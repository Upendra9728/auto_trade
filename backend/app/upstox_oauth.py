from __future__ import annotations

import base64
import hashlib
import hmac
import time

import httpx
from fastapi import HTTPException

from .config import settings
from .crypto import decrypt_token, encrypt_token
from .db import SessionLocal
from .models import ClientToken, User, UserUpstoxApp


def _make_state(user_email: str) -> str:
    ts = str(int(time.time()))
    payload = f"{user_email}|{ts}"
    sig = hmac.new(settings.internal_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    state_raw = f"{payload}|{sig}"
    return base64.urlsafe_b64encode(state_raw.encode()).decode()


def _parse_state(state_b64: str) -> str:
    try:
        raw = base64.urlsafe_b64decode(state_b64.encode()).decode()
        email, ts, sig = raw.split("|")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state")

    expected = hmac.new(settings.internal_secret.encode("utf-8"), f"{email}|{ts}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=400, detail="Invalid state signature")

    if abs(int(time.time()) - int(ts)) > 600:
        raise HTTPException(status_code=400, detail="State expired")

    return email


def build_authorize_url(user_email: str, client_id: str | None = None) -> str:
    if not settings.upstox_redirect_uri:
        raise HTTPException(
            status_code=500,
            detail="Upstox OAuth not configured: set UPSTOX_REDIRECT_URI in backend/.env",
        )

    effective_client_id = client_id or settings.upstox_client_id
    if not effective_client_id:
        raise HTTPException(
            status_code=500,
            detail="Upstox OAuth not configured: set UPSTOX_CLIENT_ID or save user app creds",
        )

    state = _make_state(user_email)
    base = settings.upstox_oauth_base_url.rstrip("/")
    # Upstox API v2 authorization endpoint
    auth_path = "/login/authorization/dialog"

    url = (
        f"{base}{auth_path}?client_id={effective_client_id}"
        f"&redirect_uri={settings.upstox_redirect_uri}&response_type=code&state={state}"
    )
    return url


async def exchange_code_and_store(code: str, state: str) -> str:
    email = _parse_state(state)

    if not settings.upstox_redirect_uri:
        raise HTTPException(
            status_code=500,
            detail="Upstox OAuth not configured: set UPSTOX_REDIRECT_URI in backend/.env",
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")

        app = db.query(UserUpstoxApp).filter(UserUpstoxApp.user_id == user.id).one_or_none()
        if app is not None:
            client_id = app.client_id
            client_secret = decrypt_token(app.client_secret_encrypted)
        else:
            client_id = settings.upstox_client_id
            client_secret = settings.upstox_client_secret

        if not client_id or not client_secret:
            raise HTTPException(
                status_code=500,
                detail="Upstox OAuth not configured: set UPSTOX_CLIENT_ID/UPSTOX_CLIENT_SECRET or save user app creds",
            )

        token_url = settings.upstox_oauth_base_url.rstrip("/") + "/login/authorization/token"

        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.upstox_redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(token_url, data=data, timeout=15)

        if resp.status_code != 200:
            # Surface the response body for easier debugging
            raise HTTPException(status_code=400, detail=f"Token exchange failed: {resp.status_code} {resp.text}")

        j = resp.json()
        # Upstox responses may vary; try common fields
        access_token = j.get("access_token") or j.get("accessToken") or (j.get("data") or {}).get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail=f"No access token in response: {j}")

        existing = db.query(ClientToken).filter(ClientToken.client_id == email).one_or_none()
        encrypted = encrypt_token(access_token)
        if existing is None:
            token = ClientToken(client_id=email, consent=True, access_token_encrypted=encrypted)
            db.add(token)
        else:
            existing.access_token_encrypted = encrypted
            existing.consent = True
        db.commit()
    finally:
        db.close()

    return access_token
