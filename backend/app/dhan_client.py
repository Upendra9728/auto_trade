from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import httpx


logger = logging.getLogger(__name__)


DHAN_SUPER_ORDERS_URL = "https://api.dhan.co/v2/super/orders"

EXCHANGE_SEGMENT_MAP = {
    "NSE_FO": "NSE_FNO",
    "BSE_FO": "BSE_FNO",
    "NSE_EQ": "NSE_EQ",
    "BSE_EQ": "BSE",
    "NSE_FNO": "NSE_FNO",
    "BSE_FNO": "BSE_FNO",
}


class DhanApiError(RuntimeError):
    pass


class DhanClient:
    async def place_super_order(
        self,
        *,
        dhan_client_id: str,
        access_token: str,
        exchange_segment: str,
        security_id: str,
        quantity: int,
        price: float,
        target_price: float,
        stop_loss_price: float,
        transaction_type: str = "BUY",
        product_type: str = "INTRADAY",
        order_type: str = "LIMIT",
        trailing_jump: float = 0,
    ) -> dict[str, Any]:
        segment = EXCHANGE_SEGMENT_MAP.get(exchange_segment.upper(), exchange_segment.upper())

        payload = {
            "dhanClientId": dhan_client_id,
            "correlationId": uuid.uuid4().hex[:20],
            "transactionType": transaction_type.upper(),
            "exchangeSegment": segment,
            "productType": product_type,
            "orderType": order_type,
            "securityId": security_id,
            "quantity": quantity,
            "price": price,
            "targetPrice": target_price,
            "stopLossPrice": stop_loss_price,
            "trailingJump": trailing_jump,
        }

        headers = {
            "Content-Type": "application/json",
            "access-token": access_token,
        }

        logger.info("Dhan payload: %s", json.dumps(payload, separators=(",", ":")))

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(DHAN_SUPER_ORDERS_URL, headers=headers, json=payload)

        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(f"Dhann returned non-JSON: HTTP {resp.status_code} -> {resp.text[:500]}")

        if resp.status_code >= 400:
            raise DhanApiError(f"Dhann API error HTTP {resp.status_code}: {data}")

        return data
