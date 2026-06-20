from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..crypto import encrypt_token
from ..deps import get_db
from ..models import ClientToken, OrderBatch, PasswordResetOtp, User, UserSession, UserUpstoxApp
from ..schemas import (
    AdminDashboardResponse,
    AdminUserResponse,
    BrokerTokenSummary,
    TokenAdminUpdateRequest,
    TokenResponse,
    TokenUpsertRequest,
)

router = APIRouter(tags=["admin"])


def require_admin(
    x_admin_secret: str | None = Header(default=None, alias="X-Admin-Secret"),
) -> None:
    if x_admin_secret != settings.admin_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _token_summary(t: ClientToken) -> BrokerTokenSummary:
    return BrokerTokenSummary(
        broker=t.broker or "upstox",
        client_id=t.client_id,
        consent=t.consent,
        updated_at=t.updated_at.isoformat(),
    )


def _token_resp(t: ClientToken) -> TokenResponse:
    return TokenResponse(
        client_id=t.client_id,
        broker=t.broker or "upstox",
        consent=t.consent,
        updated_at=t.updated_at.isoformat(),
    )


# -- Dashboard -----------------------------------------------------------------

@router.get("/api/admin/dashboard", response_model=AdminDashboardResponse)
def admin_dashboard(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> AdminDashboardResponse:
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active.is_(True)).count()
    tokens = db.query(ClientToken).all()

    tokens_by_broker: dict[str, int] = {}
    consented_by_broker: dict[str, int] = {}
    for t in tokens:
        b = t.broker or "upstox"
        tokens_by_broker[b] = tokens_by_broker.get(b, 0) + 1
        if t.consent:
            consented_by_broker[b] = consented_by_broker.get(b, 0) + 1

    recent_batches = db.query(OrderBatch).count()
    return AdminDashboardResponse(
        total_users=total_users,
        active_users=active_users,
        tokens_by_broker=tokens_by_broker,
        consented_by_broker=consented_by_broker,
        recent_batches=recent_batches,
    )


# -- Users (original paths for webapp compat) ---------------------------------

@router.get("/api/users", response_model=list[AdminUserResponse])
def list_users(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> list[AdminUserResponse]:
    users = db.query(User).order_by(User.created_at.desc()).all()
    result = []
    for u in users:
        broker_tokens = db.query(ClientToken).filter(ClientToken.user_id == u.id).all()
        if not broker_tokens:
            broker_tokens = db.query(ClientToken).filter(ClientToken.client_id == u.email).all()
        result.append(
            AdminUserResponse(
                id=u.id,
                name=u.name,
                email=u.email,
                phone_number=u.phone_number,
                primary_broker=getattr(u, "primary_broker", "upstox") or "upstox",
                is_active=u.is_active,
                created_at=u.created_at.isoformat(),
                updated_at=u.updated_at.isoformat(),
                broker_tokens=[_token_summary(t) for t in broker_tokens],
            )
        )
    return result


@router.delete("/api/users/{user_email}")
def delete_user(
    user_email: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> dict[str, str]:
    email = user_email.strip().lower()
    user = db.query(User).filter(User.email == email).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)
    db.query(PasswordResetOtp).filter(PasswordResetOtp.user_id == user.id).delete(synchronize_session=False)
    db.query(UserUpstoxApp).filter(UserUpstoxApp.user_id == user.id).delete(synchronize_session=False)
    db.query(ClientToken).filter(ClientToken.user_id == user.id).delete(synchronize_session=False)
    db.query(ClientToken).filter(ClientToken.client_id == email).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    return {"status": "deleted", "user_email": email}


@router.patch("/api/users/{user_email}/toggle-active")
def toggle_user_active(
    user_email: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> dict[str, str]:
    email = user_email.strip().lower()
    user = db.query(User).filter(User.email == email).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = not user.is_active
    db.commit()
    return {"status": "updated", "user_email": email, "is_active": str(user.is_active)}


# -- Tokens (original paths for webapp compat) ---------------------------------

@router.get("/api/tokens", response_model=list[TokenResponse])
def list_tokens(
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> list[TokenResponse]:
    tokens = db.query(ClientToken).order_by(ClientToken.updated_at.desc()).all()
    return [_token_resp(t) for t in tokens]


@router.post("/api/tokens", response_model=TokenResponse)
def upsert_token(
    req: TokenUpsertRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> TokenResponse:
    existing = db.query(ClientToken).filter(ClientToken.client_id == req.client_id).one_or_none()
    encrypted = encrypt_token(req.access_token)

    if existing is None:
        token = ClientToken(client_id=req.client_id, broker="upstox", consent=req.consent, access_token_encrypted=encrypted)
        db.add(token)
    else:
        existing.consent = req.consent
        existing.access_token_encrypted = encrypted

    db.commit()
    t = db.query(ClientToken).filter(ClientToken.client_id == req.client_id).one()
    return _token_resp(t)


@router.get("/api/tokens/{client_id}", response_model=TokenResponse)
def get_token(
    client_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_admin),
) -> TokenResponse:
    token = db.query(ClientToken).filter(ClientToken.client_id == client_id).one_or_none()
    if token is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return _token_resp(token)


@router.patch("/api/tokens/{client_id}", response_model=TokenResponse)
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
    return _token_resp(token)


@router.delete("/api/tokens/{client_id}")
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
