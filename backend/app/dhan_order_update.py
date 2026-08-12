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
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from .crypto import decrypt_token
from .db import SessionLocal
from .dhan_client import DhanApiError, DhanClient
from .models import DhanCredential, SignalNotification, User

logger = logging.getLogger(__name__)

DHAN_ORDER_UPDATE_WS_URL = "wss://api-order-update.dhan.co"

# Exchange-reported statuses that mean the order did NOT (and will not) execute.
TERMINAL_FAILURE_STATUSES = {"REJECTED", "CANCELLED", "EXPIRED"}
# Statuses that mean the order is genuinely live/registered at the exchange.
CONFIRMED_LIVE_STATUSES = {"TRANSIT", "PENDING", "TRADED"}

_RECONCILE_INTERVAL_SECONDS = 300  # re-check which users need a connection
_RECONNECT_BACKOFF_SECONDS = 15


def apply_live_status(
    db: Session,
    notif: SignalNotification,
    *,
    status: str | None,
    exchange_order_no: str | None = None,
    reason_description: str | None = None,
    traded_qty: int | None = None,
    traded_price: float | None = None,
) -> None:
    """Apply a live/exchange status update to a notification and commit. Shared
    by both the WebSocket handler and the REST poll fallback."""
    status = (status or "").upper()
    if status:
        notif.live_status = status
    if exchange_order_no:
        notif.exchange_order_no = exchange_order_no
    if reason_description:
        notif.reason_description = reason_description
    if traded_qty:
        notif.traded_qty = traded_qty
    if traded_price:
        notif.traded_price = traded_price
    notif.live_updated_at = dt.datetime.utcnow()

    # The exchange truly rejected/cancelled/expired the order — this overrides
    # the earlier "placed" status set right after HTTP acceptance.
    if status in TERMINAL_FAILURE_STATUSES and notif.status != "failed":
        notif.status = "failed"
        # Dhan reports "CONFIRMED" (or leaves the field blank) as the reason for
        # CANCELLED orders that simply never got filled and were auto square-off
        # cancelled — that's a normal market outcome, not a real rejection reason.
        if status == "CANCELLED" and (not reason_description or reason_description.upper() == "CONFIRMED"):
            notif.error_message = "Order expired unfilled — auto-cancelled by the exchange (entry price was never hit)."
        else:
            notif.error_message = f"Rejected by exchange: {reason_description or status}"

    db.commit()


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
                .filter(SignalNotification.dhan_order_id == str(order_no))
                .one_or_none()
            )
            if notif is None:
                return

            status = str(data.get("Status") or "").upper()
            apply_live_status(
                db, notif,
                status=status,
                exchange_order_no=data.get("ExchOrderNo"),
                reason_description=data.get("ReasonDescription"),
                traded_qty=data.get("TradedQty"),
                traded_price=data.get("TradedPrice") or data.get("AvgTradedPrice"),
            )
            logger.info("Live order update: order %s -> %s (notification %s)", order_no, status, notif.id)
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

_POLL_INTERVAL_SECONDS = 30
_STALE_THRESHOLD = dt.timedelta(minutes=2)
_MIN_AGE_BEFORE_POLL = dt.timedelta(seconds=20)  # give the WS a head start
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
            .options(joinedload(SignalNotification.user).joinedload(User.dhan_credential))
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
        data = await DhanClient.get_order_status(
            access_token=access_token,
            order_id=notif.dhan_order_id,
            source_ipv6=user.assigned_ipv6,
        )
        item = _extract_order_item(data, notif.dhan_order_id)
        if item is None:
            return
        status = item.get("orderStatus") or item.get("Status")
        apply_live_status(
            db, notif,
            status=status,
            exchange_order_no=item.get("exchangeOrderId") or item.get("ExchOrderNo"),
            reason_description=item.get("omsErrorDescription") or item.get("ReasonDescription"),
            traded_qty=item.get("filledQty") or item.get("TradedQty"),
            traded_price=item.get("averageTradedPrice") or item.get("AvgTradedPrice") or item.get("TradedPrice"),
        )
        logger.info("Order status poll: order %s -> %s (notification %s)", notif.dhan_order_id, status, notif.id)
    except DhanApiError as exc:
        if "DH-901" in str(exc):
            # Known-bad/expired token — retrying every cycle just burns Dhan's rate
            # limit for no benefit until the user pastes a fresh token. Back off.
            _auth_cooldown_until[notif.user_id] = dt.datetime.utcnow() + _AUTH_FAILURE_COOLDOWN
            logger.warning(
                "Order status poll: user %s has an invalid/expired Dhan token; pausing polls for %s",
                notif.user_id, _AUTH_FAILURE_COOLDOWN,
            )
        else:
            logger.warning("Order status poll failed for notification %s: %s", notif.id, exc)
    except Exception:
        logger.exception("Order status poll: unexpected error for notification %s", notif.id)


def _extract_order_item(data: object, order_id: str) -> dict | None:
    """Dhan's GET /v2/orders/{id} can return a single object or a list of legs
    (for super orders); normalize to the entry matching our order_id."""
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and str(item.get("orderId")) == str(order_id):
                return item
        return data[0] if data and isinstance(data[0], dict) else None
    if isinstance(data, dict):
        return data
    return None
