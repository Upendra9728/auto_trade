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
    credits: int = 0
    auto_trade_enabled: bool = False
    auto_trade_quantity: int | None = None
    telegram_automation_enabled: bool = False
    telegram_channel_name: str | None = None


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
    telegram_automation_enabled: bool | None = None
    telegram_channel_name: str | None = Field(default=None, max_length=128)


class UpdateFcmTokenRequest(BaseModel):
    fcm_token: str = Field(min_length=1, max_length=4096)


class UpdateAutoTradeRequest(BaseModel):
    auto_trade_enabled: bool
    # Preset quantity overriding admin's signal quantity for every future signal; None = use admin's qty
    auto_trade_quantity: int | None = Field(default=None, ge=1)


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
    # If True, this signal is also posted to the configured Telegram group after creation
    send_to_telegram: bool = False


class GroupRef(BaseModel):
    id: int
    name: str


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
    # Derived lifecycle: 'cancelled' | 'awaiting' | 'live' | 'completed' | 'ended'
    lifecycle: str | None = None
    pending_count: int | None = None
    completed_at: str | None = None
    # IDs of the groups this signal was targeted at (None = all eligible users)
    target_group_ids: list[int] | None = None
    # Resolved group references (id + name) for group-targeted signals
    target_groups: list[GroupRef] | None = None


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
    # Deadline to confirm/reject before this notification auto-times-out (None = no timeout applies, e.g. auto-trade)
    confirm_deadline: str | None = None
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
    is_auto_placed: bool = False


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


class TelegramIngestRequest(BaseModel):
    """Body posted by the standalone Telegram bot process for every group message."""
    raw_text: str = Field(min_length=1, max_length=4096)
    channel_name: str | None = Field(default=None, max_length=128)


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
    credits: int = 0
    created_at: str
    updated_at: str


class AdminUpdateUserRequest(BaseModel):
    assigned_ipv6: str | None = None
    role: Literal["user", "admin"] | None = None
    is_active: bool | None = None


class AdminAddCreditsRequest(BaseModel):
    amount: int = Field(ge=0, description="Number of credits to add to the user(s)")


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


class SignalTradeInsightParticipant(BaseModel):
    notification_id: int
    user_id: int
    user_name: str
    user_email: str
    ordered_quantity: int
    traded_qty: int | None = None
    traded_price: float | None = None
    exit_leg: str | None = None
    exit_price: float | None = None
    exit_time: str | None = None
    realized_pnl: float | None = None
    live_status: str | None = None
    is_auto_placed: bool = False


class SignalTradeInsightsResponse(BaseModel):
    signal_id: int
    signal_title: str
    transaction_type: str
    exchange_segment: str
    security_id: str
    entry_price: float
    target_price: float
    stop_loss_price: float
    created_at: str
    completed_at: str | None = None
    lifecycle: str
    total_participants: int
    total_orders_placed: int
    target_hit_count: int
    stop_loss_hit_count: int
    win_rate_pct: float
    net_pnl: float
    gross_profit: float
    gross_loss: float
    total_traded_quantity: int
    participants: list[SignalTradeInsightParticipant] = []
    user_trade: SignalTradeInsightParticipant | None = None


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


class DayBucket(BaseModel):
    date: str
    count: int


class PaginatedDayBucketsResponse(BaseModel):
    items: list[DayBucket]
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
    telegram_channel_name: str | None = Field(default=None, max_length=128)


class GroupUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    telegram_channel_name: str | None = Field(default=None, max_length=128)


class GroupResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    member_count: int
    created_by_id: int
    created_at: str
    updated_at: str
    telegram_channel_name: str | None = None


class GroupDetailResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    members: list[AdminUserResponse]
    created_by_id: int
    created_at: str
    updated_at: str
    telegram_channel_name: str | None = None


class GroupAddMembersRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1)


# ---------------------------------------------------------------------------
# Payments / Razorpay
# ---------------------------------------------------------------------------

class CreditPlanResponse(BaseModel):
    """Describes a purchasable credit plan returned by GET /api/payments/plans."""
    id: str                     # 'basic' | 'intermediate' | 'pro'
    name: str                   # Display name, e.g. "Basic"
    paid_credits: int           # Credits purchased
    bonus_credits: int          # Bonus credits gifted free
    total_credits: int          # paid_credits + bonus_credits
    amount_rs: int              # Price in INR (rupees)
    amount_paise: int           # Price in paise (INR × 100) — used by Razorpay
    badge: str | None = None    # Optional badge label, e.g. "Most Popular"
    description: str | None = None


class CreateOrderRequest(BaseModel):
    """Body for POST /api/payments/orders."""
    plan_id: str = Field(min_length=1, max_length=32)


class CreateOrderResponse(BaseModel):
    """Returned after a Razorpay Order is created — passed directly to the mobile SDK."""
    razorpay_order_id: str
    amount_paise: int
    currency: str
    key_id: str          # Public key — safe to send to the client
    plan: CreditPlanResponse


class VerifyPaymentRequest(BaseModel):
    """Body for POST /api/payments/verify — sent by mobile after successful Razorpay Checkout."""
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class CreditPurchaseResponse(BaseModel):
    """Summary returned after a purchase is verified."""
    purchase_id: int
    plan_id: str
    total_credits_added: int
    new_credit_balance: int
    amount_rs: int
    razorpay_payment_id: str
    paid_at: str

