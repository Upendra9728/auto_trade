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
# Secondary index without expiry: (SYMBOL, strike_float, OPTION_TYPE) → list[ScripMatch]
# Used to auto-fetch the nearest upcoming expiry when none is supplied.
_BY_CONTRACT: dict[tuple[str, float, str], list["ScripMatch"]] = {}
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
            _BY_CONTRACT.setdefault((symbol, strike, opt_type), []).append(entry)
            count += 1

    logger.info("Scrip master loaded: %d option contracts indexed from %s", count, csv_path)
    _LOADED = True


def reload() -> None:
    """Clear the in-memory index and rebuild it from the CSV on disk."""
    global _LOADED, _INDEX, _BY_CONTRACT
    _INDEX = {}
    _BY_CONTRACT = {}
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
    Background loop that re-downloads and reloads the scrip master once per day
    at 07:30 IST (before market open at 09:15 IST), regardless of when the
    server last restarted.  This ensures new weekly/monthly contracts added by
    Dhan on Thursday nights are available before Friday's session.
    """
    _IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
    _REFRESH_HOUR = 7
    _REFRESH_MINUTE = 30

    while True:
        now = dt.datetime.now(_IST)
        target = now.replace(hour=_REFRESH_HOUR, minute=_REFRESH_MINUTE, second=0, microsecond=0)
        if now >= target:
            target += dt.timedelta(days=1)
        sleep_seconds = (target - now).total_seconds()
        logger.info(
            "Scrip master next refresh scheduled at %s IST (in %.1f h)",
            target.strftime("%Y-%m-%d %H:%M"),
            sleep_seconds / 3600,
        )
        await asyncio.sleep(sleep_seconds)
        logger.info("Scrip master daily refresh: downloading...")
        if await download_scrip_master():
            reload()


def list_symbols() -> list[str]:
    """Return all distinct index/underlying symbols available for quick-select, sorted alphabetically."""
    _load()
    return sorted({key[0] for key in _BY_CONTRACT})


def list_expiries(symbol: str) -> list[str]:
    """Return upcoming expiry dates (YYYY-MM-DD, sorted) available for a symbol."""
    _load()
    symbol = symbol.upper().strip()
    today = dt.date.today().isoformat()
    expiries = {
        key[3] for key in _INDEX if key[0] == symbol and key[3] >= today
    }
    return sorted(expiries)


def list_strikes(symbol: str, expiry: str) -> list[dict]:
    """
    Return distinct strikes for a symbol+expiry, each with which option types (CE/PE) exist.
    Sorted ascending by strike price.
    """
    _load()
    symbol = symbol.upper().strip()
    expiry = expiry.strip()[:10]
    strikes: dict[float, set[str]] = {}
    for key in _INDEX:
        if key[0] == symbol and key[3] == expiry:
            strikes.setdefault(key[1], set()).add(key[2])
    return [
        {"strike": strike, "option_types": sorted(types)}
        for strike, types in sorted(strikes.items())
    ]


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


def search_nearest_expiry(
    *,
    symbol: str,
    strike: float,
    option_type: str,
    exchange: str | None = None,
) -> list[ScripMatch]:
    """
    Same as search(), but auto-picks the nearest upcoming expiry instead of
    requiring the caller to supply one.

    Returns matches for the closest expiry_date >= today, or [] if none found.
    """
    _load()

    key = (symbol.upper().strip(), round(float(strike), 2), option_type.upper().strip())
    candidates = list(_BY_CONTRACT.get(key, []))

    if exchange:
        exc_filter = "BSE" if exchange.upper() in ("BSE", "BSE_FNO") else "NSE"
        candidates = [m for m in candidates if m["exchange"] == exc_filter]

    today = dt.date.today().isoformat()
    upcoming = sorted((m for m in candidates if m["expiry_date"] >= today), key=lambda m: m["expiry_date"])
    if not upcoming:
        return []

    nearest_date = upcoming[0]["expiry_date"]
    return [m for m in upcoming if m["expiry_date"] == nearest_date]
