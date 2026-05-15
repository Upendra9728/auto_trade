from __future__ import annotations

import re
import json
from collections.abc import Generator
import uuid
import datetime as dt
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .auth import (
    generate_otp,
    generate_session_token,
    hash_otp,
    hash_password,
    hash_session_token,
    verify_password,
)
from .config import settings
from .crypto import encrypt_token
from .db import SessionLocal, init_db
from .mailer import send_password_reset_email
from .models import ClientToken, OrderBatch, PasswordResetOtp, User, UserSession, UserUpstoxApp
from .order_service import place_gtt_for_all_clients
from .schemas import (
    BatchPlaceResponse,
    GttPlaceRequest,
    OrderBatchResponse,
    OrderResultResponse,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    TelegramIngestRequest,
    TokenAdminUpdateRequest,
    TokenResponse,
    TokenUpsertRequest,
    UserAuthResponse,
    UserLoginRequest,
    UserProfileResponse,
    UserRegistrationRequest,
    UserTokenStatusResponse,
    UserTokenUpsertRequest,
    UserUpstoxAppStatusResponse,
    UserUpstoxAppUpsertRequest,
)
from .telegram_parser import parse_telegram_message_to_gtt
from .upstox_oauth import build_authorize_url, exchange_code_and_store

app = FastAPI(title="Automate Trading (Upstox GTT)")

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"] ,
    allow_headers=["*"],
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_admin(
    x_admin_secret: str | None = Header(default=None, alias="X-Admin-Secret"),
) -> None:
    if x_admin_secret != settings.admin_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _utcnow() -> dt.datetime:
    return dt.datetime.utcnow()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_email(email: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email))


def _validate_phone(phone_number: str) -> bool:
    return bool(re.fullmatch(r"[+0-9][0-9\- ]{5,31}", phone_number.strip()))


def _to_profile(user: User) -> UserProfileResponse:
    return UserProfileResponse(name=user.name, email=user.email, phone_number=user.phone_number)


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    raw_token = authorization.split(" ", 1)[1].strip()
    if not raw_token:
        raise HTTPException(status_code=401, detail="Invalid access token")

    token_hash = hash_session_token(raw_token)
    session = (
        db.query(UserSession)
        .filter(UserSession.token_hash == token_hash, UserSession.expires_at > _utcnow())
        .one_or_none()
    )
    if session is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    user = db.query(User).filter(User.id == session.user_id, User.is_active.is_(True)).one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="User is inactive")
    return user


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/register", response_model=UserProfileResponse)
def register_user(req: UserRegistrationRequest, db: Session = Depends(get_db)) -> UserProfileResponse:
    email = _normalize_email(req.email)
    if not _validate_email(email):
        raise HTTPException(status_code=400, detail="Invalid email format")

    if not _validate_phone(req.phone_number):
        raise HTTPException(status_code=400, detail="Invalid phone number format")

    existing = db.query(User).filter(User.email == email).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        name=req.name.strip(),
        email=email,
        phone_number=req.phone_number.strip(),
        password_hash=hash_password(req.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_profile(user)


@app.post("/api/auth/login", response_model=UserAuthResponse)
def login_user(req: UserLoginRequest, db: Session = Depends(get_db)) -> UserAuthResponse:
    email = _normalize_email(req.email)
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).one_or_none()
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    expires_at = _utcnow() + dt.timedelta(hours=settings.auth_session_hours)
    raw_token = generate_session_token()
    session = UserSession(user_id=user.id, token_hash=hash_session_token(raw_token), expires_at=expires_at)
    db.add(session)

    # Keep table small by deleting expired sessions on every login.
    db.query(UserSession).filter(UserSession.expires_at <= _utcnow()).delete(synchronize_session=False)

    db.commit()
    return UserAuthResponse(
        access_token=raw_token,
        token_type="bearer",
        expires_at=expires_at.isoformat(),
        user=_to_profile(user),
    )


@app.get("/api/auth/me", response_model=UserProfileResponse)
def auth_me(user: User = Depends(get_current_user)) -> UserProfileResponse:
    return _to_profile(user)


