from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..deps import get_current_admin, get_db
from ..ipv6_pool import assign_next_ipv6
from ..models import DhanCredential, PasswordResetOtp, Signal, SignalNotification, User, UserSession
from ..notifications import send_signal_cancelled_notifications, send_signal_notifications
from ..pagination import paginate_meta, parse_ist_date_range
from ..scrip_lookup import search as scrip_search_fn
from ..scrip_lookup import search_nearest_expiry as scrip_search_nearest_expiry_fn
from ..schemas import (
    AdminSignalDetailResponse,
    AdminUpdateUserRequest,
    AdminUserResponse,
    PaginatedSignalsResponse,
    PaginatedUsersResponse,
    SignalCreateRequest,
    SignalResponse,
)
from ..xlsx_export import build_xlsx_response, to_ist_str

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)


@router.get("/scrip-search")
def scrip_search(
    symbol: str,
    strike: float,
    option_type: str,
    expiry: str | None = None,
    exchange: str | None = None,
    _: User = Depends(get_current_admin),
) -> list[dict]:
    """
    Look up Dhan numeric security IDs from the local scrip master CSV.
    symbol:      index name, e.g. NIFTY, SENSEX, BANKNIFTY
    strike:      strike price as a number, e.g. 23800
    option_type: PE or CE
    expiry:      optional YYYY-MM-DD; if omitted, the nearest upcoming expiry is auto-selected
    exchange:    optional NSE or BSE filter
    """
    if expiry:
        results = scrip_search_fn(
            symbol=symbol,
            strike=strike,
            option_type=option_type,
            expiry_date=expiry,
            exchange=exchange,
        )
        expiry_desc = f"expiry {expiry}"
    else:
        results = scrip_search_nearest_expiry_fn(
            symbol=symbol,
            strike=strike,
            option_type=option_type,
            exchange=exchange,
        )
        expiry_desc = "nearest upcoming expiry"

    if not results:
        raise HTTPException(
            status_code=404,
            detail=f"No instrument found: {symbol} {strike}{option_type} ({expiry_desc}). "
                   "Check symbol spelling, strike price, expiry date, and that the scrip master CSV is deployed.",
        )
    return results


def _to_admin_user(u: User, db: Session) -> AdminUserResponse:
    has_cred = db.query(DhanCredential).filter(DhanCredential.user_id == u.id).count() > 0
    return AdminUserResponse(
        id=u.id,
        name=u.name,
        email=u.email,
        phone_number=u.phone_number,
        role=u.role,
        assigned_ipv6=u.assigned_ipv6,
        is_active=u.is_active,
        has_dhan_credential=has_cred,
        created_at=u.created_at.isoformat(),
        updated_at=u.updated_at.isoformat(),
    )


