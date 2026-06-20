from __future__ import annotations

import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


connect_args: dict = {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _run_migrations() -> None:
    """Run lightweight column-add migrations for existing databases (PostgreSQL)."""
    migrations = [
        (
            "client_tokens",
            "broker",
            "ALTER TABLE client_tokens ADD COLUMN broker VARCHAR(32) NOT NULL DEFAULT 'upstox'",
        ),
        (
            "client_tokens",
            "user_id",
            "ALTER TABLE client_tokens ADD COLUMN user_id INTEGER REFERENCES users(id)",
        ),
        (
            "users",
            "primary_broker",
            "ALTER TABLE users ADD COLUMN primary_broker VARCHAR(32) NOT NULL DEFAULT 'upstox'",
        ),
    ]

    with engine.connect() as conn:
        for table, column, ddl in migrations:
            try:
                conn.execute(text(ddl))
                conn.commit()
                logger.info("Migration applied: ADD COLUMN %s.%s", table, column)
            except Exception as exc:
                conn.rollback()
                # Postgres error code 42701 = column already exists
                msg = str(exc).lower()
                if "already exists" in msg or "duplicate column" in msg or "42701" in msg:
                    continue
                logger.warning("Migration skipped for %s.%s: %s", table, column, exc)


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _run_migrations()
