import { messageExists, saveMessage } from './db';
import type { Env, TelegramUpdate } from './types';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function getLocalDatetime(timezone: string): { date: string; timestamp: string } {
  const localStr = new Date().toLocaleString('sv', { timeZone: timezone });
  const [date, time] = localStr.split(' ');
  return { date, timestamp: `${date}T${time}` };
}

function extFromMime(mime: string | null | undefined): string {
  if (!mime) return 'bin';
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? mime.split('/')[1] ?? 'bin';
}

async function uploadToR2(
  env: Env,
  fileId: string,
  knownSize: number | undefined,
  mime: string | null | undefined,
  r2Key: string,
): Promise<void> {
  if (knownSize !== undefined && knownSize > MAX_FILE_BYTES) {
    throw new Error(`File too large: ${knownSize} bytes`);
  }

  const getFileRes = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
  );
  if (!getFileRes.ok) throw new Error(`getFile failed: ${getFileRes.status}`);
  const { result } = (await getFileRes.json()) as {
    result: { file_path: string; file_size?: number };
  };

  if (result.file_size !== undefined && result.file_size > MAX_FILE_BYTES) {
    throw new Error(`File too large: ${result.file_size} bytes`);
  }

  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${result.file_path}`,
  );
  if (!fileRes.ok) throw new Error(`File download failed: ${fileRes.status}`);

  await env.MEDIA_BUCKET.put(r2Key, fileRes.body, {
    httpMetadata: { contentType: mime ?? 'application/octet-stream' },
  });
}

export async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const msg = update.message;
  if (!msg?.from) return;

  if (msg.from.id !== parseInt(env.TELEGRAM_ALLOWED_USER_ID, 10)) return;

  if (msg.text?.startsWith('/start') || msg.text?.startsWith('/help')) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: msg.from.id, text: 'Bot active.' }),
    });
    return;
  }

  if (await messageExists(env.DB, msg.message_id)) return;

  const { date, timestamp } = getLocalDatetime(env.TIMEZONE);

  if (msg.text) {
    await saveMessage(env.DB, {
      message_id: msg.message_id,
      date,
      timestamp,
      message_type: 'text',
      text: msg.text,
    });
    return;
  }

  let fileId: string;
  let mime: string | null | undefined;
  let fileName: string | undefined;
  let fileSize: number | undefined;
  let messageType: string;

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    fileId = photo.file_id;
    mime = 'image/jpeg';
    fileSize = photo.file_size;
    messageType = 'photo';
  } else if (msg.voice) {
    fileId = msg.voice.file_id;
    mime = msg.voice.mime_type;
    fileSize = msg.voice.file_size;
    messageType = 'voice';
  } else if (msg.video) {
    fileId = msg.video.file_id;
    mime = msg.video.mime_type;
    fileSize = msg.video.file_size;
    messageType = 'video';
  } else if (msg.audio) {
    fileId = msg.audio.file_id;
    mime = msg.audio.mime_type;
    fileSize = msg.audio.file_size;
    messageType = 'audio';
  } else if (msg.document) {
    fileId = msg.document.file_id;
    mime = msg.document.mime_type;
    fileName = msg.document.file_name;
    fileSize = msg.document.file_size;
    messageType = 'document';
  } else {
    return;
  }

  const r2Key = `${date}/${msg.message_id}.${extFromMime(mime)}`;
  await uploadToR2(env, fileId, fileSize, mime, r2Key);

  await saveMessage(env.DB, {
    message_id: msg.message_id,
    date,
    timestamp,
    message_type: messageType,
    text: msg.caption ?? null,
    r2_key: r2Key,
    file_mime_type: mime ?? null,
    file_name: fileName ?? null,
  });
}
