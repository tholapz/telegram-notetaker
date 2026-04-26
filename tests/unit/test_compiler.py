import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from github import GithubException

from compiler import _build_content_blocks, _parse_people, compile_daily_note


def _row(
    timestamp: str,
    message_type: str,
    text: str | None = None,
    file_id: str | None = None,
    file_mime_type: str | None = None,
) -> dict:
    """Build a dict that mimics a sqlite3.Row for compiler internals."""
    return {
        "timestamp": timestamp,
        "message_type": message_type,
        "text": text,
        "file_id": file_id,
        "file_mime_type": file_mime_type,
    }


class TestBuildContentBlocks:
    def test_text_message_becomes_text_block(self):
        msgs = [_row("2026-04-26T10:30:00", "text", text="hello world")]
        blocks = _build_content_blocks(msgs, {})
        text_block = blocks[0]
        assert text_block["type"] == "text"
        assert "10:30" in text_block["text"]
        assert "hello world" in text_block["text"]
        assert "[text]" in text_block["text"]

    def test_photo_with_uri_becomes_image_block(self):
        msgs = [_row("2026-04-26T10:00:00", "photo", file_id="FID1", file_mime_type="image/jpeg")]
        blocks = _build_content_blocks(msgs, {"FID1": "https://example.com/img.jpg"})
        img_block = next(b for b in blocks if b.get("type") == "image")
        assert img_block["source"]["type"] == "url"
        assert img_block["source"]["url"] == "https://example.com/img.jpg"

    def test_pdf_document_becomes_document_block(self):
        msgs = [_row("2026-04-26T10:00:00", "document", file_id="FID2",
                     file_mime_type="application/pdf")]
        blocks = _build_content_blocks(msgs, {"FID2": "https://example.com/doc.pdf"})
        doc_block = next(b for b in blocks if b.get("type") == "document")
        assert doc_block["source"]["media_type"] == "application/pdf"

    def test_voice_with_uri_becomes_text_reference(self):
        msgs = [_row("2026-04-26T10:00:00", "voice", file_id="FID3",
                     file_mime_type="audio/ogg")]
        uri = "https://api.telegram.org/file/botTOKEN/voice.ogg"
        blocks = _build_content_blocks(msgs, {"FID3": uri})
        audio_ref = next(
            b for b in blocks
            if b.get("type") == "text" and "Audio/Video" in b.get("text", "")
        )
        assert uri in audio_ref["text"]

    def test_unresolved_file_id_becomes_unavailable_placeholder(self):
        msgs = [_row("2026-04-26T10:00:00", "photo", file_id="MISSING")]
        blocks = _build_content_blocks(msgs, {})
        unavailable = next(
            b for b in blocks
            if b.get("type") == "text" and "Media unavailable" in b.get("text", "")
        )
        assert "MISSING" in unavailable["text"]

    def test_final_instruction_block_always_appended(self):
        blocks = _build_content_blocks([], {})
        assert any("Daily Note" in b.get("text", "") for b in blocks)

    def test_empty_text_field_renders_as_empty_string(self):
        msgs = [_row("2026-04-26T10:00:00", "photo", text=None)]
        blocks = _build_content_blocks(msgs, {})
        text_block = blocks[0]
        assert text_block["type"] == "text"
        assert text_block["text"].endswith(":\n")


class TestParsePeople:
    def test_parses_em_dash_format(self):
        markdown = "## People\n- Alice Smith — met at conference\n- Bob Jones — client call\n## Other\n"
        people = _parse_people(markdown)
        assert ("Alice Smith", "met at conference") in people
        assert ("Bob Jones", "client call") in people

    def test_stops_at_next_section(self):
        markdown = "## People\n- Carol — colleague\n## Raw Timeline\n- Dave — should be ignored\n"
        people = _parse_people(markdown)
        assert len(people) == 1
        assert people[0][0] == "Carol"

    def test_returns_empty_for_no_people_section(self):
        markdown = "## Accomplishments\n- did stuff\n"
        assert _parse_people(markdown) == []

    def test_returns_empty_for_empty_people_section(self):
        markdown = "## People\n## Raw Timeline\n"
        assert _parse_people(markdown) == []

    def test_handles_en_dash(self):
        markdown = "## People\n- Eve – partner\n"
        people = _parse_people(markdown)
        assert people[0][0] == "Eve"
        assert people[0][1] == "partner"

    def test_asterisk_bullet_format(self):
        markdown = "## People\n* Frank — vendor\n"
        people = _parse_people(markdown)
        assert people[0] == ("Frank", "vendor")


