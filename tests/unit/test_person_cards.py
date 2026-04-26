import json
from unittest.mock import MagicMock, patch

import pytest

import db
from person_cards import _card_markdown, compile_person_cards


@pytest.fixture(autouse=True)
def use_tmp_db(tmp_db):
    pass


def _make_card(name: str, first: str, last: str, notes: list[dict]) -> dict:
    return {"name": name, "first_seen": first, "last_seen": last, "notes_json": json.dumps(notes)}


class TestCardMarkdown:
    def test_renders_frontmatter(self):
        card = _make_card("Alice Smith", "2026-04-01", "2026-04-26",
                          [{"date": "2026-04-01", "context": "first"}])
        md = _card_markdown(card)
        assert "name: Alice Smith" in md
        assert "first_seen: 2026-04-01" in md
        assert "last_seen: 2026-04-26" in md

    def test_renders_h1_with_name(self):
        card = _make_card("Bob Jones", "2026-04-01", "2026-04-26",
                          [{"date": "2026-04-01", "context": "ctx"}])
        md = _card_markdown(card)
        assert "# Bob Jones" in md

    def test_interaction_log_sorted_by_date(self):
        card = _make_card("Carol", "2026-04-01", "2026-04-26", [
            {"date": "2026-04-26", "context": "later"},
            {"date": "2026-04-01", "context": "earlier"},
        ])
        md = _card_markdown(card)
        idx_early = md.index("2026-04-01")
        idx_late = md.index("2026-04-26")
        assert idx_early < idx_late

    def test_each_note_entry_formatted_correctly(self):
        card = _make_card("Dave", "2026-04-10", "2026-04-10",
                          [{"date": "2026-04-10", "context": "weekly sync"}])
        md = _card_markdown(card)
        assert "- **2026-04-10** — weekly sync" in md


class TestCompilePersonCards:
    def _mock_github(self):
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

        mock_github = MagicMock()
        mock_github.return_value.get_repo.return_value = mock_repo
        return mock_github, mock_repo

    def test_skips_when_no_cards(self):
        with patch("person_cards.Github") as mock_github:
            compile_person_cards()
            mock_github.assert_not_called()

    def test_creates_one_blob_per_person(self):
        db.upsert_person_card("Alice", "2026-04-26", "colleague")
        db.upsert_person_card("Bob", "2026-04-26", "client")

        mock_github, mock_repo = self._mock_github()
        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        assert mock_repo.create_git_blob.call_count == 2

    def test_commits_to_correct_branch(self):
        db.upsert_person_card("Carol", "2026-04-26", "ctx")

        mock_github, mock_repo = self._mock_github()
        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        mock_repo.get_git_ref.assert_called_once_with("heads/main")

    def test_file_path_uses_vault_path_and_name(self):
        db.upsert_person_card("Dave Smith", "2026-04-26", "ctx")

        mock_github, mock_repo = self._mock_github()
        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        tree_call_args = mock_repo.create_git_tree.call_args[0][0]
        paths = [b["path"] for b in tree_call_args]
        assert any("Notes/People/Dave-Smith.md" in p for p in paths)

    def test_updates_branch_ref_to_new_commit(self):
        db.upsert_person_card("Eve", "2026-04-26", "ctx")

        mock_github, mock_repo = self._mock_github()
        with patch("person_cards.Github", mock_github):
            compile_person_cards()

        mock_repo.get_git_ref.return_value.edit.assert_called_once_with("new_sha")
