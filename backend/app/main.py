from __future__ import annotations

# -- IPv4 patch ----------------------------------------------------------------
import socket

_orig_getaddrinfo = socket.getaddrinfo


def _getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    return _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)


socket.getaddrinfo = _getaddrinfo_ipv4
# -----------------------------------------------------------------------------

import logging

import httpx
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .db import init_db, SessionLocal
from .deps import get_current_user, get_db
from .models import User, UserUpstoxApp
from .routers import auth, user, admin, orders, upstox
from .upstox_oauth import build_authorize_url

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title="Automate Trading")

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
app.include_router(orders.router)
app.include_router(upstox.router)


# -- Legacy compat path for Upstox auth URL ------------------------------------
@app.get("/api/upstox/auth-url")
def get_upstox_auth_url_legacy(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    app_row = db.query(UserUpstoxApp).filter(UserUpstoxApp.user_id == current_user.id).one_or_none()
    url = build_authorize_url(current_user.email, client_id=app_row.client_id if app_row else None)
    return {"url": url}


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/server-ip")
async def get_server_ip(request: Request) -> dict[str, str]:
    """Return the server's public IP and the request source IP for debugging."""
    source_ip = request.client.host if request.client else "unknown"
    public_ip = "unknown"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            public_ip = (await client.get("https://api.ipify.org")).text.strip()
    except Exception:
        public_ip = "error"

    return {
        "source_ip": source_ip,
        "public_ip": public_ip,
    }