@app.post("/api/auth/logout")
def logout_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    raw_token = authorization.split(" ", 1)[1].strip()
    if not raw_token:
        raise HTTPException(status_code=401, detail="Invalid access token")

    db.query(UserSession).filter(UserSession.token_hash == hash_session_token(raw_token)).delete(synchronize_session=False)
    db.commit()
    return {"status": "logged_out"}


@app.post("/api/auth/request-password-reset")
def request_password_reset(req: PasswordResetRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    email = _normalize_email(req.email)
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).one_or_none()

    if user is None:
        return {"status": "otp_sent"}

    now = _utcnow()
    db.query(PasswordResetOtp).filter(
        PasswordResetOtp.user_id == user.id,
        PasswordResetOtp.consumed_at.is_(None),
    ).update({PasswordResetOtp.consumed_at: now}, synchronize_session=False)

    otp = generate_otp()
    otp_row = PasswordResetOtp(
        user_id=user.id,
        otp_hash=hash_otp(email=email, otp=otp, secret=settings.internal_secret),
        expires_at=now + dt.timedelta(minutes=settings.otp_expiry_minutes),
    )
    db.add(otp_row)

    try:
        send_password_reset_email(to_email=email, otp=otp)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not send OTP email: {exc}")

    db.commit()
    return {"status": "otp_sent"}


@app.post("/api/auth/verify-password-reset")
def verify_password_reset(req: PasswordResetConfirmRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    email = _normalize_email(req.email)
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).one_or_none()
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid email or OTP")

    otp_hash = hash_otp(email=email, otp=req.otp.strip(), secret=settings.internal_secret)
    otp_row = (
        db.query(PasswordResetOtp)
        .filter(
            PasswordResetOtp.user_id == user.id,
            PasswordResetOtp.otp_hash == otp_hash,
            PasswordResetOtp.consumed_at.is_(None),
            PasswordResetOtp.expires_at > _utcnow(),
        )
        .order_by(PasswordResetOtp.created_at.desc())
        .first()
    )

    if otp_row is None:
        raise HTTPException(status_code=400, detail="Invalid email or OTP")

    now = _utcnow()
    user.password_hash = hash_password(req.new_password)
    user.updated_at = now
    otp_row.consumed_at = now
    db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)
    db.commit()
    return {"status": "password_updated"}


