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


async def _resolve_ipv6(hostname: str) -> str | None:
    """Resolve hostname to an IPv6 (AAAA) address, returning None if not available."""
    loop = asyncio.get_event_loop()
    try:
        results = await loop.getaddrinfo(hostname, 443, family=socket.AF_INET6, type=socket.SOCK_STREAM)
        if results:
            addr = results[0][4][0]
            logger.info("Resolved %s → IPv6 %s", hostname, addr)
            return addr
    except Exception as exc:
        logger.warning("Could not resolve %s to IPv6: %s", hostname, exc)
    return None


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

        # ── IPv6 source binding ────────────────────────────────────────────────
        url = DHAN_SUPER_ORDERS_URL
        transport: httpx.AsyncHTTPTransport

        if source_ipv6:
            source_ipv6 = source_ipv6.strip()
            logger.info("Dhan outbound: binding to IPv6 %s", source_ipv6)

            # 1. Verify the address is actually assigned to this server's interface.
            _verify_ipv6_bindable(source_ipv6)

            # 2. Force IPv6 DNS resolution so httpx doesn't fall back to IPv4
            #    (Happy Eyeballs can silently ignore the local_address binding).
            dhan_ipv6 = await _resolve_ipv6(DHAN_API_HOST)
            if dhan_ipv6:
                # Connect directly to the IPv6 address with the Host header preserved.
                url = f"https://[{dhan_ipv6}]/v2/super/orders"
                headers["Host"] = DHAN_API_HOST
                logger.info("Dhan: forcing IPv6 connection to [%s]", dhan_ipv6)
            else:
                logger.warning(
                    "Dhan: %s has no AAAA record — falling back to default resolution. "
                    "Source IPv6 binding may not take effect.",
                    DHAN_API_HOST,
                )

            transport = httpx.AsyncHTTPTransport(local_address=source_ipv6)
        else:
            transport = httpx.AsyncHTTPTransport()

        try:
            async with httpx.AsyncClient(transport=transport, timeout=30) as client:
                resp = await client.post(url, headers=headers, json=payload)
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
