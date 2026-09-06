from __future__ import annotations

import datetime as dt
import logging
import socket
import http.client

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload

from ..crypto import decrypt_token, encrypt_token
from ..deps import get_current_user, get_db
from ..dhan_client import DhanApiError, DhanClient
from ..models import DhanCredential, OrderEvent, Signal, SignalNotification, User
from ..order_service import place_order_for_notification
from ..pagination import paginate_meta, parse_ist_date_range, list_day_buckets
from ..token_refresh import renew_and_save_credential_with_reason
from ..token_refresh import parse_dhan_expiry
from ..schemas import (
    DhanCredentialResponse,
    DhanCredentialUpsertRequest,
    ConfirmNotificationRequest,
    DayBucket,
    OrderEventResponse,
    PaginatedDayBucketsResponse,
    PaginatedNotificationsResponse,
    SignalNotificationResponse,
    SignalResponse,
    UpdateAutoTradeRequest,
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
        email_verified=user.email_verified,
        terms_accepted=user.terms_accepted,
        terms_accepted_at=user.terms_accepted_at.isoformat() if user.terms_accepted_at else None,
        credits=user.credits,
        auto_trade_enabled=user.auto_trade_enabled,
        auto_trade_quantity=user.auto_trade_quantity,
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
        lot_size=signal.lot_size,
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
        live_status=notif.live_status,
        exchange_order_no=notif.exchange_order_no,
        traded_qty=notif.traded_qty,
        traded_price=notif.traded_price,
        reason_description=notif.reason_description,
        live_updated_at=notif.live_updated_at.isoformat() if notif.live_updated_at else None,
        exit_leg=notif.exit_leg,
        exit_price=notif.exit_price,
        exit_time=notif.exit_time.isoformat() if notif.exit_time else None,
        realized_pnl=notif.realized_pnl,
        is_auto_placed=notif.is_auto_placed,
    )


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------

