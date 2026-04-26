import json

import pytest

import db


@pytest.fixture(autouse=True)
def use_tmp_db(tmp_db):
    pass


class TestSaveAndGetMessages:
    def test_save_text_and_retrieve(self):
        db.save_message("2026-04-26", "2026-04-26T10:00:00", "text", text="Hello")
        rows = db.get_messages_for_date("2026-04-26")
        assert len(rows) == 1
        assert rows[0]["text"] == "Hello"
        assert rows[0]["message_type"] == "text"
        assert rows[0]["file_id"] is None

    def test_save_photo_stores_file_id(self):
        db.save_message(
            "2026-04-26", "2026-04-26T10:01:00", "photo",
            text="caption", file_id="FXYZ123", file_mime_type="image/jpeg",
        )
        rows = db.get_messages_for_date("2026-04-26")
        assert rows[0]["file_id"] == "FXYZ123"
        assert rows[0]["file_mime_type"] == "image/jpeg"
        assert rows[0]["file_name"] is None

    def test_save_document_stores_filename(self):
        db.save_message(
            "2026-04-26", "2026-04-26T09:00:00", "document",
            file_id="DOCID", file_mime_type="application/pdf", file_name="report.pdf",
        )
        rows = db.get_messages_for_date("2026-04-26")
        assert rows[0]["file_name"] == "report.pdf"

    def test_messages_ordered_by_timestamp(self):
        db.save_message("2026-04-26", "2026-04-26T10:05:00", "text", text="Second")
        db.save_message("2026-04-26", "2026-04-26T10:01:00", "text", text="First")
        rows = db.get_messages_for_date("2026-04-26")
        assert rows[0]["text"] == "First"
        assert rows[1]["text"] == "Second"

    def test_get_messages_wrong_date_returns_empty(self):
        db.save_message("2026-04-26", "2026-04-26T10:00:00", "text", text="Today")
        assert db.get_messages_for_date("2026-04-25") == []

    def test_delete_clears_only_target_date(self):
        db.save_message("2026-04-26", "2026-04-26T10:00:00", "text", text="Today")
        db.save_message("2026-04-25", "2026-04-25T10:00:00", "text", text="Yesterday")
        db.delete_messages_for_date("2026-04-26")
        assert db.get_messages_for_date("2026-04-26") == []
        assert len(db.get_messages_for_date("2026-04-25")) == 1

    def test_delete_nonexistent_date_is_noop(self):
        db.delete_messages_for_date("1999-01-01")  # should not raise


class TestPersonCards:
    def test_upsert_creates_new_card(self):
        db.upsert_person_card("Alice Smith", "2026-04-26", "Met at conference")
        card = db.get_person_card("Alice Smith")
        assert card is not None
        assert card["first_seen"] == "2026-04-26"
        assert card["last_seen"] == "2026-04-26"
        notes = json.loads(card["notes_json"])
        assert notes == [{"date": "2026-04-26", "context": "Met at conference"}]

    def test_upsert_appends_to_existing_card(self):
        db.upsert_person_card("Bob Jones", "2026-04-25", "First meeting")
        db.upsert_person_card("Bob Jones", "2026-04-26", "Follow-up call")
        card = db.get_person_card("Bob Jones")
        assert card["first_seen"] == "2026-04-25"
        assert card["last_seen"] == "2026-04-26"
        notes = json.loads(card["notes_json"])
        assert len(notes) == 2
        assert notes[1] == {"date": "2026-04-26", "context": "Follow-up call"}

    def test_get_all_person_cards(self):
        db.upsert_person_card("Alice", "2026-04-26", "ctx a")
        db.upsert_person_card("Bob", "2026-04-26", "ctx b")
        cards = db.get_all_person_cards()
        assert {c["name"] for c in cards} == {"Alice", "Bob"}

    def test_get_person_card_not_found_returns_none(self):
        assert db.get_person_card("Nobody Here") is None

    def test_multiple_people_unique_names(self):
        db.upsert_person_card("Carol", "2026-04-26", "first")
        db.upsert_person_card("Carol", "2026-04-27", "second")
        all_cards = db.get_all_person_cards()
        carol_cards = [c for c in all_cards if c["name"] == "Carol"]
        assert len(carol_cards) == 1

    def test_upsert_same_date_is_ignored(self):
        db.upsert_person_card("Dave", "2026-04-26", "first mention")
        db.upsert_person_card("Dave", "2026-04-26", "second mention same day")
        notes = json.loads(db.get_person_card("Dave")["notes_json"])
        assert len(notes) == 1
        assert notes[0]["context"] == "first mention"
