from __future__ import annotations

import asyncio
import datetime as dt
import logging
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from ..deps import get_current_admin, get_db
from ..crypto import decrypt_token
from ..config import settings
from ..db import SessionLocal
from ..dhan_client import DhanApiError, DhanClient
from ..order_service import place_order_for_notification
from ..token_refresh import renew_and_save_credential_with_reason
from ..ipv6_pool import assign_next_ipv6
from ..models import DhanCredential, OrderEvent, PasswordResetOtp, Signal, SignalNotification, User, UserGroup, UserGroupMember, UserPosition, UserSession
from ..notifications import send_signal_cancelled_notifications, send_signal_notifications
from ..pagination import paginate_meta, parse_ist_date_range
from ..scrip_lookup import search as scrip_search_fn
from ..scrip_lookup import search_nearest_expiry as scrip_search_nearest_expiry_fn
from ..scrip_lookup import list_symbols as scrip_list_symbols_fn
from ..scrip_lookup import list_expiries as scrip_list_expiries_fn
from ..scrip_lookup import list_strikes as scrip_list_strikes_fn
from ..scrip_lookup import search_contracts as scrip_search_contracts_fn
from ..schemas import (
    AdminAddCreditsRequest,
    AdminSignalDetailResponse,
    AdminSignalNotificationRow,
    AdminUpdateUserRequest,
    AdminUserPnlRow,
    AdminUserResponse,
    GroupAddMembersRequest,
    GroupCreateRequest,
    GroupDetailResponse,
    GroupResponse,
    GroupUpdateRequest,
    OrderActionResult,
    OrderEventResponse,
    PaginatedNotificationsAdminResponse,
    PaginatedSignalsResponse,
    PaginatedUsersResponse,
    SignalCreateRequest,
    SignalOrderModifyRequest,
    SignalResponse,
    PaginationMeta,
    UserPositionResponse,
)
from ..xlsx_export import build_xlsx_response, to_ist_str, _ROW_WHITE, _ROW_GREY

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


@router.get("/scrip-symbols")
def scrip_symbols(_: User = Depends(get_current_admin)) -> list[str]:
    """List all index/underlying symbols available for the Quick Select signal-creation flow."""
    return scrip_list_symbols_fn()


@router.get("/scrip-expiries")
def scrip_expiries(symbol: str, _: User = Depends(get_current_admin)) -> list[str]:
    """List upcoming expiry dates (YYYY-MM-DD) available for a symbol."""
    return scrip_list_expiries_fn(symbol)


@router.get("/scrip-strikes")
def scrip_strikes(symbol: str, expiry: str, _: User = Depends(get_current_admin)) -> list[dict]:
    """List distinct strikes for a symbol+expiry, each annotated with available option types (CE/PE)."""
    return scrip_list_strikes_fn(symbol, expiry)


@router.get("/scrip-contracts")
def scrip_contracts(query: str, limit: int = 30, _: User = Depends(get_current_admin)) -> list[dict]:
    """Search distinct symbol+expiry+option-type contracts by free-text symbol match (e.g. 'NIFTY')."""
    return scrip_search_contracts_fn(query, limit=limit)


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
        credits=u.credits,
        created_at=u.created_at.isoformat(),
        updated_at=u.updated_at.isoformat(),
    )


def _to_signal_response(signal: Signal, db: Session, include_counts: bool = True) -> SignalResponse:
    counts: dict[str, int] = {}
    exchange_confirmed = exchange_rejected = awaiting_confirmation = None
    cancellable_count = None
    if include_counts:
        rows = db.query(SignalNotification).filter(SignalNotification.signal_id == signal.id).all()
        exchange_confirmed = exchange_rejected = awaiting_confirmation = 0
        cancellable_count = 0
        for row in rows:
            counts[row.status] = counts.get(row.status, 0) + 1
            if row.status == "placed":
                if row.live_status in ("TRANSIT", "PENDING", "TRADED"):
                    exchange_confirmed += 1
                else:
                    awaiting_confirmation += 1
                # Same predicate as the bulk cancel/modify endpoints below.
                if row.exit_leg is None and row.live_status not in _TERMINAL_LIVE_STATUSES:
                    cancellable_count += 1
            elif row.live_status in ("REJECTED", "CANCELLED", "EXPIRED"):
                exchange_rejected += 1

    import json as _json
    target_group_ids: list[int] | None = None
    if signal.target_group_ids:
        try:
            target_group_ids = _json.loads(signal.target_group_ids)
        except Exception:
            pass

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
        cancellable_count=cancellable_count,
        target_group_ids=target_group_ids,
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


