CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL UNIQUE,
  date TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  message_type TEXT NOT NULL,
  text TEXT,
  r2_key TEXT,
  file_mime_type TEXT,
  file_name TEXT
);
