import type { MessageRow } from './types';

export async function messageExists(db: D1Database, messageId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM messages WHERE message_id = ?')
    .bind(messageId)
    .first<MessageRow>();
  return row !== null;
}

export async function saveMessage(
  db: D1Database,
  params: {
    message_id: number;
    date: string;
    timestamp: string;
    message_type: string;
    text?: string | null;
    r2_key?: string | null;
    file_mime_type?: string | null;
    file_name?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO messages (message_id, date, timestamp, message_type, text, r2_key, file_mime_type, file_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      params.message_id,
      params.date,
      params.timestamp,
      params.message_type,
      params.text ?? null,
      params.r2_key ?? null,
      params.file_mime_type ?? null,
      params.file_name ?? null,
    )
    .run();
}
