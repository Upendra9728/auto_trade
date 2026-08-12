"""
token_refresh.py — Background loop that automatically renews Dhan access tokens
before they expire so users never need to paste a fresh token every 24 hours.

How it works
------------
1. A background asyncio task starts with the FastAPI app (see main.py).
2. Every hour it queries for credentials whose token_expires_at is within 2 hours
   OR whose updated_at is more than 22 hours old (covers tokens saved without an
   explicit expiry, e.g. pasted manually from Dhan Web).
3. For each such credential it calls Dhan's RenewToken API, stores the new
   encrypted token and updated expiry, and commits.

renew_and_save_credential() is also called from order_service.py as a just-in-time
renewal guard right before an order is placed.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from .crypto import decrypt_token, encrypt_token
from .dhan_client import DhanApiError, DhanClient
from .db import SessionLocal
from .models import DhanCredential

logger = logging.getLogger(__name__)

# Renew tokens expiring within this window
_RENEW_THRESHOLD = dt.timedelta(hours=2)
# Background loop polling interval
_CHECK_INTERVAL_SECONDS = 3600
# Dhan expiryTime strings are in IST (UTC+5:30)
_IST_OFFSET = dt.timedelta(hours=5, minutes=30)


def parse_dhan_expiry(expiry_str: str) -> dt.datetime:
    """
    Convert Dhan's expiryTime string (IST, no tz designator) to a UTC naive datetime.
    Examples: '2026-01-01T00:00:00.000', '2025-09-23T12:37:23'
    """
    try:
        clean = expiry_str.replace("T", " ").split(".")[0]
        ist_naive = dt.datetime.strptime(clean, "%Y-%m-%d %H:%M:%S")
        return ist_naive - _IST_OFFSET
    except (ValueError, AttributeError):
        # Fallback: treat as valid for another 24 h
        return dt.datetime.utcnow() + dt.timedelta(hours=24)


def parse_dhan_token_validity(validity_str: str) -> dt.datetime | None:
    """
    Convert Dhan's GET /v2/profile `tokenValidity` string (IST, 'DD/MM/YYYY HH:MM')
    to a UTC naive datetime. Returns None if the format is unrecognized (caller
    should leave token_expires_at unset rather than guess in that case).
    """
    try:
        ist_naive = dt.datetime.strptime(validity_str.strip(), "%d/%m/%Y %H:%M")
        return ist_naive - _IST_OFFSET
    except (ValueError, AttributeError):
        return None


async def renew_and_save_credential(cred: DhanCredential, db: Session) -> bool:
    """
    Call Dhan RenewToken for *cred*, encrypt and persist the new token and expiry.

    Returns True on success, False on any failure (caller can still attempt the
    order with the existing token — it may still be valid).
    """
    try:
        current_token = decrypt_token(cred.access_token_encrypted)
        # Bind RenewToken call to the user's assigned IPv6 (if present) so Dhan
        # sees the request coming from the registered IP — same as order calls.
        source_ipv6 = None
        try:
            source_ipv6 = getattr(cred.user, "assigned_ipv6", None)
        except Exception:
            source_ipv6 = None

        result = await DhanClient.renew_token(
            dhan_client_id=cred.dhan_client_id,
            access_token=current_token,
            source_ipv6=source_ipv6,
        )
        new_token: str | None = result.get("accessToken") or result.get("access_token")
        if not new_token:
            logger.error(
                "RenewToken for client %s: no accessToken in response: %s",
                cred.dhan_client_id,
                result,
            )
            return False
        expiry_str: str | None = result.get("expiryTime") or result.get("expiry_time")
        cred.access_token_encrypted = encrypt_token(new_token)
        cred.token_expires_at = (
            parse_dhan_expiry(expiry_str) if expiry_str
            else dt.datetime.utcnow() + dt.timedelta(hours=24)
        )
        cred.updated_at = dt.datetime.utcnow()
        db.commit()
        logger.info(
            "Renewed Dhan token for client %s; new expiry (UTC): %s",
            cred.dhan_client_id,
            cred.token_expires_at,
        )
        return True
    except DhanApiError as exc:
        logger.error(
            "RenewToken API error for client %s (ipv6=%s): %s",
            cred.dhan_client_id,
            source_ipv6,
            exc,
        )
        return False
    except Exception as exc:
        logger.exception(
            "Unexpected error renewing token for client %s: %s", cred.dhan_client_id, exc
        )
        return False


async def renew_and_save_credential_with_reason(cred: DhanCredential, db: Session) -> dict:
    """
    Like `renew_and_save_credential` but returns a dict with detailed result
    information suitable for admin tooling. Returns:
      {"success": bool, "reason": str|None, "refreshed_at": str|None}
    """
    try:
        current_token = decrypt_token(cred.access_token_encrypted)
        source_ipv6 = None
        try:
            source_ipv6 = getattr(cred.user, "assigned_ipv6", None)
        except Exception:
            source_ipv6 = None

        result = await DhanClient.renew_token(
            dhan_client_id=cred.dhan_client_id,
            access_token=current_token,
            source_ipv6=source_ipv6,
        )
        new_token: str | None = result.get("accessToken") or result.get("access_token")
        if not new_token:
            reason = f"no accessToken in response: {result}"
            logger.error("RenewToken for client %s: %s", cred.dhan_client_id, reason)
            return {"success": False, "reason": f"{reason}; ipv6: {source_ipv6}", "refreshed_at": None, "source_ipv6": source_ipv6}

        expiry_str: str | None = result.get("expiryTime") or result.get("expiry_time")
        cred.access_token_encrypted = encrypt_token(new_token)
        cred.token_expires_at = (
            parse_dhan_expiry(expiry_str) if expiry_str
            else dt.datetime.utcnow() + dt.timedelta(hours=24)
        )
        cred.updated_at = dt.datetime.utcnow()
        db.commit()
        refreshed_at = cred.updated_at.isoformat()
        logger.info(
            "Renewed Dhan token for client %s; new expiry (UTC): %s",
            cred.dhan_client_id,
            cred.token_expires_at,
        )
        return {"success": True, "reason": None, "refreshed_at": refreshed_at}
    except DhanApiError as exc:
        reason = f"DhanApiError: {exc}"
        logger.error(
            "RenewToken API error for client %s (ipv6=%s): %s",
            cred.dhan_client_id,
            source_ipv6,
            exc,
        )
        # Append the attempted ipv6 for easier debugging in admin responses
        return {"success": False, "reason": f"{reason}; ipv6: {source_ipv6}", "refreshed_at": None, "source_ipv6": source_ipv6}
    except Exception as exc:
        reason = str(exc)
        logger.exception(
            "Unexpected error renewing token for client %s: %s", cred.dhan_client_id, exc
        )
        return {"success": False, "reason": f"{reason}; ipv6: {source_ipv6}", "refreshed_at": None, "source_ipv6": source_ipv6}


async def token_refresh_loop() -> None:
    """
    Infinite asyncio loop.  Wakes up every hour and renews credentials that are
    approaching expiry.  Designed to run as a background task via asyncio.create_task.
    """
    logger.info(
        "Token refresh loop started (interval=%ds, renew_threshold=%s)",
        _CHECK_INTERVAL_SECONDS,
        _RENEW_THRESHOLD,
    )
    while True:
        await asyncio.sleep(_CHECK_INTERVAL_SECONDS)
        now = dt.datetime.utcnow()
        threshold = now + _RENEW_THRESHOLD
        # Tokens where updated_at is this old are almost certainly expired
        age_cutoff = now - dt.timedelta(hours=22)

        db: Session = SessionLocal()
        try:
            expiring = (
                db.query(DhanCredential)
                .filter(
                    DhanCredential.is_active.is_(True),
                    or_(
                        # Known expiry: renew if expiring within threshold
                        and_(
                            DhanCredential.token_expires_at.isnot(None),
                            DhanCredential.token_expires_at <= threshold,
                        ),
                        # Unknown expiry (user pasted token manually): renew if
                        # credential hasn't been updated in >=22 h
                        and_(
                            DhanCredential.token_expires_at.is_(None),
                            DhanCredential.updated_at <= age_cutoff,
                        ),
                    ),
                )
                .all()
            )
            if expiring:
                logger.info("Token refresh: renewing %d credential(s)", len(expiring))
                for cred in expiring:
                    await renew_and_save_credential(cred, db)
            else:
                logger.debug("Token refresh: no credentials need renewal")
        except Exception as exc:
            logger.exception("Token refresh loop iteration error: %s", exc)
        finally:
            db.close()