@router.post("/accept-terms", response_model=UserProfileResponse)
def accept_terms(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    current_user.terms_accepted = True
    current_user.terms_accepted_at = dt.datetime.utcnow()
    current_user.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    return _to_profile(current_user)


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


@router.put("/me/auto-trade", response_model=UserProfileResponse)
def update_auto_trade(
    req: UpdateAutoTradeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    """
    Premium: when enabled, every future signal is auto-confirmed and placed immediately
    (costs 3 credits/order instead of 1). auto_trade_quantity, if set, overrides the
    admin's quantity for every signal; None falls back to the admin's quantity.
    """
    current_user.auto_trade_enabled = req.auto_trade_enabled
    current_user.auto_trade_quantity = req.auto_trade_quantity
    current_user.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    return _to_profile(current_user)


@router.delete("/me/fcm-token")
def clear_fcm_token(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Clear the FCM token on logout so the device stops receiving notifications for this account."""
    current_user.fcm_token = None
    current_user.updated_at = dt.datetime.utcnow()
    db.commit()
    return {"status": "cleared"}


# ---------------------------------------------------------------------------
# Dhan credentials
# ---------------------------------------------------------------------------

# Dhan enforces a 2-minute cooldown between generateAccessToken calls per user
_DHAN_TOKEN_COOLDOWN_SECONDS = 120


def _assert_cooldown_ok(cred: DhanCredential) -> None:
    """Raise 429 with time-remaining if the last token generation was too recent."""
    elapsed = (dt.datetime.utcnow() - cred.updated_at).total_seconds()
    if elapsed < _DHAN_TOKEN_COOLDOWN_SECONDS:
        wait = int(_DHAN_TOKEN_COOLDOWN_SECONDS - elapsed) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Dhan allows token generation once every 2 minutes. Please wait {wait} seconds.",
        )


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
        token_expires_at=cred.token_expires_at.isoformat() if cred.token_expires_at else None,
        totp_configured=bool(cred.totp_secret_encrypted),
    )



@router.post("/me/dhan/refresh")
async def refresh_my_dhan_credential(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Attempt to renew the current user's Dhan token and return detailed result."""
    cred = db.query(DhanCredential).filter(DhanCredential.user_id == current_user.id).one_or_none()
    if cred is None:
        raise HTTPException(status_code=404, detail="No Dhan credential found for this user")

    _assert_cooldown_ok(cred)

    result = await renew_and_save_credential_with_reason(cred, db)
    return {
        "dhan_client_id": cred.dhan_client_id,
        "refreshed": "success" if result.get("success") else "failure",
        "reason": result.get("reason"),
        "refreshed_at": result.get("refreshed_at"),
        "ipv6": result.get("source_ipv6"),
    }


@router.post("/me/dhan", response_model=DhanCredentialResponse, status_code=200)
async def upsert_dhan_credential(
    req: DhanCredentialUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DhanCredentialResponse:
    # Validate credentials and obtain the first token in one call.
    # generateAccessToken works regardless of whether an existing token is active.
    try:
        token_result = await DhanClient.generate_access_token(
            dhan_client_id=req.dhan_client_id.strip(),
            pin=req.pin,
            totp_secret=req.totp_secret,
        )
    except DhanApiError as exc:
        raise HTTPException(status_code=400, detail=f"Dhan rejected these credentials: {exc}")

    new_token: str | None = token_result.get("accessToken") or token_result.get("access_token")
    if not new_token:
        raise HTTPException(status_code=502, detail="Dhan did not return an access token")

    expiry_str: str | None = token_result.get("expiryTime") or token_result.get("expiry_time")
    token_expires_at = (
        parse_dhan_expiry(expiry_str) if expiry_str
        else dt.datetime.utcnow() + dt.timedelta(hours=24)
    )

    cred = db.query(DhanCredential).filter(DhanCredential.user_id == current_user.id).one_or_none()
    if cred is not None:
        _assert_cooldown_ok(cred)
    if cred is None:
        cred = DhanCredential(
            user_id=current_user.id,
            dhan_client_id=req.dhan_client_id.strip(),
            access_token_encrypted=encrypt_token(new_token),
            pin_encrypted=encrypt_token(req.pin),
            totp_secret_encrypted=encrypt_token(req.totp_secret),
            is_active=True,
            token_expires_at=token_expires_at,
        )
        db.add(cred)
    else:
        cred.dhan_client_id = req.dhan_client_id.strip()
        cred.access_token_encrypted = encrypt_token(new_token)
        cred.pin_encrypted = encrypt_token(req.pin)
        cred.totp_secret_encrypted = encrypt_token(req.totp_secret)
        cred.is_active = True
        cred.token_expires_at = token_expires_at
        cred.updated_at = dt.datetime.utcnow()

    db.commit()
    db.refresh(cred)
    return DhanCredentialResponse(
        dhan_client_id=cred.dhan_client_id,
        is_active=cred.is_active,
        updated_at=cred.updated_at.isoformat(),
        token_expires_at=cred.token_expires_at.isoformat() if cred.token_expires_at else None,
        totp_configured=True,
    )


# ---------------------------------------------------------------------------
# Signal notifications
# ---------------------------------------------------------------------------

@router.get("/me/notifications", response_model=PaginatedNotificationsResponse)
def list_notifications(
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaginatedNotificationsResponse:
    """
    Return signal notifications for the current user.
    Optional ?status=pending|confirmed|placed|rejected|failed filter, and
    ?date_from=/?date_to= (YYYY-MM-DD, IST) to filter by when the signal was received.
    Sorted newest first, pending first.
    """
    start_utc, end_utc = parse_ist_date_range(date_from, date_to)
    query = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.signal))
        .filter(SignalNotification.user_id == current_user.id)
    )
    if status:
        query = query.filter(SignalNotification.status == status)
    if start_utc is not None:
        query = query.filter(SignalNotification.created_at >= start_utc)
    if end_utc is not None:
        query = query.filter(SignalNotification.created_at < end_utc)

    total = query.count()
    # Pending notifications first, then most recent
    notifications = (
        query.order_by(
            (SignalNotification.status == "pending").desc(),
            SignalNotification.created_at.desc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return PaginatedNotificationsResponse(
        items=[_to_notification_response(n) for n in notifications],
        meta=paginate_meta(page=page, page_size=page_size, total=total),
    )


@router.get("/me/notifications/days", response_model=PaginatedDayBucketsResponse)
def list_notification_days(
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaginatedDayBucketsResponse:
    query = db.query(SignalNotification).filter(SignalNotification.user_id == current_user.id)
    if status:
        query = query.filter(SignalNotification.status == status)
    days, meta = list_day_buckets(query, SignalNotification.created_at, page=page, page_size=page_size)
    return PaginatedDayBucketsResponse(
        items=[DayBucket(**row) for row in days],
        meta=meta,
    )


@router.post("/me/notifications/{notification_id}/confirm", response_model=SignalNotificationResponse)
async def confirm_notification(
    notification_id: int,
    req: ConfirmNotificationRequest = ConfirmNotificationRequest(),
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
    await place_order_for_notification(notification=notif, db=db, quantity_override=req.quantity)
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


@router.get("/me/orders", response_model=PaginatedNotificationsResponse)
def list_orders(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaginatedNotificationsResponse:
    """Return placed/failed order history for the current user."""
    start_utc, end_utc = parse_ist_date_range(date_from, date_to)
    query = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.signal))
        .filter(
            SignalNotification.user_id == current_user.id,
            SignalNotification.status.in_(["placed", "failed"]),
        )
    )
    if start_utc is not None:
        query = query.filter(SignalNotification.created_at >= start_utc)
    if end_utc is not None:
        query = query.filter(SignalNotification.created_at < end_utc)

    total = query.count()
    notifications = (
        query.order_by(SignalNotification.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return PaginatedNotificationsResponse(
        items=[_to_notification_response(n) for n in notifications],
        meta=paginate_meta(page=page, page_size=page_size, total=total),
    )


@router.get("/me/orders/days", response_model=PaginatedDayBucketsResponse)
def list_order_days(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaginatedDayBucketsResponse:
    query = (
        db.query(SignalNotification)
        .filter(
            SignalNotification.user_id == current_user.id,
            SignalNotification.status.in_(["placed", "failed"]),
        )
    )
    days, meta = list_day_buckets(query, SignalNotification.created_at, page=page, page_size=page_size)
    return PaginatedDayBucketsResponse(
        items=[DayBucket(**row) for row in days],
        meta=meta,
    )


@router.post("/me/test-push")
def test_push_notification(
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """
    Send a test FCM push notification to the current user's registered device.
    Useful for verifying that Firebase credentials and FCM token are configured.
    """
    if not current_user.fcm_token:
        raise HTTPException(
            status_code=400,
            detail="No FCM token registered for your account. Open the app and log in first.",
        )
    from ..notifications import send_push_notification
    ok = send_push_notification(
        fcm_token=current_user.fcm_token,
        title="🔔 Test Notification",
        body="Push notifications are working correctly!",
        data={"type": "TEST"},
    )
    if not ok:
        raise HTTPException(
            status_code=500,
            detail="FCM send failed. Check FIREBASE_CREDENTIALS_JSON in backend .env and server logs.",
        )
    return {"status": "sent", "token_suffix": current_user.fcm_token[-8:]}


@router.get("/me/notifications/{notification_id}/events", response_model=list[OrderEventResponse])
def get_user_notification_events(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OrderEventResponse]:
    """Return historical audit-log events for a notification owned by the current user."""
    notif = (
        db.query(SignalNotification)
        .filter(SignalNotification.id == notification_id, SignalNotification.user_id == current_user.id)
        .one_or_none()
    )
    if notif is None:
        raise HTTPException(status_code=404, detail="Notification not found")

    events = (
        db.query(OrderEvent)
        .filter(OrderEvent.notification_id == notification_id)
        .order_by(OrderEvent.created_at.asc())
        .all()
    )
    return [
        OrderEventResponse(
            id=e.id,
            notification_id=e.notification_id,
            source=e.source,
            event_type=e.event_type,
            leg=e.leg,
            status=e.status,
            price=e.price,
            quantity=e.quantity,
            reason_description=e.reason_description,
            exchange_order_no=e.exchange_order_no,
            created_at=e.created_at.isoformat(),
        )
        for e in events
    ]


@router.get("/test-ip")
def test_ip(request: Request, current_user: User = Depends(get_current_user)) -> dict[str, str | None]:
    """Test IPv6 by binding and making a real HTTP call to detect the external IP."""
    if not current_user.assigned_ipv6:
        return {
            "bound_ipv6": None,
            "detected_ip": None,
            "status": "❌ No IPv6 assigned to your account",
        }
    
    try:
        # Use http.client with custom socket binding
        # Create socket bound to assigned IPv6
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((current_user.assigned_ipv6, 0))
        sock.settimeout(10)
        
        # Connect to icanhazip.com (IPv6-friendly service that returns your IP)
        try:
            sock.connect(("icanhazip.com", 80))
        except socket.gaierror:
            # Fallback to ipify.org if icanhazip doesn't resolve
            sock.close()
            sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((current_user.assigned_ipv6, 0))
            sock.settimeout(10)
            sock.connect(("api.ipify.org", 80))
        
        # Send HTTP GET request
        http_request = b"GET / HTTP/1.1\r\nHost: icanhazip.com\r\nConnection: close\r\nUser-Agent: TradingBot/1.0\r\n\r\n"
        sock.sendall(http_request)
        
        # Receive response
        response = b""
        while True:
            try:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                response += chunk
            except socket.timeout:
                break
        sock.close()
        
        # Parse response body (skip headers)
        response_text = response.decode('utf-8', errors='ignore')
        parts = response_text.split('\r\n\r\n', 1)
        
        if len(parts) > 1:
            detected_ip = parts[1].strip().split('\n')[0].strip()
        else:
            detected_ip = None
        
        if detected_ip:
            return {
                "bound_ipv6": current_user.assigned_ipv6,
                "detected_ip": detected_ip,
                "status": f"✅ IPv6 binding successful!\n\nBound to: {current_user.assigned_ipv6}\nExternal sees: {detected_ip}\n\nYour IPv6 is working and ready for Dhan orders!",
            }
        else:
            return {
                "bound_ipv6": current_user.assigned_ipv6,
                "detected_ip": None,
                "status": f"⚠️ Bound successfully but couldn't parse response.\n\nBound to: {current_user.assigned_ipv6}\n\nYou may still be able to place orders.",
            }
            
    except socket.timeout:
        return {
            "bound_ipv6": current_user.assigned_ipv6,
            "detected_ip": None,
            "status": f"❌ Connection timed out.\n\nBound IPv6: {current_user.assigned_ipv6}\n\nThe IPv6 may not have external internet access.",
        }
    except socket.gaierror as e:
        return {
            "bound_ipv6": current_user.assigned_ipv6,
            "detected_ip": None,
            "status": f"❌ DNS resolution failed: {str(e)}\n\nBound IPv6: {current_user.assigned_ipv6}\n\nEC2 may not have IPv6 internet routing configured.",
        }
    except OSError as e:
        return {
            "bound_ipv6": current_user.assigned_ipv6,
            "detected_ip": None,
            "status": f"❌ Binding failed: {str(e)}\n\nIPv6 {current_user.assigned_ipv6} is not available on this instance.",
        }
    except Exception as e:
        return {
            "bound_ipv6": current_user.assigned_ipv6,
            "detected_ip": None,
            "status": f"❌ Unexpected error: {str(e)}",
        }
