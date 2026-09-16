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
import re

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from .config import settings
from .crypto import decrypt_token, encrypt_token
from .dhan_client import DhanApiError, DhanClient
from .db import SessionLocal
from .models import DhanCredential

logger = logging.getLogger(__name__)

# Dhan expiryTime strings are in IST (UTC+5:30)
_IST_OFFSET = dt.timedelta(hours=5, minutes=30)
_client_locks: dict[str, asyncio.Lock] = {}
_refresh_failure_cooldown: dict[str, dt.datetime] = {}


def sanitize_totp_secret(secret: str) -> str:
    """Normalize a Dhan TOTP secret copied from Dhan Web or an otpauth URI."""
    if not secret:
        return ""
    value = secret.strip()
    if value.startswith("otpauth://"):
        try:
            parsed = value.split("?", 1)[1]
            for part in parsed.split("&"):
                if part.startswith("secret="):
                    value = part.split("=", 1)[1]
                    break
        except Exception:
            value = ""
    value = re.sub(r"[^A-Za-z2-7]", "", value).upper()
    return value


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
    Generate a fresh Dhan token via TOTP for *cred* and persist it.
    Returns True on success, False on any failure.
    """
    if not cred.pin_encrypted or not cred.totp_secret_encrypted:
        logger.error(
            "Cannot refresh token for client %s: no TOTP credentials stored",
            cred.dhan_client_id,
        )
        return False
    try:
        pin = decrypt_token(cred.pin_encrypted)
        totp_secret = sanitize_totp_secret(decrypt_token(cred.totp_secret_encrypted))
        result = await DhanClient.generate_access_token(
            dhan_client_id=cred.dhan_client_id,
            pin=pin,
            totp_secret=totp_secret,
            source_ipv6=getattr(cred.user, "assigned_ipv6", None),
        )
        return _apply_token_result(cred, db, result)
    except DhanApiError as exc:
        logger.error("generateAccessToken failed for client %s: %s", cred.dhan_client_id, exc)
        return False
    except Exception as exc:
        logger.exception("Unexpected error refreshing token for client %s: %s", cred.dhan_client_id, exc)
        return False


async def renew_and_save_credential_with_reason(cred: DhanCredential, db: Session) -> dict:
    """
    Like `renew_and_save_credential` but returns a dict with detailed result
    information suitable for admin tooling.
    Returns: {"success": bool, "reason": str|None, "refreshed_at": str|None}
    """
    source_ipv6 = None
    try:
        source_ipv6 = getattr(cred.user, "assigned_ipv6", None)
    except Exception:
        source_ipv6 = None

    if not cred.pin_encrypted or not cred.totp_secret_encrypted:
        reason = "No TOTP credentials stored — user must re-save credentials with PIN and TOTP secret"
        logger.error("Cannot refresh token for client %s: %s", cred.dhan_client_id, reason)
        return {"success": False, "reason": reason, "refreshed_at": None, "source_ipv6": source_ipv6}

    try:
        pin = decrypt_token(cred.pin_encrypted)
        totp_secret = sanitize_totp_secret(decrypt_token(cred.totp_secret_encrypted))
        result = await DhanClient.generate_access_token(
            dhan_client_id=cred.dhan_client_id,
            pin=pin,
            totp_secret=totp_secret,
            source_ipv6=getattr(cred.user, "assigned_ipv6", None),
        )
        ok = _apply_token_result(cred, db, result)
        if ok:
            return {"success": True, "reason": None, "refreshed_at": cred.updated_at.isoformat(), "source_ipv6": source_ipv6}
        return {"success": False, "reason": "no accessToken in response", "refreshed_at": None, "source_ipv6": source_ipv6}
    except DhanApiError as exc:
        reason = str(exc)
        logger.error("generateAccessToken failed for client %s: %s", cred.dhan_client_id, reason)
        return {"success": False, "reason": reason, "refreshed_at": None, "source_ipv6": source_ipv6}
    except Exception as exc:
        logger.exception("Unexpected error refreshing token for client %s: %s", cred.dhan_client_id, exc)
        return {"success": False, "reason": str(exc), "refreshed_at": None, "source_ipv6": source_ipv6}


def _apply_token_result(cred: DhanCredential, db: Session, result: dict) -> bool:
    """Persist a new token from a generateAccessToken response. Returns True on success."""
    new_token: str | None = result.get("accessToken") or result.get("access_token")
    if not new_token:
        logger.error("generateAccessToken for client %s: no accessToken in response: %s", cred.dhan_client_id, result)
        return False
    expiry_str: str | None = result.get("expiryTime") or result.get("expiry_time")
    cred.access_token_encrypted = encrypt_token(new_token)
    cred.token_expires_at = (
        parse_dhan_expiry(expiry_str) if expiry_str
        else dt.datetime.utcnow() + dt.timedelta(hours=24)
    )
    cred.updated_at = dt.datetime.utcnow()
    db.commit()
    logger.info("generateAccessToken: new token for client %s; expiry (UTC): %s", cred.dhan_client_id, cred.token_expires_at)
    return True


async def token_refresh_loop() -> None:
    """
    Infinite asyncio loop. Wakes up on TOKEN_REFRESH_INTERVAL_SECONDS and renews
    credentials expiring within TOKEN_RENEW_THRESHOLD_HOURS. Designed to run as
    a background task via asyncio.create_task.
    """
    interval = settings.token_refresh_interval_seconds
    threshold = dt.timedelta(hours=settings.token_renew_threshold_hours)
    logger.info(
        "Token refresh loop started (interval=%ds, renew_threshold=%s)",
        interval,
        threshold,
    )

    while True:
        now = dt.datetime.utcnow()
        expiry_threshold = now + threshold
        age_cutoff = now - dt.timedelta(hours=22)

        db: Session = SessionLocal()
        try:
            expiring = (
                db.query(DhanCredential)
                .filter(
                    DhanCredential.is_active.is_(True),
                    or_(
                        and_(
                            DhanCredential.token_expires_at.isnot(None),
                            DhanCredential.token_expires_at <= expiry_threshold,
                        ),
                        and_(
                            DhanCredential.token_expires_at.is_(None),
                            DhanCredential.updated_at <= age_cutoff,
                        ),
                    ),
                )
                .all()
            )

            eligible = []
            for cred in expiring:
                key = cred.dhan_client_id
                cooldown_until = _refresh_failure_cooldown.get(key)
                if cooldown_until and cooldown_until > now:
                    logger.info("Skipping Dhan token refresh for %s until %s due to cooldown", key, cooldown_until.isoformat())
                    continue
                eligible.append(cred)

            if eligible:
                logger.info("Token refresh: renewing %d credential(s)", len(eligible))
                for cred in eligible:
                    if cred.dhan_client_id not in _client_locks:
                        _client_locks[cred.dhan_client_id] = asyncio.Lock()
                    async with _client_locks[cred.dhan_client_id]:
                        ok = await renew_and_save_credential(cred, db)
                        if not ok:
                            _refresh_failure_cooldown[cred.dhan_client_id] = now + dt.timedelta(minutes=15)
            else:
                logger.debug("Token refresh: no credentials need renewal")
        except Exception as exc:
            logger.exception("Token refresh loop iteration error: %s", exc)
        finally:
            db.close()
        await asyncio.sleep(interval)
