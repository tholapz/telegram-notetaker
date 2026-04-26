import asyncio
import logging
import os
from datetime import datetime

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from compiler import compile_daily_note

logger = logging.getLogger(__name__)


def build_scheduler(bot) -> AsyncIOScheduler:
    timezone_str = os.environ.get("TIMEZONE", "Asia/Bangkok")
    scheduler = AsyncIOScheduler(timezone=timezone_str)

    async def _daily_job() -> None:
        tz = pytz.timezone(timezone_str)
        date_str = datetime.now(tz).strftime("%Y-%m-%d")
        logger.info("Starting daily compilation for %s", date_str)

        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                await compile_daily_note(date_str, bot=bot)
                logger.info("Daily note compiled successfully for %s", date_str)
                return
            except Exception as exc:
                last_exc = exc
                logger.error("Compilation attempt %d failed: %s", attempt + 1, exc)
                if attempt < 2:
                    await asyncio.sleep(60)

        # All retries exhausted — alert via Telegram
        try:
            user_id = int(os.environ["TELEGRAM_ALLOWED_USER_ID"])
            await bot.send_message(
                user_id, f"⚠️ Daily note compilation failed: {last_exc}"
            )
        except Exception as exc:
            logger.error("Failed to send Telegram alert: %s", exc)

    scheduler.add_job(
        _daily_job,
        CronTrigger(hour=23, minute=55, timezone=timezone_str),
    )
    return scheduler
