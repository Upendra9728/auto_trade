from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from functools import lru_cache
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import logging
import re

from pydantic import ValidationError

from .schemas import GttPlaceRequest


_CSV_PATH = Path(__file__).resolve().parents[2] / "bot" / "complete.csv"
_DHAN_CSV_PATH = Path(__file__).resolve().parents[2] / "bot" / "api-scrip-master-detailed.csv"

# Maps (EXCH_ID, SEGMENT) from Dhan scrip master → Dhan API exchangeSegment value
_DHAN_EXCHANGE_SEGMENT_MAP: dict[tuple[str, str], str] = {
    ("NSE", "D"): "NSE_FNO",
    ("BSE", "D"): "BSE_FNO",
    ("NSE", "C"): "NSE_CUR",
    ("BSE", "C"): "BSE_CUR",
    ("NSE", "E"): "NSE_EQ",
    ("BSE", "E"): "BSE",
    ("MCX", "M"): "MCX_COMM",
}
_SYMBOL_RE = re.compile(
    r"^SYMBOL\s*:\s*([A-Z0-9 ]+?)\s*(\d+(?:\.\d+)?)(CE|PE)\s*$",
    re.IGNORECASE,
)
_EXPIRY_RE = re.compile(r"^EXPIRY\s*:?\s*(.+?)\s*$", re.IGNORECASE)
_INSTRUMENT_RE = re.compile(r"^INSTRUMENT_TOKEN\s*:\s*(.+?)\s*$", re.IGNORECASE)
_PRICE_RANGE_RE = re.compile(r"^PRICE\s*:?\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))\s*$", re.IGNORECASE)
_PRICE_ABOVE_RE = re.compile(r"^PRICE\s*:?\s*ABOVE\s+(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)
_PRICE_EXACT_RE = re.compile(r"^PRICE\s*:?\s*(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)
_TARGETS_RE = re.compile(r"^TARGETS\s*:?\s*(.+?)\s*$", re.IGNORECASE)
_STOPLOSS_RE = re.compile(r"^STOPLOSS\s*:?\s*(\d+(?:\.\d+)?)\s*$", re.IGNORECASE)
_QTY_RE = re.compile(r"^(QTY|QUANTITY)\s*:?\s*(\d+)\s*$", re.IGNORECASE)
_STRIKE_LINE_RE = re.compile(r"^(\d+(?:\.\d+)?)(CE|PE)\s*$", re.IGNORECASE)
# Matches trailing broker/order-type line: "Upstox GTT", "Dhann BO", "Fyers BO"
_BROKER_LINE_RE = re.compile(
    r"^(upstox|dhann|dhan|fyers)\s+(gtt|bo|bracket)\s*$",
    re.IGNORECASE,
)
_EXPIRY_SUFFIX_RE = re.compile(
    r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z]{3,9})(?:\s+(\d{2,4}))?\s+EXPIRY\s*$",
    re.IGNORECASE,
)
_HEADER_KEYWORDS_RE = re.compile(
    r"^(SYMBOL|INSTRUMENT_TOKEN|PRICE|STOPLOSS|TARGETS|EXPIRY|QTY|QUANTITY)\b",
    re.IGNORECASE,
)

logger = logging.getLogger(__name__)


def get_buffer(entry_price: float) -> float:
    if 100 <= entry_price < 200:
        return 2.0
    if 200 <= entry_price < 300:
        return 3.0
    if 300 <= entry_price < 400:
        return 4.0
    if entry_price >= 400:
        return 5.0
    return 0.0


def apply_buffer(signal_type: str, entry: float, stoploss: float, target: float) -> tuple[float, float, float]:
    buffer_points = get_buffer(entry)
    if signal_type.upper() == "SELL":
        adjusted_stoploss = stoploss + buffer_points
        adjusted_target = target + buffer_points
    else:
        adjusted_stoploss = stoploss - buffer_points
        adjusted_target = target - buffer_points
    return buffer_points, adjusted_stoploss, adjusted_target


