from __future__ import annotations

import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


connect_args: dict = {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _apply_migrations() -> None:
    """Idempotent column additions for databases created before a schema change."""
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "users" in table_names:
        existing = {c["name"] for c in inspector.get_columns("users")}
        if "email_verified" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE"))
                conn.commit()
            logger.info("Migration: added email_verified column to users")
        if "terms_accepted" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN terms_accepted BOOLEAN DEFAULT FALSE"))
                conn.commit()
            logger.info("Migration: added terms_accepted column to users")
        if "terms_accepted_at" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMP"))
                conn.commit()
            logger.info("Migration: added terms_accepted_at column to users")
        if "credits" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0"))
                conn.commit()
            logger.info("Migration: added credits column to users")
        auto_trade_columns = {"auto_trade_enabled": "BOOLEAN DEFAULT FALSE", "auto_trade_quantity": "INTEGER"}
        missing_auto_trade = {col: ddl for col, ddl in auto_trade_columns.items() if col not in existing}
        if missing_auto_trade:
            with engine.connect() as conn:
                for col, ddl in missing_auto_trade.items():
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))
                conn.commit()
            logger.info("Migration: added auto-trade columns to users: %s", list(missing_auto_trade))

    if "dhan_credentials" in table_names:
        existing = {c["name"] for c in inspector.get_columns("dhan_credentials")}
        if "token_expires_at" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE dhan_credentials ADD COLUMN token_expires_at TIMESTAMP"))
                conn.commit()
            logger.info("Migration: added token_expires_at column to dhan_credentials")
        totp_columns = {"pin_encrypted": "TEXT", "totp_secret_encrypted": "TEXT"}
        missing_totp = {col: ddl for col, ddl in totp_columns.items() if col not in existing}
        if missing_totp:
            with engine.connect() as conn:
                for col, ddl in missing_totp.items():
                    conn.execute(text(f"ALTER TABLE dhan_credentials ADD COLUMN {col} {ddl}"))
                conn.commit()
            logger.info("Migration: added TOTP columns to dhan_credentials: %s", list(missing_totp))

    if "signal_notifications" in table_names:
        existing = {c["name"] for c in inspector.get_columns("signal_notifications")}
        live_status_columns = {
            "live_status": "VARCHAR(16)",
            "exchange_order_no": "VARCHAR(64)",
            "traded_qty": "INTEGER",
            "traded_price": "FLOAT",
            "reason_description": "TEXT",
            "live_updated_at": "TIMESTAMP",
        }
        missing = {name: ddl for name, ddl in live_status_columns.items() if name not in existing}
        if missing:
            with engine.connect() as conn:
                for name, ddl in missing.items():
                    conn.execute(text(f"ALTER TABLE signal_notifications ADD COLUMN {name} {ddl}"))
                conn.commit()
            logger.info("Migration: added live order status columns to signal_notifications: %s", list(missing))

        exit_columns = {
            "exit_leg": "VARCHAR(16)",
            "exit_price": "FLOAT",
            "exit_time": "TIMESTAMP",
            "ordered_quantity": "INTEGER",
            "realized_pnl": "FLOAT",
        }
        missing_exit = {col: ddl for col, ddl in exit_columns.items() if col not in existing}
        if missing_exit:
            with engine.connect() as conn:
                for col, ddl in missing_exit.items():
                    conn.execute(text(f"ALTER TABLE signal_notifications ADD COLUMN {col} {ddl}"))
                conn.commit()
            logger.info("Migration: added exit leg columns to signal_notifications: %s", list(missing_exit))
        
        if "version" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE signal_notifications ADD COLUMN version INTEGER DEFAULT 1"))
                conn.commit()
            logger.info("Migration: added version column to signal_notifications")
        if "is_auto_placed" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE signal_notifications ADD COLUMN is_auto_placed BOOLEAN DEFAULT FALSE"))
                conn.commit()
            logger.info("Migration: added is_auto_placed column to signal_notifications")

    if "signals" in table_names:
        existing = {c["name"] for c in inspector.get_columns("signals")}
        if "target_group_ids" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE signals ADD COLUMN target_group_ids TEXT"))
                conn.commit()
            logger.info("Migration: added target_group_ids column to signals")

    # Create user_groups and user_group_members tables if they don't exist yet
    if "user_groups" not in table_names:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE user_groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(128) NOT NULL UNIQUE,
                    description TEXT,
                    created_by_id INTEGER NOT NULL REFERENCES users(id),
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        logger.info("Migration: created user_groups table")

    if "user_group_members" not in table_names:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE user_group_members (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_id INTEGER NOT NULL REFERENCES user_groups(id),
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (group_id, user_id)
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_group_members_group_id ON user_group_members (group_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_group_members_user_id ON user_group_members (user_id)"))
            conn.commit()
        logger.info("Migration: created user_group_members table")


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _apply_migrations()
