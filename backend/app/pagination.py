"""Shared pagination + IST-date-range query helpers for admin/user list endpoints."""
from __future__ import annotations

import datetime as dt

from fastapi import HTTPException

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