def _to_signal_response(signal: Signal, db: Session, include_counts: bool = True) -> SignalResponse:
    counts: dict[str, int] = {}
    exchange_confirmed = exchange_rejected = awaiting_confirmation = None
    if include_counts:
        rows = db.query(SignalNotification).filter(SignalNotification.signal_id == signal.id).all()
        exchange_confirmed = exchange_rejected = awaiting_confirmation = 0
        for row in rows:
            counts[row.status] = counts.get(row.status, 0) + 1
            if row.status == "placed":
                if row.live_status in ("TRANSIT", "PENDING", "TRADED"):
                    exchange_confirmed += 1
                else:
                    awaiting_confirmation += 1
            elif row.live_status in ("REJECTED", "CANCELLED", "EXPIRED"):
                exchange_rejected += 1

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
        total_notified=sum(counts.values()) if counts else None,
        confirmed=counts.get("confirmed"),
        placed=counts.get("placed"),
        rejected=counts.get("rejected"),
        failed=counts.get("failed"),
        exchange_confirmed=exchange_confirmed,
        exchange_rejected=exchange_rejected,
        awaiting_confirmation=awaiting_confirmation,
    )


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@router.get("/users", response_model=PaginatedUsersResponse)
def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, description="Match against name or email"),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    is_active: bool | None = Query(default=None, description="Filter by active/pending-approval status"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> PaginatedUsersResponse:
    start_utc, end_utc = parse_ist_date_range(date_from, date_to)
    query = db.query(User)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(or_(User.name.ilike(like), User.email.ilike(like)))
    if start_utc is not None:
        query = query.filter(User.created_at >= start_utc)
    if end_utc is not None:
        query = query.filter(User.created_at < end_utc)
    if is_active is not None:
        query = query.filter(User.is_active.is_(is_active))

    total = query.count()
    users = (
        query.order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return PaginatedUsersResponse(
        items=[_to_admin_user(u, db) for u in users],
        meta=paginate_meta(page=page, page_size=page_size, total=total),
    )


@router.get("/users/export")
def export_users(
    search: str | None = Query(default=None, description="Match against name or email"),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Downloads all users (matching the given filters) as an .xlsx file."""
    start_utc, end_utc = parse_ist_date_range(date_from, date_to)
    query = db.query(User)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(or_(User.name.ilike(like), User.email.ilike(like)))
    if start_utc is not None:
        query = query.filter(User.created_at >= start_utc)
    if end_utc is not None:
        query = query.filter(User.created_at < end_utc)
    users = query.order_by(User.created_at.desc()).all()

    headers = [
        "ID", "Name", "Email", "Phone Number", "Role", "Assigned IPv6",
        "Active", "Has Dhan Credential", "Created At (IST)", "Updated At (IST)",
    ]
    rows = []
    for u in users:
        has_cred = db.query(DhanCredential).filter(DhanCredential.user_id == u.id).count() > 0
        rows.append([
            u.id, u.name, u.email, u.phone_number, u.role, u.assigned_ipv6 or "",
            "Yes" if u.is_active else "No", "Yes" if has_cred else "No",
            to_ist_str(u.created_at), to_ist_str(u.updated_at),
        ])

    filename = f"users_{dt.datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return build_xlsx_response(filename=filename, sheet_title="Users", headers=headers, rows=rows)


@router.get("/users/{user_id}", response_model=AdminUserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> AdminUserResponse:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _to_admin_user(user, db)


@router.put("/users/{user_id}", response_model=AdminUserResponse)
def update_user(
    user_id: int,
    req: AdminUpdateUserRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> AdminUserResponse:
    """
    Update a user's assigned IPv6, role, or active status.
    The assigned_ipv6 must be one of the AWS ENI-delegated addresses configured
    on the EC2 instance (see poc.md). Once set, Dhan orders for this user
    will egress from that address.
    """
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    # Prevent admin from de-admining themselves
    if user.id == admin.id and req.role == "user":
        raise HTTPException(status_code=400, detail="Cannot demote yourself from admin")

    if req.assigned_ipv6 is not None:
        user.assigned_ipv6 = req.assigned_ipv6.strip() or None
    if req.role is not None:
        user.role = req.role
    if req.is_active is not None:
        user.is_active = req.is_active

    user.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(user)
    return _to_admin_user(user, db)


@router.post("/users/{user_id}/approve", response_model=AdminUserResponse)
def approve_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> AdminUserResponse:
    """Activates a pending self-registered user and assigns an IPv6 if it doesn't have one yet."""
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = True
    if not user.assigned_ipv6:
        user.assigned_ipv6 = assign_next_ipv6(db)
    user.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(user)
    return _to_admin_user(user, db)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> dict[str, str]:
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)
    db.query(PasswordResetOtp).filter(PasswordResetOtp.user_id == user.id).delete(synchronize_session=False)
    db.query(SignalNotification).filter(SignalNotification.user_id == user.id).delete(synchronize_session=False)
    db.query(DhanCredential).filter(DhanCredential.user_id == user.id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    return {"status": "deleted", "user_id": str(user_id)}


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------

@router.post("/signals", response_model=SignalResponse, status_code=201)
def create_signal(
    req: SignalCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> SignalResponse:
    """
    Create a trading signal and broadcast it to all eligible users
    (active, has active Dhan credential and assigned IPv6).
    Each eligible user gets a SignalNotification record and an FCM push.
    """
    signal = Signal(
        created_by_id=admin.id,
        title=req.title.strip(),
        exchange_segment=req.exchange_segment.upper(),
        security_id=req.security_id.strip(),
        transaction_type=req.transaction_type,
        product_type=req.product_type,
        order_type=req.order_type,
        quantity=req.quantity,
        price=req.price,
        target_price=req.target_price,
        stop_loss_price=req.stop_loss_price,
        trailing_jump=req.trailing_jump,
        expires_at=req.expires_at,
        status="active",
    )
    db.add(signal)
    db.flush()  # get signal.id

    # Find eligible users
    eligible_users = (
        db.query(User)
        .join(DhanCredential, DhanCredential.user_id == User.id)
        .filter(
            User.is_active.is_(True),
            User.assigned_ipv6.isnot(None),
            DhanCredential.is_active.is_(True),
        )
        .all()
    )

    fcm_tokens: list[str] = []
    for user in eligible_users:
        notif = SignalNotification(signal_id=signal.id, user_id=user.id, status="pending")
        db.add(notif)
        if user.fcm_token:
            fcm_tokens.append(user.fcm_token)

    db.commit()
    db.refresh(signal)

    # Send FCM push notifications (best-effort, non-blocking)
    if fcm_tokens:
        result = send_signal_notifications(
            signal_id=signal.id,
            signal_title=req.title,
            fcm_tokens=fcm_tokens,
        )
        logger.info(
            "Signal %s broadcast: %d users notified, FCM sent=%d failed=%d",
            signal.id, len(eligible_users), result["sent"], result["failed"],
        )
    else:
        logger.info("Signal %s created; no FCM tokens to notify (%d eligible users)", signal.id, len(eligible_users))

    return _to_signal_response(signal, db)


@router.get("/signals", response_model=PaginatedSignalsResponse)
def list_signals(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> PaginatedSignalsResponse:
    start_utc, end_utc = parse_ist_date_range(date_from, date_to)
    query = db.query(Signal)
    if start_utc is not None:
        query = query.filter(Signal.created_at >= start_utc)
    if end_utc is not None:
        query = query.filter(Signal.created_at < end_utc)

    total = query.count()
    signals = (
        query.order_by(Signal.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return PaginatedSignalsResponse(
        items=[_to_signal_response(s, db) for s in signals],
        meta=paginate_meta(page=page, page_size=page_size, total=total),
    )


@router.get("/signals/{signal_id}", response_model=AdminSignalDetailResponse)
def get_signal(
    signal_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> AdminSignalDetailResponse:
    signal = db.query(Signal).filter(Signal.id == signal_id).one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")

    notifications = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.user))
        .filter(SignalNotification.signal_id == signal_id)
        .all()
    )

    notif_data: list[dict[str, Any]] = []
    for n in notifications:
        notif_data.append({
            "notification_id": n.id,
            "user_id": n.user_id,
            "user_email": n.user.email,
            "user_name": n.user.name,
            "assigned_ipv6": n.user.assigned_ipv6,
            "status": n.status,
            "dhan_order_id": n.dhan_order_id,
            "error_message": n.error_message,
            "confirmed_at": n.confirmed_at.isoformat() if n.confirmed_at else None,
            "placed_at": n.placed_at.isoformat() if n.placed_at else None,
            "created_at": n.created_at.isoformat(),
            "live_status": n.live_status,
            "exchange_order_no": n.exchange_order_no,
            "traded_qty": n.traded_qty,
            "traded_price": n.traded_price,
            "reason_description": n.reason_description,
            "live_updated_at": n.live_updated_at.isoformat() if n.live_updated_at else None,
        })

    return AdminSignalDetailResponse(
        signal=_to_signal_response(signal, db),
        notifications=notif_data,
    )


@router.put("/signals/{signal_id}/cancel")
def cancel_signal(
    signal_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict[str, str]:
    signal = db.query(Signal).filter(Signal.id == signal_id).one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")
    if signal.status == "cancelled":
        return {"status": "already_cancelled"}

    # Grab tokens of users about to lose their pending notification, before the bulk update
    affected_tokens = [
        token
        for (token,) in db.query(User.fcm_token)
        .join(SignalNotification, SignalNotification.user_id == User.id)
        .filter(
            SignalNotification.signal_id == signal_id,
            SignalNotification.status == "pending",
            User.fcm_token.isnot(None),
        )
        .all()
    ]

    signal.status = "cancelled"
    # Mark all pending notifications as rejected
    db.query(SignalNotification).filter(
        SignalNotification.signal_id == signal_id,
        SignalNotification.status == "pending",
    ).update({"status": "rejected"}, synchronize_session=False)

    db.commit()

    if affected_tokens:
        result = send_signal_cancelled_notifications(
            signal_id=signal_id,
            signal_title=signal.title,
            fcm_tokens=affected_tokens,
        )
        logger.info(
            "Signal %s cancelled: notified %d users, FCM sent=%d failed=%d",
            signal_id, len(affected_tokens), result["sent"], result["failed"],
        )

    return {"status": "cancelled", "signal_id": str(signal_id)}


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@router.get("/orders/export")
def export_orders(
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Downloads all per-user order notifications (across all signals) in the given date range as an .xlsx file."""
    start_utc, end_utc = parse_ist_date_range(date_from, date_to)
    query = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.user), joinedload(SignalNotification.signal))
    )
    if start_utc is not None:
        query = query.filter(SignalNotification.created_at >= start_utc)
    if end_utc is not None:
        query = query.filter(SignalNotification.created_at < end_utc)
    notifications = query.order_by(SignalNotification.created_at.desc()).all()

    headers = [
        "Notification ID", "Signal ID", "Signal Title", "Security ID", "Exchange Segment",
        "Transaction Type", "Product Type", "Order Type", "Quantity", "Price",
        "Target Price", "Stop Loss", "User Name", "User Email", "Status",
        "Dhan Order ID", "Live Status", "Exchange Order No", "Traded Qty", "Traded Price",
        "Error Message", "Reason Description", "Confirmed At (IST)", "Placed At (IST)", "Created At (IST)",
    ]
    rows = []
    for n in notifications:
        s = n.signal
        rows.append([
            n.id, s.id, s.title, s.security_id, s.exchange_segment,
            s.transaction_type, s.product_type, s.order_type, s.quantity, s.price,
            s.target_price, s.stop_loss_price, n.user.name, n.user.email, n.status,
            n.dhan_order_id or "", n.live_status or "", n.exchange_order_no or "",
            n.traded_qty if n.traded_qty is not None else "", n.traded_price if n.traded_price is not None else "",
            n.error_message or "", n.reason_description or "",
            to_ist_str(n.confirmed_at), to_ist_str(n.placed_at), to_ist_str(n.created_at),
        ])

    filename = f"orders_{dt.datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return build_xlsx_response(filename=filename, sheet_title="Orders", headers=headers, rows=rows)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict[str, Any]:
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active.is_(True)).count()
    users_with_ipv6 = db.query(User).filter(User.assigned_ipv6.isnot(None)).count()
    users_with_dhan = db.query(DhanCredential).filter(DhanCredential.is_active.is_(True)).count()
    total_signals = db.query(Signal).count()
    active_signals = db.query(Signal).filter(Signal.status == "active").count()

    total_failed = db.query(SignalNotification).filter(SignalNotification.status == "failed").count()
    total_pending = db.query(SignalNotification).filter(SignalNotification.status == "pending").count()

    # 'placed' only means Dhan's HTTP API accepted the request. Split it further
    # using the live order status from Dhan's order-update WebSocket so the admin
    # can see how many orders are *really* confirmed at the exchange.
    placed_rows = (
        db.query(SignalNotification.live_status)
        .filter(SignalNotification.status == "placed")
        .all()
    )
    exchange_confirmed = sum(1 for (ls,) in placed_rows if ls in ("TRANSIT", "PENDING", "TRADED"))
    awaiting_confirmation = len(placed_rows) - exchange_confirmed
    total_exchange_rejected = (
        db.query(SignalNotification)
        .filter(SignalNotification.live_status.in_(["REJECTED", "CANCELLED", "EXPIRED"]))
        .count()
    )

    return {
        "users": {
            "total": total_users,
            "active": active_users,
            "with_ipv6_assigned": users_with_ipv6,
            "with_dhan_credential": users_with_dhan,
        },
        "signals": {
            "total": total_signals,
            "active": active_signals,
        },
        "orders": {
            # Really confirmed at the exchange (TRANSIT/PENDING/TRADED) — this is
            # the number that should be trusted as "actually placed in Dhan".
            "placed": exchange_confirmed,
            "awaiting_confirmation": awaiting_confirmation,
            "exchange_rejected": total_exchange_rejected,
            "failed": total_failed,
            "pending": total_pending,
        },
    }
