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
    created_at: string;
    message_type: string;
    text?: string | null;
    r2_key?: string | null;
    file_mime_type?: string | null;
    file_name?: string | null;
    status?: string;
    forwarded_from?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO messages (message_id, date, created_at, message_type, text, r2_key, file_mime_type, file_name, status, forwarded_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      params.message_id,
      params.date,
      params.created_at,
      params.message_type,
      params.text ?? null,
      params.r2_key ?? null,
      params.file_mime_type ?? null,
      params.file_name ?? null,
      params.status ?? 'ok',
      params.forwarded_from ?? null,
    )
    .run();
}

export async function updateMessageText(
  db: D1Database,
  messageId: number,
  text: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE messages SET text = ? WHERE message_id = ?')
    .bind(text, messageId)
    .run();
}

export async function getStatusSummary(
  db: D1Database,
): Promise<{ lastMessageAt: string | null; failedCount: number }> {
  const row = await db
    .prepare(
      "SELECT MAX(created_at) as last_message_at, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count FROM messages",
    )
    .first<{ last_message_at: string | null; failed_count: number }>();
  return {
    lastMessageAt: row?.last_message_at ?? null,
    failedCount: row?.failed_count ?? 0,
  };
}
