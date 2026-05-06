import { handleUpdate } from './bot';
import { pollPendingJobs, submitBatchTurn } from './batch';
import { getActiveCompileJob } from './db';
import { prepareCompile } from './compiler';
import type { Env, TelegramUpdate } from './types';

function getLocalDate(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

async function alertUser(env: Env, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_ALLOWED_USER_ID, text }),
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      const expectedSecret = env.TELEGRAM_BOT_TOKEN.split(':')[1];
      if (secret !== expectedSecret) return new Response('Unauthorized', { status: 401 });
      const update = (await request.json()) as TelegramUpdate;
      await handleUpdate(update, env, ctx);
      return new Response('OK');
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Polling cron (*/5 * * * *): check if any pending batch has finished.
    if (event.cron !== '55 16 * * *') {
      ctx.waitUntil(pollPendingJobs(env));
      return;
    }

    // Daily compile cron (55 16 * * *).
    const dateStr = getLocalDate(env.TIMEZONE);
    const notify = (text: string) => alertUser(env, text);

    const activeJob = await getActiveCompileJob(env.DB);
    if (activeJob) {
      await alertUser(env, `⏳ Compilation already in progress for ${activeJob.date} (batch: ${activeJob.batch_id}).`);
      return;
    }

    ctx.waitUntil(
      (async () => {
        try {
          const context = await prepareCompile(dateStr, env, notify);
          if (!context) return;
          const batchId = await submitBatchTurn(
            context.initialMessages,
            context.systemPrompt,
            context.tools,
            {
              date: dateStr,
              chatId: env.TELEGRAM_ALLOWED_USER_ID,
              turn: 0,
              pendingWrites: new Map(),
              startedAt: new Date().toISOString(),
              inputTokens: 0,
              outputTokens: 0,
            },
            env,
          );
          await alertUser(env, `🤖 Daily note compilation queued for ${dateStr}.\nBatch: ${batchId}`);
        } catch (e) {
          await alertUser(env, `❌ Compilation failed to start: ${(e as Error).message ?? e}`);
        }
      })(),
    );
  },
};
