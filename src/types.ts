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
  timestamp: string;
  message_type: string;
  text: string | null;
  r2_key: string | null;
  file_mime_type: string | null;
  file_name: string | null;
}
