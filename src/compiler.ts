import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaManagedAgentsFileResourceParams,
  BetaManagedAgentsGitHubRepositoryResourceParams,
} from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import type { Env, MessageRow } from './types';

function getLocalDate(timezone: string): string {
  const d = new Date(Date.now() - 86_400_000);
  return d.toLocaleString('sv', { timeZone: timezone }).split(' ')[0];
}

function mountFilename(row: MessageRow): string {
  if (row.file_name) return row.file_name;
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
  };
  const ext = mimeToExt[row.file_mime_type ?? ''] ?? '';
  return `${row.message_id}${ext}`;
}

export async function runCompiler(env: Env, date?: string): Promise<string> {
  const targetDate = date ?? getLocalDate(env.TIMEZONE);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const d1Result = await env.DB.prepare(
    'SELECT * FROM messages WHERE date = ? ORDER BY created_at ASC',
  )
    .bind(targetDate)
    .all<MessageRow>();

  const rows = d1Result.results;
  console.log(`compiler: ${rows.length} messages for ${targetDate}`);

  const resources: Array<BetaManagedAgentsFileResourceParams | BetaManagedAgentsGitHubRepositoryResourceParams> = [];

  if (rows.length > 0) {
    const content = JSON.stringify(rows, null, 2);
    const file = new File([content], 'messages.json', { type: 'application/json' });
    const uploaded = await client.beta.files.upload({ file });
    resources.push({
      type: 'file',
      file_id: uploaded.id,
      mount_path: '/workspace/today/messages.json',
    });
    console.log(`compiler: uploaded messages.json → ${uploaded.id}`);
  }

  for (const row of rows) {
    if (!row.anthropic_file_id) continue;
    resources.push({
      type: 'file',
      file_id: row.anthropic_file_id,
      mount_path: `/workspace/today/media/${mountFilename(row)}`,
    });
  }

  resources.push({
    type: 'github_repository',
    url: `https://github.com/${env.GH_REPO}`,
    mount_path: '/workspace/obsidian-vault',
    authorization_token: env.GH_TOKEN,
  });

  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: env.AGENT_ID, version: parseInt(env.AGENT_VERSION, 10) },
    environment_id: env.ENV_ID,
    vault_ids: [env.VAULT_ID],
    resources,
  });
  console.log(`compiler: session created ${session.id}`);

  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text:
              `Generate the daily briefing for ${targetDate}.\n\n` +
              `Data in /mnt/session/uploads/workspace/today/ (yesterday's captures):\n` +
              `  messages.json — all messages and notes\n` +
              `  media/        — photos, documents, and files\n\n` +
              `Read all files, produce the structured Obsidian daily note, ` +
              `save it to /workspace/obsidian-vault/daily/${targetDate}.md, ` +
              `and push to the main branch. To push files to GitHub, always use the github MCP tool (create_or_update_file). Do not use 'git push' — the local proxy is unreliable.`,
          },
        ],
      },
    ],
  });

  return session.id;
}
