from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from .crypto import decrypt_token
from .dhan_client import DhanApiError, DhanClient
from .models import ClientToken, OrderBatch, OrderResult
from .schemas import GttPlaceRequest
from .telegram_parser import ParsedOrder
from .upstox_client import UpstoxApiError, UpstoxClient

logger = logging.getLogger(__name__)


def _find_rule_price(gtt_request: GttPlaceRequest, strategy: str) -> float | None:
    for rule in gtt_request.rules:
        if rule.strategy == strategy:
            return rule.trigger_price
    return None


async def place_orders_for_parsed(
    *,
    db: Session,
    parsed: ParsedOrder,
    raw_text: str,
    source: str = "telegram",
    telegram_chat_id: str | None = None,
    telegram_message_id: str | None = None,
) -> OrderBatch:
    batch = OrderBatch(
        source=source,
        raw_text=raw_text,
        parsed_payload_json=json.dumps({
            "broker": parsed.broker,
            "order_subtype": parsed.order_subtype,
            "price": parsed.price,
            "stoploss": parsed.stoploss,
            "target": parsed.target,
            "quantity": parsed.quantity,
            "instrument_token": parsed.instrument_token,
            "security_id": parsed.security_id,
        }),
        telegram_chat_id=telegram_chat_id,
        telegram_message_id=telegram_message_id,
    )
    db.add(batch)
    db.flush()

    if parsed.broker == "upstox":
        await _place_upstox_gtt_batch(db=db, batch=batch, parsed=parsed)
    elif parsed.broker == "dhann":
        await _place_dhan_bo_batch(db=db, batch=batch, parsed=parsed)
    elif parsed.broker == "fyers":
        await _place_fyers_dummy_batch(db=db, batch=batch, parsed=parsed)
    else:
        logger.warning("Unknown broker '%s', skipping order placement", parsed.broker)

    db.commit()
    db.refresh(batch)
    return batch


async def _place_upstox_gtt_batch(
    *,
    db: Session,
    batch: OrderBatch,
    parsed: ParsedOrder,
) -> None:
    if parsed.gtt_request is None:
        res = OrderResult(
            batch_id=batch.id,
            client_id="(system)",
            status="error",
            error_message="Upstox GTT payload could not be built from message",
        )
        db.add(res)
        return

    tokens = (
        db.query(ClientToken)
        .filter(ClientToken.broker == "upstox", ClientToken.consent.is_(True))
        .order_by(ClientToken.client_id.asc())
        .all()
    )

    client = UpstoxClient()
    payload = json.loads(parsed.gtt_request.model_dump_json())
    target_price = _find_rule_price(parsed.gtt_request, "TARGET")

    for t in tokens:
        try:
            access_token = decrypt_token(t.access_token_encrypted)
            order_ids = await client.place_gtt_order(access_token=access_token, payload=payload)

            auto_cancel_message: str | None = None
            if target_price is not None:
                try:
                    ltp = await client.get_ltp(
                        access_token=access_token,
                        instrument_token=payload["instrument_token"],
                    )
                    entry_price = _find_rule_price(parsed.gtt_request, "ENTRY")
                    if _should_auto_cancel(parsed.gtt_request.transaction_type, ltp, target_price):
                        for oid in order_ids:
                            await client.cancel_gtt_order(access_token=access_token, gtt_order_id=oid)
                        auto_cancel_message = "Auto-cancelled: target hit before entry"
                        logger.warning(
                            "%s | client=%s ltp=%s target=%s entry=%s",
                            auto_cancel_message, t.client_id, ltp, target_price, entry_price,
                        )
                except UpstoxApiError as exc:
                    logger.warning("Auto-cancel check failed | client=%s error=%s", t.client_id, exc)

            if auto_cancel_message:
                res = OrderResult(
                    batch_id=batch.id,
                    client_id=t.client_id,
                    status="error",
                    gtt_order_ids=json.dumps(order_ids),
                    error_message=auto_cancel_message,
                )
            else:
                res = OrderResult(
                    batch_id=batch.id,
                    client_id=t.client_id,
                    status="success",
                    gtt_order_ids=json.dumps(order_ids),
                )
        except (UpstoxApiError, Exception) as exc:
            res = OrderResult(
                batch_id=batch.id,
                client_id=t.client_id,
                status="error",
                error_message=str(exc),
            )
        db.add(res)


async def _place_dhan_bo_batch(
    *,
    db: Session,
    batch: OrderBatch,
    parsed: ParsedOrder,
) -> None:
    tokens = (
        db.query(ClientToken)
        .filter(ClientToken.broker == "dhann", ClientToken.consent.is_(True))
        .order_by(ClientToken.client_id.asc())
        .all()
    )

    client = DhanClient()

    for t in tokens:
        try:
            access_token = decrypt_token(t.access_token_encrypted)
            await client.place_super_order(
                dhan_client_id=t.client_id,
                access_token=access_token,
                exchange_segment=parsed.exchange_segment,
                security_id=parsed.security_id,
                quantity=parsed.quantity,
                price=parsed.price,
                target_price=parsed.adjusted_target,
                stop_loss_price=parsed.adjusted_stoploss,
            )
            res = OrderResult(
                batch_id=batch.id,
                client_id=t.client_id,
                status="success",
                gtt_order_ids=json.dumps([]),
            )
        except (DhanApiError, Exception) as exc:
            res = OrderResult(
                batch_id=batch.id,
                client_id=t.client_id,
                status="error",
                error_message=str(exc),
            )
        db.add(res)


async def _place_fyers_dummy_batch(
    *,
    db: Session,
    batch: OrderBatch,
    parsed: ParsedOrder,
) -> None:
    tokens = (
        db.query(ClientToken)
        .filter(ClientToken.broker == "fyers", ClientToken.consent.is_(True))
        .order_by(ClientToken.client_id.asc())
        .all()
    )

    for t in tokens:
        res = OrderResult(
            batch_id=batch.id,
            client_id=t.client_id,
            status="error",
            error_message="Fyers BO order placement is not yet implemented",
        )
        db.add(res)


def _should_auto_cancel(signal_type: str, ltp: float, target: float) -> bool:
    if signal_type.upper() == "SELL":
        return ltp <= target
    return ltp >= target


# Legacy helper kept for the /api/gtt/place-batch endpoint
async def place_gtt_for_all_clients(
    *,
    db: Session,
    gtt_request: GttPlaceRequest,
    raw_text: str,
    source: str = "telegram",
    telegram_chat_id: str | None = None,
    telegram_message_id: str | None = None,
) -> OrderBatch:
    from .telegram_parser import ParsedOrder as PO
    parsed = PO(
        broker="upstox",
        order_subtype="gtt",
        quantity=gtt_request.quantity,
        price=_find_rule_price(gtt_request, "ENTRY") or 0.0,
        stoploss=_find_rule_price(gtt_request, "STOPLOSS") or 0.0,
        target=_find_rule_price(gtt_request, "TARGET") or 0.0,
        adjusted_stoploss=_find_rule_price(gtt_request, "STOPLOSS") or 0.0,
        adjusted_target=_find_rule_price(gtt_request, "TARGET") or 0.0,
        instrument_token=gtt_request.instrument_token,
        security_id="",
        exchange_segment="",
        tradingsymbol="",
        gtt_request=gtt_request,
    )
    return await place_orders_for_parsed(
        db=db,
        parsed=parsed,
        raw_text=raw_text,
        source=source,
        telegram_chat_id=telegram_chat_id,
        telegram_message_id=telegram_message_id,
    )
