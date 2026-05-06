import Anthropic from '@anthropic-ai/sdk';
import { deleteCompileJob, getActiveCompileJob, saveCompileJob } from './db';
import { finalizeCompile, isAllowedWritePath } from './compiler';
import type { Env } from './types';

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

// Fetches results for a completed batch and finalizes the compilation in a single pass.
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

  const pendingWrites = new Map<string, string>(Object.entries(JSON.parse(job.pending_writes_json)));
  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text');

  for (const block of message.content) {
    if (block.type !== 'tool_use' || block.name !== 'write_vault_file') continue;
    const { path, content } = block.input as { path: string; content: string };
    if (isAllowedWritePath(path)) pendingWrites.set(path, content);
  }

  await deleteCompileJob(env.DB, batchId);
  await finalizeCompile(textBlock?.text ?? '', pendingWrites, job.date, env, send, {
    turns: 1,
    inputTokens,
    outputTokens,
    startedAt: job.started_at,
  });
}
