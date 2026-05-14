from __future__ import annotations

import json

from sqlalchemy.orm import Session

from .crypto import decrypt_token
from .models import ClientToken, OrderBatch, OrderResult
from .schemas import GttPlaceRequest
from .upstox_client import UpstoxApiError, UpstoxClient


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

    for t in tokens:
        try:
            access_token = decrypt_token(t.access_token_encrypted)
            order_ids = await client.place_gtt_order(access_token=access_token, payload=payload)
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
