import { handleUpdate } from './bot';
import { compileDailyNote } from './compiler';
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
      await handleUpdate(update, env);
      return new Response('OK');
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const dateStr = getLocalDate(env.TIMEZONE);
    ctx.waitUntil(
      (async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await compileDailyNote(dateStr, env);
            return;
          } catch (e) {
            lastError = e;
            console.error(`Compilation attempt ${attempt + 1} failed: ${e}`);
            if (attempt < 2) await new Promise((r) => setTimeout(r, 60_000));
          }
        }
        await alertUser(env, `⚠️ Daily note compilation failed: ${lastError}`);
      })(),
    );
  },
};
