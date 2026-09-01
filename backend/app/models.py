from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Table, Column

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    phone_number: Mapped[str] = mapped_column(String(32))
    password_hash: Mapped[str] = mapped_column(Text)
    # 'user' | 'admin'
    role: Mapped[str] = mapped_column(String(16), default="user")
    # Assigned AWS IPv6 address for Dhan order placement (e.g. '2406:da1a:c1e:f000:bb82::1')
    assigned_ipv6: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Firebase Cloud Messaging device token for push notifications
    fcm_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    terms_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    terms_accepted_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    # Trading signal order placement credits (1 credit = 1 successful order placed)
    credits: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    dhan_credential: Mapped["DhanCredential | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    notifications: Mapped[list["SignalNotification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    group_memberships: Mapped[list["UserGroupMember"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class DhanCredential(Base):
    """Stores each user's Dhan client ID and encrypted access token."""

    __tablename__ = "dhan_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    dhan_client_id: Mapped[str] = mapped_column(String(64))
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    # Encrypted Dhan login PIN (6-digit); required for automated token generation via TOTP
    pin_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Encrypted base32 TOTP secret from authenticator app setup
    totp_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # UTC datetime when the Dhan access token expires (None if unknown)
    token_expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    user: Mapped[User] = relationship(back_populates="dhan_credential")


class Signal(Base):
    """
    A trading signal created by an admin.
    When created, a SignalNotification is generated for every active user
    with an active Dhan credential and an assigned IPv6 address.
    """

    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(256))
    exchange_segment: Mapped[str] = mapped_column(String(32))   # e.g. NSE_FNO
    security_id: Mapped[str] = mapped_column(String(64))        # Dhan security ID
    transaction_type: Mapped[str] = mapped_column(String(8))    # BUY | SELL
    product_type: Mapped[str] = mapped_column(String(16))       # INTRADAY | CNC | MARGIN | etc.
    order_type: Mapped[str] = mapped_column(String(16))         # LIMIT | MARKET
    quantity: Mapped[int] = mapped_column(Integer)
    lot_size: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    price: Mapped[float] = mapped_column(Float)
    target_price: Mapped[float] = mapped_column(Float)
    stop_loss_price: Mapped[float] = mapped_column(Float)
    trailing_jump: Mapped[float] = mapped_column(Float, default=0)
    # 'active' | 'cancelled'
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    # JSON-encoded list of group IDs this signal was targeted to (None = all eligible users)
    target_group_ids: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    created_by: Mapped[User] = relationship(foreign_keys=[created_by_id])
    notifications: Mapped[list["SignalNotification"]] = relationship(
        back_populates="signal", cascade="all, delete-orphan"
    )


class SignalNotification(Base):
    """
    Per-user status for a given signal.
    Lifecycle: pending → confirmed → placed
                       → rejected
                       → failed (placement error)
    """

    __tablename__ = "signal_notifications"
    __table_args__ = (UniqueConstraint("signal_id", "user_id", name="uq_signal_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # 'pending' | 'confirmed' | 'rejected' | 'placed' | 'failed'
    # NOTE: 'placed' only means Dhan's HTTP API accepted the request. It does NOT
    # mean the exchange executed/confirmed it — see live_status below for that.
    status: Mapped[str] = mapped_column(String(16), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    dhan_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Actual quantity submitted to Dhan (user may override the signal's default quantity)
    ordered_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    placed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    # Optimistic locking version to prevent concurrent WS + polling overwrites
    version: Mapped[int] = mapped_column(Integer, default=1, index=True)

    # ---- Real-time exchange status, populated by the Dhan Live Order Update
    # WebSocket (see dhan_order_update.py). None until the first update arrives.
    # Raw Dhan values: TRANSIT | PENDING | REJECTED | CANCELLED | TRADED | EXPIRED
    live_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    exchange_order_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    traded_qty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    traded_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    reason_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    live_updated_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    # ---- Exit leg tracking: set when TARGET_LEG or STOP_LOSS_LEG is triggered
    # 'TARGET_LEG' = target hit; 'STOP_LOSS_LEG' = stop-loss hit
    exit_leg: Mapped[str | None] = mapped_column(String(16), nullable=True)
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    exit_time: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    realized_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)

    signal: Mapped[Signal] = relationship(back_populates="notifications")
    user: Mapped[User] = relationship(back_populates="notifications")
    events: Mapped[list["OrderEvent"]] = relationship(
        back_populates="notification", cascade="all, delete-orphan", order_by="OrderEvent.created_at.asc()"
    )


class OrderEvent(Base):
    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey("signal_notifications.id"), index=True)
    source: Mapped[str] = mapped_column(String(16))  # 'ws' | 'poll'
    event_type: Mapped[str] = mapped_column(String(32))
    leg: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    exchange_order_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, index=True)

    notification: Mapped[SignalNotification] = relationship(back_populates="events")


class UserPosition(Base):
    """Latest open position snapshot cached per user from Dhan's GET /v2/positions."""

    __tablename__ = "user_positions"
    __table_args__ = (UniqueConstraint("user_id", "security_id", "exchange_segment", "product_type", name="uq_user_pos"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    trading_symbol: Mapped[str] = mapped_column(String(64))
    security_id: Mapped[str] = mapped_column(String(64))
    position_type: Mapped[str] = mapped_column(String(16))  # LONG | SHORT | CLOSED
    exchange_segment: Mapped[str] = mapped_column(String(32))
    product_type: Mapped[str] = mapped_column(String(16))
    buy_avg: Mapped[float] = mapped_column(Float, default=0.0)
    buy_qty: Mapped[int] = mapped_column(Integer, default=0)
    cost_price: Mapped[float] = mapped_column(Float, default=0.0)
    sell_avg: Mapped[float] = mapped_column(Float, default=0.0)
    sell_qty: Mapped[int] = mapped_column(Integer, default=0)
    net_qty: Mapped[int] = mapped_column(Integer, default=0)
    realized_profit: Mapped[float] = mapped_column(Float, default=0.0)
    unrealized_profit: Mapped[float] = mapped_column(Float, default=0.0)
    rbi_reference_rate: Mapped[float] = mapped_column(Float, default=1.0)
    multiplier: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    user: Mapped[User] = relationship()


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    user: Mapped[User] = relationship()


class PasswordResetOtp(Base):
    __tablename__ = "password_reset_otps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    otp_hash: Mapped[str] = mapped_column(String(128), index=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)
    consumed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    user: Mapped[User] = relationship()


class EmailVerificationOtp(Base):
    __tablename__ = "email_verification_otps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    otp_hash: Mapped[str] = mapped_column(String(128), index=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)
    consumed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    user: Mapped[User] = relationship()


# ---------------------------------------------------------------------------
# User Groups
# ---------------------------------------------------------------------------

class UserGroup(Base):
    """Admin-created groups used to target signals to a subset of users."""

    __tablename__ = "user_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    created_by: Mapped[User] = relationship(foreign_keys=[created_by_id])
    members: Mapped[list["UserGroupMember"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class UserGroupMember(Base):
    """Association table linking users to groups."""

    __tablename__ = "user_group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_group_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("user_groups.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    added_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    group: Mapped[UserGroup] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="group_memberships")