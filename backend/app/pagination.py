"""Shared pagination + IST-date-range query helpers for admin/user list endpoints."""
from __future__ import annotations

import datetime as dt

from fastapi import HTTPException
from sqlalchemy import Date, cast, func

from .schemas import PaginationMeta

# Dhan/app convention: dates shown to users are IST: see mobile/utils/time.ts
_IST_OFFSET = dt.timedelta(hours=5, minutes=30)


def parse_ist_date_range(
    date_from: str | None, date_to: str | None
) -> tuple[dt.datetime | None, dt.datetime | None]:
    """
    Parse optional YYYY-MM-DD query params (interpreted as IST calendar dates) into a
    UTC-naive [start, end) range suitable for filtering a UTC-naive created_at column.
    """
    start_utc: dt.datetime | None = None
    end_utc: dt.datetime | None = None
    try:
        if date_from:
            start_utc = dt.datetime.strptime(date_from, "%Y-%m-%d") - _IST_OFFSET
        if date_to:
            end_utc = dt.datetime.strptime(date_to, "%Y-%m-%d") + dt.timedelta(days=1) - _IST_OFFSET
    except ValueError:
        raise HTTPException(status_code=400, detail="date_from/date_to must be in YYYY-MM-DD format")
    return start_utc, end_utc


def paginate_meta(*, page: int, page_size: int, total: int) -> PaginationMeta:
    total_pages = (total + page_size - 1) // page_size if total else 0
    return PaginationMeta(page=page, page_size=page_size, total=total, total_pages=total_pages)


def list_day_buckets(query, date_column, *, page: int, page_size: int = 15):
    """
    Group `query` into IST calendar-day buckets (newest first), paginated by day.
    Uses portable SQLAlchemy expressions (column + timedelta, then cast to Date)
    instead of SQLite-only date()/datetime() so this works on Postgres too.
    """
    day_expr = cast(date_column + _IST_OFFSET, Date)
    grouped = query.with_entities(day_expr.label("date")).group_by(day_expr)
    total = query.session.query(func.count()).select_from(grouped.subquery()).scalar() or 0
    rows = (
        query.with_entities(day_expr.label("date"), func.count().label("count"))
        .group_by(day_expr)
        .order_by(day_expr.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    # Different DB drivers return the cast Date as either a date object (psycopg) or a str (sqlite).
    days = [
        {"date": row.date.isoformat() if hasattr(row.date, "isoformat") else str(row.date), "count": row.count}
        for row in rows
    ]
    return days, paginate_meta(page=page, page_size=page_size, total=total)
