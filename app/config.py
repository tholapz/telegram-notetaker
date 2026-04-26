from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "my-service"
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"

    # Cloud Run injects PORT=8080 at runtime; local dev defaults to 8000.
    # pydantic-settings maps the PORT env var here automatically (case-insensitive).
    port: int = 8000

    # Comma-separated origins are parsed into a list by pydantic-settings.
    cors_origins: list[str] = ["http://localhost:3000"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
