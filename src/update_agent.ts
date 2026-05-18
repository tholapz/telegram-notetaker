// Update existing agent — increments version, keeps same AGENT_ID
// npx tsx --env-file .env src/update_agent.ts

declare const process: { env: Record<string, string | undefined> };

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `\
You are Mimir, a personal morning intelligence briefing assistant for a solo AI consultant based in Bangkok.

Each morning you are given access to the previous day's captured data: text messages, notes, photos, documents, and media files.

Your task is to produce a structured morning briefing in Obsidian Markdown format — something the consultant reads over their first coffee. Include:

- **Yesterday's Work**: projects, tasks, and decisions made
- **Key Conversations**: important messages and context
- **Insights & Ideas**: noteworthy thoughts captured during the day
- **Action Items for Today**: clear, prioritized list
- **Follow-ups**: things needing a response or further attention

Analyze all content carefully. Read every file provided. For images use vision. For PDFs use the pdf skill.

To push files to GitHub, always use the github MCP tool (create_or_update_file). Do not use \`git push\` — the local proxy is unreliable.

Output ONLY the Markdown content. No preamble, no explanation. Do not wrap your output in a code block. Return raw markdown text directly.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const agentId = process.env.AGENT_ID;
const agentVersion = process.env.AGENT_VERSION;

if (!agentId || !agentVersion) {
  throw new Error('AGENT_ID and AGENT_VERSION must be set in .env');
}

const agent = await client.beta.agents.update(agentId, {
  version: parseInt(agentVersion, 10),
  name: 'Mimir',
  model: 'claude-sonnet-4-6',
  system: SYSTEM_PROMPT,
  mcp_servers: [
    {
      type: 'url',
      name: 'github',
      url: 'https://api.githubcopilot.com/mcp/v1',
    },
  ],
  tools: [
    {
      type: 'agent_toolset_20260401',
      default_config: {
        enabled: true,
        permission_policy: { type: 'always_allow' },
      },
    },
    {
      type: 'mcp_toolset',
      mcp_server_name: 'github',
      default_config: {
        enabled: true,
        permission_policy: { type: 'always_allow' },
      },
    },
  ],
  skills: [
    { type: 'anthropic', skill_id: 'xlsx' },
    { type: 'anthropic', skill_id: 'pdf' },
  ],
});

console.log(`AGENT_ID=${agent.id}`);
console.log(`AGENT_VERSION=${agent.version}`);
console.log('Update .env and wrangler.toml [vars] with the new AGENT_VERSION.');
