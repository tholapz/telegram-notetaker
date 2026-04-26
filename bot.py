import logging
import os
from datetime import datetime

import pytz
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from db import save_message

logger = logging.getLogger(__name__)

_TIMEZONE = pytz.timezone(os.environ.get("TIMEZONE", "Asia/Bangkok"))
_ALLOWED_USER_ID = int(os.environ.get("TELEGRAM_ALLOWED_USER_ID", "0"))


def _now() -> datetime:
    return datetime.now(_TIMEZONE)


def _allowed(update: Update) -> bool:
    return update.effective_user is not None and update.effective_user.id == _ALLOWED_USER_ID


async def _handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    await update.message.reply_text("Bot active.")


async def _handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    now = _now()
    save_message(
        date=now.strftime("%Y-%m-%d"),
        timestamp=now.isoformat(),
        message_type="text",
        text=update.message.text,
    )


async def _handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    now = _now()
    photo = update.message.photo[-1]
    save_message(
        date=now.strftime("%Y-%m-%d"),
        timestamp=now.isoformat(),
        message_type="photo",
        text=update.message.caption,
        file_id=photo.file_id,
        file_mime_type="image/jpeg",
    )


async def _handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    now = _now()
    voice = update.message.voice
    save_message(
        date=now.strftime("%Y-%m-%d"),
        timestamp=now.isoformat(),
        message_type="voice",
        text=update.message.caption,
        file_id=voice.file_id,
        file_mime_type=voice.mime_type,
    )


async def _handle_video(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    now = _now()
    video = update.message.video
    save_message(
        date=now.strftime("%Y-%m-%d"),
        timestamp=now.isoformat(),
        message_type="video",
        text=update.message.caption,
        file_id=video.file_id,
        file_mime_type=video.mime_type,
    )


async def _handle_audio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    now = _now()
    audio = update.message.audio
    save_message(
        date=now.strftime("%Y-%m-%d"),
        timestamp=now.isoformat(),
        message_type="audio",
        text=update.message.caption,
        file_id=audio.file_id,
        file_mime_type=audio.mime_type,
    )


async def _handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    now = _now()
    doc = update.message.document
    save_message(
        date=now.strftime("%Y-%m-%d"),
        timestamp=now.isoformat(),
        message_type="document",
        text=update.message.caption,
        file_id=doc.file_id,
        file_mime_type=doc.mime_type,
        file_name=doc.file_name,
    )


def build_application() -> Application:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    app = Application.builder().token(token).build()

    app.add_handler(CommandHandler("start", _handle_start))
    app.add_handler(CommandHandler("help", _handle_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, _handle_text))
    app.add_handler(MessageHandler(filters.PHOTO, _handle_photo))
    app.add_handler(MessageHandler(filters.VOICE, _handle_voice))
    app.add_handler(MessageHandler(filters.VIDEO, _handle_video))
    app.add_handler(MessageHandler(filters.AUDIO, _handle_audio))
    app.add_handler(MessageHandler(filters.Document.ALL, _handle_document))

    return app
