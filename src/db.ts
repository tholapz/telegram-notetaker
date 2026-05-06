import type { CompileJobRow, MessageRow, PersonCardRow } from './types';

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    .bind(key, value)
    .run();
}

export async function deleteMeta(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM meta WHERE key = ?').bind(key).run();
}

const COMPILE_LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes — exceeds the Cloudflare waitUntil max

// Returns the ISO start timestamp if a live lock exists.
// Auto-clears and returns null if the lock is stale (worker was likely killed by the platform).
export async function getActiveLock(db: D1Database): Promise<string | null> {
  const value = await getMeta(db, 'compile_running');
  if (!value) return null;
  if (Date.now() - new Date(value).getTime() > COMPILE_LOCK_TTL_MS) {
    await deleteMeta(db, 'compile_running');
    await deleteMeta(db, 'compile_cancel');
    return null;
  }
  return value;
}

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
    r2_url?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO messages (date, timestamp, message_type, text, file_id, file_mime_type, file_name, r2_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      params.date,
      params.timestamp,
      params.message_type,
      params.text ?? null,
      params.file_id ?? null,
      params.file_mime_type ?? null,
      params.file_name ?? null,
      params.r2_url ?? null,
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

const COMPILE_JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24h — Anthropic batch max TTL

export async function saveCompileJob(db: D1Database, job: CompileJobRow): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO compile_jobs
        (batch_id, date, chat_id, turn, messages_json, system_prompt, pending_writes_json, started_at, input_tokens, output_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      job.batch_id, job.date, job.chat_id, job.turn,
      job.messages_json, job.system_prompt, job.pending_writes_json,
      job.started_at, job.input_tokens, job.output_tokens,
    )
    .run();
}

export async function getCompileJob(db: D1Database, batchId: string): Promise<CompileJobRow | null> {
  return db.prepare('SELECT * FROM compile_jobs WHERE batch_id = ?').bind(batchId).first<CompileJobRow>();
}

export async function deleteCompileJob(db: D1Database, batchId: string): Promise<void> {
  await db.prepare('DELETE FROM compile_jobs WHERE batch_id = ?').bind(batchId).run();
}

// Returns the active job, auto-deleting any that exceeded the 24h Anthropic batch TTL.
export async function getActiveCompileJob(db: D1Database): Promise<CompileJobRow | null> {
  const job = await db.prepare('SELECT * FROM compile_jobs LIMIT 1').first<CompileJobRow>();
  if (!job) return null;
  if (Date.now() - new Date(job.started_at).getTime() > COMPILE_JOB_TTL_MS) {
    await db.prepare('DELETE FROM compile_jobs WHERE batch_id = ?').bind(job.batch_id).run();
    return null;
  }
  return job;
}
