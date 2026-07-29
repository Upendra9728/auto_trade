from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)

# In-memory index: (SYMBOL, strike_float, OPTION_TYPE, YYYY-MM-DD) → list[ScripMatch]
_INDEX: dict[tuple[str, float, str, str], list["ScripMatch"]] = {}
_LOADED = False


class ScripMatch(TypedDict):
    security_id: str
    trading_symbol: str
    exchange: str          # NSE | BSE
    exchange_segment: str  # NSE_FNO | BSE_FNO
    expiry_date: str       # YYYY-MM-DD
    lot_size: int
    strike_price: float
    option_type: str       # PE | CE


def _load() -> None:
    global _LOADED
    if _LOADED:
        return

    # Configurable path: SCRIP_MASTER_PATH env var, otherwise sibling of app/
    import os
    env_path = os.environ.get("SCRIP_MASTER_PATH")
    csv_path = Path(env_path) if env_path else Path(__file__).parent.parent / "api-scrip-master.csv"

    if not csv_path.exists():
        logger.warning(
            "api-scrip-master.csv not found at %s — scrip auto-lookup disabled. "
            "Download from https://images.dhan.co/api-data/api-scrip-master.csv and place "
            "it next to the backend/ folder, or set SCRIP_MASTER_PATH.",
            csv_path,
        )
        _LOADED = True
        return

    count = 0
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            opt_type = row.get("SEM_OPTION_TYPE", "").strip()
            if opt_type not in ("PE", "CE"):
                continue  # skip futures, currencies, equities

            trading_sym = row.get("SEM_TRADING_SYMBOL", "")
            # Format: NIFTY-Aug2026-23800-PE  →  symbol = NIFTY
            symbol = trading_sym.split("-")[0].upper() if trading_sym else ""
            if not symbol:
                continue

            try:
                strike = round(float(row.get("SEM_STRIKE_PRICE", 0)), 2)
            except ValueError:
                continue

            expiry = row.get("SEM_EXPIRY_DATE", "")[:10]  # YYYY-MM-DD
            if not expiry:
                continue

            exchange_raw = row.get("SEM_EXM_EXCH_ID", "").upper()
            exchange_segment = "NSE_FNO" if exchange_raw == "NSE" else "BSE_FNO"

            try:
                lot_size = int(float(row.get("SEM_LOT_UNITS", 1)))
            except (ValueError, TypeError):
                lot_size = 1

            entry: ScripMatch = {
                "security_id": row["SEM_SMST_SECURITY_ID"],
                "trading_symbol": trading_sym,
                "exchange": exchange_raw,
                "exchange_segment": exchange_segment,
                "expiry_date": expiry,
                "lot_size": lot_size,
                "strike_price": strike,
                "option_type": opt_type,
            }

            key = (symbol, strike, opt_type, expiry)
            _INDEX.setdefault(key, []).append(entry)
            count += 1

    logger.info("Scrip master loaded: %d option contracts indexed from %s", count, csv_path)
    _LOADED = True


def search(
    *,
    symbol: str,
    strike: float,
    option_type: str,
    expiry_date: str,
    exchange: str | None = None,
) -> list[ScripMatch]:
    """
    Look up matching Dhan instruments by exact key.

    Returns up to 2 matches (NSE + BSE) unless exchange is specified.
    Returns [] if the CSV was not found or no instrument matches.
    """
    _load()

    key = (
        symbol.upper().strip(),
        round(float(strike), 2),
        option_type.upper().strip(),
        expiry_date.strip()[:10],
    )
    matches = list(_INDEX.get(key, []))

    if exchange:
        exc_filter = "BSE" if exchange.upper() in ("BSE", "BSE_FNO") else "NSE"
        matches = [m for m in matches if m["exchange"] == exc_filter]

    return matches