class TestCompileDailyNote:
    @pytest.fixture
    def mock_messages(self):
        return [_row("2026-04-26T09:00:00", "text", text="morning note")]

    @pytest.fixture
    def llm_response_text(self):
        return (
            "---\ndate: 2026-04-26\ntags: [work]\npeople: []\n---\n\n"
            "# Daily Note — 26-04-2026\n\n## People\n- Alice — colleague\n\n"
            "## Raw Timeline\n### 09:00\nmorning note\n\n---"
        )

    async def test_skips_when_no_messages(self, tmp_db):
        with patch("compiler.get_messages_for_date", return_value=[]):
            await compile_daily_note("2026-04-26")
            # No exception, no further calls

    async def test_calls_llm_and_commits_note(self, tmp_db, mock_messages, llm_response_text):
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=llm_response_text)]

        mock_repo = MagicMock()
        mock_repo.get_contents.side_effect = GithubException(404, {}, {})
        mock_repo.create_file = MagicMock()

        with (
            patch("compiler.get_messages_for_date", return_value=mock_messages),
            patch("compiler.anthropic.AsyncAnthropic") as mock_client_cls,
            patch("compiler.Github") as mock_github_cls,
            patch("compiler.upsert_person_card") as mock_upsert,
            patch("compiler.compile_person_cards") as mock_cards,
            patch("compiler.delete_messages_for_date") as mock_delete,
        ):
            mock_client = MagicMock()
            mock_client_cls.return_value = mock_client
            mock_client.messages.create = AsyncMock(return_value=mock_response)

            mock_github_cls.return_value.get_repo.return_value = mock_repo

            await compile_daily_note("2026-04-26")

            mock_client.messages.create.assert_awaited_once()
            mock_repo.create_file.assert_called_once()
            commit_path = mock_repo.create_file.call_args[0][0]
            assert "2026-04-26.md" in commit_path

            mock_upsert.assert_called_once_with("Alice", "2026-04-26", "colleague")
            mock_cards.assert_called_once()
            mock_delete.assert_called_once_with("2026-04-26")

    async def test_resolves_media_uris_before_llm(self, tmp_db, llm_response_text):
        photo_msg = _row("2026-04-26T10:00:00", "photo",
                         file_id="FID9", file_mime_type="image/jpeg")

        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=llm_response_text)]
        mock_repo = MagicMock()
        mock_repo.get_contents.side_effect = GithubException(404, {}, {})

        mock_bot = MagicMock()
        tg_file = MagicMock()
        tg_file.file_path = "photos/file.jpg"
        mock_bot.get_file = AsyncMock(return_value=tg_file)

        with (
            patch("compiler.get_messages_for_date", return_value=[photo_msg]),
            patch("compiler.anthropic.AsyncAnthropic") as mock_client_cls,
            patch("compiler.Github") as mock_github_cls,
            patch("compiler.upsert_person_card"),
            patch("compiler.compile_person_cards"),
            patch("compiler.delete_messages_for_date"),
        ):
            mock_client = MagicMock()
            mock_client_cls.return_value = mock_client
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_github_cls.return_value.get_repo.return_value = mock_repo

            await compile_daily_note("2026-04-26", bot=mock_bot)

            call_kwargs = mock_client.messages.create.call_args[1]
            content = call_kwargs["messages"][0]["content"]
            img_block = next(b for b in content if b.get("type") == "image")
            assert "photos/file.jpg" in img_block["source"]["url"]

    async def test_media_resolution_failure_uses_placeholder(self, tmp_db, llm_response_text):
        photo_msg = _row("2026-04-26T10:00:00", "photo",
                         file_id="BAD_FID", file_mime_type="image/jpeg")

        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=llm_response_text)]
        mock_repo = MagicMock()
        mock_repo.get_contents.side_effect = GithubException(404, {}, {})

        mock_bot = MagicMock()
        mock_bot.get_file = AsyncMock(side_effect=RuntimeError("Telegram error"))

        with (
            patch("compiler.get_messages_for_date", return_value=[photo_msg]),
            patch("compiler.anthropic.AsyncAnthropic") as mock_client_cls,
            patch("compiler.Github") as mock_github_cls,
            patch("compiler.upsert_person_card"),
            patch("compiler.compile_person_cards"),
            patch("compiler.delete_messages_for_date"),
        ):
            mock_client = MagicMock()
            mock_client_cls.return_value = mock_client
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_github_cls.return_value.get_repo.return_value = mock_repo

            await compile_daily_note("2026-04-26", bot=mock_bot)

            call_kwargs = mock_client.messages.create.call_args[1]
            content = call_kwargs["messages"][0]["content"]
            placeholder = next(
                b for b in content
                if b.get("type") == "text" and "Media unavailable" in b.get("text", "")
            )
            assert "BAD_FID" in placeholder["text"]

    async def test_updates_existing_github_file(self, tmp_db, mock_messages, llm_response_text):
        mock_response = MagicMock()
        mock_response.content = [MagicMock(text=llm_response_text)]

        existing_file = MagicMock()
        existing_file.sha = "abc123"
        mock_repo = MagicMock()
        mock_repo.get_contents.return_value = existing_file
        mock_repo.update_file = MagicMock()

        with (
            patch("compiler.get_messages_for_date", return_value=mock_messages),
            patch("compiler.anthropic.AsyncAnthropic") as mock_client_cls,
            patch("compiler.Github") as mock_github_cls,
            patch("compiler.upsert_person_card"),
            patch("compiler.compile_person_cards"),
            patch("compiler.delete_messages_for_date"),
        ):
            mock_client = MagicMock()
            mock_client_cls.return_value = mock_client
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_github_cls.return_value.get_repo.return_value = mock_repo

            await compile_daily_note("2026-04-26")

            mock_repo.update_file.assert_called_once()
            assert mock_repo.update_file.call_args[0][3] == "abc123"
