import { handleUpdate } from './bot';
import { runCompiler } from './compiler';
import type { Env, TelegramUpdate } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      const expectedSecret = env.TELEGRAM_BOT_TOKEN.split(':')[1];
      if (secret !== expectedSecret) {
        return new Response('Unauthorized', { status: 401 });
      }

      try {
        const update = (await request.json()) as TelegramUpdate;
        await handleUpdate(update, env);
        return new Response('OK');
      } catch (e) {
        console.error(`handleUpdate failed: ${e}`);
        return new Response('Internal Server Error', { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCompiler(env).catch((err) => console.error("runMimir failed:", err)));
  },
};
