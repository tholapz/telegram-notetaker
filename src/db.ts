import type { MessageRow, PersonCardRow } from './types';

export async function saveMessage(
  db: D1Database,
  params: {
    date: string;
    timestamp: string;
    message_type: string;
    text?: string | null;
    file_id?: string | null;
    file_mime_type?: string | null;
    file_name?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO messages (date, timestamp, message_type, text, file_id, file_mime_type, file_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      params.date,
      params.timestamp,
      params.message_type,
      params.text ?? null,
      params.file_id ?? null,
      params.file_mime_type ?? null,
      params.file_name ?? null,
    )
    .run();
}

export async function getMessagesForDate(db: D1Database, dateStr: string): Promise<MessageRow[]> {
  const result = await db
    .prepare('SELECT * FROM messages WHERE date = ? ORDER BY timestamp')
    .bind(dateStr)
    .all<MessageRow>();
  return result.results;
}

export async function deleteMessagesForDate(db: D1Database, dateStr: string): Promise<void> {
  await db.prepare('DELETE FROM messages WHERE date = ?').bind(dateStr).run();
}

export async function upsertPersonCard(
  db: D1Database,
  name: string,
  dateStr: string,
  context: string,
): Promise<void> {
  const existing = await db
    .prepare('SELECT * FROM person_cards WHERE name = ?')
    .bind(name)
    .first<PersonCardRow>();

  if (existing) {
    const notes: Array<{ date: string; context: string }> = JSON.parse(existing.notes_json);
    if (notes.some((n) => n.date === dateStr)) return;
    notes.push({ date: dateStr, context });
    await db
      .prepare('UPDATE person_cards SET last_seen = ?, notes_json = ? WHERE name = ?')
      .bind(dateStr, JSON.stringify(notes), name)
      .run();
  } else {
    await db
      .prepare(
        'INSERT INTO person_cards (name, first_seen, last_seen, notes_json) VALUES (?, ?, ?, ?)',
      )
      .bind(name, dateStr, dateStr, JSON.stringify([{ date: dateStr, context }]))
      .run();
  }
}

export async function getAllPersonCards(db: D1Database): Promise<PersonCardRow[]> {
  const result = await db.prepare('SELECT * FROM person_cards').all<PersonCardRow>();
  return result.results;
}
