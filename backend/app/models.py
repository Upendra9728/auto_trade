from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    dhan_credential: Mapped["DhanCredential | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    notifications: Mapped[list["SignalNotification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class DhanCredential(Base):
    """Stores each user's Dhan client ID and encrypted access token."""

    __tablename__ = "dhan_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    dhan_client_id: Mapped[str] = mapped_column(String(64))
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
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
    status: Mapped[str] = mapped_column(String(16), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    dhan_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    placed_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=dt.datetime.utcnow)

    signal: Mapped[Signal] = relationship(back_populates="notifications")
    user: Mapped[User] = relationship(back_populates="notifications")


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