from __future__ import annotations

import datetime as dt
import logging
import socket

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload

from ..crypto import decrypt_token, encrypt_token
from ..deps import get_current_user, get_db
from ..models import DhanCredential, Signal, SignalNotification, User
from ..order_service import place_order_for_notification
from ..schemas import (
    DhanCredentialResponse,
    DhanCredentialUpsertRequest,
    SignalNotificationResponse,
    SignalResponse,
    UpdateFcmTokenRequest,
    UpdateProfileRequest,
    UserProfileResponse,
)

router = APIRouter(prefix="/api/users", tags=["users"])
logger = logging.getLogger(__name__)


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


def _to_signal_response(signal: Signal) -> SignalResponse:
    return SignalResponse(
        id=signal.id,
        title=signal.title,
        exchange_segment=signal.exchange_segment,
        security_id=signal.security_id,
        transaction_type=signal.transaction_type,
        product_type=signal.product_type,
        order_type=signal.order_type,
        quantity=signal.quantity,
        price=signal.price,
        target_price=signal.target_price,
        stop_loss_price=signal.stop_loss_price,
        trailing_jump=signal.trailing_jump,
        status=signal.status,
        created_by_id=signal.created_by_id,
        created_at=signal.created_at.isoformat(),
        expires_at=signal.expires_at.isoformat() if signal.expires_at else None,
    )


def _to_notification_response(notif: SignalNotification) -> SignalNotificationResponse:
    return SignalNotificationResponse(
        id=notif.id,
        signal_id=notif.signal_id,
        status=notif.status,
        signal=_to_signal_response(notif.signal),
        error_message=notif.error_message,
        dhan_order_id=notif.dhan_order_id,
        confirmed_at=notif.confirmed_at.isoformat() if notif.confirmed_at else None,
        placed_at=notif.placed_at.isoformat() if notif.placed_at else None,
        created_at=notif.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserProfileResponse)
def get_profile(current_user: User = Depends(get_current_user)) -> UserProfileResponse:
    return _to_profile(current_user)


@router.put("/me", response_model=UserProfileResponse)
def update_profile(
    req: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    if req.name is not None:
        current_user.name = req.name.strip()
    if req.phone_number is not None:
        current_user.phone_number = req.phone_number.strip()
    current_user.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    return _to_profile(current_user)


@router.put("/me/fcm-token")
def update_fcm_token(
    req: UpdateFcmTokenRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    current_user.fcm_token = req.fcm_token
    current_user.updated_at = dt.datetime.utcnow()
    db.commit()
    return {"status": "updated"}


# ---------------------------------------------------------------------------
# Dhan credentials
# ---------------------------------------------------------------------------

@router.get("/me/dhan", response_model=DhanCredentialResponse | None)
def get_dhan_credential(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DhanCredentialResponse | None:
    cred = db.query(DhanCredential).filter(DhanCredential.user_id == current_user.id).one_or_none()
    if cred is None:
        return None
    return DhanCredentialResponse(
        dhan_client_id=cred.dhan_client_id,
        is_active=cred.is_active,
        updated_at=cred.updated_at.isoformat(),
    )


@router.post("/me/dhan", response_model=DhanCredentialResponse, status_code=200)
def upsert_dhan_credential(
    req: DhanCredentialUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DhanCredentialResponse:
    cred = db.query(DhanCredential).filter(DhanCredential.user_id == current_user.id).one_or_none()
    encrypted = encrypt_token(req.access_token)

    if cred is None:
        cred = DhanCredential(
            user_id=current_user.id,
            dhan_client_id=req.dhan_client_id.strip(),
            access_token_encrypted=encrypted,
            is_active=True,
        )
        db.add(cred)
    else:
        cred.dhan_client_id = req.dhan_client_id.strip()
        cred.access_token_encrypted = encrypted
        cred.is_active = True
        cred.updated_at = dt.datetime.utcnow()

    db.commit()
    db.refresh(cred)
    return DhanCredentialResponse(
        dhan_client_id=cred.dhan_client_id,
        is_active=cred.is_active,
        updated_at=cred.updated_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Signal notifications
# ---------------------------------------------------------------------------

@router.get("/me/notifications", response_model=list[SignalNotificationResponse])
def list_notifications(
    status: str | None = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SignalNotificationResponse]:
    """
    Return signal notifications for the current user.
    Optional ?status=pending|confirmed|placed|rejected|failed filter.
    Sorted newest first, pending first.
    """
    query = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.signal))
        .filter(SignalNotification.user_id == current_user.id)
    )
    if status:
        query = query.filter(SignalNotification.status == status)

    # Pending notifications first, then most recent
    notifications = (
        query.order_by(
            (SignalNotification.status == "pending").desc(),
            SignalNotification.created_at.desc(),
        )
        .limit(limit)
        .all()
    )
    return [_to_notification_response(n) for n in notifications]


@router.post("/me/notifications/{notification_id}/confirm", response_model=SignalNotificationResponse)
async def confirm_notification(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SignalNotificationResponse:
    """
    User confirms a pending signal — triggers immediate Dhan order placement
    from the user's assigned IPv6 address.
    """
    notif = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.signal), joinedload(SignalNotification.user))
        .filter(SignalNotification.id == notification_id, SignalNotification.user_id == current_user.id)
        .one_or_none()
    )
    if notif is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notif.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Notification is already in '{notif.status}' state",
        )
    if notif.signal.status == "cancelled":
        raise HTTPException(status_code=409, detail="Signal has been cancelled by admin")

    notif.status = "confirmed"
    notif.confirmed_at = dt.datetime.utcnow()
    db.commit()

    # Place the Dhan order immediately
    await place_order_for_notification(notification=notif, db=db)
    db.refresh(notif)
    return _to_notification_response(notif)


@router.post("/me/notifications/{notification_id}/reject", response_model=SignalNotificationResponse)
def reject_notification(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SignalNotificationResponse:
    notif = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.signal))
        .filter(SignalNotification.id == notification_id, SignalNotification.user_id == current_user.id)
        .one_or_none()
    )
    if notif is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notif.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Notification is already in '{notif.status}' state",
        )

    notif.status = "rejected"
    db.commit()
    db.refresh(notif)
    return _to_notification_response(notif)


@router.get("/me/orders", response_model=list[SignalNotificationResponse])
def list_orders(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SignalNotificationResponse]:
    """Return placed/failed order history for the current user."""
    notifications = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.signal))
        .filter(
            SignalNotification.user_id == current_user.id,
            SignalNotification.status.in_(["placed", "failed"]),
        )
        .order_by(SignalNotification.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_to_notification_response(n) for n in notifications]


@router.get("/test-ip")
def test_ip(request: Request, current_user: User = Depends(get_current_user)) -> dict[str, str | None]:
    """Test IPv6 binding to assigned address."""
    if not current_user.assigned_ipv6:
        return {
            "bound_ipv6": None,
            "status": "No IPv6 assigned to your account",
        }
    
    try:
        # Try to bind a socket to the assigned IPv6
        sock = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((current_user.assigned_ipv6, 0))
        sock.close()
        
        return {
            "bound_ipv6": current_user.assigned_ipv6,
            "status": "✅ IPv6 binding successful — Your IPv6 is properly configured and ready for Dhan orders",
        }
    except OSError as e:
        return {
            "bound_ipv6": current_user.assigned_ipv6,
            "status": f"❌ IPv6 binding failed: {str(e)} — Please contact admin to verify IPv6 configuration on EC2",
        }
    except Exception as e:
        return {
            "bound_ipv6": current_user.assigned_ipv6,
            "status": f"❌ Error: {str(e)}",
        }
