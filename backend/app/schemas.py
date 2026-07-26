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


class DhanCredentialResponse(BaseModel):
    dhan_client_id: str
    is_active: bool
    updated_at: str


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
