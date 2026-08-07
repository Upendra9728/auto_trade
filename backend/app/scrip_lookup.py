from __future__ import annotations

import asyncio
import csv
import datetime as dt
import logging
import os
from pathlib import Path
from typing import TypedDict

import httpx

SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master.csv"

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


def _csv_path() -> Path:
    env = os.environ.get("SCRIP_MASTER_PATH")
    return Path(env) if env else Path(__file__).parent.parent / "api-scrip-master.csv"


def _load() -> None:
    global _LOADED
    if _LOADED:
        return

    csv_path = _csv_path()

    if not csv_path.exists():
        logger.warning(
            "api-scrip-master.csv not found at %s — scrip auto-lookup disabled. "
            "It will be downloaded automatically on next startup if internet is available.",
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


def reload() -> None:
    """Clear the in-memory index and rebuild it from the CSV on disk."""
    global _LOADED, _INDEX
    _INDEX = {}
    _LOADED = False
    _load()


async def download_scrip_master() -> bool:
    """
    Download the latest scrip master CSV from Dhan into the configured path.
    Uses an atomic write (download → temp file → rename) so the old file
    remains readable while the download is in progress.
    Returns True on success, False on any failure.
    """
    path = _csv_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            resp = await client.get(SCRIP_MASTER_URL)
            resp.raise_for_status()
            tmp.write_bytes(resp.content)
        tmp.replace(path)
        logger.info(
            "Scrip master downloaded: %.1f MB → %s",
            len(resp.content) / 1_048_576,
            path,
        )
        return True
    except Exception as exc:
        logger.error("Failed to download scrip master: %s", exc)
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        return False


async def ensure_scrip_master_fresh() -> None:
    """
    Called at startup.  Downloads the scrip master if:
    - the file does not exist, OR
    - the file is older than 23 hours (stale contracts).
    After a successful download the in-memory index is rebuilt.
    """
    path = _csv_path()
    needs_download = not path.exists()
    if not needs_download:
        age = dt.datetime.utcnow() - dt.datetime.utcfromtimestamp(path.stat().st_mtime)
        needs_download = age > dt.timedelta(hours=23)
        if needs_download:
            logger.info("Scrip master is %.1f hours old — refreshing", age.total_seconds() / 3600)

    if needs_download:
        ok = await download_scrip_master()
        if ok:
            reload()
    else:
        logger.info("Scrip master is fresh (last modified: %s UTC)",
                    dt.datetime.utcfromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M"))


async def scrip_master_refresh_loop() -> None:
    """
    Background loop that re-downloads and reloads the scrip master once every
    24 hours so new weekly/monthly contracts are always available.
    """
    logger.info("Scrip master refresh loop started (interval=24 h)")
    while True:
        await asyncio.sleep(86_400)   # 24 hours
        logger.info("Scrip master daily refresh: downloading...")
        if await download_scrip_master():
            reload()


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