@router.post("/users/{user_id}/credits", response_model=AdminUserResponse)
def add_user_credits(
    user_id: int,
    req: AdminAddCreditsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> AdminUserResponse:
    """Add trading signal credits to a specific user."""
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.credits += req.amount
    user.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(user)
    return _to_admin_user(user, db)


@router.post("/users/credits/add-all", response_model=dict[str, int])
def add_credits_to_all_users(
    req: AdminAddCreditsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict[str, int]:
    """Add trading signal credits to all active users at once."""
    count = db.query(User).filter(User.is_active.is_(True)).update(
        {User.credits: User.credits + req.amount, User.updated_at: dt.datetime.utcnow()},
        synchronize_session=False,
    )
    db.commit()
    return {"updated": count}


@router.get("/users/{user_id}/dhan-ip")
async def get_user_dhan_ip(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict[str, Any]:
    """
    Shows the static IP(s) currently registered with Dhan for this user, alongside
    our own assigned_ipv6, so a mismatch (the usual cause of DH-905 'Invalid IP')
    is obvious at a glance. Read-only — does not change anything on Dhan's side.
    """
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    cred = db.query(DhanCredential).filter(DhanCredential.user_id == user_id).one_or_none()
    if cred is None or not cred.is_active:
        raise HTTPException(status_code=400, detail="User has no active Dhan credential on file")

    access_token = decrypt_token(cred.access_token_encrypted)
    try:
        dhan_ip = await DhanClient.get_ip(access_token=access_token)
    except DhanApiError as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch IP from Dhan: {exc}")

    return {
        "assigned_ipv6": user.assigned_ipv6,
        "dhan_primary_ip": dhan_ip.get("primaryIP"),
        "dhan_secondary_ip": dhan_ip.get("secondaryIP"),
        "dhan_modify_date_primary": dhan_ip.get("modifyDatePrimary"),
        "dhan_modify_date_secondary": dhan_ip.get("modifyDateSecondary"),
        "matches": bool(user.assigned_ipv6) and user.assigned_ipv6 == dhan_ip.get("primaryIP"),
    }


@router.post("/users/{user_id}/dhan-ip/register")
async def register_user_dhan_ip(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict[str, Any]:
    """
    Registers our assigned_ipv6 as this user's PRIMARY static IP with Dhan —
    calling setIP the first time, or modifyIP if one is already set (which Dhan
    only allows once every 7 days). Returns the before/after state so the admin
    can see exactly what changed.
    """
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.assigned_ipv6:
        raise HTTPException(status_code=400, detail="User has no assigned_ipv6 in our DB yet")
    cred = db.query(DhanCredential).filter(DhanCredential.user_id == user_id).one_or_none()
    if cred is None or not cred.is_active:
        raise HTTPException(status_code=400, detail="User has no active Dhan credential on file")

    access_token = decrypt_token(cred.access_token_encrypted)
    target_ip = user.assigned_ipv6

    try:
        before = await DhanClient.get_ip(access_token=access_token)
    except DhanApiError as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch current IP from Dhan: {exc}")

    current_primary = before.get("primaryIP")
    if current_primary == target_ip:
        return {
            "action": "already_correct",
            "assigned_ipv6": target_ip,
            "dhan_primary_ip": current_primary,
        }

    if not current_primary:
        try:
            await DhanClient.set_ip(
                access_token=access_token, dhan_client_id=cred.dhan_client_id, ip=target_ip, ip_flag="PRIMARY",
            )
        except DhanApiError as exc:
            raise HTTPException(status_code=502, detail=f"Dhan setIP failed: {exc}")
        action = "set"
    else:
        modify_date = before.get("modifyDatePrimary")
        today = dt.date.today().isoformat()
        if modify_date and modify_date > today:
            return {
                "action": "cooldown_blocked",
                "assigned_ipv6": target_ip,
                "dhan_primary_ip": current_primary,
                "modify_allowed_from": modify_date,
                "detail": f"Dhan only allows changing the primary IP once every 7 days. "
                          f"This account's IP can next be changed on {modify_date}.",
            }
        try:
            await DhanClient.modify_ip(
                access_token=access_token, dhan_client_id=cred.dhan_client_id, ip=target_ip, ip_flag="PRIMARY",
            )
        except DhanApiError as exc:
            raise HTTPException(status_code=502, detail=f"Dhan modifyIP failed: {exc}")
        action = "modified"

    try:
        after = await DhanClient.get_ip(access_token=access_token)
    except DhanApiError as exc:
        after = {}
        logger.warning("Registered IP for user %s but could not re-fetch to confirm: %s", user_id, exc)

    return {
        "action": action,
        "assigned_ipv6": target_ip,
        "dhan_primary_ip_before": current_primary,
        "dhan_primary_ip_after": after.get("primaryIP"),
    }



@router.post("/dhan/refresh-all-tokens")
async def refresh_all_tokens(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict:
    """Admin-only: attempt to renew Dhan tokens for all active credentials.

    Returns a per-user result list with email, dhan_client_id, refreshed (success/failure),
    reason (if any), and refreshed_at (ISO timestamp or null).
    """
    creds = (
        db.query(DhanCredential)
        .options(joinedload(DhanCredential.user))
        .filter(DhanCredential.is_active.is_(True))
        .all()
    )

    results: list[dict] = []
    for cred in creds:
        user_email = cred.user.email if cred.user is not None else None
        res = await renew_and_save_credential_with_reason(cred, db)
        results.append({
            "email": user_email,
            "dhan_client_id": cred.dhan_client_id,
            "refreshed": "success" if res.get("success") else "failure",
            "reason": res.get("reason"),
            "refreshed_at": res.get("refreshed_at"),
            "ipv6": res.get("source_ipv6"),
        })

    return {"count": len(results), "results": results}


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------

def _create_and_broadcast_signal(
    db: Session,
    background_tasks: BackgroundTasks,
    *,
    created_by_id: int,
    req: SignalCreateRequest,
) -> Signal:
    """
    Creates a Signal, fans out SignalNotification rows to eligible users, auto-confirms
    and schedules order placement for users with Auto-Trade enabled, and dispatches FCM
    push notifications. Shared by the admin HTTP endpoint and the Telegram ingest route.
    """
    import json as _json

    # Validate group IDs if provided
    target_group_ids: list[int] | None = None
    if req.group_ids:
        groups = db.query(UserGroup).filter(UserGroup.id.in_(req.group_ids)).all()
        if len(groups) != len(set(req.group_ids)):
            found_ids = {g.id for g in groups}
            missing = [gid for gid in req.group_ids if gid not in found_ids]
            raise HTTPException(status_code=404, detail=f"Groups not found: {missing}")
        target_group_ids = req.group_ids

    signal = Signal(
        created_by_id=created_by_id,
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
        target_group_ids=_json.dumps(target_group_ids) if target_group_ids else None,
    )
    db.add(signal)
    db.flush()  # get signal.id

    # Build base eligible-user query
    eligible_query = (
        db.query(User)
        .join(DhanCredential, DhanCredential.user_id == User.id)
        .filter(
            User.is_active.is_(True),
            User.assigned_ipv6.isnot(None),
            User.credits > 0,
            DhanCredential.is_active.is_(True),
        )
    )

    # If groups selected, further restrict to users who are members of those groups
    if target_group_ids:
        member_user_ids = (
            db.query(UserGroupMember.user_id)
            .filter(UserGroupMember.group_id.in_(target_group_ids))
            .distinct()
            .subquery()
        )
        eligible_query = eligible_query.filter(User.id.in_(member_user_ids))

    eligible_users = eligible_query.all()

    fcm_tokens: list[str] = []
    notifs: list[SignalNotification] = []
    for user in eligible_users:
        notif = SignalNotification(signal_id=signal.id, user_id=user.id, status="pending")
        if user.auto_trade_enabled:
            notif.status = "confirmed"
            notif.confirmed_at = dt.datetime.utcnow()
            notif.is_auto_placed = True
        db.add(notif)
        notifs.append(notif)
        if user.fcm_token:
            fcm_tokens.append(user.fcm_token)

    db.flush()  # assign notif.id before we collect the auto-trade subset
    auto_trade_notification_ids = [n.id for n in notifs if n.is_auto_placed]

    db.commit()
    db.refresh(signal)

    # Auto-place orders for Auto-Trade users after the response is returned
    if auto_trade_notification_ids:
        background_tasks.add_task(_auto_place_signal_notifications, auto_trade_notification_ids)

    # Post the signal to the Telegram group after the response is returned (best-effort)
    if req.send_to_telegram:
        background_tasks.add_task(_send_signal_to_telegram, signal.id)

    # Send FCM push notifications after the response is returned (best-effort)
    if fcm_tokens:
        background_tasks.add_task(
            _broadcast_signal_push, signal.id, req.title, fcm_tokens, len(eligible_users),
        )
    else:
        logger.info("Signal %s created; no FCM tokens to notify (%d eligible users)", signal.id, len(eligible_users))

    return signal


@router.post("/signals", response_model=SignalResponse, status_code=201)
def create_signal(
    req: SignalCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> SignalResponse:
    """
    Create a trading signal and broadcast it to eligible users.
    If group_ids is provided, only users in those groups receive the signal.
    Otherwise all eligible users (active, has Dhan credential and IPv6) receive it.
    """
    signal = _create_and_broadcast_signal(db, background_tasks, created_by_id=admin.id, req=req)
    return _to_signal_response(signal, db)


async def _auto_place_signal_notifications(notification_ids: list[int]) -> None:
    """Runs after the HTTP response is sent — places Dhan orders for Auto-Trade users."""
    db = SessionLocal()
    try:
        notifs = (
            db.query(SignalNotification)
            .options(joinedload(SignalNotification.signal), joinedload(SignalNotification.user))
            .filter(SignalNotification.id.in_(notification_ids))
            .all()
        )
        for notif in notifs:
            await place_order_for_notification(
                notification=notif, db=db, quantity_override=notif.user.auto_trade_quantity,
            )
    finally:
        db.close()


async def _send_signal_to_telegram(signal_id: int) -> None:
    """Runs after the HTTP response is sent — posts the signal to the configured Telegram group,
    using the same key:value format the bot/ process parses on the way in."""
    if not settings.telegram_bot_token or not settings.telegram_group_chat_id:
        logger.warning("send_to_telegram requested but telegram_bot_token/telegram_group_chat_id not configured")
        return
    db = SessionLocal()
    try:
        signal = db.query(Signal).filter(Signal.id == signal_id).one_or_none()
        if signal is None:
            return
        # signal.title follows the "{SYMBOL} {STRIKE}{CE|PE} {EXPIRY}" convention used by both
        # the Quick Select and Paste Message signal-creation flows.
        parts = signal.title.strip().split()
        symbol = parts[0] if parts else signal.title
        strike_opt = parts[1] if len(parts) > 1 else ""
        expiry = parts[2] if len(parts) > 2 else (
            signal.expires_at.strftime("%Y-%m-%d") if signal.expires_at else ""
        )
        lines = [
            symbol, strike_opt,
            f"PRICE: {signal.price}",
            f"STOPLOSS: {signal.stop_loss_price}",
            f"TARGETS: {signal.target_price}",
            f"QTY: {signal.quantity}",
        ]
        if expiry:
            lines.append(f"EXPIRY: {expiry}")
        text = "\n".join(lines)

        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json={"chat_id": settings.telegram_group_chat_id, "text": text})
        if resp.status_code >= 400:
            logger.warning("Failed to send signal %s to Telegram: HTTP %s %s", signal_id, resp.status_code, resp.text[:300])
    except Exception as exc:
        logger.warning("Failed to send signal %s to Telegram: %s", signal_id, exc)
    finally:
        db.close()


def _broadcast_signal_push(signal_id: int, signal_title: str, fcm_tokens: list[str], eligible_count: int) -> None:
    """Runs after the HTTP response is sent — actually dispatches the FCM pushes."""
    result = send_signal_notifications(signal_id=signal_id, signal_title=signal_title, fcm_tokens=fcm_tokens)
    logger.info(
        "Signal %s broadcast: %d users notified, FCM sent=%d failed=%d",
        signal_id, eligible_count, result["sent"], result["failed"],
    )


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
            "ordered_quantity": n.ordered_quantity,
            "live_status": n.live_status,
            "exchange_order_no": n.exchange_order_no,
            "traded_qty": n.traded_qty,
            "traded_price": n.traded_price,
            "reason_description": n.reason_description,
            "live_updated_at": n.live_updated_at.isoformat() if n.live_updated_at else None,
            "exit_leg": n.exit_leg,
            "exit_price": n.exit_price,
            "exit_time": n.exit_time.isoformat() if n.exit_time else None,
            "realized_pnl": n.realized_pnl,
        })

    return AdminSignalDetailResponse(
        signal=_to_signal_response(signal, db),
        notifications=notif_data,
    )


@router.put("/signals/{signal_id}/cancel")
def cancel_signal(
    signal_id: int,
    background_tasks: BackgroundTasks,
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
        background_tasks.add_task(
            _broadcast_signal_cancelled_push, signal_id, signal.title, affected_tokens,
        )

    return {"status": "cancelled", "signal_id": str(signal_id)}


def _broadcast_signal_cancelled_push(signal_id: int, signal_title: str, fcm_tokens: list[str]) -> None:
    """Runs after the HTTP response is sent — actually dispatches the FCM pushes."""
    result = send_signal_cancelled_notifications(signal_id=signal_id, signal_title=signal_title, fcm_tokens=fcm_tokens)
    logger.info(
        "Signal %s cancelled: notified %d users, FCM sent=%d failed=%d",
        signal_id, len(fcm_tokens), result["sent"], result["failed"],
    )


# ---------------------------------------------------------------------------
# Order management (cancel / modify / paginated notifications)
# ---------------------------------------------------------------------------

def _notif_to_row(n: SignalNotification) -> AdminSignalNotificationRow:
    return AdminSignalNotificationRow(
        notification_id=n.id,
        user_id=n.user_id,
        user_email=n.user.email,
        user_name=n.user.name,
        assigned_ipv6=n.user.assigned_ipv6,
        status=n.status,
        dhan_order_id=n.dhan_order_id,
        error_message=n.error_message,
        confirmed_at=n.confirmed_at.isoformat() if n.confirmed_at else None,
        placed_at=n.placed_at.isoformat() if n.placed_at else None,
        created_at=n.created_at.isoformat(),
        ordered_quantity=n.ordered_quantity,
        live_status=n.live_status,
        exchange_order_no=n.exchange_order_no,
        traded_qty=n.traded_qty,
        traded_price=n.traded_price,
        reason_description=n.reason_description,
        live_updated_at=n.live_updated_at.isoformat() if n.live_updated_at else None,
        exit_leg=n.exit_leg,
        exit_price=n.exit_price,
        exit_time=n.exit_time.isoformat() if n.exit_time else None,
        realized_pnl=n.realized_pnl,
    )


@router.get("/signals/{signal_id}/notifications", response_model=PaginatedNotificationsAdminResponse)
def list_signal_notifications(
    signal_id: int,
    status: str | None = Query(default=None, description="Filter by notification status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD (IST), inclusive"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> PaginatedNotificationsAdminResponse:
    signal = db.query(Signal).filter(Signal.id == signal_id).one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")

    start_utc, end_utc = parse_ist_date_range(date_from, date_to)
    query = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.user))
        .filter(SignalNotification.signal_id == signal_id)
    )
    if status:
        query = query.filter(SignalNotification.status == status)
    if start_utc is not None:
        query = query.filter(SignalNotification.created_at >= start_utc)
    if end_utc is not None:
        query = query.filter(SignalNotification.created_at < end_utc)

    total = query.count()
    notifications = (
        query.order_by(SignalNotification.placed_at.desc().nullslast(), SignalNotification.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return PaginatedNotificationsAdminResponse(
        items=[_notif_to_row(n) for n in notifications],
        meta=PaginationMeta(page=page, page_size=page_size, total=total, total_pages=max(1, -(-total // page_size))),
    )


# Statuses that mean the order is still potentially active at the exchange.
# NOTE: TRADED is intentionally absent — entry filled means exit legs are still live.
_ACTIVE_LIVE_STATUSES = {"TRANSIT", "PENDING", "PART_TRADED", "TRADED"}
# Statuses where the order is fully terminal — no action possible.
# CLOSED = entry + exit leg fully done. TRADED is NOT terminal (exit legs still open).
_TERMINAL_LIVE_STATUSES = {"CLOSED", "EXPIRED", "CANCELLED", "REJECTED"}
# Max concurrent outbound Dhan API calls during bulk cancel/modify (protects rate limits).
_BULK_CONCURRENCY = 50


async def _load_cred_and_token(db: Session, notif: SignalNotification) -> tuple[DhanCredential, str] | None:
    """Load and JIT-refresh the user's Dhan credential. Returns (cred, plaintext_token) or None on failure."""
    from ..token_refresh import renew_and_save_credential
    cred = (
        db.query(DhanCredential)
        .filter(DhanCredential.user_id == notif.user_id, DhanCredential.is_active.is_(True))
        .one_or_none()
    )
    if cred is None:
        return None
    # JIT token refresh if near expiry
    now = dt.datetime.utcnow()
    needs_refresh = (
        cred.token_expires_at is not None and (cred.token_expires_at - now).total_seconds() < 1800
    ) or (
        cred.token_expires_at is None and (now - cred.updated_at).total_seconds() > 84600
    )
    if needs_refresh:
        await renew_and_save_credential(cred, db)
        db.refresh(cred)
    return cred, decrypt_token(cred.access_token_encrypted)


@router.post("/signals/{signal_id}/cancel-orders", response_model=list[OrderActionResult])
async def cancel_signal_orders(
    signal_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[OrderActionResult]:
    """Cancel all cancellable Dhan orders for a signal (PENDING/TRANSIT/PART_TRADED or no exchange update yet)."""
    signal = db.query(Signal).filter(Signal.id == signal_id).one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")

    # Include live_status IS NULL — freshly placed orders not yet updated by the WebSocket
    # are the most important ones to cancel. SQL NOT IN silently excludes NULLs, so we
    # must explicitly include them with an OR condition.
    notifications = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.user))
        .filter(
            SignalNotification.signal_id == signal_id,
            SignalNotification.status == "placed",
            SignalNotification.exit_leg.is_(None),  # skip orders whose exit leg already triggered
            or_(
                SignalNotification.live_status.is_(None),
                ~SignalNotification.live_status.in_(list(_TERMINAL_LIVE_STATUSES)),
            ),
        )
        .all()
    )

    if not notifications:
        return []

    # Phase 1: load all credentials sequentially (may trigger JIT token refresh)
    cred_infos: list[tuple[DhanCredential, str] | None] = []
    for notif in notifications:
        cred_infos.append(await _load_cred_and_token(db, notif))

    # Phase 2: fire all Dhan cancel calls in parallel, capped at _BULK_CONCURRENCY
    sem = asyncio.Semaphore(_BULK_CONCURRENCY)

    async def _cancel_one(
        notif: SignalNotification,
        cred_info: tuple[DhanCredential, str] | None,
    ) -> OrderActionResult:
        if not notif.dhan_order_id:
            return OrderActionResult(
                notification_id=notif.id, user_id=notif.user_id,
                user_email=notif.user.email, dhan_order_id=None,
                success=False, reason="No Dhan order ID recorded",
            )
        if cred_info is None:
            return OrderActionResult(
                notification_id=notif.id, user_id=notif.user_id,
                user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                success=False, reason="No active Dhan credential",
            )
        cred, token = cred_info
        async with sem:
            try:
                await DhanClient.cancel_super_order(
                    order_id=notif.dhan_order_id,
                    dhan_client_id=cred.dhan_client_id,
                    access_token=token,
                    source_ipv6=notif.user.assigned_ipv6,
                )
                notif.status = "cancelled"  # mark dirty; committed in batch below
                return OrderActionResult(
                    notification_id=notif.id, user_id=notif.user_id,
                    user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                    success=True, reason=None,
                )
            except DhanApiError as exc:
                return OrderActionResult(
                    notification_id=notif.id, user_id=notif.user_id,
                    user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                    success=False, reason=str(exc),
                )

    raw = await asyncio.gather(
        *[_cancel_one(n, ci) for n, ci in zip(notifications, cred_infos)],
        return_exceptions=True,
    )

    results: list[OrderActionResult] = []
    for notif, r in zip(notifications, raw):
        if isinstance(r, Exception):
            results.append(OrderActionResult(
                notification_id=notif.id, user_id=notif.user_id,
                user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                success=False, reason=f"Unexpected error: {r}",
            ))
        else:
            results.append(r)  # type: ignore[arg-type]

    # Phase 3: single commit for all status mutations
    db.commit()
    return results


@router.post("/signals/{signal_id}/modify-orders", response_model=list[OrderActionResult])
async def modify_signal_orders(
    signal_id: int,
    req: SignalOrderModifyRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[OrderActionResult]:
    """Modify price/target/stop-loss on all cancellable placed orders for a signal."""
    signal = db.query(Signal).filter(Signal.id == signal_id).one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Signal not found")

    notifications = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.user))
        .filter(
            SignalNotification.signal_id == signal_id,
            SignalNotification.status == "placed",
            SignalNotification.exit_leg.is_(None),  # skip orders whose exit leg already triggered
            or_(
                SignalNotification.live_status.is_(None),
                ~SignalNotification.live_status.in_(list(_TERMINAL_LIVE_STATUSES)),
            ),
        )
        .all()
    )

    if not notifications:
        return []

    # Phase 1: load all credentials sequentially (may trigger JIT token refresh)
    cred_infos: list[tuple[DhanCredential, str] | None] = []
    for notif in notifications:
        cred_infos.append(await _load_cred_and_token(db, notif))

    # Phase 2: parallel Dhan modify calls with bounded concurrency
    sem = asyncio.Semaphore(_BULK_CONCURRENCY)

    async def _modify_one(
        notif: SignalNotification,
        cred_info: tuple[DhanCredential, str] | None,
    ) -> OrderActionResult:
        if not notif.dhan_order_id:
            return OrderActionResult(
                notification_id=notif.id, user_id=notif.user_id,
                user_email=notif.user.email, dhan_order_id=None,
                success=False, reason="No Dhan order ID recorded",
            )
        if cred_info is None:
            return OrderActionResult(
                notification_id=notif.id, user_id=notif.user_id,
                user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                success=False, reason="No active Dhan credential",
            )
        cred, token = cred_info
        # entry still open (NULL = never updated by WS) → ENTRY_LEG
        # entry already TRADED → modify exit legs independently per Dhan spec
        entry_pending = notif.live_status in (None, "TRANSIT", "PENDING", "PART_TRADED")
        async with sem:
            try:
                if entry_pending:
                    # ENTRY_LEG accepts price, targetPrice, stopLossPrice, trailingJump
                    await DhanClient.modify_super_order(
                        order_id=notif.dhan_order_id,
                        dhan_client_id=cred.dhan_client_id,
                        access_token=token,
                        source_ipv6=notif.user.assigned_ipv6,
                        leg_name="ENTRY_LEG",
                        price=req.price,
                        target_price=req.target_price,
                        stop_loss_price=req.stop_loss_price,
                        trailing_jump=req.trailing_jump,
                    )
                else:
                    # Per Dhan spec:
                    #   TARGET_LEG   → only targetPrice
                    #   STOP_LOSS_LEG → stopLossPrice and/or trailingJump
                    # IMPORTANT: Dhan cancels trailing stop if trailingJump is omitted or 0.
                    # Always carry the signal's current trailing_jump forward if admin didn't change it.
                    made_call = False
                    if req.target_price is not None:
                        await DhanClient.modify_super_order(
                            order_id=notif.dhan_order_id,
                            dhan_client_id=cred.dhan_client_id,
                            access_token=token,
                            source_ipv6=notif.user.assigned_ipv6,
                            leg_name="TARGET_LEG",
                            target_price=req.target_price,
                        )
                        made_call = True
                    if req.stop_loss_price is not None or req.trailing_jump is not None:
                        # Carry forward signal's trailing_jump if admin only changed stop_loss_price
                        effective_trailing = req.trailing_jump if req.trailing_jump is not None else signal.trailing_jump
                        await DhanClient.modify_super_order(
                            order_id=notif.dhan_order_id,
                            dhan_client_id=cred.dhan_client_id,
                            access_token=token,
                            source_ipv6=notif.user.assigned_ipv6,
                            leg_name="STOP_LOSS_LEG",
                            stop_loss_price=req.stop_loss_price,
                            trailing_jump=effective_trailing,
                        )
                        made_call = True
                    if not made_call:
                        return OrderActionResult(
                            notification_id=notif.id, user_id=notif.user_id,
                            user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                            success=False,
                            reason="Entry is already filled; specify target_price or stop_loss_price/trailing_jump to modify exit legs",
                        )
                return OrderActionResult(
                    notification_id=notif.id, user_id=notif.user_id,
                    user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                    success=True, reason=None,
                )
            except DhanApiError as exc:
                return OrderActionResult(
                    notification_id=notif.id, user_id=notif.user_id,
                    user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                    success=False, reason=str(exc),
                )

    raw = await asyncio.gather(
        *[_modify_one(n, ci) for n, ci in zip(notifications, cred_infos)],
        return_exceptions=True,
    )

    results: list[OrderActionResult] = []
    any_success = False
    for notif, r in zip(notifications, raw):
        if isinstance(r, Exception):
            results.append(OrderActionResult(
                notification_id=notif.id, user_id=notif.user_id,
                user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                success=False, reason=f"Unexpected error: {r}",
            ))
        else:
            if r.success:  # type: ignore[union-attr]
                any_success = True
            results.append(r)  # type: ignore[arg-type]

    # Update signal DB values to reflect the latest modify (only if at least one succeeded)
    if any_success:
        if req.price is not None:
            signal.price = req.price
        if req.target_price is not None:
            signal.target_price = req.target_price
        if req.stop_loss_price is not None:
            signal.stop_loss_price = req.stop_loss_price
        if req.trailing_jump is not None:
            signal.trailing_jump = req.trailing_jump
        db.commit()

    return results


@router.post("/notifications/{notification_id}/cancel-order", response_model=OrderActionResult)
async def cancel_notification_order(
    notification_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> OrderActionResult:
    """Cancel a single user's Dhan order."""
    notif = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.user))
        .filter(SignalNotification.id == notification_id)
        .one_or_none()
    )
    if notif is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not notif.dhan_order_id:
        raise HTTPException(status_code=400, detail="No Dhan order ID recorded for this notification")

    cred_info = await _load_cred_and_token(db, notif)
    if cred_info is None:
        raise HTTPException(status_code=400, detail="No active Dhan credential for this user")
    cred, token = cred_info
    try:
        await DhanClient.cancel_super_order(
            order_id=notif.dhan_order_id,
            dhan_client_id=cred.dhan_client_id,
            access_token=token,
            source_ipv6=notif.user.assigned_ipv6,
        )
        notif.status = "cancelled"
        db.commit()
        return OrderActionResult(
            notification_id=notif.id, user_id=notif.user_id,
            user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
            success=True, reason=None,
        )
    except DhanApiError as exc:
        return OrderActionResult(
            notification_id=notif.id, user_id=notif.user_id,
            user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
            success=False, reason=str(exc),
        )


@router.post("/notifications/{notification_id}/modify-order", response_model=OrderActionResult)
async def modify_notification_order(
    notification_id: int,
    req: SignalOrderModifyRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> OrderActionResult:
    """Modify a single user's Dhan order."""
    notif = (
        db.query(SignalNotification)
        .options(joinedload(SignalNotification.user), joinedload(SignalNotification.signal))
        .filter(SignalNotification.id == notification_id)
        .one_or_none()
    )
    if notif is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not notif.dhan_order_id:
        raise HTTPException(status_code=400, detail="No Dhan order ID recorded")

    cred_info = await _load_cred_and_token(db, notif)
    if cred_info is None:
        raise HTTPException(status_code=400, detail="No active Dhan credential for this user")
    cred, token = cred_info
    # TRADED means entry filled; exit legs still modifiable.
    entry_pending = notif.live_status in (None, "TRANSIT", "PENDING", "PART_TRADED")
    try:
        if entry_pending:
            await DhanClient.modify_super_order(
                order_id=notif.dhan_order_id,
                dhan_client_id=cred.dhan_client_id,
                access_token=token,
                source_ipv6=notif.user.assigned_ipv6,
                leg_name="ENTRY_LEG",
                price=req.price,
                target_price=req.target_price,
                stop_loss_price=req.stop_loss_price,
                trailing_jump=req.trailing_jump,
            )
        else:
            # Per Dhan spec: TARGET_LEG → only targetPrice; STOP_LOSS_LEG → stopLossPrice/trailingJump
            # Carry forward signal's trailing_jump to avoid silently cancelling the trailing stop.
            made_call = False
            if req.target_price is not None:
                await DhanClient.modify_super_order(
                    order_id=notif.dhan_order_id,
                    dhan_client_id=cred.dhan_client_id,
                    access_token=token,
                    source_ipv6=notif.user.assigned_ipv6,
                    leg_name="TARGET_LEG",
                    target_price=req.target_price,
                )
                made_call = True
            if req.stop_loss_price is not None or req.trailing_jump is not None:
                effective_trailing = req.trailing_jump if req.trailing_jump is not None else (
                    notif.signal.trailing_jump if notif.signal else None
                )
                await DhanClient.modify_super_order(
                    order_id=notif.dhan_order_id,
                    dhan_client_id=cred.dhan_client_id,
                    access_token=token,
                    source_ipv6=notif.user.assigned_ipv6,
                    leg_name="STOP_LOSS_LEG",
                    stop_loss_price=req.stop_loss_price,
                    trailing_jump=effective_trailing,
                )
                made_call = True
            if not made_call:
                return OrderActionResult(
                    notification_id=notif.id, user_id=notif.user_id,
                    user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
                    success=False,
                    reason="Entry is already filled; specify target_price or stop_loss_price/trailing_jump",
                )
        return OrderActionResult(
            notification_id=notif.id, user_id=notif.user_id,
            user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
            success=True, reason=None,
        )
    except DhanApiError as exc:
        return OrderActionResult(
            notification_id=notif.id, user_id=notif.user_id,
            user_email=notif.user.email, dhan_order_id=notif.dhan_order_id,
            success=False, reason=str(exc),
        )


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
    notifications = query.order_by(SignalNotification.signal_id.asc(), SignalNotification.created_at.desc()).all()

    headers = [
        "Notif ID", "Signal ID", "Signal Title", "Security ID", "Exchange",
        "Txn", "Product", "Order Type", "Sig Qty", "Ordered Qty", "Price",
        "Target", "Stop Loss", "User Name", "User Email", "Status",
        "Dhan Order ID", "Live Status", "Exchange Order No",
        "Entry Qty", "Entry Price", "Exit Via", "Exit Price", "Realized PnL",
        "Error Message", "Reason", "Confirmed At (IST)", "Placed At (IST)", "Created At (IST)",
    ]
    rows = []
    # Track which signal group each row belongs to for alternating colours
    seen_signals: list[int] = []
    signal_group_idx: dict[int, int] = {}
    for n in notifications:
        sid = n.signal.id
        if sid not in signal_group_idx:
            signal_group_idx[sid] = len(signal_group_idx)

    row_fills = []
    for n in notifications:
        s = n.signal
        rows.append([
            n.id, s.id, s.title, s.security_id, s.exchange_segment,
            s.transaction_type, s.product_type, s.order_type,
            s.quantity, n.ordered_quantity if n.ordered_quantity is not None else "",
            s.price, s.target_price, s.stop_loss_price,
            n.user.name, n.user.email, n.status,
            n.dhan_order_id or "", n.live_status or "", n.exchange_order_no or "",
            n.traded_qty if n.traded_qty is not None else "", n.traded_price if n.traded_price is not None else "",
            n.exit_leg or "", n.exit_price if n.exit_price is not None else "",
            n.realized_pnl if n.realized_pnl is not None else "",
            n.error_message or "", n.reason_description or "",
            to_ist_str(n.confirmed_at), to_ist_str(n.placed_at), to_ist_str(n.created_at),
        ])
        # Alternate white/grey per signal group so each signal's rows are visually distinct
        fill = _ROW_WHITE if signal_group_idx[s.id] % 2 == 0 else _ROW_GREY
        row_fills.append(fill)

    filename = f"orders_{dt.datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return build_xlsx_response(filename=filename, sheet_title="Orders", headers=headers, rows=rows, row_fills=row_fills)


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

    total_realized_pnl = float(db.query(func.coalesce(func.sum(SignalNotification.realized_pnl), 0.0)).scalar() or 0.0)
    total_unrealized_pnl = float(db.query(func.coalesce(func.sum(UserPosition.unrealized_profit), 0.0)).scalar() or 0.0)

    pending_approvals = db.query(User).filter(User.is_active.is_(False)).count()
    recent_signals = [
        {
            "id": s.id,
            "title": s.title,
            "status": s.status,
            "created_at": s.created_at.isoformat(),
            "total_notified": s.notifications and len(s.notifications) or 0,
            "placed": sum(1 for n in s.notifications if n.status == "placed"),
        }
        for s in db.query(Signal).order_by(Signal.created_at.desc()).limit(5).all()
    ]

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
            "total_realized_pnl": round(total_realized_pnl, 2),
            "total_unrealized_pnl": round(total_unrealized_pnl, 2),
        },
        "pending_approvals": pending_approvals,
        "recent_signals": recent_signals,
    }


# ---------------------------------------------------------------------------
# Order events timeline & P&L tracking
# ---------------------------------------------------------------------------

@router.get("/notifications/{notification_id}/events", response_model=list[OrderEventResponse])
def get_admin_notification_events(
    notification_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[OrderEventResponse]:
    """Return historical audit-log events for any notification (most recent `limit`, oldest first)."""
    notif = db.query(SignalNotification).filter(SignalNotification.id == notification_id).one_or_none()
    if notif is None:
        raise HTTPException(status_code=404, detail="Notification not found")

    events = (
        db.query(OrderEvent)
        .filter(OrderEvent.notification_id == notification_id)
        .order_by(OrderEvent.created_at.desc())
        .limit(limit)
        .all()
    )
    events.reverse()
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


@router.get("/users/pnl", response_model=list[AdminUserPnlRow])
def get_admin_users_pnl(
    search: str | None = Query(default=None, description="Match against name or email"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[AdminUserPnlRow]:
    """Return per-user P&L summary across all closed orders and live positions."""
    query = db.query(User).filter(User.role != "admin")
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(or_(User.name.ilike(like), User.email.ilike(like)))

    users = query.order_by(User.id.asc()).all()
    results: list[AdminUserPnlRow] = []

    for u in users:
        total_orders = (
            db.query(SignalNotification)
            .filter(SignalNotification.user_id == u.id, SignalNotification.status.in_(["placed", "failed"]))
            .count()
        )
        closed_orders = (
            db.query(SignalNotification)
            .filter(SignalNotification.user_id == u.id, SignalNotification.realized_pnl.isnot(None))
            .count()
        )
        win_count = (
            db.query(SignalNotification)
            .filter(SignalNotification.user_id == u.id, SignalNotification.realized_pnl > 0)
            .count()
        )
        loss_count = (
            db.query(SignalNotification)
            .filter(SignalNotification.user_id == u.id, SignalNotification.realized_pnl < 0)
            .count()
        )
        realized_pnl = float(
            db.query(func.coalesce(func.sum(SignalNotification.realized_pnl), 0.0))
            .filter(SignalNotification.user_id == u.id)
            .scalar() or 0.0
        )
        dhan_realized = float(
            db.query(func.coalesce(func.sum(UserPosition.realized_profit), 0.0))
            .filter(UserPosition.user_id == u.id)
            .scalar() or 0.0
        )
        dhan_unrealized = float(
            db.query(func.coalesce(func.sum(UserPosition.unrealized_profit), 0.0))
            .filter(UserPosition.user_id == u.id)
            .scalar() or 0.0
        )

        results.append(
            AdminUserPnlRow(
                user_id=u.id,
                user_name=u.name,
                user_email=u.email,
                assigned_ipv6=u.assigned_ipv6,
                total_orders=total_orders,
                closed_orders=closed_orders,
                win_count=win_count,
                loss_count=loss_count,
                total_realized_pnl=round(realized_pnl, 2),
                dhan_realized_profit=round(dhan_realized, 2),
                dhan_unrealized_profit=round(dhan_unrealized, 2),
            )
        )

    return results


@router.get("/positions", response_model=list[UserPositionResponse])
def list_admin_positions(
    user_id: int | None = Query(default=None, description="Filter by user ID"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[UserPositionResponse]:
    """List open positions across users cached from Dhan."""
    query = db.query(UserPosition).options(joinedload(UserPosition.user))
    if user_id is not None:
        query = query.filter(UserPosition.user_id == user_id)

    positions = query.order_by(UserPosition.updated_at.desc()).all()
    return [
        UserPositionResponse(
            id=p.id,
            user_id=p.user_id,
            user_name=p.user.name if p.user else None,
            user_email=p.user.email if p.user else None,
            trading_symbol=p.trading_symbol,
            security_id=p.security_id,
            position_type=p.position_type,
            exchange_segment=p.exchange_segment,
            product_type=p.product_type,
            buy_avg=p.buy_avg,
            buy_qty=p.buy_qty,
            cost_price=p.cost_price,
            sell_avg=p.sell_avg,
            sell_qty=p.sell_qty,
            net_qty=p.net_qty,
            realized_profit=p.realized_profit,
            unrealized_profit=p.unrealized_profit,
            updated_at=p.updated_at.isoformat(),
        )
        for p in positions
    ]


# ---------------------------------------------------------------------------
# User Groups
# ---------------------------------------------------------------------------

def _to_group_response(group: UserGroup, db: Session) -> GroupResponse:
    count = db.query(UserGroupMember).filter(UserGroupMember.group_id == group.id).count()
    return GroupResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        member_count=count,
        created_by_id=group.created_by_id,
        created_at=group.created_at.isoformat(),
        updated_at=group.updated_at.isoformat(),
    )


@router.get("/groups", response_model=list[GroupResponse])
def list_groups(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[GroupResponse]:
    """List all user groups."""
    groups = db.query(UserGroup).order_by(UserGroup.name.asc()).all()
    return [_to_group_response(g, db) for g in groups]


@router.post("/groups", response_model=GroupResponse, status_code=201)
def create_group(
    req: GroupCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> GroupResponse:
    """Create a new user group."""
    existing = db.query(UserGroup).filter(UserGroup.name == req.name.strip()).one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"A group named '{req.name}' already exists")
    group = UserGroup(
        name=req.name.strip(),
        description=req.description.strip() if req.description else None,
        created_by_id=admin.id,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return _to_group_response(group, db)


@router.get("/groups/{group_id}", response_model=GroupDetailResponse)
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> GroupDetailResponse:
    """Get a group with its full member list."""
    group = db.query(UserGroup).filter(UserGroup.id == group_id).one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    members = (
        db.query(User)
        .join(UserGroupMember, UserGroupMember.user_id == User.id)
        .filter(UserGroupMember.group_id == group_id)
        .order_by(User.name.asc())
        .all()
    )
    return GroupDetailResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        members=[_to_admin_user(u, db) for u in members],
        created_by_id=group.created_by_id,
        created_at=group.created_at.isoformat(),
        updated_at=group.updated_at.isoformat(),
    )


@router.put("/groups/{group_id}", response_model=GroupResponse)
def update_group(
    group_id: int,
    req: GroupUpdateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> GroupResponse:
    """Rename or update the description of a group."""
    group = db.query(UserGroup).filter(UserGroup.id == group_id).one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    if req.name is not None:
        name = req.name.strip()
        clash = db.query(UserGroup).filter(UserGroup.name == name, UserGroup.id != group_id).one_or_none()
        if clash:
            raise HTTPException(status_code=409, detail=f"A group named '{name}' already exists")
        group.name = name
    if req.description is not None:
        group.description = req.description.strip() or None
    group.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(group)
    return _to_group_response(group, db)


@router.delete("/groups/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict[str, str]:
    """Delete a group and all its memberships."""
    group = db.query(UserGroup).filter(UserGroup.id == group_id).one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    db.query(UserGroupMember).filter(UserGroupMember.group_id == group_id).delete(synchronize_session=False)
    db.delete(group)
    db.commit()
    return {"status": "deleted", "group_id": str(group_id)}


@router.post("/groups/{group_id}/members", response_model=GroupResponse)
def add_group_members(
    group_id: int,
    req: GroupAddMembersRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> GroupResponse:
    """Add one or more users to a group (silently skips duplicates)."""
    group = db.query(UserGroup).filter(UserGroup.id == group_id).one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")

    # Validate all user IDs
    users = db.query(User).filter(User.id.in_(req.user_ids)).all()
    if len(users) != len(set(req.user_ids)):
        found_ids = {u.id for u in users}
        missing = [uid for uid in req.user_ids if uid not in found_ids]
        raise HTTPException(status_code=404, detail=f"Users not found: {missing}")

    # Fetch existing members to skip
    existing = {
        m.user_id
        for m in db.query(UserGroupMember).filter(
            UserGroupMember.group_id == group_id,
            UserGroupMember.user_id.in_(req.user_ids),
        ).all()
    }

    for user_id in req.user_ids:
        if user_id not in existing:
            db.add(UserGroupMember(group_id=group_id, user_id=user_id))

    group.updated_at = dt.datetime.utcnow()
    db.commit()
    db.refresh(group)
    return _to_group_response(group, db)


@router.delete("/groups/{group_id}/members/{user_id}")
def remove_group_member(
    group_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> dict[str, str]:
    """Remove a single user from a group."""
    group = db.query(UserGroup).filter(UserGroup.id == group_id).one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    member = (
        db.query(UserGroupMember)
        .filter(UserGroupMember.group_id == group_id, UserGroupMember.user_id == user_id)
        .one_or_none()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="User is not a member of this group")
    db.delete(member)
    group.updated_at = dt.datetime.utcnow()
    db.commit()
    return {"status": "removed", "group_id": str(group_id), "user_id": str(user_id)}
