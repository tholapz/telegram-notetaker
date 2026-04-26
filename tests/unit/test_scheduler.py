import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from apscheduler.triggers.cron import CronTrigger

from scheduler import build_scheduler


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.send_message = AsyncMock()
    return bot


class TestSchedulerConfiguration:
    def test_scheduler_has_one_job(self, mock_bot):
        scheduler = build_scheduler(mock_bot)
        assert len(scheduler.get_jobs()) == 1

    def test_job_fires_at_2355_bangkok(self, mock_bot):
        scheduler = build_scheduler(mock_bot)
        job = scheduler.get_jobs()[0]
        trigger = job.trigger
        assert isinstance(trigger, CronTrigger)
        # Inspect the trigger fields for hour=23, minute=55
        fields = {f.name: str(f) for f in trigger.fields}
        assert fields["hour"] == "23"
        assert fields["minute"] == "55"

    def test_scheduler_uses_configured_timezone(self, mock_bot, monkeypatch):
        monkeypatch.setenv("TIMEZONE", "Asia/Bangkok")
        scheduler = build_scheduler(mock_bot)
        job = scheduler.get_jobs()[0]
        assert str(job.trigger.timezone) == "Asia/Bangkok"


class TestDailyJobRetryLogic:
    async def test_success_on_first_attempt(self, mock_bot):
        scheduler = build_scheduler(mock_bot)
        job_func = scheduler.get_jobs()[0].func

        with (
            patch("compiler.get_messages_for_date", return_value=[]),
        ):
            await job_func()
            mock_bot.send_message.assert_not_awaited()

    async def test_retries_three_times_on_failure(self, mock_bot):
        scheduler = build_scheduler(mock_bot)
        job_func = scheduler.get_jobs()[0].func

        call_count = 0

        async def failing_compile(date_str, bot=None):
            nonlocal call_count
            call_count += 1
            raise RuntimeError("LLM error")

        with (
            patch("scheduler.compile_daily_note", failing_compile),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            await job_func()

        assert call_count == 3

    async def test_sends_telegram_alert_after_all_retries_fail(self, mock_bot):
        scheduler = build_scheduler(mock_bot)
        job_func = scheduler.get_jobs()[0].func

        async def always_fails(date_str, bot=None):
            raise RuntimeError("persistent error")

        with (
            patch("scheduler.compile_daily_note", always_fails),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            await job_func()

        mock_bot.send_message.assert_awaited_once()
        alert_text = mock_bot.send_message.call_args[0][1]
        assert "⚠️" in alert_text
        assert "persistent error" in alert_text

    async def test_sleeps_60s_between_retries(self, mock_bot):
        scheduler = build_scheduler(mock_bot)
        job_func = scheduler.get_jobs()[0].func

        async def always_fails(date_str, bot=None):
            raise RuntimeError("fail")

        sleep_calls = []

        async def record_sleep(seconds):
            sleep_calls.append(seconds)

        with (
            patch("scheduler.compile_daily_note", always_fails),
            patch("asyncio.sleep", record_sleep),
        ):
            await job_func()

        assert sleep_calls == [60, 60]

    async def test_no_alert_on_success(self, mock_bot):
        scheduler = build_scheduler(mock_bot)
        job_func = scheduler.get_jobs()[0].func

        async def succeeds(date_str, bot=None):
            pass

        with patch("scheduler.compile_daily_note", succeeds):
            await job_func()

        mock_bot.send_message.assert_not_awaited()
