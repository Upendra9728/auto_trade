import hmac
import hashlib
import json
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models import Base, User, CreditPurchase
from app.routers.payment import (
    calculate_credit_pricing,
    _get_plan_or_custom,
    _build_plans,
)


def test_pricing_calculation_at_boundaries():
    # 1 credit: minimum, no bonus
    p1 = calculate_credit_pricing(1)
    assert p1["paid_credits"] == 1
    assert p1["bonus_credits"] == 0
    assert p1["total_credits"] == 1
    assert p1["base_amount_rs"] == 100
    assert p1["gst_amount_rs"] == 18
    assert p1["amount_rs"] == 118
    assert p1["amount_paise"] == 11800

    # 5 credits: threshold boundary, no bonus
    p5 = calculate_credit_pricing(5)
    assert p5["paid_credits"] == 5
    assert p5["bonus_credits"] == 0
    assert p5["total_credits"] == 5
    assert p5["base_amount_rs"] == 500
    assert p5["gst_amount_rs"] == 90
    assert p5["amount_rs"] == 590
    assert p5["amount_paise"] == 59000

    # 6 credits: first point with bonus (+1)
    p6 = calculate_credit_pricing(6)
    assert p6["paid_credits"] == 6
    assert p6["bonus_credits"] == 1
    assert p6["total_credits"] == 7
    assert p6["base_amount_rs"] == 600
    assert p6["gst_amount_rs"] == 108
    assert p6["amount_rs"] == 708
    assert p6["amount_paise"] == 70800

    # 10 credits: matches intermediate plan bonus (+2)
    p10 = calculate_credit_pricing(10)
    assert p10["paid_credits"] == 10
    assert p10["bonus_credits"] == 2
    assert p10["total_credits"] == 12

    # 16 credits: 16 * 20% = 3.2 -> 3 bonus credits
    p16 = calculate_credit_pricing(16)
    assert p16["paid_credits"] == 16
    assert p16["bonus_credits"] == 3
    assert p16["total_credits"] == 19
    assert p16["base_amount_rs"] == 1600
    assert p16["gst_amount_rs"] == 288
    assert p16["amount_rs"] == 1888
    assert p16["amount_paise"] == 188800

    # 100 credits: max limit, +20 bonus
    p100 = calculate_credit_pricing(100)
    assert p100["paid_credits"] == 100
    assert p100["bonus_credits"] == 20
    assert p100["total_credits"] == 120


def test_custom_plan_validation():
    # Valid custom
    plan = _get_plan_or_custom("custom", 16)
    assert plan.id == "custom"
    assert plan.paid_credits == 16
    assert plan.bonus_credits == 3
    assert plan.total_credits == 19
    assert plan.amount_rs == 1888

    # Missing credits parameter
    with pytest.raises(HTTPException) as exc_missing:
        _get_plan_or_custom("custom", None)
    assert exc_missing.value.status_code == 422

    # Below min credits (0)
    with pytest.raises(HTTPException) as exc_below:
        _get_plan_or_custom("custom", 0)
    assert exc_below.value.status_code == 422

    # Above max credits (101)
    with pytest.raises(HTTPException) as exc_above:
        _get_plan_or_custom("custom", 101)
    assert exc_above.value.status_code == 422

    # Unknown plan ID
    with pytest.raises(HTTPException) as exc_unknown:
        _get_plan_or_custom("nonexistent_plan", None)
    assert exc_unknown.value.status_code == 404


def test_fixed_plans_include_gst():
    plans = _build_plans()
    assert len(plans) == 3

    basic = next(p for p in plans if p.id == "basic")
    assert basic.paid_credits == 5
    assert basic.base_amount_rs == 500
    assert basic.gst_amount_rs == 90
    assert basic.amount_rs == 590
    assert basic.amount_paise == 59000

    intermediate = next(p for p in plans if p.id == "intermediate")
    assert intermediate.paid_credits == 10
    assert intermediate.bonus_credits == 2
    assert intermediate.base_amount_rs == 1000
    assert intermediate.gst_amount_rs == 180
    assert intermediate.amount_rs == 1180
    assert intermediate.amount_paise == 118000


@pytest.fixture
def in_memory_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_webhook_order_matching_and_no_double_credit(in_memory_db):
    from app.routers.payment import razorpay_webhook
    from unittest.mock import AsyncMock

    user = User(
        id=10,
        name="Trader Joe",
        email="trader@example.com",
        phone_number="+919876543210",
        password_hash="fakehash",
        credits=5,
    )
    in_memory_db.add(user)

    # In-app checkout created an order for 16 credits (+3 bonus = 19 total)
    purchase = CreditPurchase(
        user_id=10,
        plan_id="custom",
        paid_credits=16,
        bonus_credits=3,
        total_credits=19,
        amount_paise=188800,
        status="created",
        razorpay_order_id="order_test_12345",
    )
    in_memory_db.add(purchase)
    in_memory_db.commit()

    settings.razorpay_webhook_secret = "test_webhook_secret"

    payload_dict = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_test_999",
                    "order_id": "order_test_12345",
                    "amount": 188800,
                    "email": "trader@example.com",
                }
            }
        },
    }
    raw_payload = json.dumps(payload_dict).encode("utf-8")
    sig = hmac.new(b"test_webhook_secret", raw_payload, hashlib.sha256).hexdigest()

    mock_request = AsyncMock()
    mock_request.body = AsyncMock(return_value=raw_payload)
    mock_request.headers = {"x-razorpay-signature": sig}

    import asyncio

    # First webhook event -> processes and adds credits
    res1 = asyncio.run(razorpay_webhook(mock_request, db=in_memory_db))
    assert res1["status"] == "success"
    assert res1["credits_added"] == 19

    in_memory_db.refresh(user)
    in_memory_db.refresh(purchase)
    assert user.credits == 24  # 5 initial + 19 total
    assert purchase.status == "paid"
    assert purchase.razorpay_payment_id == "pay_test_999"

    # Second webhook event (same order_id / payment_id retry) -> already processed
    res2 = asyncio.run(razorpay_webhook(mock_request, db=in_memory_db))
    assert res2["status"] == "already processed"

    in_memory_db.refresh(user)
    assert user.credits == 24  # No double crediting!


def test_env_configurable_pricing_settings(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", "dummy_key")
    monkeypatch.setenv("CUSTOM_CREDITS_MIN", "5")
    monkeypatch.setenv("CUSTOM_CREDITS_MAX", "250")
    monkeypatch.setenv("GST_PERCENT", "12")
    monkeypatch.setenv("BONUS_CREDIT_THRESHOLD", "10")
    monkeypatch.setenv("BONUS_CREDIT_PERCENT", "15")

    custom_settings = Settings()
    assert custom_settings.custom_credits_min == 5
    assert custom_settings.custom_credits_max == 250
    assert custom_settings.gst_percent == 12
    assert custom_settings.bonus_credit_threshold == 10
    assert custom_settings.bonus_credit_percent == 15

    # Test aliases (e.g. MIN_CREDITS, MAX_CREDITS, GST)
    monkeypatch.delenv("CUSTOM_CREDITS_MIN", raising=False)
    monkeypatch.delenv("CUSTOM_CREDITS_MAX", raising=False)
    monkeypatch.delenv("GST_PERCENT", raising=False)
    monkeypatch.setenv("MIN_CREDITS", "2")
    monkeypatch.setenv("MAX_CREDITS", "150")
    monkeypatch.setenv("GST", "5")

    alias_settings = Settings()
    assert alias_settings.custom_credits_min == 2
    assert alias_settings.custom_credits_max == 150
    assert alias_settings.gst_percent == 5

