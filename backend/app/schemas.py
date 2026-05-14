from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TokenUpsertRequest(BaseModel):
    client_id: str = Field(min_length=1, max_length=64)
    access_token: str = Field(min_length=10)
    consent: bool = True


class TokenResponse(BaseModel):
    client_id: str
    consent: bool
    updated_at: str


class TokenAdminUpdateRequest(BaseModel):
    access_token: str | None = Field(default=None, min_length=10)
    consent: bool | None = None


class UserRegistrationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=128)
    email: str = Field(min_length=5, max_length=254)
    phone_number: str = Field(min_length=7, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class UserLoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class UserProfileResponse(BaseModel):
    name: str
    email: str
    phone_number: str


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


class UserTokenUpsertRequest(BaseModel):
    access_token: str = Field(min_length=10)
    consent: bool = True


class UserTokenStatusResponse(BaseModel):
    has_token: bool
    token: TokenResponse | None = None


class GttRule(BaseModel):
    strategy: Literal["ENTRY", "TARGET", "STOPLOSS"]
    trigger_type: Literal["BELOW", "ABOVE", "IMMEDIATE"]
    trigger_price: float
    market_protection: int | None = None
    trailing_gap: float | None = None


class GttPlaceRequest(BaseModel):
    type: Literal["SINGLE", "MULTIPLE"]
    quantity: int = Field(ge=1)
    product: Literal["I", "D", "MTF"]
    instrument_token: str
    transaction_type: Literal["BUY", "SELL"]
    rules: list[GttRule]


class TelegramIngestRequest(BaseModel):
    text: str = Field(min_length=1)
    telegram_chat_id: str | None = None
    telegram_message_id: str | None = None


class BatchPlaceResponse(BaseModel):
    batch_id: int
    total_clients: int
    success: int
    error: int
    results: list[dict[str, Any]]


class OrderResultResponse(BaseModel):
    client_id: str
    status: Literal["success", "error"]
    gtt_order_ids: list[str] | None = None
    error_message: str | None = None
    created_at: str


class OrderBatchResponse(BaseModel):
    batch_id: int
    created_at: str
    source: str
    raw_text: str
    parsed_payload_json: str
    telegram_chat_id: str | None = None
    telegram_message_id: str | None = None
    results: list[OrderResultResponse]
