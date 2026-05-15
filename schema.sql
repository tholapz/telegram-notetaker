CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL UNIQUE,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message_type TEXT NOT NULL,
  text TEXT,
  anthropic_file_id TEXT,
  file_mime_type TEXT,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  forwarded_from TEXT
);
