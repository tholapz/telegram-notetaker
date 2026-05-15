import { getStatusSummary, messageExists, saveMessage, updateMessageText } from './db';
import type { Env, TelegramMessage, TelegramUpdate } from './types';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function getLocalDatetime(timezone: string): { date: string; created_at: string } {
  const localStr = new Date().toLocaleString('sv', { timeZone: timezone });
  const [date, time] = localStr.split(' ');
  return { date, created_at: `${date}T${time}` };
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

function getForwardedFrom(msg: TelegramMessage): string | null {
  if (msg.forward_from) {
    return msg.forward_from.username
      ? `@${msg.forward_from.username}`
      : msg.forward_from.first_name;
  }
  if (msg.forward_from_chat) {
    return msg.forward_from_chat.username
      ? `@${msg.forward_from_chat.username}`
      : (msg.forward_from_chat.title ?? null);
  }
  return msg.forward_sender_name ?? null;
}

async function sendMessage(env: Env, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
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

async function handleCheckStatus(env: Env, chatId: number): Promise<void> {
  const lines: string[] = ['📊 Pipeline Status\n'];

  let lastMessageAt: string | null = null;
  let failedCount = 0;

  try {
    const summary = await getStatusSummary(env.DB);
    lastMessageAt = summary.lastMessageAt;
    failedCount = summary.failedCount;
    lines.push('D1: ✅ reachable');
  } catch {
    lines.push('D1: ❌ unreachable');
  }

  try {
    await env.MEDIA_BUCKET.list({ limit: 1 });
    lines.push('R2: ✅ reachable');
  } catch {
    lines.push('R2: ❌ unreachable');
  }

  if (lastMessageAt) {
    const diffMs = Date.now() - new Date(lastMessageAt).getTime();
    const h = Math.floor(diffMs / 3_600_000);
    const m = Math.floor((diffMs % 3_600_000) / 60_000);
    const age = h > 0 ? `${h}h ${m}m ago` : `${m}m ago`;
    lines.push(`Last message: ${age}${h >= 24 ? ' ⚠️' : ''}`);
  } else {
    lines.push('Last message: none recorded');
  }

  lines.push(`Failed media: ${failedCount}${failedCount > 0 ? ' ⚠️' : ''}`);

  await sendMessage(env, chatId, lines.join('\n'));
}

export async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  if (update.edited_message) {
    const edited = update.edited_message;
    if (!edited.from || edited.from.id !== parseInt(env.TELEGRAM_ALLOWED_USER_ID, 10)) return;
    await updateMessageText(env.DB, edited.message_id, edited.text ?? edited.caption ?? null);
    return;
  }

  const msg = update.message;
  if (!msg?.from) return;

  if (msg.from.id !== parseInt(env.TELEGRAM_ALLOWED_USER_ID, 10)) return;

  if (msg.text?.startsWith('/start') || msg.text?.startsWith('/help')) {
    await sendMessage(
      env,
      msg.from.id,
      `/help — show this message\n/status — check D1, R2, and last message health\n/version — show bot version and deploy time`,
    );
    return;
  }

  if (msg.text?.startsWith('/version')) {
    await sendMessage(env, msg.from.id, `Version: 0.1.0\nDeployed: ${BUILD_TIME}`);
    return;
  }

  if (msg.text?.startsWith('/status')) {
    await handleCheckStatus(env, msg.from.id);
    return;
  }

  if (await messageExists(env.DB, msg.message_id)) return;

  const { date, created_at } = getLocalDatetime(env.TIMEZONE);
  const forwarded_from = getForwardedFrom(msg);

  if (msg.text) {
    await saveMessage(env.DB, {
      message_id: msg.message_id,
      date,
      created_at,
      message_type: 'text',
      text: msg.text,
      forwarded_from,
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

  try {
    await uploadToR2(env, fileId, fileSize, mime, r2Key);
  } catch (e) {
    console.error(`R2 upload failed for message ${msg.message_id}: ${e}`);
    await saveMessage(env.DB, {
      message_id: msg.message_id,
      date,
      created_at,
      message_type: messageType,
      text: msg.caption ?? null,
      file_mime_type: mime ?? null,
      file_name: fileName ?? null,
      forwarded_from,
      status: 'failed',
    });
    await sendMessage(env, msg.from.id, `⚠️ Failed to store ${messageType} — check /status`);
    return;
  }

  await saveMessage(env.DB, {
    message_id: msg.message_id,
    date,
    created_at,
    message_type: messageType,
    text: msg.caption ?? null,
    r2_key: r2Key,
    file_mime_type: mime ?? null,
    file_name: fileName ?? null,
    forwarded_from,
    status: 'ok',
  });
}
