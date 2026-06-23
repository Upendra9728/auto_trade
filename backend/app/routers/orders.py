from __future__ import annotations

import json
import logging
import socket

_orig_getaddrinfo = socket.getaddrinfo


def _getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    return _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)


socket.getaddrinfo = _getaddrinfo_ipv4

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import OrderBatch
from ..order_service import place_gtt_for_all_clients, place_orders_for_parsed
from ..schemas import (
    BatchPlaceResponse,
    DhanSuperOrderRequest,
    DhanSuperOrderResponse,
    GttPlaceRequest,
    OrderBatchResponse,
    OrderResultResponse,
    TelegramIngestRequest,
)
from ..config import settings
from ..telegram_parser import parse_telegram_message
from ..dhan_client import DhanClient, DhanApiError

router = APIRouter(tags=["orders"])
logger = logging.getLogger(__name__)


@router.post("/api/gtt/place-batch", response_model=BatchPlaceResponse)
async def place_batch(req: GttPlaceRequest, db: Session = Depends(get_db)) -> BatchPlaceResponse:
    batch = await place_gtt_for_all_clients(db=db, gtt_request=req, raw_text=req.model_dump_json(), source="api")
    return _batch_to_response(batch)


@router.post("/api/dhan/super-order", response_model=DhanSuperOrderResponse)
async def dhan_super_order(req: DhanSuperOrderRequest) -> DhanSuperOrderResponse:
    client = DhanClient()
    try:
        data = await client.place_super_order(
            dhan_client_id=req.dhan_client_id,
            access_token=req.access_token,
            exchange_segment=req.exchange_segment,
            security_id=req.security_id,
            quantity=req.quantity,
            price=req.price,
            target_price=req.target_price,
            stop_loss_price=req.stop_loss_price,
            transaction_type=req.transaction_type,
            product_type=req.product_type,
            order_type=req.order_type,
            trailing_jump=req.trailing_jump,
        )
        return DhanSuperOrderResponse(success=True, message="Dhan super order request submitted", data=data)
    except DhanApiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/telegram/ingest", response_model=BatchPlaceResponse)
async def telegram_ingest(
    req: TelegramIngestRequest,
    x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret"),
    db: Session = Depends(get_db),
) -> BatchPlaceResponse:
    if x_internal_secret != settings.internal_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        parsed = parse_telegram_message(req.text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    batch = await place_orders_for_parsed(
        db=db,
        parsed=parsed,
        raw_text=req.text,
        source="telegram",
        telegram_chat_id=req.telegram_chat_id,
        telegram_message_id=req.telegram_message_id,
    )
    return _batch_to_response(batch)


@router.get("/api/batches", response_model=list[OrderBatchResponse])
def list_batches(limit: int = 20, db: Session = Depends(get_db)) -> list[OrderBatchResponse]:
    limit = max(1, min(100, limit))
    batches = db.query(OrderBatch).order_by(OrderBatch.id.desc()).limit(limit).all()
    return [_batch_to_detail_response(b) for b in batches]


@router.get("/api/batches/{batch_id}", response_model=OrderBatchResponse)
def get_batch(batch_id: int, db: Session = Depends(get_db)) -> OrderBatchResponse:
    batch = db.query(OrderBatch).filter(OrderBatch.id == batch_id).one_or_none()
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _batch_to_detail_response(batch)


def _batch_to_response(batch: OrderBatch) -> BatchPlaceResponse:
    results = []
    success = 0
    error = 0
    for r in batch.results:
        row = {
            "client_id": r.client_id,
            "status": r.status,
            "gtt_order_ids": json.loads(r.gtt_order_ids) if r.gtt_order_ids else None,
            "error_message": r.error_message,
        }
        results.append(row)
        if r.status == "success":
            success += 1
        else:
            error += 1
    return BatchPlaceResponse(
        batch_id=batch.id,
        total_clients=len(batch.results),
        success=success,
        error=error,
        results=results,
    )


def _batch_to_detail_response(batch: OrderBatch) -> OrderBatchResponse:
    results = [
        OrderResultResponse(
            client_id=r.client_id,
            status=r.status,  # type: ignore[arg-type]
            gtt_order_ids=json.loads(r.gtt_order_ids) if r.gtt_order_ids else None,
            error_message=r.error_message,
            created_at=r.created_at.isoformat(),
        )
        for r in batch.results
    ]
    return OrderBatchResponse(
        batch_id=batch.id,
        created_at=batch.created_at.isoformat(),
        source=batch.source,
        raw_text=batch.raw_text,
        parsed_payload_json=batch.parsed_payload_json,
        telegram_chat_id=batch.telegram_chat_id,
        telegram_message_id=batch.telegram_message_id,
        results=results,
    )
