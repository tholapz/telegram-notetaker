#!/usr/bin/env node
/**
 * Backfill R2 uploads for early messages that have a file_id but no r2_url.
 *
 * Usage: node scripts/backfill-r2.mjs [--dry-run]
 *
 * Requires: wrangler authenticated, .env present at project root.
 */

import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const DB_NAME = 'telegram-notetaker';
const R2_BUCKET = 'obsidian-vault';

// ── Load .env ─────────────────────────────────────────────────────────────────

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv(path.join(ROOT, '.env'));
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const S3_API = env.S3_API?.replace(/\/$/, '');

if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set in .env');
if (!S3_API) throw new Error('S3_API not set in .env');

// ── Helpers ───────────────────────────────────────────────────────────────────

function npxWrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf-8', cwd: ROOT });
}

function d1Query(sql) {
  const out = npxWrangler(['d1', 'execute', DB_NAME, '--json', `--command=${sql}`, '--remote']);
  // Strip any non-JSON preamble (wrangler deprecation notices etc.)
  const jsonStart = out.indexOf('[');
  if (jsonStart === -1) throw new Error(`Unexpected wrangler output:\n${out}`);
  const parsed = JSON.parse(out.slice(jsonStart));
  return parsed[0]?.results ?? [];
}

function d1Run(sql) {
  if (DRY_RUN) {
    console.log(`  [dry-run] SQL: ${sql}`);
    return;
  }
  npxWrangler(['d1', 'execute', DB_NAME, `--command=${sql}`, '--remote']);
}

function r2Put(key, tmpFile, contentType) {
  if (DRY_RUN) {
    console.log(`  [dry-run] r2 put ${R2_BUCKET}/${key} (${contentType})`);
    return;
  }
  npxWrangler([
    'r2', 'object', 'put',
    `${R2_BUCKET}/${key}`,
    `--file=${tmpFile}`,
    `--content-type=${contentType}`,
    '--remote'
  ]);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const rows = d1Query(
  'SELECT id, file_id, file_mime_type FROM messages WHERE file_id IS NOT NULL AND r2_url IS NULL',
);

if (rows.length === 0) {
  console.log('No rows to backfill.');
  process.exit(0);
}

console.log(`Found ${rows.length} row(s) to backfill.${DRY_RUN ? ' (dry-run)' : ''}\n`);

let ok = 0;
let failed = 0;

for (const row of rows) {
  const { id, file_id, file_mime_type } = row;
  const mime = file_mime_type ?? 'application/octet-stream';
  process.stdout.write(`[${id}] file_id=${file_id} … `);

  // 1. Resolve file path via Telegram
  let filePath;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}`,
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.description ?? JSON.stringify(data));
    filePath = data.result.file_path;
  } catch (e) {
    console.log(`SKIP (getFile failed: ${e.message})`);
    failed++;
    continue;
  }

  // 2. Download file bytes
  let buffer;
  try {
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.log(`SKIP (download failed: ${e.message})`);
    failed++;
    continue;
  }

  // 3. Upload to R2
  const key = `telegram-media/${file_id}`;
  const tmpFile = path.join(tmpdir(), `tg-backfill-${id}`);
  try {
    writeFileSync(tmpFile, buffer);
    r2Put(key, tmpFile, mime);
  } catch (e) {
    console.log(`SKIP (R2 upload failed: ${e.message})`);
    failed++;
    continue;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }

  // 4. Update r2_url in D1 (escape single quotes for inline SQL)
  const r2_url = `${S3_API}/${key}`;
  const safeUrl = r2_url.replace(/'/g, "''");
  try {
    d1Run(`UPDATE messages SET r2_url='${safeUrl}' WHERE id=${id}`);
  } catch (e) {
    console.log(`SKIP (D1 update failed: ${e.message})`);
    failed++;
    continue;
  }

  console.log(`OK → ${r2_url}`);
  ok++;
}

console.log(`\nDone. ${ok} uploaded, ${failed} failed/skipped.`);
if (failed > 0) process.exit(1);
