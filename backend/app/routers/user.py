from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..crypto import encrypt_token
from ..deps import get_current_user, get_db
from ..models import ClientToken, User, UserUpstoxApp
from ..schemas import (
    AllBrokerTokensResponse,
    BrokerTokenSummary,
    TokenResponse,
    UserTokenStatusResponse,
    UserTokenUpsertRequest,
    UserUpstoxAppStatusResponse,
    UserUpstoxAppUpsertRequest,
)
from ..upstox_oauth import build_authorize_url

router = APIRouter(prefix="/api/user", tags=["user"])


def _token_to_response(t: ClientToken) -> TokenResponse:
    return TokenResponse(
        client_id=t.client_id,
        broker=t.broker or "upstox",
        consent=t.consent,
        updated_at=t.updated_at.isoformat(),
    )


# -- Multi-broker token endpoints ----------------------------------------------

@router.get("/broker-tokens", response_model=AllBrokerTokensResponse)
def get_all_broker_tokens(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AllBrokerTokensResponse:
    tokens = db.query(ClientToken).filter(ClientToken.user_id == user.id).all()
    if not tokens:
        # Include legacy record by email if present
        legacy = db.query(ClientToken).filter(ClientToken.client_id == user.email).all()
        tokens = legacy
    return AllBrokerTokensResponse(
        tokens=[
            BrokerTokenSummary(
                broker=t.broker or "upstox",
                client_id=t.client_id,
                consent=t.consent,
                updated_at=t.updated_at.isoformat(),
            )
            for t in tokens
        ]
    )


@router.put("/broker-token/{broker}", response_model=TokenResponse)
def upsert_broker_token(
    broker: str,
    req: UserTokenUpsertRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TokenResponse:
    if broker not in ("upstox", "dhann", "fyers"):
        raise HTTPException(status_code=400, detail="Invalid broker. Must be upstox, dhann, or fyers")

    existing = (
        db.query(ClientToken)
        .filter(ClientToken.user_id == user.id, ClientToken.broker == broker)
        .one_or_none()
    )
    encrypted = encrypt_token(req.access_token)

    if existing is None:
        token = ClientToken(
            user_id=user.id,
            client_id=req.client_id.strip(),
            broker=broker,
            consent=req.consent,
            access_token_encrypted=encrypted,
        )
        db.add(token)
    else:
        existing.client_id = req.client_id.strip()
        existing.consent = req.consent
        existing.access_token_encrypted = encrypted

    db.commit()
    t = db.query(ClientToken).filter(ClientToken.user_id == user.id, ClientToken.broker == broker).one()
    return _token_to_response(t)


# -- Upstox token (legacy path /api/user/token) --------------------------------

@router.get("/token", response_model=UserTokenStatusResponse)
def get_user_token_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserTokenStatusResponse:
    token = (
        db.query(ClientToken)
        .filter(ClientToken.user_id == user.id, ClientToken.broker == "upstox")
        .one_or_none()
    )
    if token is None:
        token = db.query(ClientToken).filter(ClientToken.client_id == user.email).one_or_none()
    if token is None:
        return UserTokenStatusResponse(has_token=False, token=None)
    return UserTokenStatusResponse(has_token=True, token=_token_to_response(token))


@router.put("/token", response_model=TokenResponse)
def upsert_user_token(
    req: UserTokenUpsertRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TokenResponse:
    existing = (
        db.query(ClientToken)
        .filter(ClientToken.user_id == user.id, ClientToken.broker == "upstox")
        .one_or_none()
    )
    if existing is None:
        existing = db.query(ClientToken).filter(ClientToken.client_id == user.email).one_or_none()

    encrypted = encrypt_token(req.access_token)
    client_id = req.client_id.strip() if req.client_id else user.email

    if existing is None:
        token = ClientToken(
            user_id=user.id,
            client_id=client_id,
            broker="upstox",
            consent=req.consent,
            access_token_encrypted=encrypted,
        )
        db.add(token)
    else:
        existing.client_id = client_id
        existing.consent = req.consent
        existing.access_token_encrypted = encrypted
        if existing.user_id is None:
            existing.user_id = user.id
        if not existing.broker:
            existing.broker = "upstox"

    db.commit()
    t = (
        db.query(ClientToken)
        .filter(ClientToken.user_id == user.id, ClientToken.broker == "upstox")
        .one_or_none()
    ) or db.query(ClientToken).filter(ClientToken.client_id == user.email).one()
    return _token_to_response(t)


# -- Upstox App credentials ----------------------------------------------------

@router.get("/upstox-app", response_model=UserUpstoxAppStatusResponse)
def get_user_upstox_app(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserUpstoxAppStatusResponse:
    app = db.query(UserUpstoxApp).filter(UserUpstoxApp.user_id == user.id).one_or_none()
    if app is None:
        return UserUpstoxAppStatusResponse(has_app=False)
    return UserUpstoxAppStatusResponse(has_app=True, client_id=app.client_id, updated_at=app.updated_at.isoformat())


@router.put("/upstox-app", response_model=UserUpstoxAppStatusResponse)
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
    return UserUpstoxAppStatusResponse(has_app=True, client_id=app.client_id, updated_at=app.updated_at.isoformat())
