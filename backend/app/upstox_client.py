from __future__ import annotations

from typing import Any

import httpx

from .config import settings


class UpstoxApiError(RuntimeError):
    pass


class UpstoxClient:
    def __init__(self, base_url: str | None = None) -> None:
        self._base_url = (base_url or settings.upstox_base_url).rstrip("/")

    async def place_gtt_order(self, *, access_token: str, payload: dict[str, Any]) -> list[str]:
        url = f"{self._base_url}/v3/order/gtt/place"
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": f"Bearer {access_token}",
        }
        if settings.upstox_x_algo_name:
            headers["X-Algo-Name"] = settings.upstox_x_algo_name

        transport = None
        if settings.upstox_force_ipv4:
            transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")

        async with httpx.AsyncClient(timeout=30, transport=transport) as client:
            resp = await client.post(url, headers=headers, json=payload)

        try:
            data = resp.json()
        except Exception:
            raise UpstoxApiError(f"Upstox returned non-JSON: HTTP {resp.status_code} -> {resp.text}")

        if resp.status_code >= 400:
            raise UpstoxApiError(f"Upstox error HTTP {resp.status_code}: {data}")

        if data.get("status") != "success":
            raise UpstoxApiError(f"Upstox status not success: {data}")

        order_ids = (data.get("data") or {}).get("gtt_order_ids")
        if not isinstance(order_ids, list) or not all(isinstance(x, str) for x in order_ids):
            raise UpstoxApiError(f"Unexpected response shape: {data}")

        return order_ids

    async def get_ltp(self, *, access_token: str, instrument_token: str) -> float:
        url = f"{self._base_url}/v3/market-quote/ltp"
        headers = {
            "accept": "application/json",
            "authorization": f"Bearer {access_token}",
        }
        if settings.upstox_x_algo_name:
            headers["X-Algo-Name"] = settings.upstox_x_algo_name

        transport = None
        if settings.upstox_force_ipv4:
            transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")

        async with httpx.AsyncClient(timeout=15, transport=transport) as client:
            resp = await client.get(url, headers=headers, params={"instrument_key": instrument_token})

        try:
            data = resp.json()
        except Exception:
            raise UpstoxApiError(f"Upstox returned non-JSON: HTTP {resp.status_code} -> {resp.text}")

        if resp.status_code >= 400:
            raise UpstoxApiError(f"Upstox error HTTP {resp.status_code}: {data}")

        if data.get("status") not in (None, "success"):
            raise UpstoxApiError(f"Upstox status not success: {data}")

        payload = data.get("data") or {}
        last_price = None
        if isinstance(payload, dict):
            token_row = payload.get(instrument_token)
            if isinstance(token_row, dict):
                last_price = token_row.get("last_price")
            if last_price is None and "last_price" in payload:
                last_price = payload.get("last_price")

        if not isinstance(last_price, (int, float)):
            raise UpstoxApiError(f"Could not read LTP for {instrument_token}: {data}")

        return float(last_price)

    async def cancel_gtt_order(self, *, access_token: str, gtt_order_id: str) -> None:
        url = f"{self._base_url}/v3/order/gtt/cancel"
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": f"Bearer {access_token}",
        }
        if settings.upstox_x_algo_name:
            headers["X-Algo-Name"] = settings.upstox_x_algo_name

        transport = None
        if settings.upstox_force_ipv4:
            transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")

        async with httpx.AsyncClient(timeout=15, transport=transport) as client:
            resp = await client.request("DELETE", url, headers=headers, json={"gtt_order_id": gtt_order_id})

        try:
            data = resp.json()
        except Exception:
            raise UpstoxApiError(f"Upstox returned non-JSON: HTTP {resp.status_code} -> {resp.text}")

        if resp.status_code >= 400:
            raise UpstoxApiError(f"Upstox error HTTP {resp.status_code}: {data}")

        if data.get("status") not in (None, "success"):
            raise UpstoxApiError(f"Upstox status not success: {data}")
