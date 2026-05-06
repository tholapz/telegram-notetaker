import Anthropic from '@anthropic-ai/sdk';
import { deleteCompileJob, getActiveCompileJob, saveCompileJob } from './db';
import { finalizeCompile, isAllowedWritePath, searchWeb, VAULT_TOOLS, WEB_SEARCH_TOOL } from './compiler';
import { GitHubClient } from './github';
import type { Env } from './types';

const MAX_TURNS = 10;

type BatchResult =
  | { type: 'succeeded'; message: Anthropic.Message }
  | { type: 'errored'; error: unknown }
  | { type: 'expired' }
  | { type: 'canceled' };

type BatchIndividualResult = { custom_id: string; result: BatchResult };

async function sendTelegram(env: Env, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// Submits one conversation turn to the Anthropic batch API and persists state to D1.
export async function submitBatchTurn(
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  tools: Anthropic.Tool[],
  job: {
    date: string;
    chatId: string;
    turn: number;
    pendingWrites: Map<string, string>;
    startedAt: string;
    inputTokens: number;
    outputTokens: number;
  },
  env: Env,
): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const batch = await client.messages.batches.create({
    requests: [{
      custom_id: 'turn',
      params: { model: env.MODEL, max_tokens: 8192, system: systemPrompt, tools, messages },
    }],
  });

  await saveCompileJob(env.DB, {
    batch_id: batch.id,
    date: job.date,
    chat_id: job.chatId,
    turn: job.turn,
    messages_json: JSON.stringify(messages),
    system_prompt: systemPrompt,
    pending_writes_json: JSON.stringify(Object.fromEntries(job.pendingWrites)),
    started_at: job.startedAt,
    input_tokens: job.inputTokens,
    output_tokens: job.outputTokens,
  });

  return batch.id;
}

// Called by the polling cron. Checks the active batch; if ended, processes results.
export async function pollPendingJobs(env: Env): Promise<void> {
  const job = await getActiveCompileJob(env.DB);
  if (!job) return;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let batch: Anthropic.Messages.MessageBatch;
  try {
    batch = await client.messages.batches.retrieve(job.batch_id);
  } catch (e) {
    console.warn(`pollPendingJobs: failed to retrieve batch ${job.batch_id}: ${e}`);
    return;
  }

  console.log(`Batch ${job.batch_id} status: ${batch.processing_status}`);
  if (batch.processing_status !== 'ended') return;

  await processBatchResult(job.batch_id, env);
}

// Fetches results for a completed batch, executes tool calls, and either
// submits the next turn or finalizes the compilation.
async function processBatchResult(batchId: string, env: Env): Promise<void> {
  const job = await getActiveCompileJob(env.DB);
  if (!job || job.batch_id !== batchId) {
    console.warn(`processBatchResult: no job for batch_id=${batchId}`);
    return;
  }

  const send = (text: string) => sendTelegram(env, job.chat_id, text);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let batchResult: BatchIndividualResult | null = null;
  for await (const r of await client.messages.batches.results(batchId)) {
    if ((r as BatchIndividualResult).custom_id === 'turn') {
      batchResult = r as BatchIndividualResult;
      break;
    }
  }

  if (!batchResult) {
    await send(`❌ Batch ${batchId} ended but returned no result.`);
    await deleteCompileJob(env.DB, batchId);
    return;
  }

  if (batchResult.result.type === 'errored') {
    await send(`❌ Batch failed: ${JSON.stringify(batchResult.result.error)}`);
    await deleteCompileJob(env.DB, batchId);
    return;
  }

  if (batchResult.result.type === 'expired' || batchResult.result.type === 'canceled') {
    await send(`❌ Batch ${batchResult.result.type}.`);
    await deleteCompileJob(env.DB, batchId);
    return;
  }

  const message = batchResult.result.message;
  const inputTokens = job.input_tokens + (message.usage?.input_tokens ?? 0);
  const outputTokens = job.output_tokens + (message.usage?.output_tokens ?? 0);
  const turn = job.turn + 1;

  const messages: Anthropic.MessageParam[] = JSON.parse(job.messages_json);
  const pendingWrites = new Map<string, string>(Object.entries(JSON.parse(job.pending_writes_json)));
  const tools: Anthropic.Tool[] = [...VAULT_TOOLS, ...(env.TAVILY_API_KEY ? [WEB_SEARCH_TOOL] : [])];
  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text');

  if (message.stop_reason === 'end_turn' || message.stop_reason !== 'tool_use') {
    await deleteCompileJob(env.DB, batchId);
    await finalizeCompile(textBlock?.text ?? '', pendingWrites, job.date, env, send, {
      turns: turn,
      inputTokens,
      outputTokens,
      startedAt: job.started_at,
    });
    return;
  }

  if (turn >= MAX_TURNS) {
    await send(`❌ Compilation exceeded ${MAX_TURNS} turns without finishing.`);
    await deleteCompileJob(env.DB, batchId);
    return;
  }

  // Execute tool calls, then submit next batch turn
  messages.push({ role: 'assistant', content: message.content });
  const gh = new GitHubClient(env.GH_TOKEN, env.GH_REPO);
  const toolResults: Anthropic.ToolResultBlockParam[] = [];

  for (const block of message.content) {
    if (block.type !== 'tool_use') continue;
    let result: string;
    try {
      if (block.name === 'list_vault_files') {
        const { path } = block.input as { path: string };
        result = JSON.stringify(await gh.listDirectory(path, env.GH_BRANCH));
      } else if (block.name === 'read_vault_file') {
        const { path } = block.input as { path: string };
        result = (await gh.getFileContent(path, env.GH_BRANCH)) ?? `File not found: ${path}`;
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
      console.warn(`Tool "${block.name}" failed:`, e);
    }
    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
  }

  messages.push({ role: 'user', content: toolResults });

  await deleteCompileJob(env.DB, batchId);
  const nextBatchId = await submitBatchTurn(messages, job.system_prompt, tools, {
    date: job.date,
    chatId: job.chat_id,
    turn,
    pendingWrites,
    startedAt: job.started_at,
    inputTokens,
    outputTokens,
  }, env);

  console.log(`Batch turn ${turn} submitted: ${nextBatchId} (date=${job.date})`);
}
