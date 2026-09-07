from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from . import scrip_lookup

# Broad ranges covering common emoji blocks (pictographs, emoticons, dingbats, flags,
# arrows, variation selectors) — stripped so admins can decorate messages freely.
_EMOJI_PATTERN = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E6-\U0001F1FF"
    "\U00002190-\U000021FF"
    "\U00002B00-\U00002BFF"
    "\U0000FE0F"
    "\U0000200D"
    "]+",
    flags=re.UNICODE,
)

_STRIKE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(PE|CE)", flags=re.IGNORECASE)

_MONTH_MAP = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}


@dataclass
class ParsedSignal:
    symbol: str
    strike: float
    option_type: str  # PE | CE
    price: float
    stop_loss_price: float
    target_price: float
    quantity: int | None
    expiry: str | None  # YYYY-MM-DD, optional


def strip_emojis(text: str) -> str:
    return _EMOJI_PATTERN.sub("", text)


def _strip_markdown_markers(line: str) -> str:
    """Strips leading/trailing bold/italic markers (*, _, `) so decorated lines like
    '**SENSEX' or 'EXPIRY**' still match plain text (symbol lookup, key detection)."""
    return line.strip("*_`").strip()


def normalize_channel_name(name: str | None) -> str:
    """Shared normalization for matching a Telegram channel/group name against configured values."""
    return (name or "").strip().lower().lstrip("@")


def _pick_value(lines: list[str], key: str) -> str:
    for line in lines:
        upper = line.upper()
        if upper.startswith(f"{key}:") or upper.startswith(f"{key} "):
            return line.split(":", 1)[1].strip() if ":" in line else line[len(key):].strip()
    return ""


def _extract_numbers(raw: str) -> list[float]:
    if not raw:
        return []
    # Exclude signed negatives created by range notation like "165-170".
    # We want [165, 170], not [165, -170].
    return [float(num) for num in re.findall(r"\d+(?:\.\d+)?", raw)]


def _parse_price_value(raw: str) -> float | None:
    numbers = _extract_numbers(raw)
    if not numbers:
        return None
    if len(numbers) >= 2:
        return sum(numbers[:2]) / 2
    return numbers[0]


def _parse_target_value(raw: str) -> float | None:
    if not raw:
        return None
    cleaned = raw.strip()
    if "/" in cleaned:
        first = cleaned.split("/", 1)[0]
        cleaned = first
    numbers = _extract_numbers(cleaned)
    if not numbers:
        return None
    return numbers[0]


def _parse_expiry(raw: str) -> str | None:
    if not raw:
        return None

    cleaned = raw.strip()
    match = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", cleaned)
    if match:
        year, month, day = match.groups()
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"

    match = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)", cleaned, flags=re.IGNORECASE)
    if match:
        day = int(match.group(1))
        month_name = match.group(2).lower()
        month = _MONTH_MAP.get(month_name[:3], _MONTH_MAP.get(month_name))
        if month is None:
            return None
        year = datetime.now().year
        return f"{year:04d}-{month:02d}-{day:02d}"

    return None


def parse_signal_message(raw_text: str) -> ParsedSignal | None:
    """
    Parses a Telegram group message into signal fields, mirroring the mobile app's
    admin paste-parser (signal-create.tsx). Returns None if the message doesn't match
    the expected format, so unrelated group chatter never creates a signal.

    Supported examples:
        SENSEX
        76800CE
        PRICE @ 165-170
        STOPLOSS 160
        TARGET 200/240/350
        10th September EXPIRY

    Also supports the older key-value format:
        PRICE: 3
        STOPLOSS: 0
        TARGETS: 15
        QTY: 1300
        EXPIRY: 2026-07-21
    """
    cleaned = strip_emojis(raw_text)
    lines = [_strip_markdown_markers(ln) for ln in cleaned.splitlines() if ln.strip()]
    lines = [ln for ln in lines if ln]
    if len(lines) < 2:
        return None

    symbol = None
    for idx, line in enumerate(lines):
        candidate = line.upper()
        if candidate in scrip_lookup.list_symbols():
            symbol = candidate
            symbol_index = idx
            break
    if symbol is None:
        return None

    strike_match = None
    for line in lines[symbol_index + 1:]:
        strike_match = _STRIKE_RE.search(line)
        if strike_match:
            break
    if not strike_match:
        return None

    strike = float(strike_match.group(1))
    option_type = strike_match.group(2).upper()

    price_raw = ""
    stop_raw = ""
    target_raw = ""
    qty_raw = ""
    expiry_raw = ""

    for line in lines:
        upper = line.upper()
        if "PRICE" in upper and not price_raw:
            price_raw = line
        elif ("STOPLOSS" in upper or "STOP_LOSS" in upper) and not stop_raw:
            stop_raw = line
        elif "TARGET" in upper and not target_raw:
            target_raw = line
        elif ("QTY" in upper or "QUANTITY" in upper) and not qty_raw:
            qty_raw = line
        elif "EXPIRY" in upper and not expiry_raw:
            expiry_raw = line

    if not price_raw:
        price_raw = _pick_value(lines, "PRICE")
    if not stop_raw:
        stop_raw = _pick_value(lines, "STOPLOSS") or _pick_value(lines, "STOP_LOSS")
    if not target_raw:
        target_raw = _pick_value(lines, "TARGETS") or _pick_value(lines, "TARGET")
    if not qty_raw:
        qty_raw = _pick_value(lines, "QTY") or _pick_value(lines, "QUANTITY")
    if not expiry_raw:
        expiry_raw = _pick_value(lines, "EXPIRY")

    price = _parse_price_value(price_raw)
    stop_loss_price = _parse_price_value(stop_raw)
    target_price = _parse_target_value(target_raw)
    if price is None or stop_loss_price is None or target_price is None:
        return None

    quantity: int | None = None
    if qty_raw:
        qty_candidates = _extract_numbers(qty_raw)
        if qty_candidates:
            quantity = int(qty_candidates[0])

    expiry = _parse_expiry(expiry_raw)

    return ParsedSignal(
        symbol=symbol,
        strike=strike,
        option_type=option_type,
        price=price,
        stop_loss_price=stop_loss_price,
        target_price=target_price,
        quantity=quantity,
        expiry=expiry,
    )
