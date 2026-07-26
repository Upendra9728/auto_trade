from __future__ import annotations

import datetime as dt
import re

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..auth import (
    generate_otp,
    generate_session_token,
    hash_otp,
    hash_password,
    hash_session_token,
    verify_password,
)
from ..config import settings
from ..deps import get_current_user, get_db, _utcnow
from ..mailer import send_password_reset_email
from ..models import PasswordResetOtp, User, UserSession
from ..schemas import (
    AdminBootstrapRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    UserAuthResponse,
    UserLoginRequest,
    UserProfileResponse,
    UserRegistrationRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_email(email: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email))


def _validate_phone(phone_number: str) -> bool:
    return bool(re.fullmatch(r"[+0-9][0-9\- ]{5,31}", phone_number.strip()))


def _to_profile(user: User) -> UserProfileResponse:
    return UserProfileResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        phone_number=user.phone_number,
        role=user.role,
        assigned_ipv6=user.assigned_ipv6,
        is_active=user.is_active,
    )


@router.post("/register", response_model=UserProfileResponse, status_code=201)
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
        role="user",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_profile(user)


@router.post("/login", response_model=UserAuthResponse)
def login_user(req: UserLoginRequest, db: Session = Depends(get_db)) -> UserAuthResponse:
    email = _normalize_email(req.email)
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).one_or_none()
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    expires_at = _utcnow() + dt.timedelta(hours=settings.auth_session_hours)
    raw_token = generate_session_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_session_token(raw_token),
        expires_at=expires_at,
    )
    db.add(session)
    # Clean up expired sessions
    db.query(UserSession).filter(UserSession.expires_at <= _utcnow()).delete(synchronize_session=False)
    db.commit()

    return UserAuthResponse(
        access_token=raw_token,
        token_type="bearer",
        expires_at=expires_at.isoformat(),
        user=_to_profile(user),
    )


@router.get("/me", response_model=UserProfileResponse)
def auth_me(user: User = Depends(get_current_user)) -> UserProfileResponse:
    return _to_profile(user)


@router.post("/logout")
def logout_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return {"status": "logged_out"}
    raw_token = authorization.split(" ", 1)[1].strip()
    if raw_token:
        db.query(UserSession).filter(
            UserSession.token_hash == hash_session_token(raw_token)
        ).delete(synchronize_session=False)
        db.commit()
    return {"status": "logged_out"}


@router.post("/request-password-reset")
def request_password_reset(req: PasswordResetRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    email = _normalize_email(req.email)
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).one_or_none()
    # Always return same response to avoid user enumeration
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
        send_password_reset_email(to_email=email, otp=otp, name=user.name)
    except Exception:
        pass  # Best-effort — don't reveal mail failure to caller

    db.commit()
    return {"status": "otp_sent"}


@router.post("/reset-password")
def reset_password(req: PasswordResetConfirmRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    email = _normalize_email(req.email)
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).one_or_none()
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    expected_hash = hash_otp(email=email, otp=req.otp, secret=settings.internal_secret)
    otp_row = (
        db.query(PasswordResetOtp)
        .filter(
            PasswordResetOtp.user_id == user.id,
            PasswordResetOtp.otp_hash == expected_hash,
            PasswordResetOtp.consumed_at.is_(None),
            PasswordResetOtp.expires_at > _utcnow(),
        )
        .one_or_none()
    )
    if otp_row is None:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    user.password_hash = hash_password(req.new_password)
    otp_row.consumed_at = _utcnow()
    # Invalidate all sessions on password change
    db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)
    db.commit()
    return {"status": "password_reset"}


# ---------------------------------------------------------------------------
# Admin bootstrap — promote a user to admin using the ADMIN_SECRET.
# Used for the very first admin setup. After that, use the admin panel.
# ---------------------------------------------------------------------------

@router.post("/admin-bootstrap")
def admin_bootstrap(req: AdminBootstrapRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    if req.admin_secret != settings.admin_secret:
        raise HTTPException(status_code=403, detail="Invalid admin secret")

    email = _normalize_email(req.email)
    user = db.query(User).filter(User.email == email).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found — register first, then bootstrap")

    user.role = "admin"
    db.commit()
    return {"status": "promoted", "email": email, "role": "admin"}