def validate_risk_reward(
    signal_type: str,
    entry: float,
    stoploss: float,
    target: float,
) -> tuple[bool, float, float, float]:
    if signal_type.upper() == "SELL":
        risk = stoploss - entry
        reward = entry - target
    else:
        risk = entry - stoploss
        reward = target - entry

    if risk <= 0 or reward <= 0:
        return False, 0.0, risk, reward

    ratio = reward / risk
    return ratio >= 2.0, ratio, risk, reward


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


def _normalize_expiry_from_parts(day_text: str, month_text: str, year_text: str | None) -> str:
    month_key = month_text.strip().upper()[:3]
    month_map = {
        "JAN": 1,
        "FEB": 2,
        "MAR": 3,
        "APR": 4,
        "MAY": 5,
        "JUN": 6,
        "JUL": 7,
        "AUG": 8,
        "SEP": 9,
        "OCT": 10,
        "NOV": 11,
        "DEC": 12,
    }
    if month_key not in month_map:
        raise ValueError(f"Unsupported EXPIRY month: {month_text}")

    day = int(day_text)
    if year_text:
        year = int(year_text)
        if year < 100:
            year += 2000
    else:
        today = datetime.utcnow().date()
        year = today.year
        try_date = datetime(year, month_map[month_key], day).date()
        if try_date < today:
            year += 1

    return datetime(year, month_map[month_key], day).strftime("%Y-%m-%d")


def _is_underlying_line(value: str) -> bool:
    if _HEADER_KEYWORDS_RE.match(value):
        return False
    if re.search(r"\d", value):
        return False
    return bool(re.fullmatch(r"[A-Z][A-Z& ]{1,24}", value.strip().upper()))


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


@lru_cache(maxsize=1)
def _load_dhan_instruments() -> list[dict[str, str]]:
    if not _DHAN_CSV_PATH.exists():
        raise ValueError(f"Dhan scrip master CSV not found: {_DHAN_CSV_PATH}")

    with _DHAN_CSV_PATH.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def _dhan_exchange_segment(row: dict[str, str]) -> str:
    key = (row.get("EXCH_ID", "").strip().upper(), row.get("SEGMENT", "").strip().upper())
    return _DHAN_EXCHANGE_SEGMENT_MAP.get(key, f"{key[0]}_{key[1]}")


def _resolve_dhan_instrument_row(symbol: str, expiry: str) -> dict[str, str]:
    """Resolve instrument row from Dhan scrip master CSV."""
    symbol_match = _SYMBOL_RE.match(f"SYMBOL: {symbol}")
    if not symbol_match:
        raise ValueError("SYMBOL must look like 'BANKNIFTY 50000CE'")

    underlying = symbol_match.group(1).strip().upper().replace(" ", "")
    strike_raw = symbol_match.group(2).strip()
    option_type = symbol_match.group(3).upper()
    normalized_expiry = _normalize_expiry(expiry)

    # Dhan stores strike as float string (e.g. "50000.0" or "50000")
    # Normalize both sides to plain int-like string when possible
    try:
        strike_norm = str(int(float(strike_raw)))
    except ValueError:
        strike_norm = strike_raw

    for row in _load_dhan_instruments():
        # Match UNDERLYING_SYMBOL
        row_underlying = (row.get("UNDERLYING_SYMBOL") or "").strip().upper()
        if row_underlying != underlying:
            continue

        # Match OPTION_TYPE (CE/PE; skip XX = non-option)
        row_opt = (row.get("OPTION_TYPE") or "").strip().upper()
        if row_opt != option_type:
            continue

        # Match expiry
        row_expiry_raw = (row.get("SM_EXPIRY_DATE") or "").strip()
        try:
            row_expiry = _normalize_expiry(row_expiry_raw)
        except ValueError:
            continue
        if row_expiry != normalized_expiry:
            continue

        # Match strike
        try:
            row_strike = str(int(float(row.get("STRIKE_PRICE") or "0")))
        except ValueError:
            row_strike = ""
        if row_strike != strike_norm:
            continue

        if (row.get("SECURITY_ID") or "").strip():
            return row

    raise ValueError(
        f"Could not resolve Dhan security_id for SYMBOL '{symbol}' with EXPIRY '{expiry}'"
    )


