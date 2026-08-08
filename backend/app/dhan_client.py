from __future__ import annotations

import asyncio
import json
import logging
import socket
import uuid
from typing import Any

import httpx


logger = logging.getLogger(__name__)


DHAN_API_HOST = "api.dhan.co"
DHAN_SUPER_ORDERS_URL = "https://api.dhan.co/v2/super/orders"
DHAN_RENEW_TOKEN_URL = "https://api.dhan.co/v2/RenewToken"
DHAN_ORDER_BY_ID_URL = "https://api.dhan.co/v2/orders/{order_id}"

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


def _verify_ipv6_bindable(ipv6: str) -> None:
    """
    Raise DhanApiError if the IPv6 address is not assigned to any local interface.
    This catches mis-configured ENI assignments before wasting a Dhan API call.
    """
    try:
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.bind((ipv6, 0))
        sock.close()
    except OSError as exc:
        raise DhanApiError(
            f"IPv6 address {ipv6} is not assigned to this server's network interface "
            f"({exc}). Ask admin to assign it on the AWS ENI."
        ) from exc


class DhanClient:
    @staticmethod
    async def renew_token(*, dhan_client_id: str, access_token: str) -> dict[str, Any]:
        """
        Call Dhan's RenewToken API to obtain a fresh token with a new 24-hour expiry.
        Only works for active tokens originally generated via Dhan Web.
        Returns the response dict containing 'accessToken' and 'expiryTime'.
        """
        headers = {
            "access-token": access_token,
            "dhanClientId": dhan_client_id,
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(DHAN_RENEW_TOKEN_URL, headers=headers)
        except Exception as exc:
            raise DhanApiError(f"Network error calling RenewToken: {exc}") from exc

        logger.info("RenewToken response status=%s body=%s", resp.status_code, resp.text[:500])

        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(
                f"RenewToken returned non-JSON: HTTP {resp.status_code} -> {resp.text[:300]}"
            )

        if resp.status_code >= 400:
            raise DhanApiError(f"RenewToken error HTTP {resp.status_code}: {data}")

        return data

    @staticmethod
    def _format_error_message(data: Any, status_code: int) -> str:
        if isinstance(data, dict):
            error_code = data.get("errorCode") or data.get("code") or ""
            error_message = str(data.get("errorMessage") or data.get("message") or "")
            # Only map to the IP-whitelist message when the errorMessage actually
            # mentions IP — DH-905 is a generic Input_Exception used for many errors.
            if "invalid ip" in error_message.lower() or "ip" in error_message.lower() and "whitelist" in error_message.lower():
                return (
                    "Dhan rejected the request because the source IP is not whitelisted for this client. "
                    "Ensure the assigned IPv6 address is registered in the Dhan developer portal."
                )
            if error_message:
                return f"Dhan error [{error_code}]: {error_message}"
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
            source_ipv6 = source_ipv6.strip()
            logger.info("Dhan outbound: binding to IPv6 %s", source_ipv6)
            # Verify the address is assigned to the local interface before calling Dhan.
            _verify_ipv6_bindable(source_ipv6)
            # local_address tells httpcore/anyio to bind the outbound socket to this
            # IPv6 address. anyio filters remote DNS results to IPv6-only when
            # local_address is IPv6, so the connection will use IPv6 end-to-end.
            transport = httpx.AsyncHTTPTransport(local_address=source_ipv6)
        else:
            transport = httpx.AsyncHTTPTransport()

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

    @staticmethod
    async def get_order_status(
        *,
        access_token: str,
        order_id: str,
        source_ipv6: str | None = None,
    ) -> Any:
        """
        Fallback REST lookup (GET /v2/orders/{order-id}) used when the Live Order
        Update WebSocket hasn't reported a status for an order recently — e.g. the
        connection dropped silently. Dhan returns either a single object or a list
        of leg objects for super orders; caller is responsible for picking the
        right one.
        """
        headers = {"access-token": access_token}
        if source_ipv6:
            source_ipv6 = source_ipv6.strip()
            _verify_ipv6_bindable(source_ipv6)
            transport = httpx.AsyncHTTPTransport(local_address=source_ipv6)
        else:
            transport = httpx.AsyncHTTPTransport()

        try:
            async with httpx.AsyncClient(transport=transport, timeout=15) as client:
                resp = await client.get(DHAN_ORDER_BY_ID_URL.format(order_id=order_id), headers=headers)
        except Exception as exc:
            raise DhanApiError(f"Network error fetching order status: {exc}") from exc

        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(
                f"Order status returned non-JSON: HTTP {resp.status_code} -> {resp.text[:300]}"
            )

        if resp.status_code >= 400:
            raise DhanApiError(f"Order status error HTTP {resp.status_code}: {data}")

        return data
