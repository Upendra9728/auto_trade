from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy.orm import Session

from .crypto import decrypt_token
from .dhan_client import DhanApiError, DhanClient
from .models import DhanCredential, Signal, SignalNotification, User
from .token_refresh import renew_and_save_credential

logger = logging.getLogger(__name__)


async def place_order_for_notification(
    *,
    notification: SignalNotification,
    db: Session,
    quantity_override: int | None = None,
) -> None:
    """
    Execute the Dhan super order for a confirmed notification.

    - Looks up the user's assigned IPv6 address and Dhan credentials.
    - Binds the outbound HTTP request to the user's IPv6 address.
    - Updates notification.status to 'placed' or 'failed'.
    - quantity_override: if set, replaces the signal's quantity for this order.
    """
    signal: Signal = notification.signal
    user: User = notification.user

    if not user.assigned_ipv6:
        notification.status = "failed"
        notification.error_message = "User has no assigned IPv6 address. Contact admin."
        db.commit()
        logger.error("No IPv6 assigned for user %s (notification %s)", user.id, notification.id)
        return

    cred: DhanCredential | None = user.dhan_credential
    if cred is None or not cred.is_active:
        notification.status = "failed"
        notification.error_message = "No active Dhan credential on file."
        db.commit()
        logger.error("No active Dhan credential for user %s (notification %s)", user.id, notification.id)
        return

    # Just-in-time renewal: renew before the token expires so the order
    # is never rejected by Dhan with an auth error.
    now = dt.datetime.utcnow()
    token_age = now - cred.updated_at
    near_expiry = (
        cred.token_expires_at is not None
        and (cred.token_expires_at - now) < dt.timedelta(minutes=30)
    )
    old_enough = (
        cred.token_expires_at is None
        and token_age > dt.timedelta(hours=23, minutes=30)
    )
    if near_expiry or old_enough:
        logger.info(
            "Token for user %s is near expiry (expires=%s, age=%s); attempting renewal",
            user.id, cred.token_expires_at, token_age,
        )
        await renew_and_save_credential(cred, db)

    try:
        access_token = decrypt_token(cred.access_token_encrypted)
    except Exception as exc:
        notification.status = "failed"
        notification.error_message = f"Failed to decrypt access token: {exc}"
        db.commit()
        logger.error("Token decryption failed for user %s: %s", user.id, exc)
        return

    client = DhanClient()
    try:
        result = await client.place_super_order(
            dhan_client_id=cred.dhan_client_id,
            access_token=access_token,
            exchange_segment=signal.exchange_segment,
            security_id=signal.security_id,
            quantity=quantity_override if quantity_override is not None else signal.quantity,
            price=signal.price,
            target_price=signal.target_price,
            stop_loss_price=signal.stop_loss_price,
            transaction_type=signal.transaction_type,
            product_type=signal.product_type,
            order_type=signal.order_type,
            trailing_jump=signal.trailing_jump,
            source_ipv6=user.assigned_ipv6,
        )
        order_id = (
            result.get("orderId")
            or result.get("data", {}).get("orderId")
            or result.get("data", {}).get("order_id")
            or str(result)[:64]
        )
        notification.status = "placed"
        notification.dhan_order_id = order_id
        notification.placed_at = dt.datetime.utcnow()
        notification.ordered_quantity = quantity_override if quantity_override is not None else signal.quantity
        # Deduct one credit for successful order placement
        user.credits = max(0, user.credits - 1)
        db.commit()
        logger.info(
            "Order placed for user %s (notification %s), Dhan order ID: %s",
            user.id, notification.id, order_id,
        )
    except DhanApiError as exc:
        notification.status = "failed"
        notification.error_message = str(exc)
        db.commit()
        logger.error("Dhan API error for user %s (notification %s): %s", user.id, notification.id, exc)
    except Exception as exc:
        notification.status = "failed"
        notification.error_message = f"Unexpected error: {exc}"
        db.commit()
        logger.exception("Unexpected error placing order for user %s: %s", user.id, exc)
