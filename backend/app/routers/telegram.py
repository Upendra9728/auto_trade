from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..deps import get_db
from ..models import User
from ..schemas import SignalCreateRequest, TelegramIngestRequest
from ..scrip_lookup import search as scrip_search
from ..scrip_lookup import search_nearest_expiry as scrip_search_nearest_expiry
from ..signal_parser import parse_signal_message
from .admin import _create_and_broadcast_signal

router = APIRouter(prefix="/api/telegram", tags=["telegram"])
logger = logging.getLogger(__name__)


def _verify_internal_secret(x_internal_secret: str | None = Header(default=None)) -> None:
    if not settings.internal_secret or x_internal_secret != settings.internal_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")


def _format_strike(strike: float) -> str:
    return str(int(strike)) if strike.is_integer() else str(strike)


@router.post("/ingest")
def ingest_telegram_message(
    req: TelegramIngestRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: None = Depends(_verify_internal_secret),
) -> dict:
    """
    Called by the standalone Telegram bot process for every message posted in the
    configured admin group. Only messages matching the expected signal format create a
    Signal — everything else is silently ignored (the bot never replies in the group).
    """
    parsed = parse_signal_message(req.raw_text)
    if parsed is None:
        return {"created": False, "reason": "Message did not match the expected signal format"}

    exchange = "BSE" if parsed.symbol in ("SENSEX", "BANKEX") else "NSE"
    if parsed.expiry:
        matches = scrip_search(
            symbol=parsed.symbol, strike=parsed.strike, option_type=parsed.option_type,
            expiry_date=parsed.expiry, exchange=exchange,
        )
    else:
        matches = scrip_search_nearest_expiry(
            symbol=parsed.symbol, strike=parsed.strike, option_type=parsed.option_type, exchange=exchange,
        )
    if not matches:
        return {
            "created": False,
            "reason": f"No matching instrument for {parsed.symbol} {_format_strike(parsed.strike)}{parsed.option_type}",
        }
    match = matches[0]

    if not settings.telegram_signal_admin_email:
        raise HTTPException(status_code=500, detail="telegram_signal_admin_email is not configured")
    admin_user = (
        db.query(User)
        .filter(User.email == settings.telegram_signal_admin_email.strip().lower(), User.role == "admin")
        .one_or_none()
    )
    if admin_user is None:
        raise HTTPException(
            status_code=500,
            detail="Configured telegram_signal_admin_email does not match an existing admin user",
        )

    title = f"{parsed.symbol} {_format_strike(parsed.strike)}{parsed.option_type} {match['expiry_date']}"
    create_req = SignalCreateRequest(
        title=title,
        exchange_segment=match["exchange_segment"],
        security_id=match["security_id"],
        transaction_type="BUY",
        product_type="INTRADAY",
        order_type="LIMIT",
        quantity=parsed.quantity or match["lot_size"],
        price=parsed.price,
        target_price=parsed.target_price,
        stop_loss_price=parsed.stop_loss_price,
        trailing_jump=0,
    )
    signal = _create_and_broadcast_signal(db, background_tasks, created_by_id=admin_user.id, req=create_req)
    logger.info("Telegram ingest created signal %s (%s)", signal.id, title)
    return {"created": True, "signal_id": signal.id, "title": title}
