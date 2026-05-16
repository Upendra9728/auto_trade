from __future__ import annotations

import csv
from functools import lru_cache
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import re

from pydantic import ValidationError

from .schemas import GttPlaceRequest


_CSV_PATH = Path(__file__).resolve().parents[2] / "bot" / "complete.csv"
_SYMBOL_RE = re.compile(
    r"^SYMBOL\s*:\s*([A-Z0-9 ]+?)\s*(\d+(?:\.\d+)?)(CE|PE)\s*$",
    re.IGNORECASE,
)
_EXPIRY_RE = re.compile(r"^EXPIRY\s*:\s*(.+?)\s*$", re.IGNORECASE)
_INSTRUMENT_RE = re.compile(r"^INSTRUMENT_TOKEN\s*:\s*(.+?)\s*$", re.IGNORECASE)
_PRICE_RANGE_RE = re.compile(r"^PRICE\s*:\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))\s*$", re.IGNORECASE)
_PRICE_ABOVE_RE = re.compile(r"^PRICE\s*:\s*ABOVE\s+(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)
_PRICE_EXACT_RE = re.compile(r"^PRICE\s*:\s*(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)
_TARGETS_RE = re.compile(r"^TARGETS\s*:\s*(.+?)\s*$", re.IGNORECASE)
_STOPLOSS_RE = re.compile(r"^STOPLOSS\s*:\s*(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)
_QTY_RE = re.compile(r"^(QTY|QUANTITY)\s*:\s*(\d+)\s*$", re.IGNORECASE)


def _parse_price(value: str) -> float:
    parts = [part for part in re.split(r"\s*[-–]\s*", value.strip()) if part]
    if len(parts) == 2:
        return round((float(parts[0]) + float(parts[1])) / 2, 2)
    return float(parts[0])


def _parse_targets(value: str) -> list[float]:
    targets: list[float] = []
    for raw_part in re.split(r"[\s/,+-]+", value.strip()):
        if raw_part:
            targets.append(float(raw_part))
    return targets


def _normalize_numeric_text(value: str) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else str(number)


def _normalize_expiry(value: str) -> str:
    cleaned = value.strip().upper().replace("/", "-")
    for fmt in ("%Y-%m-%d", "%d-%b-%y", "%d %b %Y", "%d%b%y", "%d%b%Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(f"Unsupported EXPIRY format: {value}")


def _round_to_tick(value: float, tick_size: float) -> float:
    if tick_size <= 0:
        return value
    tick = Decimal(str(tick_size))
    val = Decimal(str(value))
    steps = (val / tick).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    rounded = (steps * tick).quantize(tick)
    return float(rounded)


@lru_cache(maxsize=1)
def _load_instruments() -> list[dict[str, str]]:
    if not _CSV_PATH.exists():
        raise ValueError(f"Instrument CSV not found: {_CSV_PATH}")

    with _CSV_PATH.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def _resolve_instrument_row(symbol: str, expiry: str) -> dict[str, str]:
    symbol_match = _SYMBOL_RE.match(f"SYMBOL: {symbol}")
    if not symbol_match:
        raise ValueError(
            "SYMBOL must look like 'SENSEX 75800PE' or 'BANKEX 57000CE'"
        )

    underlying = symbol_match.group(1).strip().upper().replace(" ", "")
    strike = _normalize_numeric_text(symbol_match.group(2))
    option_type = symbol_match.group(3).upper()
    normalized_expiry = _normalize_expiry(expiry)

    for row in _load_instruments():
        row_underlying = (row.get("name") or "").strip().upper().replace(" ", "")
        row_tradingsymbol = (row.get("tradingsymbol") or "").strip().upper().replace(" ", "")
        row_expiry = (row.get("expiry") or "").strip()
        row_strike = _normalize_numeric_text(row.get("strike") or "0") if (row.get("strike") or "").strip() else ""
        row_option_type = (row.get("option_type") or "").strip().upper()

        if (
            row_expiry == normalized_expiry
            and row_option_type == option_type
            and row_strike == strike
            and (
                row_underlying == underlying
                or row_tradingsymbol.startswith(underlying)
                or underlying in row_tradingsymbol
            )
        ):
            instrument_key = (row.get("instrument_key") or "").strip()
            if instrument_key:
                return row

    raise ValueError(
        f"Could not resolve instrument_token for SYMBOL '{symbol}' with EXPIRY '{expiry}'"
    )


def _resolve_instrument_token(symbol: str, expiry: str) -> str:
    return (_resolve_instrument_row(symbol, expiry).get("instrument_key") or "").strip()


def _find_instrument_row_by_token(instrument_token: str) -> dict[str, str] | None:
    token = instrument_token.strip()
    for row in _load_instruments():
        if (row.get("instrument_key") or "").strip() == token:
            return row
    return None


def parse_telegram_message_to_gtt(text: str) -> GttPlaceRequest:
    symbol = ""
    expiry = ""
    instrument_token = ""
    entry_price: float | None = None
    targets: list[float] = []
    stoploss: float | None = None
    quantity: int | None = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        m = _SYMBOL_RE.match(line)
        if m:
            symbol = f"{m.group(1).strip()} {m.group(2).strip()}{m.group(3).strip().upper()}"
            continue

        m = _EXPIRY_RE.match(line)
        if m:
            expiry = m.group(1).strip()
            continue

        m = _INSTRUMENT_RE.match(line)
        if m:
            instrument_token = m.group(1).strip()
            continue

        m = _PRICE_RANGE_RE.match(line)
        if m:
            entry_price = _parse_price(f"{m.group(1)}-{m.group(2)}")
            continue

        m = _PRICE_ABOVE_RE.match(line)
        if m:
            entry_price = round(float(m.group(1)) + 2, 2)
            continue

        m = _PRICE_EXACT_RE.match(line)
        if m:
            entry_price = float(m.group(1))
            continue

        m = _TARGETS_RE.match(line)
        if m:
            targets.extend(_parse_targets(m.group(1)))
            continue

        m = _STOPLOSS_RE.match(line)
        if m:
            stoploss = float(m.group(1))
            continue

        m = _QTY_RE.match(line)
        if m:
            quantity = int(m.group(2))
            continue

    row: dict[str, str] | None = None
    if not instrument_token:
        if not symbol:
            raise ValueError("SYMBOL is required")
        if not expiry:
            raise ValueError("EXPIRY is required")
        row = _resolve_instrument_row(symbol=symbol, expiry=expiry)
        instrument_token = (row.get("instrument_key") or "").strip()
    else:
        row = _find_instrument_row_by_token(instrument_token)
    if entry_price is None:
        raise ValueError("PRICE is required")
    if not targets:
        raise ValueError("TARGETS is required")
    if stoploss is None:
        raise ValueError("STOPLOSS is required")

    if len(targets) > 1:
        targets = [targets[0]]

    lot_size = 1
    tick_size = 0.0
    if row:
        try:
            lot_size = int(float(row.get("lot_size") or 1))
        except ValueError:
            lot_size = 1
        try:
            tick_size = float(row.get("tick_size") or 0)
        except ValueError:
            tick_size = 0.0

    if quantity is None:
        quantity = lot_size if lot_size > 0 else 1

    if lot_size > 0 and quantity % lot_size != 0:
        raise ValueError(f"QTY must be a multiple of lot size {lot_size}")

    if tick_size > 0:
        entry_price = _round_to_tick(entry_price, tick_size)
        targets = [_round_to_tick(t, tick_size) for t in targets]
        stoploss = _round_to_tick(stoploss, tick_size)

    obj = {
        "type": "MULTIPLE",
        "quantity": quantity,
        "product": "D",
        "instrument_token": instrument_token,
        "transaction_type": "BUY",
        "rules": [
            {
                "strategy": "ENTRY",
                "trigger_type": "ABOVE",
                "trigger_price": entry_price,
            },
            *[
                {
                    "strategy": "TARGET",
                    "trigger_type": "IMMEDIATE",
                    "trigger_price": target_price,
                }
                for target_price in targets
            ],
            {
                "strategy": "STOPLOSS",
                "trigger_type": "IMMEDIATE",
                "trigger_price": stoploss,
            },
        ],
    }

    try:
        return GttPlaceRequest.model_validate(obj)
    except ValidationError as e:
        raise ValueError(f"Could not parse GTT payload from Telegram message: {e}")
