import Anthropic from '@anthropic-ai/sdk';
import { deleteMessagesForDate, getMessagesForDate, upsertPersonCard } from './db';
import { GitHubClient } from './github';
import { compilePersonCards } from './personCards';
import type { Env, MessageRow } from './types';

const SYSTEM_PROMPT = `\
You are a personal knowledge assistant for a solo AI consultant based in Bangkok.
You receive a day's worth of raw notes — text messages, photos, voice memos, videos,
and documents — captured informally via Telegram throughout the day.

Your task is to produce a structured daily note in Obsidian Markdown format.

Analyze all content carefully. For media, examine the actual content of the image,
listen to/read voice or document content where possible.

TIMESTAMPS: If a message begins with an explicit time in brackets like [09:30], use that
as the event time in the Raw Timeline. Otherwise, use the Telegram message timestamp and
append "(logged)" to indicate it reflects when the note was captured, not when the event
occurred.

LINKS: Extract every URL found in all messages for the References section. Infer a short
descriptive title from surrounding context or the URL path. If no context exists, use the
domain as the title.

AI CONVERSATIONS: Messages prefixed with #ai-claude, #ai-gpt, or #ai-gemini contain
excerpts from AI conversations. Preserve the Q&A structure verbatim. Do not summarize
unless the excerpt exceeds 500 words. Group by tool under AI Conversations.

Output ONLY the Markdown content. No preamble, no explanation.`;

function finalInstruction(dateStr: string): string {
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

  return `\
Based on all the above, produce the daily note using EXACTLY this structure:

---
date: ${dateYmd}
tags: [<2-5 inferred tags>]
people: [<all names mentioned>]
---

# Daily Note — ${dateDmy}

## Handoff
<!-- 3-5 bullets: open items, pending decisions, and critical context to resume tomorrow -->
<bullet list — omit section if nothing is unresolved>

## Accomplishments
<!-- What was completed or meaningfully progressed today -->
<bullet list — omit section if nothing qualifies>

## Challenges
<!-- Obstacles, blockers, frustrations encountered today -->
<bullet list — omit section if nothing qualifies>

## Learnings
<!-- New knowledge, insights, or realizations from today -->
<bullet list — omit section if nothing qualifies>

## AI Conversations
<!-- Conversations with Claude, ChatGPT, or Gemini captured today via #ai-* tags -->
<grouped by tool, Q&A preserved — omit section if no #ai-* messages found>

## People
<!-- For each person mentioned, one line: Name — context of interaction -->
<list — omit section if no people mentioned>

## References
<!-- All URLs from today's notes. Format: [title or domain](URL) -->
<list — omit section if no links found>

## Raw Timeline
<!-- Event times where known; append "(logged)" when using Telegram message timestamp -->
### HH:MM
<original text or caption>
<if media: insert markdown reference — image embed for photos, link for others>

---`;
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

  blocks.push({ type: 'text', text: finalInstruction(dateStr) });
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

  const contentBlocks = buildContentBlocks(messages, resolvedUris, dateStr);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: env.MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
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

  const gh = new GitHubClient(env.GH_TOKEN, env.GH_REPO);
  await gh.upsertFile(`${dateStr}.md`, noteMarkdown, `notes: ${dateStr}`, env.GH_BRANCH);
  console.log(`Committed daily note: ${dateStr}.md`);

  await compilePersonCards(env);

  await deleteMessagesForDate(env.DB, dateStr);
  console.log(`Deleted messages for ${dateStr} from D1.`);
}
