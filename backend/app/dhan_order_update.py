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
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging

import websockets
from sqlalchemy.orm import Session

from .crypto import decrypt_token
from .db import SessionLocal
from .models import DhanCredential, SignalNotification, User

logger = logging.getLogger(__name__)

DHAN_ORDER_UPDATE_WS_URL = "wss://api-order-update.dhan.co"

# Exchange-reported statuses that mean the order did NOT (and will not) execute.
TERMINAL_FAILURE_STATUSES = {"REJECTED", "CANCELLED", "EXPIRED"}
# Statuses that mean the order is genuinely live/registered at the exchange.
CONFIRMED_LIVE_STATUSES = {"TRANSIT", "PENDING", "TRADED"}

_RECONCILE_INTERVAL_SECONDS = 300  # re-check which users need a connection
_RECONNECT_BACKOFF_SECONDS = 15


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
        status = str(data.get("Status") or "").upper()

        db: Session = SessionLocal()
        try:
            notif = (
                db.query(SignalNotification)
                .filter(SignalNotification.dhan_order_id == str(order_no))
                .one_or_none()
            )
            if notif is None:
                return

            notif.live_status = status or notif.live_status
            notif.exchange_order_no = data.get("ExchOrderNo") or notif.exchange_order_no
            notif.reason_description = data.get("ReasonDescription") or notif.reason_description
            traded_qty = data.get("TradedQty")
            if traded_qty:
                notif.traded_qty = traded_qty
            traded_price = data.get("TradedPrice") or data.get("AvgTradedPrice")
            if traded_price:
                notif.traded_price = traded_price
            notif.live_updated_at = dt.datetime.utcnow()

            # The exchange truly rejected/cancelled/expired the order — this
            # overrides the earlier "placed" status set right after HTTP acceptance.
            if status in TERMINAL_FAILURE_STATUSES and notif.status != "failed":
                notif.status = "failed"
                notif.error_message = f"Rejected by exchange: {data.get('ReasonDescription') or status}"

            db.commit()
            logger.info("Live order update: order %s -> %s (notification %s)", order_no, status, notif.id)
        finally:
            db.close()


_manager = DhanOrderUpdateManager()


async def dhan_order_update_loop() -> None:
    """Entry point to run as a background asyncio task from main.py."""
    await _manager.run_forever()
