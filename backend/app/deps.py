from __future__ import annotations

import datetime as dt

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .auth import hash_session_token
from .db import SessionLocal
from .models import User, UserSession


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _utcnow() -> dt.datetime:
    return dt.datetime.utcnow()


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


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency that requires the authenticated user to have the admin role."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
