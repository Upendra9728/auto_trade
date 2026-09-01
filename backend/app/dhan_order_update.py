"""
dhan_order_update.py — Background service that tracks the *real* exchange status
of every order via Dhan's Live Order Update WebSocket (wss://api-order-update.dhan.co).

Why this exists
----------------
order_service.py sets SignalNotification.status = "placed" as soon as Dhan's HTTP
super-order API returns an orderId. That only means Dhan *accepted the request* —
the order can still be rejected/cancelled by the exchange afterwards (margin,
market hours, etc.) and we would never find out. This module subscribes to
Dhan's real-time order feed (per user, since each user has their own Dhan
account/token) and updates SignalNotification.live_status with the true
exchange-reported status: TRANSIT | PENDING | REJECTED | CANCELLED | TRADED | EXPIRED.

Design
------
- One persistent WebSocket connection per user with an active Dhan credential.
- A manager loop periodically reconciles the set of users that should have a
  connection against the set that currently do, starting/stopping as needed
  (so newly onboarded/deactivated users are picked up without a restart).
- Each connection auto-reconnects with a backoff delay on any disconnect/error.
- Incoming "order_alert" messages are matched to a SignalNotification by
  dhan_order_id == OrderNo and update the live status fields. If the exchange
  reports a terminal failure (REJECTED/CANCELLED/EXPIRED), the notification's
  workflow status is flipped to "failed" so it is no longer counted as placed.
- Safety net: dhan_order_status_poll_loop() periodically REST-polls any
  'placed' order whose live status hasn't updated recently, in case a user's
  WebSocket connection dropped silently and the reconnect hasn't caught up yet.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging

import websockets
from sqlalchemy import or_, update
from sqlalchemy.orm import Session, joinedload

from .crypto import decrypt_token
from .db import SessionLocal
from .dhan_client import DhanApiError, DhanClient
from .models import DhanCredential, OrderEvent, SignalNotification, User, UserPosition

logger = logging.getLogger(__name__)

DHAN_ORDER_UPDATE_WS_URL = "wss://api-order-update.dhan.co"

# Exchange-reported statuses that mean the order did NOT (and will not) execute.
# NOTE: TRADED is NOT here — entry filled means exit legs are still live at the exchange.
# CLOSED = entry + one exit leg done for full quantity = truly terminal.
TERMINAL_FAILURE_STATUSES = {"REJECTED", "CANCELLED", "EXPIRED"}
# Statuses that mean the order is genuinely live/registered at the exchange.
# TRADED here means the ENTRY leg filled — exit legs (target/SL) are still active.
CONFIRMED_LIVE_STATUSES = {"TRANSIT", "PENDING", "TRADED"}
# CLOSED = entry filled AND one exit leg (target/SL) completed for full quantity.
SUCCESS_TERMINAL_STATUSES = {"CLOSED"}
# Statuses where no further action is possible (used by admin cancel/modify filter).
# TRADED is intentionally excluded — exit legs can still be cancelled/modified after entry fills.
ALL_TERMINAL_STATUSES = {"CLOSED", "EXPIRED", "CANCELLED", "REJECTED"}

LEG_NO_TO_NAME = {1: "ENTRY_LEG", 2: "STOP_LOSS_LEG", 3: "TARGET_LEG"}

# WebSocket manager settings
_RECONCILE_INTERVAL_SECONDS = 10   # how often to start WS tasks for newly eligible users
_RECONNECT_BACKOFF_SECONDS = 5     # wait between reconnect attempts after WS drop


def _coerce_leg_no(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def apply_live_status(
    db: Session,
    notif: SignalNotification,
    *,
    status: str | None,
    leg: str | None = None,
    source: str = "ws",
    exchange_order_no: str | None = None,
    reason_description: str | None = None,
    traded_qty: int | None = None,
    traded_price: float | None = None,
    exit_leg: str | None = None,
    exit_price: float | None = None,
    exit_time: "dt.datetime | None" = None,
) -> bool:
    """
    Apply a live/exchange status update with optimistic locking.
    
    Returns True if update succeeded, False if stale (version conflict).
    Records an OrderEvent and calculates realized PnL, then commits.
    """
    status = (status or "").upper()
    old_version = notif.version
    new_version = old_version + 1
    
    # Prepare the update dict
    update_dict = {
        "version": new_version,
        "live_updated_at": dt.datetime.utcnow(),
    }
    
    if status:
        update_dict["live_status"] = status
    if exchange_order_no:
        update_dict["exchange_order_no"] = exchange_order_no
    if reason_description:
        update_dict["reason_description"] = reason_description
    if traded_qty:
        update_dict["traded_qty"] = traded_qty
    if traded_price:
        update_dict["traded_price"] = traded_price
    if exit_leg:
        update_dict["exit_leg"] = exit_leg
    if exit_price:
        update_dict["exit_price"] = exit_price
    if exit_time:
        update_dict["exit_time"] = exit_time
    
    # Handle terminal failure status -> flip workflow status to "failed"
    workflow_status_update = None
    if status in TERMINAL_FAILURE_STATUSES and notif.status != "failed" and notif.status != "cancelled":
        workflow_status_update = "failed"
        if status == "CANCELLED":
            if traded_qty and traded_qty > 0:
                update_dict["error_message"] = f"Partially filled ({traded_qty} qty) then cancelled — may be a manual exit."
            elif not reason_description or reason_description.upper() == "CONFIRMED":
                update_dict["error_message"] = "Order expired unfilled — auto-cancelled by the exchange (entry price was never hit)."
            else:
                update_dict["error_message"] = f"Cancelled: {reason_description}"
        else:
            update_dict["error_message"] = f"Rejected by exchange: {reason_description or status}"
        update_dict["status"] = workflow_status_update
    
    # Optimistic locking: only update if version matches
    result = db.execute(
        update(SignalNotification)
        .where(SignalNotification.id == notif.id, SignalNotification.version == old_version)
        .values(update_dict)
    )
    
    if result.rowcount == 0:
        logger.warning(
            "Stale update attempt skipped for notification %s (source=%s, status=%s); "
            "WS/polling conflict detected", notif.id, source, status
        )
        db.rollback()
        return False
    
    # Reload the notification to get updated values, then record event
    db.expire(notif)
    notif = db.query(SignalNotification).filter(SignalNotification.id == notif.id).one()
    
    # Determine event type
    if exit_leg == "TARGET_LEG" or (leg == "TARGET_LEG" and status in ("TRADED", "TRIGGERED", "CLOSED")):
        event_type = "TARGET_HIT"
    elif exit_leg == "STOP_LOSS_LEG" or (leg == "STOP_LOSS_LEG" and status in ("TRADED", "TRIGGERED", "CLOSED")):
        event_type = "STOP_LOSS_HIT"
    elif leg == "ENTRY_LEG" and status in ("TRADED", "PART_TRADED"):
        event_type = "ENTRY_TRADED"
    elif status == "REJECTED":
        event_type = "REJECTED"
    elif status == "CANCELLED":
        event_type = "CANCELLED"
    elif status == "EXPIRED":
        event_type = "EXPIRED"
    elif status == "CLOSED":
        event_type = "CLOSED"
    elif status in ("TRANSIT", "PENDING"):
        event_type = "ENTRY_PENDING"
    else:
        event_type = status or "UPDATE"

    # Audit log event — skip if it's an exact repeat of the last recorded event
    # (WS + 5s polling both call this repeatedly while an order sits unchanged,
    # e.g. TRANSIT/PENDING for minutes; without dedup this floods the timeline
    # and can crash the admin app when rendering it).
    last_event = (
        db.query(OrderEvent)
        .filter(OrderEvent.notification_id == notif.id)
        .order_by(OrderEvent.created_at.desc())
        .first()
    )
    is_duplicate = (
        last_event is not None
        and last_event.event_type == event_type
        and last_event.leg == (leg or exit_leg)
        and last_event.status == status
    )
    if not is_duplicate:
        event = OrderEvent(
            notification_id=notif.id,
            source=source,
            event_type=event_type,
            leg=leg or exit_leg,
            status=status,
            price=exit_price or traded_price,
            quantity=traded_qty,
            reason_description=reason_description,
            exchange_order_no=exchange_order_no,
            created_at=dt.datetime.utcnow(),
        )
        db.add(event)

    # Calculate realized P&L when exit leg & price are known, included in the same commit.
    if notif.exit_price and notif.exit_price > 0:
        entry_price = notif.traded_price or (notif.signal.price if notif.signal else None)
        qty = notif.traded_qty or notif.ordered_quantity or (notif.signal.quantity if notif.signal else 1)
        direction = 1.0 if (notif.signal and notif.signal.transaction_type == "BUY") else -1.0
        if entry_price and entry_price > 0:
            realized_pnl = round((notif.exit_price - entry_price) * qty * direction, 2)
            # Merge P&L into the already-in-progress transaction (no extra round-trip)
            db.execute(
                update(SignalNotification)
                .where(SignalNotification.id == notif.id)
                .values({"realized_pnl": realized_pnl})
            )

    if status in SUCCESS_TERMINAL_STATUSES:
        logger.info("Order %s CLOSED (full exit complete, exit leg tracked separately)", notif.dhan_order_id)

    db.commit()
    return True


class DhanOrderUpdateManager:
    """Owns one background asyncio task per user that has an active Dhan credential."""

    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task] = {}

    async def run_forever(self) -> None:
        logger.info("Dhan live order update manager started")
        while True:
            try:
                await self._reconcile()
            except Exception:
                logger.exception("Dhan order update manager: reconcile failed")
            await asyncio.sleep(_RECONCILE_INTERVAL_SECONDS)

    async def _reconcile(self) -> None:
        db: Session = SessionLocal()
        try:
            rows = (
                db.query(User.id)
                .join(DhanCredential, DhanCredential.user_id == User.id)
                .filter(User.is_active.is_(True), DhanCredential.is_active.is_(True))
                .all()
            )
            eligible_ids = {row[0] for row in rows}
        finally:
            db.close()

        for user_id in eligible_ids:
            task = self._tasks.get(user_id)
            if task is None or task.done():
                self._tasks[user_id] = asyncio.create_task(self._user_connection_loop(user_id))

        for user_id in list(self._tasks.keys()):
            if user_id not in eligible_ids:
                self._tasks.pop(user_id).cancel()
                logger.info("Dhan order update: stopped connection for user %s (no longer eligible)", user_id)

    async def _user_connection_loop(self, user_id: int) -> None:
        """Maintain a reconnecting WebSocket connection for a single user."""
        while True:
            cred_info = self._load_credential(user_id)
            if cred_info is None:
                return  # user no longer eligible; _reconcile() will not restart us
            dhan_client_id, access_token = cred_info

            try:
                await self._connect_and_listen(user_id, dhan_client_id, access_token)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Dhan order update WS for user %s disconnected: %s", user_id, exc)

            await asyncio.sleep(_RECONNECT_BACKOFF_SECONDS)

    @staticmethod
    def _load_credential(user_id: int) -> tuple[str, str] | None:
        db: Session = SessionLocal()
        try:
            cred = (
                db.query(DhanCredential)
                .filter(DhanCredential.user_id == user_id, DhanCredential.is_active.is_(True))
                .one_or_none()
            )
            if cred is None:
                return None
            return cred.dhan_client_id, decrypt_token(cred.access_token_encrypted)
        except Exception:
            logger.exception("Dhan order update: failed to load credential for user %s", user_id)
            return None
        finally:
            db.close()

    async def _connect_and_listen(self, user_id: int, dhan_client_id: str, access_token: str) -> None:
        async with websockets.connect(DHAN_ORDER_UPDATE_WS_URL, ping_interval=20, ping_timeout=20) as ws:
            auth_msg = {
                "LoginReq": {
                    "MsgCode": 42,
                    "ClientId": dhan_client_id,
                    "Token": access_token,
                },
                "UserType": "SELF",
            }
            await ws.send(json.dumps(auth_msg))
            logger.info("Dhan order update WS connected for user %s (client %s)", user_id, dhan_client_id)

            async for raw_message in ws:
                try:
                    self._handle_message(raw_message)
                except Exception:
                    logger.exception("Dhan order update: failed to process message for user %s", user_id)

    @staticmethod
    def _handle_message(raw_message: str | bytes) -> None:
        try:
            message = json.loads(raw_message)
        except (json.JSONDecodeError, TypeError):
            return
        if not isinstance(message, dict) or message.get("Type") != "order_alert":
            return

        data = message.get("Data") or {}
        order_no = data.get("OrderNo")
        if not order_no:
            return

        db: Session = SessionLocal()
        try:
            notif = (
                db.query(SignalNotification)
                .options(joinedload(SignalNotification.signal))
                .filter(SignalNotification.dhan_order_id == str(order_no))
                .one_or_none()
            )
            if notif is None:
                return

            status = str(data.get("Status") or "").upper()
            # WS payload identifies the leg via LegNo (int); LegName does not exist here.
            leg_name = LEG_NO_TO_NAME.get(_coerce_leg_no(data.get("LegNo")), "")

            # Capture entry fill — use AvgTradedPrice for consistent P&L cost basis
            entry_traded_price: float | None = None
            entry_traded_qty: int | None = None
            if leg_name == "ENTRY_LEG" and status in ("TRADED", "PART_TRADED"):
                entry_traded_price = data.get("AvgTradedPrice") or data.get("TradedPrice")
                entry_traded_qty = data.get("TradedQty")

            # Capture exit leg details when TARGET or STOP_LOSS leg is filled.
            # Per Dhan WS docs Status can be TRADED only (not TRIGGERED/CLOSED — those are REST-only).
            exit_leg: str | None = None
            exit_price: float | None = None
            exit_time: dt.datetime | None = None
            if leg_name in ("TARGET_LEG", "STOP_LOSS_LEG") and status == "TRADED":
                exit_leg = leg_name
                exit_price = data.get("AvgTradedPrice") or data.get("TradedPrice")
                exit_time = dt.datetime.utcnow()

            apply_live_status(
                db, notif,
                status=status,
                leg=leg_name,
                source="ws",
                exchange_order_no=data.get("ExchOrderNo"),
                reason_description=data.get("ReasonDescription"),
                traded_qty=entry_traded_qty or data.get("TradedQty"),
                traded_price=entry_traded_price or data.get("AvgTradedPrice") or data.get("TradedPrice"),
                exit_leg=exit_leg,
                exit_price=exit_price,
                exit_time=exit_time,
            )
            logger.info("Live order update: order %s leg=%s -> %s (notification %s)", order_no, leg_name or "MAIN", status, notif.id)
        finally:
            db.close()


_manager = DhanOrderUpdateManager()


async def dhan_order_update_loop() -> None:
    """Entry point to run as a background asyncio task from main.py."""
    await _manager.run_forever()


# ---------------------------------------------------------------------------
# REST poll fallback — catches orders whose WebSocket update never arrived
# (e.g. the per-user connection silently dropped for a while).
# ---------------------------------------------------------------------------

_POLL_INTERVAL_SECONDS = 5
_STALE_THRESHOLD = dt.timedelta(seconds=30)
_MIN_AGE_BEFORE_POLL = dt.timedelta(seconds=5)  # give the WS a head start
_MAX_AGE_TO_POLL = dt.timedelta(hours=24)  # Dhan's order-status API only knows about the current trading day
_REQUEST_DELAY_SECONDS = 0.3  # throttle so bursts of stale orders don't trip Dhan's rate limit (DH-904)
_AUTH_FAILURE_COOLDOWN = dt.timedelta(minutes=15)  # stop retrying a user whose token is known-bad (DH-901)

# user_id -> UTC time until which we skip polling (set after an auth failure for that user)
_auth_cooldown_until: dict[int, dt.datetime] = {}


async def dhan_order_status_poll_loop() -> None:
    """Entry point to run as a background asyncio task from main.py."""
    logger.info("Dhan order status poll fallback started (interval=%ds)", _POLL_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(_POLL_INTERVAL_SECONDS)
        try:
            await _poll_stale_orders()
        except Exception:
            logger.exception("Dhan order status poll: iteration failed")


async def _poll_stale_orders() -> None:
    now = dt.datetime.utcnow()
    db: Session = SessionLocal()
    try:
        stale = (
            db.query(SignalNotification)
            .options(
                joinedload(SignalNotification.signal),
                joinedload(SignalNotification.user).joinedload(User.dhan_credential),
            )
            .filter(
                SignalNotification.status == "placed",
                SignalNotification.dhan_order_id.isnot(None),
                SignalNotification.placed_at.isnot(None),
                SignalNotification.placed_at <= now - _MIN_AGE_BEFORE_POLL,
                SignalNotification.placed_at >= now - _MAX_AGE_TO_POLL,
                or_(
                    SignalNotification.live_updated_at.is_(None),
                    SignalNotification.live_updated_at <= now - _STALE_THRESHOLD,
                ),
            )
            .all()
        )
        for notif in stale:
            cooldown_until = _auth_cooldown_until.get(notif.user_id)
            if cooldown_until and cooldown_until > now:
                continue
            await _poll_one(db, notif)
            await asyncio.sleep(_REQUEST_DELAY_SECONDS)
    finally:
        db.close()


async def _poll_one(db: Session, notif: SignalNotification) -> None:
    user = notif.user
    cred = user.dhan_credential if user else None
    if cred is None or not cred.is_active:
        return
    try:
        access_token = decrypt_token(cred.access_token_encrypted)
        orders = await DhanClient.get_super_orders(
            access_token=access_token,
            source_ipv6=user.assigned_ipv6,
        )
        item = _extract_super_order_item(orders, notif.dhan_order_id)
        if item is None:
            return

        exit_leg: str | None = None
        exit_price: float | None = None
        exit_time: dt.datetime | None = None
        for leg in item.get("legDetails") or []:
            leg_name = leg.get("legName")
            leg_status = leg.get("orderStatus")
            if leg_name in ("TARGET_LEG", "STOP_LOSS_LEG") and leg_status in ("TRADED", "TRIGGERED", "CLOSED"):
                exit_leg = leg_name
                # REST legDetails has no execution price field; use averageTradedPrice if
                # available, fall back to the leg's limit price (best effort from poll).
                exit_price = leg.get("averageTradedPrice") or leg.get("price")
                exit_time = dt.datetime.utcnow()
                break

        success = apply_live_status(
            db, notif,
            status=item.get("orderStatus"),
            leg=item.get("legName"),
            source="poll",
            exchange_order_no=item.get("exchangeOrderId"),
            reason_description=item.get("omsErrorDescription"),
            traded_qty=item.get("filledQty"),
            traded_price=item.get("averageTradedPrice"),
            exit_leg=exit_leg,
            exit_price=exit_price,
            exit_time=exit_time,
        )
        if success:
            logger.info("Order status poll: order %s -> %s (notification %s)", notif.dhan_order_id, item.get("orderStatus"), notif.id)
    except DhanApiError as exc:
        if "DH-901" in str(exc):
            _auth_cooldown_until[notif.user_id] = dt.datetime.utcnow() + _AUTH_FAILURE_COOLDOWN
            logger.warning(
                "Order status poll: user %s has an invalid/expired Dhan token; pausing polls for %s",
                notif.user_id, _AUTH_FAILURE_COOLDOWN,
            )
        else:
            logger.warning("Order status poll failed for notification %s: %s", notif.id, exc)
    except Exception:
        logger.exception("Order status poll: unexpected error for notification %s", notif.id)


def _extract_super_order_item(orders: list[dict], order_id: str) -> dict | None:
    for item in orders:
        if isinstance(item, dict) and str(item.get("orderId")) == str(order_id):
            return item
    return None


# ---------------------------------------------------------------------------
# Positions poller — fetches open positions & P&L from Dhan's GET /v2/positions
# ---------------------------------------------------------------------------

_POSITIONS_POLL_INTERVAL_SECONDS = 60


async def dhan_positions_poll_loop() -> None:
    """Entry point to run as a background asyncio task from main.py."""
    logger.info("Dhan positions poll loop started (interval=%ds)", _POSITIONS_POLL_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(_POSITIONS_POLL_INTERVAL_SECONDS)
        try:
            await _poll_all_user_positions()
        except Exception:
            logger.exception("Dhan positions poll: iteration failed")


async def _poll_all_user_positions() -> None:
    now = dt.datetime.utcnow()
    db: Session = SessionLocal()
    try:
        users = (
            db.query(User)
            .join(DhanCredential, DhanCredential.user_id == User.id)
            .filter(User.is_active.is_(True), DhanCredential.is_active.is_(True))
            .all()
        )
    finally:
        db.close()

    eligible = [
        u for u in users
        if not (_auth_cooldown_until.get(u.id) and _auth_cooldown_until[u.id] > now)
    ]

    # Run all users in parallel with a semaphore cap to avoid rate-limiting Dhan
    sem = asyncio.Semaphore(20)

    async def _run_one(u: User) -> None:
        async with sem:
            db2: Session = SessionLocal()
            try:
                await _poll_one_user_positions(db2, u)
            finally:
                db2.close()

    await asyncio.gather(*[_run_one(u) for u in eligible], return_exceptions=True)


async def _poll_one_user_positions(db: Session, user: User) -> None:
    cred = user.dhan_credential
    if cred is None or not cred.is_active:
        return
    try:
        access_token = decrypt_token(cred.access_token_encrypted)
        positions = await DhanClient.get_positions(
            access_token=access_token,
            source_ipv6=user.assigned_ipv6,
        )
        if not isinstance(positions, list):
            return

        seen_keys: set[tuple[str, str, str]] = set()
        for p in positions:
            if not isinstance(p, dict):
                continue
            sec_id = str(p.get("securityId") or "")
            segment = str(p.get("exchangeSegment") or "")
            prod_type = str(p.get("productType") or "")
            if not sec_id:
                continue
            seen_keys.add((sec_id, segment, prod_type))

            pos_row = (
                db.query(UserPosition)
                .filter(
                    UserPosition.user_id == user.id,
                    UserPosition.security_id == sec_id,
                    UserPosition.exchange_segment == segment,
                    UserPosition.product_type == prod_type,
                )
                .one_or_none()
            )
            if pos_row is None:
                pos_row = UserPosition(
                    user_id=user.id,
                    security_id=sec_id,
                    exchange_segment=segment,
                    product_type=prod_type,
                    trading_symbol=str(p.get("tradingSymbol") or sec_id),
                )
                db.add(pos_row)

            pos_row.trading_symbol = str(p.get("tradingSymbol") or pos_row.trading_symbol or sec_id)
            pos_row.position_type = str(p.get("positionType") or "CLOSED")
            pos_row.buy_avg = float(p.get("buyAvg") or 0.0)
            pos_row.buy_qty = int(p.get("buyQty") or 0)
            pos_row.cost_price = float(p.get("costPrice") or 0.0)
            pos_row.sell_avg = float(p.get("sellAvg") or 0.0)
            pos_row.sell_qty = int(p.get("sellQty") or 0)
            pos_row.net_qty = int(p.get("netQty") or 0)
            pos_row.realized_profit = float(p.get("realizedProfit") or 0.0)
            pos_row.unrealized_profit = float(p.get("unrealizedProfit") or 0.0)
            pos_row.rbi_reference_rate = float(p.get("rbiReferenceRate") or 1.0)
            pos_row.multiplier = int(p.get("multiplier") or 1)
            pos_row.updated_at = dt.datetime.utcnow()

        db.commit()
    except DhanApiError as exc:
        if "DH-901" in str(exc):
            _auth_cooldown_until[user.id] = dt.datetime.utcnow() + _AUTH_FAILURE_COOLDOWN
        else:
            logger.warning("Positions poll failed for user %s: %s", user.id, exc)
    except Exception:
        logger.exception("Positions poll: unexpected error for user %s", user.id)
