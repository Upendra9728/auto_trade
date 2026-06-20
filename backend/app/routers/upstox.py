from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import RedirectResponse

from ..config import settings
from ..upstox_oauth import exchange_code_and_store

router = APIRouter(tags=["upstox"])


@router.get("/api/upstox/callback")
async def upstox_callback(code: str | None = None, state: str | None = None) -> RedirectResponse:
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    await exchange_code_and_store(code=code, state=state)

    redirect_base = settings.webapp_base_url or (
        settings.cors_origins.split(",")[0] if settings.cors_origins else "http://localhost:4200"
    )
    redirect_url = redirect_base.rstrip("/") + "/?upstox_connected=1"
    return RedirectResponse(redirect_url)


@router.post("/mock/upstox/v3/order/gtt/place")
async def mock_upstox_gtt_place(
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"status": "error", "message": "Unauthorized"})

    if "fail" in authorization.lower():
        raise HTTPException(status_code=401, detail={"status": "error", "message": "Mock auth failure"})

    errors: list[str] = []

    def _req_str(key: str) -> str:
        val = payload.get(key)
        if not isinstance(val, str) or not val.strip():
            errors.append(f"{key} must be a non-empty string")
            return ""
        return val.strip()

    def _req_int(key: str) -> int:
        val = payload.get(key)
        if not isinstance(val, int):
            errors.append(f"{key} must be an integer")
            return 0
        return val

    gtt_type = _req_str("type")
    if gtt_type and gtt_type not in {"SINGLE", "MULTIPLE"}:
        errors.append("type must be SINGLE or MULTIPLE")

    quantity = _req_int("quantity")
    if quantity <= 0:
        errors.append("quantity must be >= 1")

    product = _req_str("product")
    if product and product not in {"I", "D", "MTF"}:
        errors.append("product must be one of I, D, MTF")

    instrument_token = _req_str("instrument_token")
    transaction_type = _req_str("transaction_type")
    if transaction_type and transaction_type not in {"BUY", "SELL"}:
        errors.append("transaction_type must be BUY or SELL")

    rules = payload.get("rules")
    if not isinstance(rules, list) or not rules:
        errors.append("rules must be a non-empty list")
        rules = []

    if errors:
        raise HTTPException(status_code=400, detail={"status": "error", "errors": errors})

    now = dt.datetime.utcnow()
    gtt_order_ids = [f"gtt_{now.strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"]

    return {
        "status": "success",
        "message": "GTT order placed successfully (mock)",
        "data": {
            "gtt_order_ids": gtt_order_ids,
            "submitted_order": {
                "type": gtt_type,
                "quantity": quantity,
                "product": product,
                "instrument_token": instrument_token,
                "transaction_type": transaction_type,
                "rules": rules,
            },
        },
        "meta": {"mock": True, "timestamp": now.isoformat() + "Z"},
    }
