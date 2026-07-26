from __future__ import annotations

import json
import logging
import socket
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
    @staticmethod
    def _format_error_message(data: Any, status_code: int) -> str:
        if isinstance(data, dict):
            error_code = data.get("errorCode") or data.get("code")
            error_message = data.get("errorMessage") or data.get("message")
            if error_code == "DH-905" or str(error_message).lower().startswith("invalid ip"):
                return (
                    "Dhan rejected the request because the source IP is not whitelisted for this client. "
                    "Ensure the assigned IPv6 address is registered in the Dhan developer portal."
                )
            return f"Dhan API error HTTP {status_code}: {data}"
        return f"Dhan API error HTTP {status_code}: {data}"

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
        # AWS IPv6 address assigned to this user — the outbound request will be
        # bound to this address so Dhan sees the per-user whitelisted IP.
        source_ipv6: str | None = None,
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
        safe_headers = {"Content-Type": headers["Content-Type"], "access-token": "<redacted>"}
        logger.info("Dhan headers: %s", json.dumps(safe_headers, separators=(",", ":")))
        logger.info("Dhan payload: %s", json.dumps(payload, separators=(",", ":")))
        if source_ipv6:
            logger.info("Dhan outbound bound to IPv6: %s", source_ipv6)

        # Build transport — optionally bind to the user's assigned IPv6 address
        # so that Dhan's per-client IP whitelist check passes.
        transport = httpx.AsyncHTTPTransport(local_address=source_ipv6) if source_ipv6 else httpx.AsyncHTTPTransport()

        try:
            async with httpx.AsyncClient(transport=transport, timeout=30) as client:
                resp = await client.post(DHAN_SUPER_ORDERS_URL, headers=headers, json=payload)
        except Exception as exc:
            raise DhanApiError(f"Network error connecting to Dhan: {exc}") from exc

        logger.info("Dhan response status=%s body=%s", resp.status_code, resp.text[:2000])

        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(f"Dhan returned non-JSON: HTTP {resp.status_code} -> {resp.text[:500]}")

        if resp.status_code >= 400:
            raise DhanApiError(self._format_error_message(data, resp.status_code))

        return data
