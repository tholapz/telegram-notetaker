import Anthropic from '@anthropic-ai/sdk';
import { deleteMessagesForDate, getMeta, getMessagesForDate, upsertPersonCard } from './db';
import { GitHubClient } from './github';
import { compilePersonCards } from './personCards';
import type { Env, MessageRow } from './types';

export class CompilationCancelledError extends Error {
  constructor() {
    super('Compilation cancelled by user');
    this.name = 'CompilationCancelledError';
  }
}

async function checkCancelled(env: Env): Promise<void> {
  const flag = await getMeta(env.DB, 'compile_cancel');
  if (flag === '1') throw new CompilationCancelledError();
}

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

type MediaContent =
  | { kind: 'bytes'; buffer: ArrayBuffer; mimeType: string }
  | { kind: 'url'; url: string };

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
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
        blocks.push({
          type: 'document',
          source: { type: 'url', url: media.url, media_type: 'application/pdf' },
        });
      }
    } else {
      const transcription = transcriptions.get(msg.file_id);
      const fallbackRef = media.kind === 'url' ? `[Audio/Video: ${media.url}]` : '[Audio/Video]';
      blocks.push({
        type: 'text',
        text: transcription ? `[Voice/Audio transcription]: ${transcription}` : fallbackRef,
      });
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

const VAULT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_vault_files',
    description:
      'List files and subdirectories in the Obsidian vault at the given path. Returns a JSON array of paths; directories end with /.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Directory path in the vault (e.g. "People", "Recipes", "Projects"). Pass empty string for root.',
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
        path: {
          type: 'string',
          description:
            'File path in the vault (e.g. "People/John-Doe.md", "Recipes/Pad-Thai.md").',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_vault_file',
    description:
      'Create or update a file in the Obsidian vault. Use for recipe cards, project notes, resource references, research summaries, etc. Do NOT write to the People/ directory — person cards are managed separately.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'File path to write (e.g. "Recipes/Pad-Thai.md", "Projects/Website.md"). Must not start with People/.',
        },
        content: {
          type: 'string',
          description: 'Full markdown content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
];

const WEB_SEARCH_TOOL: Anthropic.Tool = {
  name: 'web_search',
  description:
    'Search the internet for current information. Use this to verify claims in notes, check product availability, find alternatives, look up current prices, research topics mentioned, or surface relevant context.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Be specific for better results.',
      },
    },
    required: ['query'],
  },
};

function isAllowedWritePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('People/') || normalized === 'People') return false;
  return true;
}

async function searchWeb(query: string, tavilyKey: string): Promise<string> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: tavilyKey,
      query,
      search_depth: 'basic',
      include_answer: true,
      max_results: 5,
    }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const data = (await res.json()) as {
    answer?: string;
    results: Array<{ title: string; url: string; content: string }>;
  };

  const parts: string[] = [];
  if (data.answer) parts.push(`Summary: ${data.answer}`);
  for (const r of data.results) {
    parts.push(`**${r.title}**\n${r.url}\n${r.content}`);
  }
  return parts.join('\n\n---\n\n') || 'No results found.';
}

function stripUrlBlocks(content: Anthropic.ContentBlockParam[]): Anthropic.ContentBlockParam[] {
  return content.map((block): Anthropic.ContentBlockParam => {
    if (block.type === 'image' || block.type === 'document') {
      return { type: 'text', text: '[Media unavailable: blocked by server]' };
    }
    return block;
  });
}

