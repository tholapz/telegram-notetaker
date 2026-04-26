import json
from unittest.mock import MagicMock, patch

import pytest
from github import GithubException

import db
from person_cards import (
    _card_markdown,
    _parse_notes_section,
    _parse_user_fields,
    compile_person_cards,
)


@pytest.fixture(autouse=True)
def use_tmp_db(tmp_db):
    pass


def _make_card(name: str, first: str, last: str, notes: list[dict]) -> dict:
    return {"name": name, "first_seen": first, "last_seen": last, "notes_json": json.dumps(notes)}


class TestParseUserFields:
    def test_extracts_filled_fields(self):
        content = "---\nname: Alice\nrole: Engineer\ncompany: Acme\ncontact: alice@acme.com\n---\n"
        fields = _parse_user_fields(content)
        assert fields["role"] == "Engineer"
        assert fields["company"] == "Acme"
        assert fields["contact"] == "alice@acme.com"

    def test_placeholder_for_missing_fields(self):
        content = "---\nname: Bob\nrole: —\ncompany: —\ncontact: —\n---\n"
        fields = _parse_user_fields(content)
        assert all(v == "—" for v in fields.values())

    def test_stops_at_closing_fence(self):
        content = "---\nrole: Dev\n---\n# Bob\nrole: should not match"
        fields = _parse_user_fields(content)
        assert fields["role"] == "Dev"

    def test_returns_placeholders_for_empty_content(self):
        fields = _parse_user_fields("")
        assert fields == {"role": "—", "company": "—", "contact": "—"}


class TestParseNotesSection:
    def test_extracts_notes_body(self):
        content = "## Interaction Log\n- entry\n\n## Notes\nMet at PyCon.\n\n## Other\nignored"
        assert _parse_notes_section(content) == "Met at PyCon."

    def test_multiline_notes_preserved(self):
        content = "## Notes\nLine one.\nLine two.\n## Other\n"
        assert _parse_notes_section(content) == "Line one.\nLine two."

    def test_returns_placeholder_when_section_absent(self):
        assert _parse_notes_section("## Interaction Log\n- entry\n") == "—"

    def test_returns_placeholder_when_section_empty(self):
        assert _parse_notes_section("## Notes\n## Other\n") == "—"


class TestCardMarkdown:
    def test_renders_frontmatter_with_placeholders_by_default(self):
        card = _make_card("Alice Smith", "2026-04-01", "2026-04-26",
                          [{"date": "2026-04-01", "context": "first"}])
        md = _card_markdown(card)
        assert "role: —" in md
        assert "company: —" in md
        assert "contact: —" in md

    def test_renders_frontmatter_with_provided_user_fields(self):
        card = _make_card("Bob", "2026-04-01", "2026-04-26",
                          [{"date": "2026-04-01", "context": "ctx"}])
        fields = {"role": "Engineer", "company": "Acme", "contact": "bob@acme.com"}
        md = _card_markdown(card, user_fields=fields)
        assert "role: Engineer" in md
        assert "company: Acme" in md
        assert "contact: bob@acme.com" in md

    def test_renders_notes_section(self):
        card = _make_card("Carol", "2026-04-01", "2026-04-26",
                          [{"date": "2026-04-01", "context": "ctx"}])
        md = _card_markdown(card, notes_body="Knows Thai and English.")
        assert "## Notes\nKnows Thai and English." in md

    def test_notes_section_placeholder_by_default(self):
        card = _make_card("Dave", "2026-04-01", "2026-04-26",
                          [{"date": "2026-04-01", "context": "ctx"}])
        md = _card_markdown(card)
        assert "## Notes\n—" in md

    def test_renders_h1_with_name(self):
        card = _make_card("Eve", "2026-04-01", "2026-04-26",
                          [{"date": "2026-04-01", "context": "ctx"}])
        assert "# Eve" in _card_markdown(card)

    def test_interaction_log_sorted_by_date(self):
        card = _make_card("Frank", "2026-04-01", "2026-04-26", [
            {"date": "2026-04-26", "context": "later"},
            {"date": "2026-04-01", "context": "earlier"},
        ])
        md = _card_markdown(card)
        assert md.index("2026-04-01") < md.index("2026-04-26")


