export interface Env {
  DB: D1Database;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_USER_ID: string;
  ANTHROPIC_API_KEY: string;
  GH_TOKEN: string;
  GH_REPO: string;
  GH_BRANCH: string;
  TIMEZONE: string;
  MODEL: string;
  TAVILY_API_KEY?: string;
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
  voice?: { file_id: string; mime_type?: string };
  video?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
  document?: { file_id: string; mime_type?: string; file_name?: string };
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface MessageRow {
  id: number;
  date: string;
  timestamp: string;
  message_type: string;
  text: string | null;
  file_id: string | null;
  file_mime_type: string | null;
  file_name: string | null;
}

export interface PersonCardRow {
  id: number;
  name: string;
  first_seen: string;
  last_seen: string;
  notes_json: string;
}