def _find_dhan_row_by_security_id(security_id: str) -> dict[str, str] | None:
    sid = security_id.strip()
    for row in _load_dhan_instruments():
        if (row.get("SECURITY_ID") or "").strip() == sid:
            return row
    return None


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


@dataclass
class ParsedOrder:
    broker: str          # "upstox" | "dhann" | "fyers"
    order_subtype: str   # "gtt" | "bo"
    quantity: int
    price: float
    stoploss: float
    target: float
    adjusted_stoploss: float
    adjusted_target: float
    instrument_token: str
    security_id: str     # exchange_token from CSV (used by Dhann)
    exchange_segment: str
    tradingsymbol: str
    gtt_request: GttPlaceRequest | None = None


def _parse_order_fields(text: str, broker: str = "upstox") -> tuple[str, str, str, float | None, list[float], float | None, int | None, dict | None]:
    """Parse raw fields from a Telegram message. Returns (signal_type, symbol, instrument_token,
    entry_price, targets, stoploss, quantity, instrument_row).

    Uses the appropriate instrument CSV based on broker:
    - "upstox" / "fyers" → bot/complete.csv  (Upstox instrument keys)
    - "dhann"            → bot/api-scrip-master-detailed.csv  (Dhan security IDs)
    """
    signal_type = "BUY"
    symbol = ""
    expiry = ""
    instrument_token = ""
    entry_price: float | None = None
    targets: list[float] = []
    stoploss: float | None = None
    quantity: int | None = None
    underlying_hint = ""

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # Skip broker/order type line at end
        if _BROKER_LINE_RE.match(line):
            continue

        m = _SYMBOL_RE.match(line)
        if m:
            symbol = f"{m.group(1).strip()} {m.group(2).strip()}{m.group(3).strip().upper()}"
            continue

        if not symbol and not underlying_hint and _is_underlying_line(line):
            underlying_hint = line.strip().upper()
            continue

        if not symbol and underlying_hint:
            m = _STRIKE_LINE_RE.match(line)
            if m:
                symbol = f"{underlying_hint} {m.group(1).strip()}{m.group(2).strip().upper()}"
                continue

        m = _EXPIRY_RE.match(line)
        if m:
            expiry = m.group(1).strip()
            continue

        m = _EXPIRY_SUFFIX_RE.match(line)
        if m:
            expiry = _normalize_expiry_from_parts(m.group(1), m.group(2), m.group(3))
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
        if broker == "dhann":
            row = _resolve_dhan_instrument_row(symbol=symbol, expiry=expiry)
            # For Dhan, instrument_token holds the SECURITY_ID (used as security_id in API)
            instrument_token = (row.get("SECURITY_ID") or "").strip()
        else:
            row = _resolve_instrument_row(symbol=symbol, expiry=expiry)
            instrument_token = (row.get("instrument_key") or "").strip()
    else:
        if broker == "dhann":
            row = _find_dhan_row_by_security_id(instrument_token)
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
        # Dhan CSV uses uppercase column names; Upstox CSV uses lowercase
        lot_size_raw = row.get("lot_size") or row.get("LOT_SIZE") or "1"
        tick_size_raw = row.get("tick_size") or row.get("TICK_SIZE") or "0"
        try:
            lot_size = int(float(lot_size_raw))
        except ValueError:
            lot_size = 1
        try:
            tick_size = float(tick_size_raw)
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

    return signal_type, instrument_token, entry_price, targets, stoploss, quantity, row


def _detect_broker(text: str) -> tuple[str, str]:
    """Return (broker, order_subtype) from the last non-empty line of the message."""
    for line in reversed(text.splitlines()):
        stripped = line.strip()
        if not stripped:
            continue
        m = _BROKER_LINE_RE.match(stripped)
        if m:
            raw_broker = m.group(1).lower()
            raw_subtype = m.group(2).lower()
            broker = "dhann" if raw_broker in ("dhann", "dhan") else raw_broker
            subtype = "gtt" if raw_subtype == "gtt" else "bo"
            return broker, subtype
        # If last line has no broker marker, default to upstox gtt
        break
    return "upstox", "gtt"


