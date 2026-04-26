from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _make_update(user_id: int, **kwargs) -> MagicMock:
    update = MagicMock()
    update.effective_user = MagicMock()
    update.effective_user.id = user_id
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    update.message.caption = None
    for key, value in kwargs.items():
        setattr(update.message, key, value)
    return update


@pytest.fixture
def ctx():
    return MagicMock()


class TestAllowList:
    async def test_allowed_user_passes(self):
        import bot

        original = bot._ALLOWED_USER_ID
        bot._ALLOWED_USER_ID = 12345
        try:
            update = _make_update(12345, text="hello")
            with patch("bot.save_message") as mock_save:
                await bot._handle_text(update, MagicMock())
                mock_save.assert_called_once()
        finally:
            bot._ALLOWED_USER_ID = original

    async def test_unknown_user_is_silently_ignored(self):
        import bot

        original = bot._ALLOWED_USER_ID
        bot._ALLOWED_USER_ID = 12345
        try:
            update = _make_update(99999, text="spam")
            with patch("bot.save_message") as mock_save:
                await bot._handle_text(update, MagicMock())
                mock_save.assert_not_called()
        finally:
            bot._ALLOWED_USER_ID = original


@pytest.fixture(autouse=True)
def patch_allowed_user(monkeypatch):
    import bot
    monkeypatch.setattr(bot, "_ALLOWED_USER_ID", 12345)


class TestHandlers:
    async def test_start_replies_bot_active(self, ctx):
        import bot

        update = _make_update(12345)
        await bot._handle_start(update, ctx)
        update.message.reply_text.assert_awaited_once_with("Bot active.")

    async def test_start_does_not_save_message(self, ctx):
        import bot

        update = _make_update(12345)
        with patch("bot.save_message") as mock_save:
            await bot._handle_start(update, ctx)
            mock_save.assert_not_called()

    async def test_text_handler_saves_correct_fields(self, ctx):
        import bot

        update = _make_update(12345, text="my note")
        with patch("bot.save_message") as mock_save:
            await bot._handle_text(update, ctx)
            kw = mock_save.call_args.kwargs
            assert kw["message_type"] == "text"
            assert kw["text"] == "my note"
            assert kw.get("file_id") is None

    async def test_photo_handler_saves_file_id(self, ctx):
        import bot

        photo = MagicMock()
        photo.file_id = "PHOTO_FID"
        update = _make_update(12345)
        update.message.photo = [photo]
        update.message.caption = "nice shot"

        with patch("bot.save_message") as mock_save:
            await bot._handle_photo(update, ctx)
            kw = mock_save.call_args.kwargs
            assert kw["message_type"] == "photo"
            assert kw["file_id"] == "PHOTO_FID"
            assert kw["text"] == "nice shot"
            assert kw["file_mime_type"] == "image/jpeg"

    async def test_voice_handler_saves_file_id(self, ctx):
        import bot

        voice = MagicMock()
        voice.file_id = "VOICE_FID"
        voice.mime_type = "audio/ogg"
        update = _make_update(12345)
        update.message.voice = voice

        with patch("bot.save_message") as mock_save:
            await bot._handle_voice(update, ctx)
            kw = mock_save.call_args.kwargs
            assert kw["message_type"] == "voice"
            assert kw["file_id"] == "VOICE_FID"
            assert kw["file_mime_type"] == "audio/ogg"

    async def test_document_handler_saves_filename(self, ctx):
        import bot

        doc = MagicMock()
        doc.file_id = "DOC_FID"
        doc.mime_type = "application/pdf"
        doc.file_name = "report.pdf"
        update = _make_update(12345)
        update.message.document = doc

        with patch("bot.save_message") as mock_save:
            await bot._handle_document(update, ctx)
            kw = mock_save.call_args.kwargs
            assert kw["message_type"] == "document"
            assert kw["file_name"] == "report.pdf"
            assert kw["file_mime_type"] == "application/pdf"

    async def test_video_handler_saves_file_id(self, ctx):
        import bot

        video = MagicMock()
        video.file_id = "VID_FID"
        video.mime_type = "video/mp4"
        update = _make_update(12345)
        update.message.video = video

        with patch("bot.save_message") as mock_save:
            await bot._handle_video(update, ctx)
            kw = mock_save.call_args.kwargs
            assert kw["message_type"] == "video"
            assert kw["file_id"] == "VID_FID"

    async def test_audio_handler_saves_file_id(self, ctx):
        import bot

        audio = MagicMock()
        audio.file_id = "AUD_FID"
        audio.mime_type = "audio/mpeg"
        update = _make_update(12345)
        update.message.audio = audio

        with patch("bot.save_message") as mock_save:
            await bot._handle_audio(update, ctx)
            kw = mock_save.call_args.kwargs
            assert kw["message_type"] == "audio"
            assert kw["file_id"] == "AUD_FID"

    async def test_handlers_do_not_reply_to_regular_messages(self, ctx):
        import bot

        update = _make_update(12345, text="regular note")
        with patch("bot.save_message"):
            await bot._handle_text(update, ctx)
            update.message.reply_text.assert_not_awaited()

    async def test_timestamp_includes_date(self, ctx):
        import bot

        update = _make_update(12345, text="check date")
        with patch("bot.save_message") as mock_save:
            await bot._handle_text(update, ctx)
            kw = mock_save.call_args.kwargs
            # date should be YYYY-MM-DD
            import re
            assert re.match(r"\d{4}-\d{2}-\d{2}", kw["date"])
            # timestamp should be ISO8601
            assert "T" in kw["timestamp"]
