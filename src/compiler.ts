import Anthropic from '@anthropic-ai/sdk';
import { deleteMessagesForDate, getMessagesForDate, upsertPersonCard } from './db';
import { GitHubClient } from './github';
import { compilePersonCards } from './personCards';
import type { Env, MessageRow } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

function finalInstruction(template: string, dateStr: string): string {
  const dt = new Date(dateStr + 'T00:00:00');
  const dateYmd = dateStr;
  const dateDmy = `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
  return template.replace(/\{\{date_ymd\}\}/g, dateYmd).replace(/\{\{date_dmy\}\}/g, dateDmy);
}

type MediaContent =
  | { kind: 'bytes'; buffer: ArrayBuffer; mimeType: string }
  | { kind: 'url'; url: string };

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function transcribeAudio(env: Env, buffer: ArrayBuffer): Promise<string | null> {
  try {
    const result = (await env.AI.run('@cf/openai/whisper', {
      audio: Array.from(new Uint8Array(buffer)),
    })) as { text?: string };
    return result.text?.trim() || null;
  } catch (e) {
    console.warn('Transcription failed:', e);
    return null;
  }
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'url'; url: string; media_type: 'application/pdf' } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

function buildContentBlocks(
  messages: MessageRow[],
  resolvedMedia: Map<string, MediaContent>,
  transcriptions: Map<string, string>,
  dateStr: string,
  noteTemplate: string,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const msg of messages) {
    const hhmm = msg.timestamp.slice(11, 16);
    const text = msg.text ?? '';
    blocks.push({ type: 'text', text: `[${hhmm}] [${msg.message_type}]:\n${text}` });

    if (!msg.file_id) continue;

    const media = resolvedMedia.get(msg.file_id);
    if (!media) {
      blocks.push({ type: 'text', text: `[Media unavailable: ${msg.file_id}]` });
      continue;
    }

    const mime = msg.file_mime_type ?? '';
    if (msg.message_type === 'photo' || mime.startsWith('image/')) {
      if (media.kind === 'bytes') {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: media.mimeType || 'image/jpeg', data: arrayBufferToBase64(media.buffer) },
        });
      } else {
        blocks.push({ type: 'image', source: { type: 'url', url: media.url } });
      }
    } else if (msg.message_type === 'document' && mime === 'application/pdf') {
      if (media.kind === 'bytes') {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: arrayBufferToBase64(media.buffer) },
        });
      } else {
        blocks.push({ type: 'document', source: { type: 'url', url: media.url, media_type: 'application/pdf' } });
      }
    } else {
      const transcription = transcriptions.get(msg.file_id);
      const fallbackRef = media.kind === 'url' ? `[Audio/Video: ${media.url}]` : '[Audio/Video]';
      blocks.push({ type: 'text', text: transcription ? `[Voice/Audio transcription]: ${transcription}` : fallbackRef });
    }
  }

  blocks.push({ type: 'text', text: finalInstruction(noteTemplate, dateStr) });
  return blocks;
}

function parsePeople(markdown: string): Array<[string, string]> {
  const people: Array<[string, string]> = [];
  let inSection = false;
  for (const line of markdown.split('\n')) {
    if (line.trim() === '## People') { inSection = true; continue; }
    if (inSection) {
      if (line.startsWith('## ')) break;
      const m = line.trim().match(/^[-*]\s+(.+?)\s+[—–-]+\s+(.+)$/);
      if (m) people.push([m[1].trim(), m[2].trim()]);
    }
  }
  return people;
}

// ── Exported tools (used by batch.ts for tool execution) ──────────────────────

export const VAULT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_vault_files',
    description:
      'List files and subdirectories in the Obsidian vault at the given path. Returns a JSON array of paths; directories end with /.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path in the vault (e.g. "People", "Recipes", "Projects"). Pass empty string for root.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_vault_file',
    description: 'Read the full markdown content of a file in the Obsidian vault.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path in the vault (e.g. "People/John-Doe.md").' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_vault_file',
    description:
      'Create or update a file in the Obsidian vault. Do NOT write to the People/ directory — person cards are managed separately.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write (e.g. "Recipes/Pad-Thai.md"). Must not start with People/.' },
        content: { type: 'string', description: 'Full markdown content to write to the file.' },
      },
      required: ['path', 'content'],
    },
  },
];

export const WEB_SEARCH_TOOL: Anthropic.Tool = {
  name: 'web_search',
  description:
    'Search the internet for current information. Use to verify claims, check availability, look up prices, research topics.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query.' } },
    required: ['query'],
  },
};

export function isAllowedWritePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('People/') || normalized === 'People') return false;
  return true;
}

export async function searchWeb(query: string, tavilyKey: string): Promise<string> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: tavilyKey, query, search_depth: 'basic', include_answer: true, max_results: 5 }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const data = (await res.json()) as {
    answer?: string;
    results: Array<{ title: string; url: string; content: string }>;
  };
  const parts: string[] = [];
  if (data.answer) parts.push(`Summary: ${data.answer}`);
  for (const r of data.results) parts.push(`**${r.title}**\n${r.url}\n${r.content}`);
  return parts.join('\n\n---\n\n') || 'No results found.';
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface CompileContext {
  date: string;
  messageCount: number;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  initialMessages: Anthropic.MessageParam[];
}

export interface CompileStats {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
}

// Fetches messages, resolves media, transcribes audio, and builds the first
// user turn for the batch. Returns null if there are no messages for the date.
export async function prepareCompile(
  dateStr: string,
  env: Env,
  notify: (msg: string) => Promise<void>,
): Promise<CompileContext | null> {
  const messages = await getMessagesForDate(env.DB, dateStr);
  if (messages.length === 0) {
    await notify(`ℹ️ No messages for ${dateStr}, skipping.`);
    return null;
  }

  await notify(`🔄 Preparing compilation for ${dateStr} (${messages.length} messages)...`);

  const gh = new GitHubClient(env.GH_TOKEN, env.GH_REPO);
  const [rawSystemPrompt, rawNoteTemplate] = await Promise.all([
    gh.getFileContent('telegram-compiler-system-prompt.md', env.GH_BRANCH),
    gh.getFileContent('daily-note-template.md', env.GH_BRANCH),
  ]);
  if (!rawSystemPrompt) throw new Error('telegram-compiler-system-prompt.md not found in vault');
  if (!rawNoteTemplate) throw new Error('daily-note-template.md not found in vault');

  const systemPrompt = stripFrontmatter(rawSystemPrompt);
  const noteTemplate = stripFrontmatter(rawNoteTemplate);

  const mediaMessages = messages.filter((m) => m.file_id);
  if (mediaMessages.length > 0) {
    const r2Count = mediaMessages.filter((m) => m.r2_url).length;
    const telegramCount = mediaMessages.length - r2Count;
    await notify(
      `📎 Resolving ${mediaMessages.length} media file(s)` +
        (r2Count > 0 ? ` (${r2Count} from R2, ${telegramCount} from Telegram)` : '') +
        '...',
    );
  }

  const s3Base = env.S3_API.replace(/\/$/, '');
  const resolvedMedia = new Map<string, MediaContent>();

  for (const msg of messages) {
    if (!msg.file_id || !msg.r2_url) continue;
    try {
      const key = msg.r2_url.startsWith(s3Base + '/')
        ? msg.r2_url.slice(s3Base.length + 1)
        : msg.r2_url;
      const obj = await env.R2.get(key);
      if (!obj) throw new Error('Object not found in R2');
      resolvedMedia.set(msg.file_id, {
        kind: 'bytes',
        buffer: await obj.arrayBuffer(),
        mimeType: msg.file_mime_type ?? 'application/octet-stream',
      });
    } catch (e) {
      console.warn(`R2 fetch failed for ${msg.r2_url}: ${e}`);
    }
  }

  const audioMessages = messages.filter(
    (m) => m.file_id && (m.message_type === 'voice' || m.message_type === 'audio') && resolvedMedia.has(m.file_id),
  );
  const transcriptions = new Map<string, string>();
  if (audioMessages.length > 0) {
    await notify(`🎙️ Transcribing ${audioMessages.length} audio message(s)...`);
    for (const msg of audioMessages) {
      const media = resolvedMedia.get(msg.file_id!)!;
      const buffer = media.kind === 'bytes' ? media.buffer : await (await fetch(media.url)).arrayBuffer();
      const text = await transcribeAudio(env, buffer);
      if (text) transcriptions.set(msg.file_id!, text);
    }
  }

  const contentBlocks = buildContentBlocks(messages, resolvedMedia, transcriptions, dateStr, noteTemplate);
  const tools: Anthropic.Tool[] = [...VAULT_TOOLS, ...(env.TAVILY_API_KEY ? [WEB_SEARCH_TOOL] : [])];

  return {
    date: dateStr,
    messageCount: messages.length,
    systemPrompt,
    tools,
    initialMessages: [{ role: 'user', content: contentBlocks as Anthropic.ContentBlockParam[] }],
  };
}

// Commits the compiled note + vault files to GitHub, updates person cards,
// cleans up D1 messages, and sends a stats summary to the user.
export async function finalizeCompile(
  noteMarkdown: string,
  pendingWrites: Map<string, string>,
  dateStr: string,
  env: Env,
  notify: (msg: string) => Promise<void>,
  stats: CompileStats,
): Promise<void> {
  await notify(`📝 AI done. Committing to GitHub...`);

  const gh = new GitHubClient(env.GH_TOKEN, env.GH_REPO);

  for (const [name, context] of parsePeople(noteMarkdown)) {
    await upsertPersonCard(env.DB, name, dateStr, context);
  }

  const allWrites = [
    { path: `${dateStr}.md`, content: noteMarkdown },
    ...Array.from(pendingWrites.entries()).map(([path, content]) => ({ path, content })),
  ];

  const { commitSha, treeSha } = await gh.getBranchRef(env.GH_BRANCH);
  const blobs = await Promise.all(
    allWrites.map(async ({ path, content }) => ({
      path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: await gh.createBlob(content),
    })),
  );
  const newTreeSha = await gh.createTree(blobs, treeSha);
  const newCommitSha = await gh.createCommit(`notes: ${dateStr}`, newTreeSha, commitSha);
  await gh.updateRef(env.GH_BRANCH, newCommitSha);

  await compilePersonCards(env);
  await deleteMessagesForDate(env.DB, dateStr);

  const extraFiles = pendingWrites.size > 0 ? ` + ${pendingWrites.size} vault file(s)` : '';
  const elapsedSec = Math.round((Date.now() - new Date(stats.startedAt).getTime()) / 1000);
  const elapsed = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
  const total = stats.inputTokens + stats.outputTokens;

  console.log(`Committed daily note + ${pendingWrites.size} vault file(s): ${dateStr}`);

  await notify(
    `✅ Done! Committed ${dateStr}.md${extraFiles} to GitHub.\n\n` +
    `📊 Stats:\n` +
    `• Time: ${elapsed}\n` +
    `• Turns: ${stats.turns}\n` +
    `• Input tokens: ${stats.inputTokens.toLocaleString()}\n` +
    `• Output tokens: ${stats.outputTokens.toLocaleString()}\n` +
    `• Total tokens: ${total.toLocaleString()}`,
  );
}
