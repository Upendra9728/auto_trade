from __future__ import annotations

import asyncio
import json
import logging
import socket
import uuid
from typing import Any

import httpx

import pyotp

logger = logging.getLogger(__name__)


DHAN_API_HOST = "api.dhan.co"
DHAN_SUPER_ORDERS_URL = "https://api.dhan.co/v2/super/orders"
DHAN_SUPER_ORDER_BY_ID_URL = "https://api.dhan.co/v2/super/orders/{order_id}"
DHAN_SUPER_ORDER_CANCEL_URL = "https://api.dhan.co/v2/super/orders/{order_id}/{leg}"
DHAN_GENERATE_TOKEN_URL = "https://auth.dhan.co/app/generateAccessToken"
DHAN_ORDER_BY_ID_URL = "https://api.dhan.co/v2/orders/{order_id}"
DHAN_PROFILE_URL = "https://api.dhan.co/v2/profile"
DHAN_IP_GET_URL = "https://api.dhan.co/v2/ip/getIP"
DHAN_IP_SET_URL = "https://api.dhan.co/v2/ip/setIP"
DHAN_IP_MODIFY_URL = "https://api.dhan.co/v2/ip/modifyIP"

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
    async def generate_access_token(*, dhan_client_id: str, pin: str, totp_secret: str) -> dict[str, Any]:
        """
        Generate a fresh Dhan access token using TOTP — works even when the existing token is expired.
        Requires the user to have TOTP enabled on their Dhan account.
        Returns the response dict containing 'accessToken' and 'expiryTime'.
        """
        for attempt in range(2):
            if attempt > 0:
                # Retry once after a short wait to get a fresh TOTP code at a new window boundary
                await asyncio.sleep(2)
            totp_code = pyotp.TOTP(totp_secret).now()
            params = {"dhanClientId": dhan_client_id, "pin": pin, "totp": totp_code}
            logger.info("Dhan generateAccessToken for client %s (attempt %d)", dhan_client_id, attempt + 1)
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(DHAN_GENERATE_TOKEN_URL, params=params)
            except Exception as exc:
                raise DhanApiError(f"Network error calling generateAccessToken: {exc}") from exc

            logger.info("generateAccessToken response status=%s body=%s", resp.status_code, resp.text[:500])

            try:
                data = resp.json()
            except Exception:
                raise DhanApiError(
                    f"generateAccessToken returned non-JSON: HTTP {resp.status_code} -> {resp.text[:300]}"
                )

            if data.get("accessToken") or data.get("access_token"):
                return data

            dhan_msg: str = data.get("message", "") if isinstance(data, dict) else str(data)

            # Rate limit is a hard stop — retrying in 2s won't help
            if "2 minute" in dhan_msg or "rate" in dhan_msg.lower():
                raise DhanApiError(f"Dhan rate limit: {dhan_msg} (wait 2 minutes before retrying)")

            logger.warning(
                "generateAccessToken attempt %d for client %s: %s",
                attempt + 1, dhan_client_id, dhan_msg or data,
            )

        raise DhanApiError(f"generateAccessToken failed: {dhan_msg}")

    @staticmethod
    def _format_error_message(data: Any, status_code: int) -> str:
        if isinstance(data, dict):
            error_code = data.get("errorCode") or data.get("code") or ""
            error_message = str(data.get("errorMessage") or data.get("message") or "")
            if error_message:
                return f"Dhan error [{error_code}]: {error_message}" if error_code else error_message
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
    async def cancel_super_order(
        *,
        order_id: str,
        dhan_client_id: str,
        access_token: str,
        source_ipv6: str | None = None,
        leg: str = "ENTRY_LEG",
    ) -> dict[str, Any]:
        """DELETE /v2/super/orders/{order_id}/{leg}. ENTRY_LEG cancels all legs."""
        url = DHAN_SUPER_ORDER_CANCEL_URL.format(order_id=order_id, leg=leg)
        headers = {"Content-Type": "application/json", "access-token": access_token}
        if source_ipv6:
            source_ipv6 = source_ipv6.strip()
            _verify_ipv6_bindable(source_ipv6)
            transport = httpx.AsyncHTTPTransport(local_address=source_ipv6)
        else:
            transport = httpx.AsyncHTTPTransport()
        try:
            async with httpx.AsyncClient(transport=transport, timeout=30) as client:
                resp = await client.delete(url, headers=headers)
        except Exception as exc:
            raise DhanApiError(f"Network error cancelling super order: {exc}") from exc

        logger.info("cancel_super_order %s/%s status=%s body=%s", order_id, leg, resp.status_code, resp.text[:500])
        # 202 Accepted is normal for cancel
        if resp.status_code >= 400:
            try:
                data = resp.json()
            except Exception:
                data = resp.text
            raise DhanApiError(f"Cancel super order error HTTP {resp.status_code}: {data}")
        try:
            return resp.json()
        except Exception:
            return {"orderStatus": "CANCELLED"}

    @staticmethod
    async def modify_super_order(
        *,
        order_id: str,
        dhan_client_id: str,
        access_token: str,
        source_ipv6: str | None = None,
        leg_name: str,
        order_type: str = "LIMIT",
        quantity: int | None = None,
        price: float | None = None,
        target_price: float | None = None,
        stop_loss_price: float | None = None,
        trailing_jump: float | None = None,
    ) -> dict[str, Any]:
        """PUT /v2/super/orders/{order_id}. leg_name: ENTRY_LEG | TARGET_LEG | STOP_LOSS_LEG."""
        url = DHAN_SUPER_ORDER_BY_ID_URL.format(order_id=order_id)
        payload: dict[str, Any] = {
            "dhanClientId": dhan_client_id,
            "orderId": order_id,
            "orderType": order_type,
            "legName": leg_name,
        }
        if quantity is not None:
            payload["quantity"] = quantity
        if price is not None:
            payload["price"] = price
        if target_price is not None:
            payload["targetPrice"] = target_price
        if stop_loss_price is not None:
            payload["stopLossPrice"] = stop_loss_price
        if trailing_jump is not None:
            payload["trailingJump"] = trailing_jump

        headers = {"Content-Type": "application/json", "access-token": access_token}
        if source_ipv6:
            source_ipv6 = source_ipv6.strip()
            _verify_ipv6_bindable(source_ipv6)
            transport = httpx.AsyncHTTPTransport(local_address=source_ipv6)
        else:
            transport = httpx.AsyncHTTPTransport()
        try:
            async with httpx.AsyncClient(transport=transport, timeout=30) as client:
                resp = await client.put(url, headers=headers, json=payload)
        except Exception as exc:
            raise DhanApiError(f"Network error modifying super order: {exc}") from exc

        logger.info("modify_super_order %s/%s status=%s body=%s", order_id, leg_name, resp.status_code, resp.text[:500])
        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(f"Modify super order non-JSON: HTTP {resp.status_code} -> {resp.text[:300]}")
        if resp.status_code >= 400:
            raise DhanApiError(DhanClient._format_error_message(data, resp.status_code))
        return data

    @staticmethod
    async def get_super_orders(*, access_token: str, source_ipv6: str | None = None) -> list[dict[str, Any]]:
        """GET /v2/super/orders — all super orders for the day with leg details."""
        headers = {"Content-Type": "application/json", "access-token": access_token}
        if source_ipv6:
            source_ipv6 = source_ipv6.strip()
            _verify_ipv6_bindable(source_ipv6)
            transport = httpx.AsyncHTTPTransport(local_address=source_ipv6)
        else:
            transport = httpx.AsyncHTTPTransport()
        try:
            async with httpx.AsyncClient(transport=transport, timeout=30) as client:
                resp = await client.get(DHAN_SUPER_ORDERS_URL, headers=headers)
        except Exception as exc:
            raise DhanApiError(f"Network error fetching super orders: {exc}") from exc
        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(f"get_super_orders non-JSON: HTTP {resp.status_code} -> {resp.text[:300]}")
        if resp.status_code >= 400:
            raise DhanApiError(DhanClient._format_error_message(data, resp.status_code))
        return data if isinstance(data, list) else []


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

    @staticmethod
    async def get_profile(*, access_token: str) -> dict[str, Any]:
        """
        GET /v2/profile — lightweight credential check. Returns dhanClientId,
        tokenValidity, activeSegment, ddpi, mtf, dataPlan, dataValidity.
        No IP whitelisting is required for this endpoint (only order placement
        APIs require it), so this is safe to call before a user's IPv6 is set up.
        """
        headers = {"access-token": access_token}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(DHAN_PROFILE_URL, headers=headers)
        except Exception as exc:
            raise DhanApiError(f"Network error fetching Dhan profile: {exc}") from exc

        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(f"Dhan profile returned non-JSON: HTTP {resp.status_code} -> {resp.text[:300]}")

        if resp.status_code >= 400:
            raise DhanApiError(DhanClient._format_error_message(data, resp.status_code))

        return data

    @staticmethod
    async def get_ip(*, access_token: str) -> dict[str, Any]:
        """GET /v2/ip/getIP — the primary/secondary static IP currently registered with Dhan."""
        headers = {"access-token": access_token}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(DHAN_IP_GET_URL, headers=headers)
        except Exception as exc:
            raise DhanApiError(f"Network error fetching Dhan registered IP: {exc}") from exc

        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(f"Dhan getIP returned non-JSON: HTTP {resp.status_code} -> {resp.text[:300]}")

        if resp.status_code >= 400:
            raise DhanApiError(DhanClient._format_error_message(data, resp.status_code))

        return data

    @staticmethod
    async def _set_or_modify_ip(
        url: str, method: str, *, access_token: str, dhan_client_id: str, ip: str, ip_flag: str,
    ) -> dict[str, Any]:
        headers = {"Content-Type": "application/json", "access-token": access_token}
        payload = {"dhanClientId": dhan_client_id, "ip": ip, "ipFlag": ip_flag}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.request(method, url, headers=headers, json=payload)
        except Exception as exc:
            raise DhanApiError(f"Network error setting Dhan IP: {exc}") from exc

        try:
            data = resp.json()
        except Exception:
            raise DhanApiError(f"Dhan set/modify IP returned non-JSON: HTTP {resp.status_code} -> {resp.text[:300]}")

        if resp.status_code >= 400:
            raise DhanApiError(DhanClient._format_error_message(data, resp.status_code))

        return data

    @staticmethod
    async def set_ip(*, access_token: str, dhan_client_id: str, ip: str, ip_flag: str = "PRIMARY") -> dict[str, Any]:
        """POST /v2/ip/setIP — first-time static IP registration. Cannot be changed for 7 days after this."""
        return await DhanClient._set_or_modify_ip(
            DHAN_IP_SET_URL, "POST",
            access_token=access_token, dhan_client_id=dhan_client_id, ip=ip, ip_flag=ip_flag,
        )

    @staticmethod
    async def modify_ip(*, access_token: str, dhan_client_id: str, ip: str, ip_flag: str = "PRIMARY") -> dict[str, Any]:
        """PUT /v2/ip/modifyIP — change an already-registered static IP (only allowed once every 7 days)."""
        return await DhanClient._set_or_modify_ip(
            DHAN_IP_MODIFY_URL, "PUT",
            access_token=access_token, dhan_client_id=dhan_client_id, ip=ip, ip_flag=ip_flag,
        )

