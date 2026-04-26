import json
import sqlite3
from pathlib import Path

DB_PATH = Path("/app/data/notes.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                message_type TEXT NOT NULL,
                text TEXT,
                file_id TEXT,
                file_mime_type TEXT,
                file_name TEXT
            );
            CREATE TABLE IF NOT EXISTS person_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                notes_json TEXT NOT NULL
            );
        """)


def save_message(
    date: str,
    timestamp: str,
    message_type: str,
    text: str | None = None,
    file_id: str | None = None,
    file_mime_type: str | None = None,
    file_name: str | None = None,
) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO messages (date, timestamp, message_type, text, file_id, file_mime_type, file_name)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (date, timestamp, message_type, text, file_id, file_mime_type, file_name),
        )


def get_messages_for_date(date_str: str) -> list[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM messages WHERE date = ? ORDER BY timestamp",
            (date_str,),
        ).fetchall()


def delete_messages_for_date(date_str: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM messages WHERE date = ?", (date_str,))


def upsert_person_card(name: str, date_str: str, context: str) -> None:
    with _connect() as conn:
        existing = conn.execute(
            "SELECT * FROM person_cards WHERE name = ?", (name,)
        ).fetchone()
        if existing:
            notes = json.loads(existing["notes_json"])
            if any(n["date"] == date_str for n in notes):
                return
            notes.append({"date": date_str, "context": context})
            conn.execute(
                "UPDATE person_cards SET last_seen = ?, notes_json = ? WHERE name = ?",
                (date_str, json.dumps(notes), name),
            )
        else:
            conn.execute(
                "INSERT INTO person_cards (name, first_seen, last_seen, notes_json) VALUES (?, ?, ?, ?)",
                (name, date_str, date_str, json.dumps([{"date": date_str, "context": context}])),
            )


def get_person_card(name: str) -> sqlite3.Row | None:
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM person_cards WHERE name = ?", (name,)
        ).fetchone()


def get_all_person_cards() -> list[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute("SELECT * FROM person_cards").fetchall()
