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
