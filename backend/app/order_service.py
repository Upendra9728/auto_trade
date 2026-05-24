from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from .crypto import decrypt_token
from .models import ClientToken, OrderBatch, OrderResult
from .schemas import GttPlaceRequest
from .upstox_client import UpstoxApiError, UpstoxClient

logger = logging.getLogger(__name__)


def _find_rule_price(gtt_request: GttPlaceRequest, strategy: str) -> float | None:
    for rule in gtt_request.rules:
        if rule.strategy == strategy:
            return rule.trigger_price
    return None


def _should_auto_cancel(signal_type: str, ltp: float, target: float) -> bool:
    if signal_type.upper() == "SELL":
        return ltp <= target
    return ltp >= target


async def place_gtt_for_all_clients(
    *,
    db: Session,
    gtt_request: GttPlaceRequest,
    raw_text: str,
    source: str = "telegram",
    telegram_chat_id: str | None = None,
    telegram_message_id: str | None = None,
) -> OrderBatch:
    batch = OrderBatch(
        source=source,
        raw_text=raw_text,
        parsed_payload_json=gtt_request.model_dump_json(),
        telegram_chat_id=telegram_chat_id,
        telegram_message_id=telegram_message_id,
    )
    db.add(batch)
    db.flush()  # assigns batch.id

    tokens = (
        db.query(ClientToken)
        .filter(ClientToken.consent.is_(True))
        .order_by(ClientToken.client_id.asc())
        .all()
    )

    client = UpstoxClient()

    payload = json.loads(gtt_request.model_dump_json())
    signal_type = gtt_request.transaction_type
    entry_price = _find_rule_price(gtt_request, "ENTRY")
    target_price = _find_rule_price(gtt_request, "TARGET")

    for t in tokens:
        try:
            access_token = decrypt_token(t.access_token_encrypted)
            order_ids = await client.place_gtt_order(access_token=access_token, payload=payload)

            auto_cancel_message: str | None = None
            if target_price is not None:
                try:
                    ltp = await client.get_ltp(access_token=access_token, instrument_token=payload["instrument_token"])
                    if _should_auto_cancel(signal_type, ltp, target_price):
                        for order_id in order_ids:
                            await client.cancel_gtt_order(access_token=access_token, gtt_order_id=order_id)
                        auto_cancel_message = "Auto-cancelled: target hit before entry"
                        logger.warning(
                            "%s | client=%s ltp=%s target=%s entry=%s",
                            auto_cancel_message,
                            t.client_id,
                            ltp,
                            target_price,
                            entry_price,
                        )
                except UpstoxApiError as exc:
                    logger.warning(
                        "Auto-cancel check failed | client=%s error=%s",
                        t.client_id,
                        exc,
                    )

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
                    error_message=None,
                )
        except (UpstoxApiError, Exception) as e:
            res = OrderResult(
                batch_id=batch.id,
                client_id=t.client_id,
                status="error",
                gtt_order_ids=None,
                error_message=str(e),
            )
        db.add(res)

    db.commit()
    db.refresh(batch)
    return batch
