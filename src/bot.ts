import { saveMessage } from './db';
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

export async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const msg = update.message;
  if (!msg?.from) return;

  if (msg.from.id !== parseInt(env.TELEGRAM_ALLOWED_USER_ID, 10)) return;

  const { date, timestamp } = getLocalDatetime(env.TIMEZONE);

  if (msg.text?.startsWith('/start') || msg.text?.startsWith('/help')) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.from.id, 'Bot active.');
    return;
  }

  if (msg.text) {
    await saveMessage(env.DB, { date, timestamp, message_type: 'text', text: msg.text });
  } else if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'photo',
      text: msg.caption ?? null,
      file_id: photo.file_id,
      file_mime_type: 'image/jpeg',
    });
  } else if (msg.voice) {
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'voice',
      text: msg.caption ?? null,
      file_id: msg.voice.file_id,
      file_mime_type: msg.voice.mime_type ?? null,
    });
  } else if (msg.video) {
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'video',
      text: msg.caption ?? null,
      file_id: msg.video.file_id,
      file_mime_type: msg.video.mime_type ?? null,
    });
  } else if (msg.audio) {
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'audio',
      text: msg.caption ?? null,
      file_id: msg.audio.file_id,
      file_mime_type: msg.audio.mime_type ?? null,
    });
  } else if (msg.document) {
    await saveMessage(env.DB, {
      date,
      timestamp,
      message_type: 'document',
      text: msg.caption ?? null,
      file_id: msg.document.file_id,
      file_mime_type: msg.document.mime_type ?? null,
      file_name: msg.document.file_name ?? null,
    });
  }
}
