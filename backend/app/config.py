from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[1] / ".env"),
        env_file_encoding="utf-8",
    )

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/automate_trading"
    cors_origins: str = "http://localhost:4200"

    token_encryption_key: str
    internal_secret: str = "change-me"
    admin_secret: str = "change-me"

    upstox_base_url: str = "https://api.upstox.com"
    # OAuth endpoints live on the v2 host
    upstox_oauth_base_url: str = "https://api-v2.upstox.com"
    upstox_x_algo_name: str | None = None
    # Upstox OAuth config (optional, used for server-side token exchange)
    upstox_client_id: str | None = None
    upstox_client_secret: str | None = None
    upstox_redirect_uri: str | None = None
    # Optional: URL of the frontend webapp to redirect users back after OAuth
    webapp_base_url: str | None = None

    auth_session_hours: int = 24 * 7
    otp_expiry_minutes: int = 10

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None


settings = Settings()
