import { getAllPersonCards } from './db';
import { GitHubClient } from './github';
import type { Env, PersonCardRow } from './types';

const USER_FIELDS = ['role', 'company', 'contact'] as const;
const PLACEHOLDER = '—';

function parseUserFields(content: string): Record<string, string> {
  const fields: Record<string, string> = Object.fromEntries(
    USER_FIELDS.map((k) => [k, PLACEHOLDER]),
  );
  let inFront = false;
  for (const line of content.split('\n')) {
    if (line.trim() === '---') {
      if (!inFront) {
        inFront = true;
        continue;
      }
      break;
    }
    if (inFront) {
      for (const key of USER_FIELDS) {
        if (line.startsWith(`${key}:`)) {
          const value = line.slice(key.length + 1).trim();
          if (value) fields[key] = value;
        }
      }
    }
  }
  return fields;
}

function parseNotesSection(content: string): string {
  const lines = content.split('\n');
  let inNotes = false;
  const body: string[] = [];
  for (const line of lines) {
    if (line.trim() === '## Notes') {
      inNotes = true;
      continue;
    }
    if (inNotes) {
      if (line.startsWith('## ')) break;
      body.push(line);
    }
  }
  const text = body.join('\n').trim();
  return text || PLACEHOLDER;
}

function cardMarkdown(
  card: PersonCardRow,
  userFields: Record<string, string>,
  notesBody: string,
): string {
  const notes: Array<{ date: string; context: string }> = JSON.parse(card.notes_json);
  const logLines = notes
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((n) => `- **${n.date}** — ${n.context}`)
    .join('\n');

  return (
    `---\n` +
    `name: ${card.name}\n` +
    `first_seen: ${card.first_seen}\n` +
    `last_seen: ${card.last_seen}\n` +
    `role: ${userFields['role'] ?? PLACEHOLDER}\n` +
    `company: ${userFields['company'] ?? PLACEHOLDER}\n` +
    `contact: ${userFields['contact'] ?? PLACEHOLDER}\n` +
    `---\n\n` +
    `# ${card.name}\n\n` +
    `## Interaction Log\n` +
    `${logLines}\n\n` +
    `## Notes\n` +
    `${notesBody}\n`
  );
}

export async function compilePersonCards(env: Env): Promise<void> {
  const cards = await getAllPersonCards(env.DB);
  if (cards.length === 0) return;

  const gh = new GitHubClient(env.GH_TOKEN, env.GH_REPO);
  const branch = env.GH_BRANCH;
  const { commitSha, treeSha } = await gh.getBranchRef(branch);

  const blobs: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];

  for (const card of cards) {
    const safeName = card.name.replace(/ /g, '-');
    const path = `People/${safeName}.md`;

    let userFields = Object.fromEntries(USER_FIELDS.map((k) => [k, PLACEHOLDER]));
    let notesBody = PLACEHOLDER;

    const existing = await gh.getFileContent(path, branch);
    if (existing) {
      userFields = parseUserFields(existing);
      notesBody = parseNotesSection(existing);
    }

    const content = cardMarkdown(card, userFields, notesBody);
    const blobSha = await gh.createBlob(content);
    blobs.push({ path, mode: '100644', type: 'blob', sha: blobSha });
  }

  const newTreeSha = await gh.createTree(blobs, treeSha);
  const newCommitSha = await gh.createCommit(
    'people: update person cards',
    newTreeSha,
    commitSha,
  );
  await gh.updateRef(branch, newCommitSha);
  console.log(`Committed ${blobs.length} person card(s)`);
}
