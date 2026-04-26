import asyncio
import logging
import os

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def main() -> None:
    from bot import build_application
    from db import init_db
    from scheduler import build_scheduler

    init_db()

    app = build_application()
    scheduler = build_scheduler(app.bot)
    scheduler.start()

    logger.info("Notes bot active — %s", os.environ.get("GH_REPO", "unknown"))

    async with app:
        await app.start()
        await app.updater.start_polling()
        try:
            await asyncio.Event().wait()
        finally:
            await app.updater.stop()
            await app.stop()
            scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
