import Anthropic from '@anthropic-ai/sdk';
import { deleteMessagesForDate, getMessagesForDate, upsertPersonCard } from './db';
import { GitHubClient } from './github';
import { compilePersonCards } from './personCards';
import type { Env, MessageRow } from './types';

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

function finalInstruction(template: string, dateStr: string): string {
  let dateYmd: string;
  let dateDmy: string;
  if (dateStr) {
    const dt = new Date(dateStr + 'T00:00:00');
    dateYmd = dateStr;
    dateDmy = `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
  } else {
    dateYmd = 'YYYY-MM-DD';
    dateDmy = 'DD-MM-YYYY';
  }

  return template
    .replace(/\{\{date_ymd\}\}/g, dateYmd)
    .replace(/\{\{date_dmy\}\}/g, dateDmy);
}

async function resolveFileUri(token: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
  );
  if (!res.ok) throw new Error(`Telegram getFile ${fileId} → ${res.status}`);
  const data = (await res.json()) as { result: { file_path: string } };
  return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } }
  | { type: 'document'; source: { type: 'url'; url: string; media_type: 'application/pdf' } };

function buildContentBlocks(
  messages: MessageRow[],
  resolvedUris: Map<string, string>,
  dateStr: string,
  noteTemplate: string,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const msg of messages) {
    const hhmm = msg.timestamp.slice(11, 16);
    const text = msg.text ?? '';
    blocks.push({ type: 'text', text: `[${hhmm}] [${msg.message_type}]:\n${text}` });

    if (!msg.file_id) continue;

    const uri = resolvedUris.get(msg.file_id);
    if (!uri) {
      blocks.push({ type: 'text', text: `[Media unavailable: ${msg.file_id}]` });
      continue;
    }

    const mime = msg.file_mime_type ?? '';
    if (msg.message_type === 'photo' || mime.startsWith('image/')) {
      blocks.push({ type: 'image', source: { type: 'url', url: uri } });
    } else if (msg.message_type === 'document' && mime === 'application/pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'url', url: uri, media_type: 'application/pdf' },
      });
    } else {
      blocks.push({ type: 'text', text: `[Audio/Video: ${uri}]` });
    }
  }

  blocks.push({ type: 'text', text: finalInstruction(noteTemplate, dateStr) });
  return blocks;
}

function parsePeople(markdown: string): Array<[string, string]> {
  const people: Array<[string, string]> = [];
  let inSection = false;
  for (const line of markdown.split('\n')) {
    if (line.trim() === '## People') {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (line.startsWith('## ')) break;
      const m = line.trim().match(/^[-*]\s+(.+?)\s+[—–-]+\s+(.+)$/);
      if (m) people.push([m[1].trim(), m[2].trim()]);
    }
  }
  return people;
}

export async function compileDailyNote(dateStr: string, env: Env): Promise<void> {
  const messages = await getMessagesForDate(env.DB, dateStr);
  if (messages.length === 0) {
    console.log(`No messages for ${dateStr}, skipping.`);
    return;
  }

  const gh = new GitHubClient(env.GH_TOKEN, env.GH_REPO);

  const [rawSystemPrompt, rawNoteTemplate] = await Promise.all([
    gh.getFileContent('telegram-compiler-system-prompt.md', env.GH_BRANCH),
    gh.getFileContent('daily-note-template.md', env.GH_BRANCH),
  ]);
  if (!rawSystemPrompt) throw new Error('telegram-compiler-system-prompt.md not found in vault');
  if (!rawNoteTemplate) throw new Error('daily-note-template.md not found in vault');

  const systemPrompt = stripFrontmatter(rawSystemPrompt);
  const noteTemplate = stripFrontmatter(rawNoteTemplate);

  const resolvedUris = new Map<string, string>();
  for (const msg of messages) {
    if (msg.file_id) {
      try {
        resolvedUris.set(msg.file_id, await resolveFileUri(env.TELEGRAM_BOT_TOKEN, msg.file_id));
      } catch (e) {
        console.warn(`Could not resolve file_id ${msg.file_id}: ${e}`);
      }
    }
  }

  const contentBlocks = buildContentBlocks(messages, resolvedUris, dateStr, noteTemplate);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: env.MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: contentBlocks as Anthropic.ContentBlockParam[],
      },
    ],
  });
  const noteMarkdown = (response.content[0] as Anthropic.TextBlock).text;

  for (const [name, context] of parsePeople(noteMarkdown)) {
    await upsertPersonCard(env.DB, name, dateStr, context);
  }

  await gh.upsertFile(`${dateStr}.md`, noteMarkdown, `notes: ${dateStr}`, env.GH_BRANCH);
  console.log(`Committed daily note: ${dateStr}.md`);

  await compilePersonCards(env);

  await deleteMessagesForDate(env.DB, dateStr);
  console.log(`Deleted messages for ${dateStr} from D1.`);
}
