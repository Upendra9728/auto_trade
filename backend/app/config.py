from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[1] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
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
    auth_session_hours: int = 24 * 30
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

    # IPv6 pool — prefix (without trailing number) carved from the AWS ENI delegation.
    # Example: '2406:da1a:c1e:f000:a79e::'
    # When set, each new user is automatically assigned the next free address.
    # Leave empty to disable auto-assignment (admin assigns manually).
    ipv6_pool_prefix: str = "2406:da1a:c1e:f000:a79e::"
    # Lowest host suffix to allocate (decimal).  1 = start at ::1
    ipv6_pool_start: int = 1
    # Network interface name on the EC2 instance (usually ens5 on Nitro).
    # Used when auto-provisioning new IPv6 addresses onto the interface.
    ipv6_interface: str = "ens5"
    # When True, automatically add newly assigned IPv6 addresses to the OS
    # network interface and persistent systemd-networkd config.
    # Requires the process to have CAP_NET_ADMIN or passwordless sudo for 'ip'.
    ipv6_auto_provision: bool = True

    # Token refresh scheduler
    token_refresh_interval_seconds: int = 300
    token_renew_threshold_hours: int = 1

    # Mobile app update distribution (bump when releasing a new APK)
    # Must include the bucket's region — ap-south-1 here, not the global s3.amazonaws.com host.
    app_latest_version: str = "1.5.2"
    app_apk_url: str = "https://apk-buket.s3.ap-south-1.amazonaws.com/app-release.apk"
    app_force_update: bool = False
    app_release_notes: str = "New features\nBug fixes\nPerformance"

    # Telegram <-> app signal integration
    # Bot token from @BotFather; used both by the standalone bot/ process (inbound) and by this
    # backend to send messages to the group (outbound, when a signal's send_to_telegram is True).
    telegram_bot_token: str | None = None
    # Chat ID of the admin's Telegram group; the bot only listens to/sends to this chat.
    telegram_group_chat_id: str | None = None
    # Email of the admin User that Telegram-originated signals are attributed to (created_by_id).
    telegram_signal_admin_email: str | None = None


settings = Settings()
