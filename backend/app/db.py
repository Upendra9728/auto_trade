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
    if "dhan_credentials" not in inspector.get_table_names():
        return  # table not yet created; create_all will handle it
    existing = {c["name"] for c in inspector.get_columns("dhan_credentials")}
    if "token_expires_at" not in existing:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE dhan_credentials ADD COLUMN token_expires_at TIMESTAMP"))
            conn.commit()
        logger.info("Migration: added token_expires_at column to dhan_credentials")


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _apply_migrations()
