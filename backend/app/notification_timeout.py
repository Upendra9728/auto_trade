"""
notification_timeout.py — Background loop that auto-times-out signal notifications
a user never acted on within NOTIFICATION_CONFIRM_TIMEOUT_SECONDS of receiving them.

confirm_deadline is set on each SignalNotification at creation time (see
routers/admin.py). This loop periodically flips any still-'pending' notification
past its deadline to 'timed_out', so it stops being confirmable and the mobile
app can reflect the terminal state without waiting for a confirm attempt.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging

from sqlalchemy import update

from .db import SessionLocal
from .models import SignalNotification

logger = logging.getLogger(__name__)

_SWEEP_INTERVAL_SECONDS = 15


async def notification_timeout_sweep_loop() -> None:
    """Infinite asyncio loop; designed to run as a background task via asyncio.create_task."""
    logger.info("Notification timeout sweep loop started (interval=%ds)", _SWEEP_INTERVAL_SECONDS)
    while True:
        db = SessionLocal()
        try:
            result = db.execute(
                update(SignalNotification)
                .where(
                    SignalNotification.status == "pending",
                    SignalNotification.confirm_deadline.isnot(None),
                    SignalNotification.confirm_deadline <= dt.datetime.utcnow(),
                )
                .values(status="timed_out")
            )
            db.commit()
            if result.rowcount:
                logger.info("Notification timeout sweep: marked %d notification(s) as timed_out", result.rowcount)
        except Exception:
            logger.exception("Notification timeout sweep failed")
            db.rollback()
        finally:
            db.close()
        await asyncio.sleep(_SWEEP_INTERVAL_SECONDS)
