import { handleUpdate } from './bot';
import { CompilationCancelledError, compileDailyNote } from './compiler';
import { deleteMeta, setMeta } from './db';
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

    // Telegram webhook: POST /webhook
    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      // Secret is the part after the colon in the bot token (e.g. "ABC123..." from "12345:ABC123...")
      const expectedSecret = env.TELEGRAM_BOT_TOKEN.split(':')[1];
      if (secret !== expectedSecret) {
        return new Response('Unauthorized', { status: 401 });
      }
      const update = (await request.json()) as TelegramUpdate;
      await handleUpdate(update, env, ctx);
      return new Response('OK');
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const dateStr = getLocalDate(env.TIMEZONE);
    const notify = (text: string) => alertUser(env, text);
    ctx.waitUntil(
      (async () => {
        await setMeta(env.DB, 'compile_running', new Date().toISOString());
        try {
          let lastError: unknown;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await compileDailyNote(dateStr, env, notify);
              return;
            } catch (e) {
              if (e instanceof CompilationCancelledError) {
                await alertUser(env, '🛑 Daily note compilation was stopped.');
                return;
              }
              lastError = e;
              console.error(`Compilation attempt ${attempt + 1} failed: ${e}`);
              await alertUser(env, `⚠️ Attempt ${attempt + 1}/3 failed: ${(e as Error).message ?? e}`);
              if (attempt < 2) await new Promise((r) => setTimeout(r, 60_000));
            }
          }
          await alertUser(env, `❌ Daily note compilation failed after 3 attempts: ${(lastError as Error).message ?? lastError}`);
        } finally {
          await deleteMeta(env.DB, 'compile_running');
          await deleteMeta(env.DB, 'compile_cancel');
        }
      })(),
    );
  },
};
