from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import auth, admin, user
from .token_refresh import token_refresh_loop
from .dhan_order_update import dhan_order_update_loop, dhan_order_status_poll_loop, dhan_positions_poll_loop
from .scrip_lookup import ensure_scrip_master_fresh, scrip_master_refresh_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title="Automate Trading — Dhan Backend",
    description=(
        "Backend for the multi-client Dhan order placement platform. "
        "Each user is assigned a unique IPv6 address on the AWS EC2 instance "
        "so Dhan's per-client IP whitelist requirement is satisfied."
    ),
    version="2.0.0",
)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(user.router)
app.include_router(admin.router)


@app.on_event("startup")
async def _startup() -> None:
    init_db()
    asyncio.create_task(token_refresh_loop())
    # Live order status tracking via Dhan's order-update WebSocket, so we know
    # whether an order is *really* placed/traded at the exchange or was rejected.
    asyncio.create_task(dhan_order_update_loop())
    # Safety net in case a user's WebSocket connection silently drops.
    asyncio.create_task(dhan_order_status_poll_loop())
    # Periodic positions poll for realized/unrealized P&L
    asyncio.create_task(dhan_positions_poll_loop())
    # Run scrip master download in the background so it never blocks startup
    # within systemd's TimeoutStartSec. The daily refresh loop starts after
    # the initial download finishes.
    asyncio.create_task(_scrip_startup())


async def _scrip_startup() -> None:
    await ensure_scrip_master_fresh()
    asyncio.create_task(scrip_master_refresh_loop())


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/app-version")
def app_version() -> dict:
    return {
        "latest_version": settings.app_latest_version,
        "apk_url": settings.app_apk_url,
        "force_update": settings.app_force_update,
        "release_notes": settings.app_release_notes,
    }
