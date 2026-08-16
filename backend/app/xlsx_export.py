"""Shared helper for building downloadable .xlsx exports (admin reports)."""
from __future__ import annotations

import datetime as dt
import io

from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

_IST_OFFSET = dt.timedelta(hours=5, minutes=30)

# ── Colour palette ─── only white/grey, alternated per signal group ──────────
_HDR_FILL  = PatternFill(fill_type="solid", fgColor="1F4E79")   # dark navy header
_ROW_WHITE = PatternFill(fill_type="solid", fgColor="FFFFFF")
_ROW_GREY  = PatternFill(fill_type="solid", fgColor="F2F2F2")


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

    row_fills: per-row PatternFill override (e.g. alternating white/grey per
    signal group). None entries fall back to plain white/grey alternation by row.
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