def parse_telegram_message(text: str) -> ParsedOrder:
    """Parse a full Telegram trade message and return a broker-aware ParsedOrder."""
    broker, order_subtype = _detect_broker(text)

    signal_type, instrument_token, entry_price, targets, stoploss, quantity, row = \
        _parse_order_fields(text, broker=broker)

    raw_entry = entry_price
    raw_target = targets[0]
    raw_stoploss = stoploss

    logger.info(
        "Raw prices | entry=%s stoploss=%s target=%s side=%s broker=%s",
        raw_entry, raw_stoploss, raw_target, signal_type, broker,
    )

    rr_ok, rr_ratio, risk, reward = validate_risk_reward(signal_type, raw_entry, raw_stoploss, raw_target)
    logger.info("RR ratio | risk=%s reward=%s ratio=%.4f", risk, reward, rr_ratio)
    if not rr_ok:
        logger.warning("BLOCKED: Risk:Reward too low")
        raise ValueError("BLOCKED: Risk:Reward too low")

    tick_size = float((row or {}).get("tick_size") or (row or {}).get("TICK_SIZE") or 0)
    buffer_points, adjusted_stoploss, adjusted_target = apply_buffer(
        signal_type, raw_entry, raw_stoploss, raw_target
    )
    if tick_size > 0:
        adjusted_stoploss = _round_to_tick(adjusted_stoploss, tick_size)
        adjusted_target = _round_to_tick(adjusted_target, tick_size)

    logger.info("Adjusted prices | stoploss=%s target=%s", adjusted_stoploss, adjusted_target)

    # Extract fields from the broker-appropriate CSV row
    if broker == "dhann" and row:
        security_id = (row.get("SECURITY_ID") or "").strip()
        tradingsymbol = (row.get("SYMBOL_NAME") or row.get("UNDERLYING_SYMBOL") or "").strip()
        exchange_segment = _dhan_exchange_segment(row)
    else:
        security_id = (row or {}).get("exchange_token") or ""
        tradingsymbol = (row or {}).get("tradingsymbol") or ""
        exchange_segment = (row or {}).get("exchange") or "NSE_FO"

    gtt_request: GttPlaceRequest | None = None
    if broker == "upstox":
        obj = {
            "type": "MULTIPLE",
            "quantity": quantity,
            "product": "D",
            "instrument_token": instrument_token,
            "transaction_type": "BUY",
            "rules": [
                {"strategy": "ENTRY", "trigger_type": "ABOVE", "trigger_price": raw_entry},
                {"strategy": "TARGET", "trigger_type": "IMMEDIATE", "trigger_price": adjusted_target},
                {"strategy": "STOPLOSS", "trigger_type": "IMMEDIATE", "trigger_price": adjusted_stoploss},
            ],
        }
        logger.info("Final GTT payload | %s", json.dumps(obj, separators=(",", ":")))
        try:
            gtt_request = GttPlaceRequest.model_validate(obj)
        except ValidationError as e:
            raise ValueError(f"Could not build GTT payload: {e}")

    return ParsedOrder(
        broker=broker,
        order_subtype=order_subtype,
        quantity=quantity,
        price=raw_entry,
        stoploss=raw_stoploss,
        target=raw_target,
        adjusted_stoploss=adjusted_stoploss,
        adjusted_target=adjusted_target,
        instrument_token=instrument_token,
        security_id=security_id,
        exchange_segment=exchange_segment,
        tradingsymbol=tradingsymbol,
        gtt_request=gtt_request,
    )


def parse_telegram_message_to_gtt(text: str) -> GttPlaceRequest:
    """Legacy helper kept for backward compatibility. Parses as Upstox GTT."""
    parsed = parse_telegram_message(text)
    if parsed.gtt_request is None:
        raise ValueError("Message does not contain a valid Upstox GTT order")
    return parsed.gtt_request
