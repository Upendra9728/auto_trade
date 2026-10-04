"""
Market data proxy — returns live index quotes (Sensex, Nifty 50, Bank Nifty)
by calling the Dhan OHLC market feed API with an available user credential.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crypto import decrypt_token
from ..deps import get_current_user, get_db
from ..models import DhanCredential, User

router = APIRouter(prefix="/api/market", tags=["market"])
logger = logging.getLogger(__name__)

DHAN_OHLC_URL = "https://api.dhan.co/v2/marketfeed/ohlc"
DHAN_LTP_URL = "https://api.dhan.co/v2/marketfeed/ltp"

_ltp_cache: dict[str, tuple[float, float]] = {}  # key -> (last_price, timestamp)
_CACHE_TTL_SECONDS = 2.0

SEGMENT_LTP_MAP = {
    "NSE_FO": "NSE_FNO",
    "BSE_FO": "BSE_FNO",
    "NSE_FNO": "NSE_FNO",
    "BSE_FNO": "BSE_FNO",
    "NSE_EQ": "NSE_EQ",
    "BSE_EQ": "BSE_EQ",
    "MCX_COMM": "MCX_COMM",
    "NSE_CURRENCY": "NSE_CURRENCY",
    "BSE_CURRENCY": "BSE_CURRENCY",
    "IDX_I": "IDX_I",
}


class LtpInstrument(BaseModel):
    segment: str
    security_id: str


class LtpRequest(BaseModel):
    instruments: list[LtpInstrument]


class LtpResponse(BaseModel):
    prices: dict[str, float]

# Security IDs for Indian indices on Dhan
# NSE_EQ: Nifty 50 = 13, Bank Nifty = 25 (these are NSE index IDs)
# BSE_EQ: Sensex = 1 (BSE index ID)
# NOTE: Dhan uses NSE_INDEX segment for Nifty indices
INDEX_REQUEST_BODY = {
    "BSE_EQ": [1],       # Sensex (BSE Sensex)
    "NSE_EQ": [13, 25],  # Nifty 50, Bank Nifty
}

# Map security_id -> friendly index name
INDEX_NAMES = {
    "BSE_EQ": {
        "1": "SENSEX",
    },
    "NSE_EQ": {
        "13": "NIFTY 50",
        "25": "BANK NIFTY",
    },
}


def _parse_indices(raw: dict[str, Any]) -> dict:
    """Parse the Dhan OHLC response into a clean dict."""
    data = raw.get("data", {})
    result: dict[str, Any] = {}

    for segment, instruments in data.items():
        seg_names = INDEX_NAMES.get(segment, {})
        for sec_id_str, vals in instruments.items():
            name_key = seg_names.get(sec_id_str)
            if not name_key:
                continue
            ltp = vals.get("last_price", 0)
            ohlc = vals.get("ohlc", {})
            prev_close = ohlc.get("close", 0)
            change = round(ltp - prev_close, 2) if prev_close else 0
            change_pct = round((change / prev_close) * 100, 2) if prev_close else 0

            key = name_key.lower().replace(" ", "_")
            result[key] = {
                "name": name_key,
                "price": ltp,
                "change": change,
                "change_pct": change_pct,
                "open": ohlc.get("open", 0),
                "high": ohlc.get("high", 0),
                "low": ohlc.get("low", 0),
                "prev_close": prev_close,
            }

    return result


@router.get("/indices")
async def get_market_indices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """
    Return live OHLC snapshot for Sensex, Nifty 50, and Bank Nifty.

    Uses the calling user's Dhan credential. If the user has no credential,
    falls back to any other active credential in the system.
    """
    # Prefer the current user's credential; fall back to any active credential
    cred: DhanCredential | None = (
        db.query(DhanCredential)
        .filter(
            DhanCredential.user_id == current_user.id,
            DhanCredential.is_active == True,
        )
        .first()
    )

    if cred is None:
        # Fallback: any active credential
        cred = (
            db.query(DhanCredential)
            .filter(DhanCredential.is_active == True)
            .first()
        )

    if cred is None:
        raise HTTPException(
            status_code=503,
            detail="No active Dhan credential available for market data.",
        )

    try:
        access_token = decrypt_token(cred.access_token_encrypted)
    except Exception:
        raise HTTPException(status_code=503, detail="Failed to decrypt Dhan token.")

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "access-token": access_token,
        "client-id": cred.dhan_client_id,
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(DHAN_OHLC_URL, json=INDEX_REQUEST_BODY, headers=headers)

        if resp.status_code != 200:
            logger.warning("Dhan OHLC returned %s: %s", resp.status_code, resp.text[:200])
            raise HTTPException(status_code=502, detail=f"Dhan API error: {resp.status_code}")

        raw = resp.json()
        if raw.get("status") != "success":
            raise HTTPException(status_code=502, detail="Dhan API returned non-success status.")

        return _parse_indices(raw)

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Dhan market data request timed out.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected error fetching market indices: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to fetch market indices.")


@router.post("/ltp", response_model=LtpResponse)
async def get_market_ltp(
    req: LtpRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LtpResponse:
    now = time.time()
    prices: dict[str, float] = {}
    missing_instruments: list[tuple[str, str, int]] = []

    for inst in req.instruments:
        key = f"{inst.segment}:{inst.security_id}"
        if key in _ltp_cache:
            val, ts = _ltp_cache[key]
            if (now - ts) <= _CACHE_TTL_SECONDS:
                prices[key] = val
                continue
        mapped_seg = SEGMENT_LTP_MAP.get(inst.segment.upper(), inst.segment.upper())
        try:
            sec_id_int = int(inst.security_id)
            missing_instruments.append((inst.segment, mapped_seg, sec_id_int))
        except ValueError:
            pass

    if not missing_instruments:
        return LtpResponse(prices=prices)

    dhan_payload: dict[str, list[int]] = {}
    for _, mapped_seg, sec_id_int in missing_instruments:
        dhan_payload.setdefault(mapped_seg, []).append(sec_id_int)

    for seg in dhan_payload:
        dhan_payload[seg] = list(set(dhan_payload[seg]))

    candidates: list[DhanCredential] = (
        db.query(DhanCredential)
        .filter(DhanCredential.is_active == True)
        .order_by((DhanCredential.user_id == current_user.id).desc())
        .limit(5)
        .all()
    )

    if not candidates:
        return LtpResponse(prices=prices)

    for cred in candidates:
        try:
            token = decrypt_token(cred.access_token_encrypted)
        except Exception:
            continue

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "access-token": token,
            "client-id": cred.dhan_client_id,
        }

        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.post(DHAN_LTP_URL, json=dhan_payload, headers=headers)
            if resp.status_code == 200:
                raw = resp.json()
                if raw.get("status") == "success":
                    data = raw.get("data", {})
                    for orig_seg, mapped_seg, sec_id_int in missing_instruments:
                        sec_str = str(sec_id_int)
                        ltp_val = data.get(mapped_seg, {}).get(sec_str, {}).get("last_price")
                        if ltp_val is not None:
                            p_float = float(ltp_val)
                            key = f"{orig_seg}:{sec_str}"
                            prices[key] = p_float
                            _ltp_cache[key] = (p_float, now)
                    break
        except Exception as exc:
            logger.warning("Error fetching Dhan LTP with client %s: %s", cred.dhan_client_id, exc)

    for inst in req.instruments:
        key = f"{inst.segment}:{inst.security_id}"
        if key not in prices and key in _ltp_cache:
            prices[key] = _ltp_cache[key][0]

    return LtpResponse(prices=prices)
