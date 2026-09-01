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
    email_verified: bool
    terms_accepted: bool = False
    terms_accepted_at: str | None = None


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


class EmailVerificationSendRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class EmailVerificationConfirmRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    otp: str = Field(min_length=4, max_length=8)


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
    # 6-digit Dhan login PIN
    pin: str = Field(min_length=6, max_length=6, pattern=r'^[0-9]{6}$')
    # Base32 TOTP secret from the authenticator app setup on Dhan Web
    totp_secret: str = Field(min_length=16)


class DhanCredentialResponse(BaseModel):
    dhan_client_id: str
    is_active: bool
    updated_at: str
    token_expires_at: str | None = None
    totp_configured: bool = False


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
    # Optional list of group IDs to target; None/empty = broadcast to all eligible users
    group_ids: list[int] | None = None


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
    # Count of 'placed' notifications that are still actually cancellable/modifiable
    # at the exchange (mirrors the exact filter used by the bulk cancel/modify endpoints).
    cancellable_count: int | None = None
    # IDs of the groups this signal was targeted at (None = all eligible users)
    target_group_ids: list[int] | None = None


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
    exit_leg: str | None = None
    exit_price: float | None = None
    exit_time: str | None = None
    realized_pnl: float | None = None


class OrderEventResponse(BaseModel):
    id: int
    notification_id: int
    source: str
    event_type: str
    leg: str | None = None
    status: str
    price: float | None = None
    quantity: int | None = None
    reason_description: str | None = None
    exchange_order_no: str | None = None
    created_at: str


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


class AdminSignalNotificationRow(BaseModel):
    notification_id: int
    user_id: int
    user_email: str
    user_name: str
    assigned_ipv6: str | None = None
    status: str
    dhan_order_id: str | None = None
    error_message: str | None = None
    confirmed_at: str | None = None
    placed_at: str | None = None
    created_at: str
    ordered_quantity: int | None = None
    live_status: str | None = None
    exchange_order_no: str | None = None
    traded_qty: int | None = None
    traded_price: float | None = None
    reason_description: str | None = None
    live_updated_at: str | None = None
    exit_leg: str | None = None
    exit_price: float | None = None
    exit_time: str | None = None
    realized_pnl: float | None = None


class UserPositionResponse(BaseModel):
    id: int
    user_id: int
    user_name: str | None = None
    user_email: str | None = None
    trading_symbol: str
    security_id: str
    position_type: str
    exchange_segment: str
    product_type: str
    buy_avg: float
    buy_qty: int
    cost_price: float
    sell_avg: float
    sell_qty: int
    net_qty: int
    realized_profit: float
    unrealized_profit: float
    updated_at: str


class AdminUserPnlRow(BaseModel):
    user_id: int
    user_name: str
    user_email: str
    assigned_ipv6: str | None = None
    total_orders: int
    closed_orders: int
    win_count: int
    loss_count: int
    total_realized_pnl: float
    dhan_realized_profit: float
    dhan_unrealized_profit: float


class PaginatedNotificationsAdminResponse(BaseModel):
    items: list[AdminSignalNotificationRow]
    meta: PaginationMeta


class SignalOrderModifyRequest(BaseModel):
    price: float | None = None
    target_price: float | None = None
    stop_loss_price: float | None = None
    trailing_jump: float | None = None


class OrderActionResult(BaseModel):
    notification_id: int
    user_id: int
    user_email: str
    dhan_order_id: str | None = None
    success: bool
    reason: str | None = None


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


# ---------------------------------------------------------------------------
# User Groups
# ---------------------------------------------------------------------------

class GroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)


class GroupUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None


class GroupResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    member_count: int
    created_by_id: int
    created_at: str
    updated_at: str


class GroupDetailResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    members: list[AdminUserResponse]
    created_by_id: int
    created_at: str
    updated_at: str


class GroupAddMembersRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1)
