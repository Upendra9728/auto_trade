from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import logging

import json
import razorpay
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config import settings
from ..deps import get_current_user, get_db
from ..models import CreditPurchase, User
from ..schemas import (
    CreditPlanResponse,
    CreateOrderRequest,
    CreateOrderResponse,
    CreditPurchaseResponse,
    VerifyPaymentRequest,
)

router = APIRouter(prefix="/api/payments", tags=["payments"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Plan definitions — price computed dynamically from settings.credit_value_rs
# ---------------------------------------------------------------------------

def _build_plans() -> list[CreditPlanResponse]:
    rs = settings.credit_value_rs  # INR per credit
    return [
        CreditPlanResponse(
            id="basic",
            name="Basic",
            paid_credits=5,
            bonus_credits=0,
            total_credits=5,
            amount_rs=5 * rs,
            amount_paise=5 * rs * 100,
            badge=None,
            description="Great for getting started with trading signals.",
        ),
        CreditPlanResponse(
            id="intermediate",
            name="Intermediate",
            paid_credits=10,
            bonus_credits=2,
            total_credits=12,
            amount_rs=10 * rs,
            amount_paise=10 * rs * 100,
            badge="Most Popular",
            description="Best value — 2 bonus credits included free!",
        ),
        CreditPlanResponse(
            id="pro",
            name="Pro",
            paid_credits=15,
            bonus_credits=3,
            total_credits=18,
            amount_rs=15 * rs,
            amount_paise=15 * rs * 100,
            badge="Best Deal",
            description="Maximum credits for power traders — 3 bonus credits free!",
        ),
    ]


def _get_plan(plan_id: str) -> CreditPlanResponse:
    plans = {p.id: p for p in _build_plans()}
    if plan_id not in plans:
        raise HTTPException(status_code=404, detail=f"Plan not found: {plan_id}")
    return plans[plan_id]


def _razorpay_client() -> razorpay.Client:
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(
            status_code=503,
            detail="Payment gateway is not configured. Contact support.",
        )
    return razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/plans", response_model=list[CreditPlanResponse])
def get_plans():
    """
    Public — returns the 3 available credit plans.
    No authentication required so plans can be shown before login.
    """
    return _build_plans()


@router.post("/orders", response_model=CreateOrderResponse)
def create_order(
    body: CreateOrderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a Razorpay Order for the chosen plan.
    Returns the order details needed by the mobile SDK to launch Checkout.
    """
    plan = _get_plan(body.plan_id)
    client = _razorpay_client()

    receipt = "u" + str(current_user.id) + "_" + plan.id
    try:
        rzp_order = client.order.create({
            "amount": plan.amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "notes": {
                "user_id": str(current_user.id),
                "user_email": current_user.email,
                "plan_id": plan.id,
            },
        })
    except Exception as exc:
        logger.exception("Razorpay order creation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create payment order. Please try again.")

    # Persist a 'created' record; updated to 'paid' after verification
    purchase = CreditPurchase(
        user_id=current_user.id,
        plan_id=plan.id,
        paid_credits=plan.paid_credits,
        bonus_credits=plan.bonus_credits,
        total_credits=plan.total_credits,
        amount_paise=plan.amount_paise,
        status="created",
        razorpay_order_id=rzp_order["id"],
    )
    db.add(purchase)
    db.commit()

    return CreateOrderResponse(
        razorpay_order_id=rzp_order["id"],
        amount_paise=plan.amount_paise,
        currency="INR",
        key_id=settings.razorpay_key_id,  # type: ignore[arg-type]
        plan=plan,
    )


@router.post("/verify", response_model=CreditPurchaseResponse)
def verify_payment(
    body: VerifyPaymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Verify the Razorpay HMAC-SHA256 signature and credit the user.

    Called by the mobile app after successful Razorpay Checkout.
    Credits are ONLY awarded after cryptographic signature verification.
    """
    # 1. Find the pending purchase record
    purchase: CreditPurchase | None = (
        db.query(CreditPurchase)
        .filter_by(razorpay_order_id=body.razorpay_order_id, user_id=current_user.id)
        .first()
    )
    if not purchase:
        raise HTTPException(status_code=404, detail="Order not found or does not belong to you.")

    # 2. Idempotency — already paid
    if purchase.status == "paid":
        return CreditPurchaseResponse(
            purchase_id=purchase.id,
            plan_id=purchase.plan_id,
            total_credits_added=purchase.total_credits,
            new_credit_balance=int(current_user.credits or 0),
            amount_rs=purchase.amount_paise // 100,
            razorpay_payment_id=purchase.razorpay_payment_id or "",
            paid_at=purchase.paid_at.isoformat() if purchase.paid_at else "",
        )

    # 3. Verify HMAC-SHA256 signature
    if not settings.razorpay_key_secret:
        raise HTTPException(status_code=503, detail="Payment gateway not configured.")

    raw_msg = body.razorpay_order_id + "|" + body.razorpay_payment_id
    expected = hmac.new(
        settings.razorpay_key_secret.encode("utf-8"),
        raw_msg.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, body.razorpay_signature):
        logger.warning(
            "Invalid Razorpay signature: order=%s user=%d",
            body.razorpay_order_id,
            current_user.id,
        )
        purchase.status = "failed"
        db.commit()
        raise HTTPException(status_code=400, detail="Payment signature verification failed.")

    # 4. Credit the user
    now = dt.datetime.utcnow()
    current_user.credits = int(current_user.credits or 0) + purchase.total_credits
    purchase.status = "paid"
    purchase.razorpay_payment_id = body.razorpay_payment_id
    purchase.razorpay_signature = body.razorpay_signature
    purchase.paid_at = now

    db.commit()
    db.refresh(current_user)

    logger.info(
        "Credits added: user=%d plan=%s credits=%d payment=%s",
        current_user.id,
        purchase.plan_id,
        purchase.total_credits,
        body.razorpay_payment_id,
    )

    return CreditPurchaseResponse(
        purchase_id=purchase.id,
        plan_id=purchase.plan_id,
        total_credits_added=purchase.total_credits,
        new_credit_balance=int(current_user.credits),
        amount_rs=purchase.amount_paise // 100,
        razorpay_payment_id=body.razorpay_payment_id,
        paid_at=now.isoformat(),
    )


@router.post("/webhook")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Receives events from Razorpay (e.g. from a Payment Page).
    Automates credit addition when a user pays directly via a Razorpay payment link.
    """
    raw_body = await request.body()
    signature = request.headers.get("x-razorpay-signature")
    if not signature:
        logger.error("Webhook missing signature")
        raise HTTPException(status_code=400, detail="Missing signature")

    secret = settings.razorpay_webhook_secret
    if not secret:
        logger.error("Webhook secret not configured")
        raise HTTPException(status_code=503, detail="Webhook not configured")

    # Verify signature
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        logger.error("Webhook signature mismatch")
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event = payload.get("event")
    if event not in ("payment.captured", "payment_link.paid"):
        return {"status": "ignored", "reason": "unhandled event type"}

    try:
        payment_entity = payload["payload"]["payment"]["entity"]
        amount_paise = payment_entity.get("amount")
        email = payment_entity.get("email")
        payment_id = payment_entity.get("id")
    except KeyError:
        return {"status": "ignored", "reason": "missing payment payload"}

    if not email:
        logger.warning(f"Webhook payment {payment_id} missing email, skipping")
        return {"status": "ignored", "reason": "no email"}

    user = db.query(User).filter(User.email == email).first()
    if not user:
        logger.warning(f"Webhook payment {payment_id} from unknown email {email}, skipping")
        return {"status": "ignored", "reason": "user not found"}

    # Ensure idempotency
    existing = db.query(CreditPurchase).filter_by(razorpay_payment_id=payment_id).first()
    if existing:
        return {"status": "already processed"}

    # Match amount to a plan
    rs = settings.credit_value_rs
    plan = None
    for p in _build_plans():
        if p.amount_paise == amount_paise:
            plan = p
            break

    if not plan:
        logger.error(f"Webhook payment {payment_id} for {amount_paise} paise doesn't match any plan")
        return {"status": "ignored", "reason": "unknown amount"}

    now = dt.datetime.utcnow()
    purchase = CreditPurchase(
        user_id=user.id,
        plan_id=plan.id,
        paid_credits=plan.paid_credits,
        bonus_credits=plan.bonus_credits,
        total_credits=plan.total_credits,
        amount_paise=plan.amount_paise,
        status="paid",
        razorpay_order_id=payment_entity.get("order_id", f"manual_{payment_id}"),
        razorpay_payment_id=payment_id,
        razorpay_signature="webhook_verified",
        paid_at=now
    )
    user.credits = int(user.credits or 0) + plan.total_credits

    db.add(purchase)
    db.commit()

    logger.info(f"Webhook processed: user={user.id} ({email}) plan={plan.id} credits={plan.total_credits} payment={payment_id}")
    return {"status": "success", "credits_added": plan.total_credits}

