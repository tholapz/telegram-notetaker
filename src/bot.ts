import { CompilationCancelledError, compileDailyNote } from './compiler';
import { deleteMeta, getMeta, saveMessage, setMeta } from './db';
import { version } from '../package.json';
import type { Env, TelegramUpdate } from './types';

function getLocalDatetime(timezone: string): { date: string; timestamp: string } {
  // 'sv' locale gives "YYYY-MM-DD HH:MM:SS" — ideal for ISO-like storage
  const localStr = new Date().toLocaleString('sv', { timeZone: timezone });
  const [date, time] = localStr.split(' ');
  return { date, timestamp: `${date}T${time}` };
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function uploadMediaToR2(
  env: Env,
  fileId: string,
  mimeType: string | null,
): Promise<string | null> {
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
    );
    if (!fileRes.ok) throw new Error(`getFile ${fileRes.status}`);
    const fileData = (await fileRes.json()) as { result: { file_path: string } };
    const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;

    const mediaRes = await fetch(downloadUrl);
    if (!mediaRes.ok) throw new Error(`download ${mediaRes.status}`);
    const buffer = await mediaRes.arrayBuffer();

    const key = `telegram-media/${fileId}`;
    await env.R2.put(key, buffer, {
      httpMetadata: { contentType: mimeType ?? 'application/octet-stream' },
    });

    return `${env.S3_API.replace(/\/$/, '')}/${key}`;
  } catch (e) {
    console.warn(`R2 upload failed for ${fileId}: ${e}`);
    return null;
  }
}

export async function handleUpdate(update: TelegramUpdate, env: Env, ctx: ExecutionContext): Promise<void> {
  const msg = update.message;
  if (!msg?.from) return;

  if (msg.from.id !== parseInt(env.TELEGRAM_ALLOWED_USER_ID, 10)) return;

  const { date, timestamp } = getLocalDatetime(env.TIMEZONE);

  if (msg.text?.startsWith('/start') || msg.text?.startsWith('/help')) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      msg.from.id,
      `telegram-notetaker v${version}\n\nCommands:\n/compile — compile today's daily note\n/compile YYYY-MM-DD — compile note for a specific date\n/stop — cancel a compilation in progress`,
    );
    return;
  }

  if (msg.text?.startsWith('/stop')) {
    const chatId = msg.from.id;
    const running = await getMeta(env.DB, 'compile_running');
    if (!running) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'No compilation is currently running.');
      return;
    }
    await setMeta(env.DB, 'compile_cancel', '1');
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '🛑 Stop signal sent. Compilation will halt at the next checkpoint.');
    return;
  }

  if (msg.text?.startsWith('/compile')) {
    const parts = msg.text.trim().split(/\s+/);
    const dateArg = parts[1];
    const targetDate = dateArg ?? date;
    const chatId = msg.from.id;

    if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Invalid date format. Use: /compile YYYY-MM-DD');
      return;
    }

    const running = await getMeta(env.DB, 'compile_running');
    if (running) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `⏳ Compilation already in progress (started ${running}). Use /stop to cancel.`,
      );
      return;
    }

    const notify = (text: string) => sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
    await notify(`🔄 Starting compilation for ${targetDate}...`);

    ctx.waitUntil(
      (async () => {
        await setMeta(env.DB, 'compile_running', new Date().toISOString());
        try {
          await compileDailyNote(targetDate, env, notify);
        } catch (e) {
          if (e instanceof CompilationCancelledError) {
            await notify('🛑 Compilation stopped.');
          } else {
            await notify(`❌ Compilation failed: ${(e as Error).message ?? e}`);
          }
        } finally {
          await deleteMeta(env.DB, 'compile_running');
          await deleteMeta(env.DB, 'compile_cancel');
        }
      })(),
    );
    return;
  }

  if (msg.text) {
    await saveMessage(env.DB, { date, timestamp, message_type: 'text', text: msg.text });
  } else if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    const r2_url = await uploadMediaToR2(env, photo.file_id, 'image/jpeg');
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'photo',
      text: msg.caption ?? null,
      file_id: photo.file_id,
      file_mime_type: 'image/jpeg',
      r2_url,
    });
  } else if (msg.voice) {
    const r2_url = await uploadMediaToR2(env, msg.voice.file_id, msg.voice.mime_type ?? null);
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'voice',
      text: msg.caption ?? null,
      file_id: msg.voice.file_id,
      file_mime_type: msg.voice.mime_type ?? null,
      r2_url,
    });
  } else if (msg.video) {
    const r2_url = await uploadMediaToR2(env, msg.video.file_id, msg.video.mime_type ?? null);
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'video',
      text: msg.caption ?? null,
      file_id: msg.video.file_id,
      file_mime_type: msg.video.mime_type ?? null,
      r2_url,
    });
  } else if (msg.audio) {
    const r2_url = await uploadMediaToR2(env, msg.audio.file_id, msg.audio.mime_type ?? null);
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'audio',
      text: msg.caption ?? null,
      file_id: msg.audio.file_id,
      file_mime_type: msg.audio.mime_type ?? null,
      r2_url,
    });
  } else if (msg.document) {
    const r2_url = await uploadMediaToR2(env, msg.document.file_id, msg.document.mime_type ?? null);
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'document',
      text: msg.caption ?? null,
      file_id: msg.document.file_id,
      file_mime_type: msg.document.mime_type ?? null,
      file_name: msg.document.file_name ?? null,
      r2_url,
    });
  }
}
