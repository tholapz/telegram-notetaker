import pytest


@pytest.fixture(autouse=True)
def env_vars(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test_token:abc")
    monkeypatch.setenv("TELEGRAM_ALLOWED_USER_ID", "12345")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test_anthropic_key")
    monkeypatch.setenv("GH_TOKEN", "test_github_token")
    monkeypatch.setenv("GH_REPO", "testuser/testrepo")
    monkeypatch.setenv("GH_BRANCH", "main")
    monkeypatch.setenv("TIMEZONE", "Asia/Bangkok")
    monkeypatch.setenv("MODEL", "claude-opus-4-5")


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Patch DB_PATH to a temp file and initialise the schema."""
    import db

    db_file = tmp_path / "test_notes.db"
    monkeypatch.setattr(db, "DB_PATH", db_file)
    db.init_db()
    yield db_file
