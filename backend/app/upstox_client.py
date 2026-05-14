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

        async with httpx.AsyncClient(timeout=30) as client:
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