@app.post("/mock/upstox/v3/order/gtt/place")
async def mock_upstox_gtt_place(
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Mock of Upstox `POST /v3/order/gtt/place`.

    Use by setting `UPSTOX_BASE_URL=http://127.0.0.1:8000/mock/upstox` in backend/.env.
    """

    # Slightly stricter / more Upstox-like behavior:
    # - requires Bearer token
    # - validates full GTT payload shape we generate
    # - returns a richer success payload, while keeping: status=success and data.gtt_order_ids

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail={
                "status": "error",
                "message": "Unauthorized (missing/invalid Authorization header)",
            },
        )

    # Optional: force auth error for testing by using a token containing "fail"
    if "fail" in authorization.lower():
        raise HTTPException(
            status_code=401,
            detail={"status": "error", "message": "Mock auth failure"},
        )

    errors: list[str] = []

    def _req_str(key: str) -> str:
        val = payload.get(key)
        if not isinstance(val, str) or not val.strip():
            errors.append(f"{key} must be a non-empty string")
            return ""
        return val.strip()

    def _req_int(key: str) -> int:
        val = payload.get(key)
        if not isinstance(val, int):
            errors.append(f"{key} must be an integer")
            return 0
        return val

    gtt_type = _req_str("type")
    if gtt_type and gtt_type not in {"SINGLE", "MULTIPLE"}:
        errors.append("type must be SINGLE or MULTIPLE")

    quantity = _req_int("quantity")
    if quantity <= 0:
        errors.append("quantity must be >= 1")

    product = _req_str("product")
    if product and product not in {"I", "D", "MTF"}:
        errors.append("product must be one of I, D, MTF")

    instrument_token = _req_str("instrument_token")
    transaction_type = _req_str("transaction_type")
    if transaction_type and transaction_type not in {"BUY", "SELL"}:
        errors.append("transaction_type must be BUY or SELL")

    rules = payload.get("rules")
    if not isinstance(rules, list) or not rules:
        errors.append("rules must be a non-empty list")
        rules = []

    allowed_strategy = {"ENTRY", "TARGET", "STOPLOSS"}
    allowed_trigger_type = {"BELOW", "ABOVE", "IMMEDIATE"}
    normalized_rules: list[dict[str, Any]] = []
    for idx, rule in enumerate(rules):
        if not isinstance(rule, dict):
            errors.append(f"rules[{idx}] must be an object")
            continue

        strategy = rule.get("strategy")
        trigger_type = rule.get("trigger_type")
        trigger_price = rule.get("trigger_price")

        if strategy not in allowed_strategy:
            errors.append(f"rules[{idx}].strategy must be one of {sorted(allowed_strategy)}")
        if trigger_type not in allowed_trigger_type:
            errors.append(f"rules[{idx}].trigger_type must be one of {sorted(allowed_trigger_type)}")
        if not isinstance(trigger_price, (int, float)):
            errors.append(f"rules[{idx}].trigger_price must be a number")

        market_protection = rule.get("market_protection")
        trailing_gap = rule.get("trailing_gap")

        if market_protection is not None and not isinstance(market_protection, int):
            errors.append(f"rules[{idx}].market_protection must be an integer when provided")
        if trailing_gap is not None and not isinstance(trailing_gap, (int, float)):
            errors.append(f"rules[{idx}].trailing_gap must be a number when provided")

        normalized_rules.append(
            {
                "strategy": strategy,
                "trigger_type": trigger_type,
                "trigger_price": trigger_price,
                "market_protection": market_protection,
                "trailing_gap": trailing_gap,
            }
        )

    if errors:
        raise HTTPException(
            status_code=400,
            detail={
                "status": "error",
                "message": "Mock validation error",
                "errors": errors,
            },
        )

    now = dt.datetime.utcnow()
    gtt_order_ids = [f"gtt_{now.strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"]

    return {
        "status": "success",
        "message": "GTT order placed successfully (mock)",
        "data": {
            "gtt_order_ids": gtt_order_ids,
            "submitted_order": {
                "type": gtt_type,
                "quantity": quantity,
                "product": product,
                "instrument_token": instrument_token,
                "transaction_type": transaction_type,
                "rules": normalized_rules,
            },
        },
        "meta": {
            "mock": True,
            "timestamp": now.isoformat() + "Z",
        },
    }


@app.post("/api/tokens", response_model=TokenResponse)
def upsert_token(
    req: TokenUpsertRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> TokenResponse:
    existing = db.query(ClientToken).filter(ClientToken.client_id == req.client_id).one_or_none()
    encrypted = encrypt_token(req.access_token)

    if existing is None:
        token = ClientToken(client_id=req.client_id, consent=req.consent, access_token_encrypted=encrypted)
        db.add(token)
    else:
        existing.consent = req.consent
        existing.access_token_encrypted = encrypted

    db.commit()

    token = db.query(ClientToken).filter(ClientToken.client_id == req.client_id).one()
    return TokenResponse(client_id=token.client_id, consent=token.consent, updated_at=token.updated_at.isoformat())


@app.get("/api/user/token", response_model=UserTokenStatusResponse)
def get_user_token_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserTokenStatusResponse:
    token = db.query(ClientToken).filter(ClientToken.client_id == user.email).one_or_none()
    if token is None:
        return UserTokenStatusResponse(has_token=False, token=None)
    return UserTokenStatusResponse(
        has_token=True,
        token=TokenResponse(client_id=token.client_id, consent=token.consent, updated_at=token.updated_at.isoformat()),
    )


@app.get("/api/upstox/auth-url")
def get_upstox_auth_url(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Return a URL the frontend can open to start the Upstox OAuth flow for the current user."""
    app = db.query(UserUpstoxApp).filter(UserUpstoxApp.user_id == user.id).one_or_none()
    url = build_authorize_url(user.email, client_id=app.client_id if app else None)
    return {"url": url}


@app.get("/api/user/upstox-app", response_model=UserUpstoxAppStatusResponse)
def get_user_upstox_app(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserUpstoxAppStatusResponse:
    app = db.query(UserUpstoxApp).filter(UserUpstoxApp.user_id == user.id).one_or_none()
    if app is None:
        return UserUpstoxAppStatusResponse(has_app=False)
    return UserUpstoxAppStatusResponse(
        has_app=True,
        client_id=app.client_id,
        updated_at=app.updated_at.isoformat(),
    )


@app.put("/api/user/upstox-app", response_model=UserUpstoxAppStatusResponse)
def upsert_user_upstox_app(
    req: UserUpstoxAppUpsertRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserUpstoxAppStatusResponse:
    app = db.query(UserUpstoxApp).filter(UserUpstoxApp.user_id == user.id).one_or_none()
    encrypted_secret = encrypt_token(req.client_secret)

    if app is None:
        app = UserUpstoxApp(
            user_id=user.id,
            client_id=req.client_id.strip(),
            client_secret_encrypted=encrypted_secret,
        )
        db.add(app)
    else:
        app.client_id = req.client_id.strip()
        app.client_secret_encrypted = encrypted_secret

    db.commit()
    db.refresh(app)
    return UserUpstoxAppStatusResponse(
        has_app=True,
        client_id=app.client_id,
        updated_at=app.updated_at.isoformat(),
    )


@app.get("/api/upstox/callback")
async def upstox_callback(code: str | None = None, state: str | None = None) -> RedirectResponse:
    """OAuth callback endpoint used by Upstox to redirect back with `code` and `state`.

    The endpoint exchanges the code for an access token and stores it encrypted for the user
    referenced in the signed `state`. After success the user is redirected back to the webapp.
    """
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    await exchange_code_and_store(code=code, state=state)

    redirect_base = settings.webapp_base_url or (settings.cors_origins.split(",")[0] if settings.cors_origins else "http://localhost:4200")
    redirect_url = redirect_base.rstrip("/") + "/?upstox_connected=1"
    return RedirectResponse(redirect_url)


@app.put("/api/user/token", response_model=TokenResponse)
def upsert_user_token(
    req: UserTokenUpsertRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TokenResponse:
    existing = db.query(ClientToken).filter(ClientToken.client_id == user.email).one_or_none()
    encrypted = encrypt_token(req.access_token)

    if existing is None:
        token = ClientToken(client_id=user.email, consent=req.consent, access_token_encrypted=encrypted)
        db.add(token)
    else:
        existing.consent = req.consent
        existing.access_token_encrypted = encrypted

    db.commit()
    token = db.query(ClientToken).filter(ClientToken.client_id == user.email).one()
    return TokenResponse(client_id=token.client_id, consent=token.consent, updated_at=token.updated_at.isoformat())


@app.get("/api/tokens", response_model=list[TokenResponse])
def list_tokens(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> list[TokenResponse]:
    tokens = db.query(ClientToken).order_by(ClientToken.updated_at.desc()).all()
    return [
        TokenResponse(client_id=t.client_id, consent=t.consent, updated_at=t.updated_at.isoformat())
        for t in tokens
    ]


@app.get("/api/tokens/{client_id}", response_model=TokenResponse)
def get_token(
    client_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> TokenResponse:
    token = db.query(ClientToken).filter(ClientToken.client_id == client_id).one_or_none()
    if token is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return TokenResponse(client_id=token.client_id, consent=token.consent, updated_at=token.updated_at.isoformat())


@app.patch("/api/tokens/{client_id}", response_model=TokenResponse)
def admin_update_token(
    client_id: str,
    req: TokenAdminUpdateRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> TokenResponse:
    token = db.query(ClientToken).filter(ClientToken.client_id == client_id).one_or_none()
    if token is None:
        raise HTTPException(status_code=404, detail="Client not found")

    did_change = False

    if req.consent is not None:
        token.consent = req.consent
        did_change = True

    if req.access_token is not None:
        token.access_token_encrypted = encrypt_token(req.access_token)
        did_change = True

    if not did_change:
        raise HTTPException(status_code=400, detail="No changes provided")

    db.commit()
    db.refresh(token)
    return TokenResponse(client_id=token.client_id, consent=token.consent, updated_at=token.updated_at.isoformat())


@app.delete("/api/tokens/{client_id}")
def delete_token(
    client_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> dict[str, str]:
    token = db.query(ClientToken).filter(ClientToken.client_id == client_id).one_or_none()
    if token is None:
        raise HTTPException(status_code=404, detail="Client not found")
    db.delete(token)
    db.commit()
    return {"status": "deleted", "client_id": client_id}


@app.post("/api/gtt/place-batch", response_model=BatchPlaceResponse)
async def place_batch(req: GttPlaceRequest, db: Session = Depends(get_db)) -> BatchPlaceResponse:
    batch = await place_gtt_for_all_clients(db=db, gtt_request=req, raw_text=req.model_dump_json(), source="api")
    return _batch_to_response(batch)


@app.post("/api/telegram/ingest", response_model=BatchPlaceResponse)
async def telegram_ingest(
    req: TelegramIngestRequest,
    x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret"),
    db: Session = Depends(get_db),
) -> BatchPlaceResponse:
    if x_internal_secret != settings.internal_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        gtt = parse_telegram_message_to_gtt(req.text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    batch = await place_gtt_for_all_clients(
        db=db,
        gtt_request=gtt,
        raw_text=req.text,
        source="telegram",
        telegram_chat_id=req.telegram_chat_id,
        telegram_message_id=req.telegram_message_id,
    )
    return _batch_to_response(batch)


@app.get("/api/batches", response_model=list[OrderBatchResponse])
def list_batches(limit: int = 20, db: Session = Depends(get_db)) -> list[OrderBatchResponse]:
    limit = max(1, min(100, limit))
    batches = db.query(OrderBatch).order_by(OrderBatch.id.desc()).limit(limit).all()
    return [_batch_to_detail_response(b) for b in batches]


@app.get("/api/batches/{batch_id}", response_model=OrderBatchResponse)
def get_batch(batch_id: int, db: Session = Depends(get_db)) -> OrderBatchResponse:
    batch = db.query(OrderBatch).filter(OrderBatch.id == batch_id).one_or_none()
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _batch_to_detail_response(batch)


def _batch_to_response(batch) -> BatchPlaceResponse:
    results = []
    success = 0
    error = 0

    for r in batch.results:
        row = {
            "client_id": r.client_id,
            "status": r.status,
            "gtt_order_ids": json.loads(r.gtt_order_ids) if r.gtt_order_ids else None,
            "error_message": r.error_message,
        }
        results.append(row)
        if r.status == "success":
            success += 1
        else:
            error += 1

    return BatchPlaceResponse(
        batch_id=batch.id,
        total_clients=len(batch.results),
        success=success,
        error=error,
        results=results,
    )


def _batch_to_detail_response(batch: OrderBatch) -> OrderBatchResponse:
    results: list[OrderResultResponse] = []
    for r in batch.results:
        results.append(
            OrderResultResponse(
                client_id=r.client_id,
                status=r.status,  # type: ignore[arg-type]
                gtt_order_ids=json.loads(r.gtt_order_ids) if r.gtt_order_ids else None,
                error_message=r.error_message,
                created_at=r.created_at.isoformat(),
            )
        )

    return OrderBatchResponse(
        batch_id=batch.id,
        created_at=batch.created_at.isoformat(),
        source=batch.source,
        raw_text=batch.raw_text,
        parsed_payload_json=batch.parsed_payload_json,
        telegram_chat_id=batch.telegram_chat_id,
        telegram_message_id=batch.telegram_message_id,
        results=results,
    )
