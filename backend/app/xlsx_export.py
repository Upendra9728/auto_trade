"""Shared helper for building downloadable .xlsx exports (admin reports)."""
from __future__ import annotations

import datetime as dt
import io

from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Dhan/app convention: dates shown to admins/users are IST: see mobile/utils/time.ts
_IST_OFFSET = dt.timedelta(hours=5, minutes=30)


def to_ist_str(value: dt.datetime | None) -> str:
    """Formats a UTC-naive datetime as an IST 'YYYY-MM-DD HH:MM:SS' string."""
    if value is None:
        return ""
    return (value + _IST_OFFSET).strftime("%Y-%m-%d %H:%M:%S")


def build_xlsx_response(*, filename: str, sheet_title: str, headers: list[str], rows: list[list]) -> StreamingResponse:
    """Builds a single-sheet .xlsx file from headers + rows and returns it as a download."""
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title[:31]  # Excel sheet name limit

    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for row in rows:
        ws.append(row)

    for col_idx, header in enumerate(headers, start=1):
        width = max(12, min(40, len(header) + 4))
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = width

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