async function runAgenticCompiler(
  client: Anthropic,
  gh: GitHubClient,
  env: Env,
  systemPrompt: string,
  initialContent: Anthropic.ContentBlockParam[],
  notify: (msg: string) => Promise<void> = async () => {},
): Promise<{ noteMarkdown: string; pendingWrites: Map<string, string> }> {
  const tools: Anthropic.Tool[] = [
    ...VAULT_TOOLS,
    ...(env.TAVILY_API_KEY ? [WEB_SEARCH_TOOL] : []),
  ];
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: initialContent }];
  const pendingWrites = new Map<string, string>();
  const MAX_TURNS = 10;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    await checkCancelled(env);
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: env.MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        tools,
        messages,
      });
    } catch (e) {
      const errMsg = (e as Error).message ?? '';
      if (errMsg.includes('robots.txt')) {
        console.warn(`Anthropic URL fetch blocked by robots.txt, retrying without media blocks`);
        await notify('⚠️ Some media URLs were blocked by the server (robots.txt). Retrying without media...');
        messages[0] = { role: 'user', content: stripUrlBlocks(initialContent) };
        response = await client.messages.create({
          model: env.MODEL,
          max_tokens: 8192,
          system: systemPrompt,
          tools,
          messages,
        });
      } else {
        throw e;
      }
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');

    if (response.stop_reason === 'end_turn') {
      return { noteMarkdown: textBlock?.text ?? '', pendingWrites };
    }

    if (response.stop_reason !== 'tool_use') {
      return { noteMarkdown: textBlock?.text ?? '', pendingWrites };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      let result: string;
      try {
        if (block.name === 'list_vault_files') {
          const { path } = block.input as { path: string };
          const files = await gh.listDirectory(path, env.GH_BRANCH);
          result = JSON.stringify(files);
        } else if (block.name === 'read_vault_file') {
          const { path } = block.input as { path: string };
          const content = await gh.getFileContent(path, env.GH_BRANCH);
          result = content ?? `File not found: ${path}`;
        } else if (block.name === 'write_vault_file') {
          const { path, content } = block.input as { path: string; content: string };
          if (!isAllowedWritePath(path)) {
            result = `Error: writes to "${path}" are not allowed. People/ is managed separately.`;
          } else {
            pendingWrites.set(path, content);
            result = `Queued: ${path}`;
          }
        } else if (block.name === 'web_search') {
          const { query } = block.input as { query: string };
          result = await searchWeb(query, env.TAVILY_API_KEY!);
        } else {
          result = `Unknown tool: ${block.name}`;
        }
      } catch (e) {
        result = `Tool error: ${(e as Error).message}`;
        console.warn(`Vault tool "${block.name}" failed:`, e);
      }

      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error(`Agentic compiler exceeded ${MAX_TURNS} turns`);
}

export async function compileDailyNote(
  dateStr: string,
  env: Env,
  notify: (msg: string) => Promise<void> = async () => {},
): Promise<void> {
  const messages = await getMessagesForDate(env.DB, dateStr);
  if (messages.length === 0) {
    console.log(`No messages for ${dateStr}, skipping.`);
    await notify(`ℹ️ No messages for ${dateStr}, skipping.`);
    return;
  }

  await notify(`🔄 Compiling daily note for ${dateStr} (${messages.length} messages)...`);

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
  const resolveFailures: string[] = [];

  for (const msg of messages) {
    if (!msg.file_id) continue;

    // Prefer R2: fetch bytes directly, no public URL needed
    if (msg.r2_url) {
      try {
        const key = msg.r2_url.startsWith(s3Base + '/')
          ? msg.r2_url.slice(s3Base.length + 1)
          : msg.r2_url;
        const obj = await env.R2.get(key);
        if (!obj) throw new Error('Object not found in R2');
        const buffer = await obj.arrayBuffer();
        resolvedMedia.set(msg.file_id, {
          kind: 'bytes',
          buffer,
          mimeType: msg.file_mime_type ?? 'application/octet-stream',
        });
        continue;
      } catch (e) {
        console.warn(`R2 fetch failed for ${msg.r2_url}: ${e} — falling back to Telegram`);
      }
    }

    // Fallback: resolve via Telegram getFile API
    try {
      const url = await resolveFileUri(env.TELEGRAM_BOT_TOKEN, msg.file_id);
      resolvedMedia.set(msg.file_id, { kind: 'url', url });
    } catch (e) {
      const errMsg = (e as Error).message;
      console.warn(`Could not resolve file_id ${msg.file_id}: ${e}`);
      resolveFailures.push(`${msg.message_type} (${msg.file_id.slice(0, 12)}…): ${errMsg}`);
    }
  }

  if (resolveFailures.length > 0) {
    await notify(
      `⚠️ ${resolveFailures.length} media file(s) failed to resolve:\n${resolveFailures.map((f) => `• ${f}`).join('\n')}`,
    );
  }

  await checkCancelled(env);

  const audioMessages = messages.filter(
    (m) =>
      m.file_id &&
      (m.message_type === 'voice' || m.message_type === 'audio') &&
      resolvedMedia.has(m.file_id),
  );

  const transcriptions = new Map<string, string>();
  if (audioMessages.length > 0) {
    await notify(`🎙️ Transcribing ${audioMessages.length} audio message(s)...`);
  }

  for (const msg of messages) {
    if (!msg.file_id) continue;
    if (msg.message_type !== 'voice' && msg.message_type !== 'audio') continue;
    const media = resolvedMedia.get(msg.file_id);
    if (!media) continue;

    let buffer: ArrayBuffer;
    if (media.kind === 'bytes') {
      buffer = media.buffer;
    } else {
      const res = await fetch(media.url);
      if (!res.ok) continue;
      buffer = await res.arrayBuffer();
    }

    const text = await transcribeAudio(env, buffer);
    if (text) {
      transcriptions.set(msg.file_id, text);
      console.log(`Transcribed ${msg.message_type} (${msg.file_id.slice(0, 8)}…): ${text.slice(0, 60)}`);
    }
  }

  await checkCancelled(env);
  await notify(`🤖 Running AI compiler...`);

  const contentBlocks = buildContentBlocks(messages, resolvedMedia, transcriptions, dateStr, noteTemplate);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const { noteMarkdown, pendingWrites } = await runAgenticCompiler(
    client,
    gh,
    env,
    systemPrompt,
    contentBlocks as Anthropic.ContentBlockParam[],
    notify,
  );

  await notify(`📝 AI done. Committing to GitHub...`);

  for (const [name, context] of parsePeople(noteMarkdown)) {
    await upsertPersonCard(env.DB, name, dateStr, context);
  }

  // Batch-commit daily note + any vault files written by Claude in one git commit
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

  const extraFiles = pendingWrites.size > 0 ? ` + ${pendingWrites.size} vault file(s)` : '';
  console.log(`Committed daily note + ${pendingWrites.size} vault file(s): ${dateStr}`);

  await compilePersonCards(env);

  await deleteMessagesForDate(env.DB, dateStr);
  console.log(`Deleted messages for ${dateStr} from D1.`);

  await notify(`✅ Done! Committed ${dateStr}.md${extraFiles} to GitHub.`);
}
