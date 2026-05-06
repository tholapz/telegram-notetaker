CREATE TABLE IF NOT EXISTS compile_jobs (
  batch_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  turn INTEGER NOT NULL DEFAULT 0,
  messages_json TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  pending_writes_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
