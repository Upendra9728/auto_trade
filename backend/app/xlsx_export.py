"""Shared helper for building downloadable .xlsx exports (admin reports)."""
from __future__ import annotations

import datetime as dt
import io
from typing import Any

from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

_IST_OFFSET = dt.timedelta(hours=5, minutes=30)

# ── Colour palette ────────────────────────────────────────────────────────────
_HDR_FILL  = PatternFill(fill_type="solid", fgColor="1F4E79")   # dark navy header
_ROW_WHITE = PatternFill(fill_type="solid", fgColor="FFFFFF")
_ROW_GREY  = PatternFill(fill_type="solid", fgColor="F2F2F2")   # alternating signal group
_ROW_GREEN  = PatternFill(fill_type="solid", fgColor="E2EFDA")  # traded / success
_ROW_RED    = PatternFill(fill_type="solid", fgColor="FFE0E0")  # failed / rejected
_ROW_ORANGE = PatternFill(fill_type="solid", fgColor="FFF3CD")  # user-rejected / warning
_ROW_PURPLE = PatternFill(fill_type="solid", fgColor="F3E5F5")  # admin-cancelled
_ROW_YELLOW = PatternFill(fill_type="solid", fgColor="FFFDE7")  # pending / live

# notification status → fill (None = use group alternation)
STATUS_FILL_MAP: dict[str, PatternFill] = {
    "failed":    _ROW_RED,
    "rejected":  _ROW_ORANGE,
    "cancelled": _ROW_PURPLE,
}
LIVE_STATUS_FILL_MAP: dict[str, PatternFill] = {
    "TRADED":  _ROW_GREEN,
    "CLOSED":  _ROW_GREEN,
    "TRANSIT": _ROW_YELLOW,
    "PENDING": _ROW_YELLOW,
    "REJECTED":  _ROW_RED,
    "CANCELLED": _ROW_RED,
    "EXPIRED":   _ROW_RED,
}


def to_ist_str(value: dt.datetime | None) -> str:
    """Formats a UTC-naive datetime as an IST 'YYYY-MM-DD HH:MM:SS' string."""
    if value is None:
        return ""
    return (value + _IST_OFFSET).strftime("%Y-%m-%d %H:%M:%S")


def build_xlsx_response(
    *,
    filename: str,
    sheet_title: str,
    headers: list[str],
    rows: list[list],
    row_fills: list[PatternFill | None] | None = None,
) -> StreamingResponse:
    """Builds a single-sheet .xlsx and returns it as a download.

    row_fills: per-row PatternFill override. None entries use group-alternating white/grey.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title[:31]

    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = _HDR_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30

    for row_idx, row in enumerate(rows, start=2):
        ws.append(row)
        fill = (row_fills[row_idx - 2] if row_fills else None) or (_ROW_WHITE if row_idx % 2 == 0 else _ROW_GREY)
        for cell in ws[row_idx]:
            cell.fill = fill

    for col_idx, header in enumerate(headers, start=1):
        width = max(12, min(42, len(header) + 4))
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = width

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
