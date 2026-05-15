declare const BUILD_TIME: string;

export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_USER_ID: string;
  TIMEZONE: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; username?: string };
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  voice?: { file_id: string; mime_type?: string; file_size?: number };
  video?: { file_id: string; mime_type?: string; file_size?: number };
  audio?: { file_id: string; mime_type?: string; file_size?: number };
  document?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number };
  forward_from?: { id: number; first_name: string; username?: string };
  forward_from_chat?: { id: number; title?: string; username?: string };
  forward_sender_name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface MessageRow {
  id: number;
  message_id: number;
  date: string;
  created_at: string;
  message_type: string;
  text: string | null;
  r2_key: string | null;
  file_mime_type: string | null;
  file_name: string | null;
  status: string;
  forwarded_from: string | null;
}