class TestCompilePersonCards:
    def _mock_repo(self, existing_content: str | None = None):
        mock_ref = MagicMock()
        mock_ref.object.sha = "base_sha"
        mock_commit = MagicMock()
        mock_commit.tree = MagicMock()
        mock_blob = MagicMock()
        mock_blob.sha = "blob_sha"
        mock_tree = MagicMock()
        mock_new_commit = MagicMock()
        mock_new_commit.sha = "new_sha"

        mock_repo = MagicMock()
        mock_repo.get_git_ref.return_value = mock_ref
        mock_repo.get_git_commit.return_value = mock_commit
        mock_repo.create_git_blob.return_value = mock_blob
        mock_repo.create_git_tree.return_value = mock_tree
        mock_repo.create_git_commit.return_value = mock_new_commit

        if existing_content is not None:
            existing_file = MagicMock()
            existing_file.decoded_content = existing_content.encode()
            mock_repo.get_contents.return_value = existing_file
        else:
            mock_repo.get_contents.side_effect = GithubException(404, {}, {})

        mock_github = MagicMock()
        mock_github.return_value.get_repo.return_value = mock_repo
        return mock_github, mock_repo

    def test_skips_when_no_cards(self):
        with patch("person_cards.Github") as mock_github:
            compile_person_cards()
            mock_github.assert_not_called()

    def test_new_card_has_placeholder_fields(self):
        db.upsert_person_card("Alice", "2026-04-26", "colleague")
        mock_github, mock_repo = self._mock_repo(existing_content=None)

        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        content = mock_repo.create_git_blob.call_args[0][0]
        assert "role: —" in content
        assert "company: —" in content
        assert "contact: —" in content
        assert "## Notes\n—" in content

    def test_existing_card_preserves_user_fields(self):
        db.upsert_person_card("Bob", "2026-04-26", "client")
        existing = (
            "---\nname: Bob\nfirst_seen: 2026-04-01\nlast_seen: 2026-04-26\n"
            "role: CTO\ncompany: StartupCo\ncontact: bob@startup.io\n---\n\n"
            "## Interaction Log\n- **2026-04-01** — first\n\n"
            "## Notes\nVery technical background.\n"
        )
        mock_github, mock_repo = self._mock_repo(existing_content=existing)

        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        content = mock_repo.create_git_blob.call_args[0][0]
        assert "role: CTO" in content
        assert "company: StartupCo" in content
        assert "contact: bob@startup.io" in content
        assert "Very technical background." in content

    def test_creates_one_blob_per_person(self):
        db.upsert_person_card("Alice", "2026-04-26", "colleague")
        db.upsert_person_card("Bob", "2026-04-26", "client")
        mock_github, mock_repo = self._mock_repo(existing_content=None)

        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        assert mock_repo.create_git_blob.call_count == 2

    def test_commits_to_correct_branch(self):
        db.upsert_person_card("Carol", "2026-04-26", "ctx")
        mock_github, mock_repo = self._mock_repo(existing_content=None)

        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        mock_repo.get_git_ref.assert_called_once_with("heads/main")

    def test_file_path_uses_vault_path_and_name(self):
        db.upsert_person_card("Dave Smith", "2026-04-26", "ctx")
        mock_github, mock_repo = self._mock_repo(existing_content=None)

        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        tree_args = mock_repo.create_git_tree.call_args[0][0]
        paths = [b._identity["path"] for b in tree_args]
        assert any("Notes/People/Dave-Smith.md" in p for p in paths)

    def test_updates_branch_ref_to_new_commit(self):
        db.upsert_person_card("Eve", "2026-04-26", "ctx")
        mock_github, mock_repo = self._mock_repo(existing_content=None)

        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        mock_repo.get_git_ref.return_value.edit.assert_called_once_with("new_sha")

    def test_github_error_other_than_404_propagates(self):
        db.upsert_person_card("Frank", "2026-04-26", "ctx")
        mock_github, mock_repo = self._mock_repo(existing_content=None)
        mock_repo.get_contents.side_effect = GithubException(500, {}, {})

        with patch("person_cards.Github", mock_github):
            with pytest.raises(GithubException):
                compile_person_cards()
