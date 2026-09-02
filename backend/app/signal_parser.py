from __future__ import annotations

import re
from dataclasses import dataclass

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

_STRIKE_RE = re.compile(r"^(\d+(?:\.\d+)?)(PE|CE)$")


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


def _pick_value(lines: list[str], key: str) -> str:
    for line in lines:
        if line.upper().startswith(f"{key}:"):
            return line.split(":", 1)[1].strip()
    return ""


def parse_signal_message(raw_text: str) -> ParsedSignal | None:
    """
    Parses a Telegram group message into signal fields, mirroring the mobile app's
    admin paste-parser (signal-create.tsx). Returns None if the message doesn't match
    the expected format, so unrelated group chatter never creates a signal.

    Expected format (QTY and EXPIRY are optional):
        NIFTY
        23800PE
        PRICE: 3
        STOPLOSS: 0
        TARGETS: 15
        QTY: 1300
        EXPIRY: 2026-07-21
    """
    cleaned = strip_emojis(raw_text)
    lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None

    symbol = lines[0].upper()
    if symbol not in scrip_lookup.list_symbols():
        return None

    strike_match = _STRIKE_RE.match(lines[1].upper().replace(" ", ""))
    if not strike_match:
        return None
    strike = float(strike_match.group(1))
    option_type = strike_match.group(2)

    price_raw = _pick_value(lines, "PRICE")
    stop_raw = _pick_value(lines, "STOPLOSS") or _pick_value(lines, "STOP_LOSS")
    target_raw = _pick_value(lines, "TARGETS") or _pick_value(lines, "TARGET")
    qty_raw = _pick_value(lines, "QTY") or _pick_value(lines, "QUANTITY")
    expiry_raw = _pick_value(lines, "EXPIRY")

    try:
        price = float(price_raw)
        stop_loss_price = float(stop_raw)
        target_price = float(target_raw)
    except ValueError:
        return None

    quantity: int | None = None
    if qty_raw:
        try:
            quantity = int(float(qty_raw))
        except ValueError:
            return None

    expiry = expiry_raw[:10] if expiry_raw else None

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
