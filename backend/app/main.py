from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import auth, admin, user
from .token_refresh import token_refresh_loop

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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
