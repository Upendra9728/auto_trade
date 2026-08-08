from __future__ import annotations

import datetime as dt
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class UserRegistrationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=128)
    email: str = Field(min_length=5, max_length=254)
    phone_number: str = Field(min_length=7, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class UserLoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class UserProfileResponse(BaseModel):
    id: int
    name: str
    email: str
    phone_number: str
    role: str
    assigned_ipv6: str | None = None
    is_active: bool


class UserAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str
    user: UserProfileResponse


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class PasswordResetConfirmRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    otp: str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# User profile update
# ---------------------------------------------------------------------------

class UpdateProfileRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=128)
    phone_number: str | None = Field(default=None, min_length=7, max_length=32)


class UpdateFcmTokenRequest(BaseModel):
    fcm_token: str = Field(min_length=1, max_length=4096)


# ---------------------------------------------------------------------------
# Dhan credentials (per user)
# ---------------------------------------------------------------------------

class DhanCredentialUpsertRequest(BaseModel):
    dhan_client_id: str = Field(min_length=1, max_length=64)
    access_token: str = Field(min_length=10)
    # Optional: client can pass the expiryTime from Dhan's generateAccessToken response
    # so the backend knows exactly when to renew.  Format: ISO 8601 UTC.
    token_expires_at: dt.datetime | None = None


class DhanCredentialResponse(BaseModel):
    dhan_client_id: str
    is_active: bool
    updated_at: str
    token_expires_at: str | None = None


# ---------------------------------------------------------------------------
# Signals (admin creates, users receive)
# ---------------------------------------------------------------------------

class SignalCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    exchange_segment: str = Field(min_length=1, max_length=32,
                                  description="e.g. NSE_FNO, NSE_EQ, BSE_FNO")
    security_id: str = Field(min_length=1, max_length=64,
                             description="Dhan security ID (numeric string)")
    transaction_type: Literal["BUY", "SELL"] = "BUY"
    product_type: Literal["INTRADAY", "CNC", "MARGIN", "MTF", "CO", "BO"] = "INTRADAY"
    order_type: Literal["LIMIT", "MARKET"] = "LIMIT"
    quantity: int = Field(ge=1)
    lot_size: int | None = Field(default=None, ge=1)
    price: float = Field(ge=0)
    target_price: float = Field(ge=0)
    stop_loss_price: float = Field(ge=0)
    trailing_jump: float = Field(default=0, ge=0)
    expires_at: dt.datetime | None = None


class SignalResponse(BaseModel):
    id: int
    title: str
    exchange_segment: str
    security_id: str
    transaction_type: str
    product_type: str
    order_type: str
    quantity: int
    lot_size: int | None = None
    price: float
    target_price: float
    stop_loss_price: float
    trailing_jump: float
    status: str
    created_by_id: int
    created_at: str
    expires_at: str | None = None
    # summary counts (optional, returned on admin list)
    total_notified: int | None = None
    confirmed: int | None = None
    placed: int | None = None
    rejected: int | None = None
    failed: int | None = None
    # Of the 'placed' ones, how many are actually confirmed live at the exchange
    # (TRANSIT/PENDING/TRADED) vs still awaiting confirmation or since rejected.
    exchange_confirmed: int | None = None
    exchange_rejected: int | None = None
    awaiting_confirmation: int | None = None


# ---------------------------------------------------------------------------
# Signal notifications (user-facing)
# ---------------------------------------------------------------------------

class SignalNotificationResponse(BaseModel):
    id: int
    signal_id: int
    status: str
    signal: SignalResponse
    error_message: str | None = None
    dhan_order_id: str | None = None
    confirmed_at: str | None = None
    placed_at: str | None = None
    created_at: str
    # Real-time exchange status from Dhan's Live Order Update feed.
    # live_status: TRANSIT | PENDING | REJECTED | CANCELLED | TRADED | EXPIRED (None = no update yet)
    live_status: str | None = None
    exchange_order_no: str | None = None
    traded_qty: int | None = None
    traded_price: float | None = None
    reason_description: str | None = None
    live_updated_at: str | None = None


class ConfirmNotificationRequest(BaseModel):
    """Optional body for the confirm endpoint — lets users override quantity."""
    quantity: int | None = Field(default=None, ge=1)


# ---------------------------------------------------------------------------
# Admin user management
# ---------------------------------------------------------------------------

class AdminUserResponse(BaseModel):
    id: int
    name: str
    email: str
    phone_number: str
    role: str
    assigned_ipv6: str | None = None
    is_active: bool
    has_dhan_credential: bool
    created_at: str
    updated_at: str


class AdminUpdateUserRequest(BaseModel):
    assigned_ipv6: str | None = None
    role: Literal["user", "admin"] | None = None
    is_active: bool | None = None


class AdminSignalDetailResponse(BaseModel):
    signal: SignalResponse
    notifications: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Pagination (admin/user list endpoints)
# ---------------------------------------------------------------------------

class PaginationMeta(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class PaginatedSignalsResponse(BaseModel):
    items: list[SignalResponse]
    meta: PaginationMeta


class PaginatedUsersResponse(BaseModel):
    items: list[AdminUserResponse]
    meta: PaginationMeta


class PaginatedNotificationsResponse(BaseModel):
    items: list[SignalNotificationResponse]
    meta: PaginationMeta


# ---------------------------------------------------------------------------
# Admin bootstrapping (create first admin via secret)
# ---------------------------------------------------------------------------

class AdminBootstrapRequest(BaseModel):
    admin_secret: str
    email: str = Field(min_length=5, max_length=254)


# ---------------------------------------------------------------------------
# Health / misc
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
