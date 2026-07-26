from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[1] / ".env"),
        env_file_encoding="utf-8",
    )

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/automate_trading"
    # Comma-separated origins allowed for CORS (mobile app uses * or its own scheme)
    cors_origins: str = "*"

    token_encryption_key: str
    # Used to protect the admin-bootstrap endpoint
    admin_secret: str = "change-me"
    # Used for internal service-to-service calls (optional)
    internal_secret: str = "change-me"

    # Session config
    auth_session_hours: int = 24 * 7
    otp_expiry_minutes: int = 10

    # Email (for OTP password reset)
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None

    # Firebase Cloud Messaging
    # Path to the service account JSON file OR the raw JSON string
    firebase_credentials_path: str | None = None
    # If set, takes precedence over firebase_credentials_path
    firebase_credentials_json: str | None = None

    # IPv6 pool — prefix (without trailing :) carved from the AWS ENI delegation.
    # Example: '2406:da1a:c1e:f000:bb82:'
    # When set, each new user is automatically assigned the next free address.
    # Leave empty to disable auto-assignment (admin assigns manually).
    ipv6_pool_prefix: str = "2406:da1a:c1e:f000:bb82:"
    # Lowest host suffix to allocate (decimal).  1 = start at ::1
    ipv6_pool_start: int = 1


settings = Settings()
