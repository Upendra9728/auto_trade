"""
Market data proxy — returns live index quotes (Sensex, Nifty 50, Bank Nifty)
by calling the Dhan OHLC market feed API with an available user credential.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..crypto import decrypt_token
from ..deps import get_current_user, get_db
from ..models import DhanCredential, User

router = APIRouter(prefix="/api/market", tags=["market"])
logger = logging.getLogger(__name__)

DHAN_OHLC_URL = "https://api.dhan.co/v2/marketfeed/ohlc"

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
