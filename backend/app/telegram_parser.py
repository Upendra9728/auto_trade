from __future__ import annotations

import json
import re
from typing import Any

from pydantic import ValidationError

from .schemas import GttPlaceRequest, GttRule


_RULE_RE = re.compile(
    r"^(?:rule\s*[:=\-]\s*)?(ENTRY|TARGET|STOPLOSS)\s+(ABOVE|BELOW|IMMEDIATE)\s+([0-9]+(?:\.[0-9]+)?)\s*$",
    re.IGNORECASE,
)

_KV_RE = re.compile(r"^\s*([^:=\-]+?)\s*[:=\-]\s*(.+?)\s*$")
_KV_WS_RE = re.compile(r"^\s*([A-Za-z][A-Za-z _\-]*)\s+(.+?)\s*$")
_QTY_RE = re.compile(r"^(?:qty|quantity)\s+(\d+)\s*$", re.IGNORECASE)
_SIDE_RE = re.compile(r"^(?:side|transaction\s*type|transaction)\s+(buy|sell)\s*$", re.IGNORECASE)


def _norm_key(key: str) -> str:
    # normalize keys like "Instrument Token" / "instrument_token" / "instrument-token"
    return re.sub(r"[^a-z0-9]", "", key.strip().lower())


def _try_extract_json(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if not text:
        return None

    # Find first JSON object block in message
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    candidate = text[start : end + 1]
    try:
        obj = json.loads(candidate)
    except Exception:
        return None

    return obj if isinstance(obj, dict) else None


def _parse_kv_lines(text: str) -> dict[str, Any]:
    payload: dict[str, Any] = {"rules": []}

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        m = _RULE_RE.match(line)
        if m:
            strategy, trigger_type, trigger_price = m.group(1), m.group(2), m.group(3)
            payload["rules"].append(
                {
                    "strategy": strategy.upper(),
                    "trigger_type": trigger_type.upper(),
                    "trigger_price": float(trigger_price),
                }
            )
            continue

        # Common shorthand where users send only the side
        if line.upper() in {"BUY", "SELL"}:
            payload["transaction_type"] = line.upper()
            continue

        # Quantity without explicit separators, e.g. "QTY 1" / "Quantity 10"
        m_qty = _QTY_RE.match(line)
        if m_qty:
            payload["quantity"] = int(m_qty.group(1))
            continue

        # Side/transaction without explicit separators, e.g. "SIDE BUY"
        m_side = _SIDE_RE.match(line)
        if m_side:
            payload["transaction_type"] = m_side.group(1).upper()
            continue

        kv = _KV_RE.match(line)
        if not kv:
            # Fallback: whitespace-separated key/value, e.g. "INSTRUMENT_TOKEN NSE_EQ|..."
            kv = _KV_WS_RE.match(line)
        if not kv:
            continue

        raw_key, raw_value = kv.group(1), kv.group(2)
        key = _norm_key(raw_key)
        value = raw_value.strip()

        if key in {"type", "gtttype"}:
            payload["type"] = value
        elif key in {"quantity", "qty"}:
            payload["quantity"] = int(value)
        elif key in {"product", "producttype"}:
            payload["product"] = value
        elif key in {"instrumenttoken", "instrument", "scrip", "symboltoken"}:
            payload["instrument_token"] = value
        elif key in {"transactiontype", "transaction", "side"}:
            payload["transaction_type"] = value
        else:
            # ignore unknown keys for now
            continue

    return payload


def parse_telegram_message_to_gtt(text: str) -> GttPlaceRequest:
    obj = _try_extract_json(text)
    if obj is None:
        obj = _parse_kv_lines(text)

    # Normalize key casing for common fields
    if "type" in obj and isinstance(obj["type"], str):
        obj["type"] = obj["type"].upper()
    if "product" in obj and isinstance(obj["product"], str):
        obj["product"] = obj["product"].upper()
    if "transaction_type" in obj and isinstance(obj["transaction_type"], str):
        obj["transaction_type"] = obj["transaction_type"].upper()

    if "rules" in obj and isinstance(obj["rules"], list):
        normalized_rules = []
        for rule in obj["rules"]:
            if not isinstance(rule, dict):
                continue
            if "strategy" in rule and isinstance(rule["strategy"], str):
                rule["strategy"] = rule["strategy"].upper()
            if "trigger_type" in rule and isinstance(rule["trigger_type"], str):
                rule["trigger_type"] = rule["trigger_type"].upper()
            normalized_rules.append(rule)
        obj["rules"] = normalized_rules

    try:
        return GttPlaceRequest.model_validate(obj)
    except ValidationError as e:
        raise ValueError(f"Could not parse GTT payload from Telegram message: {e}")
