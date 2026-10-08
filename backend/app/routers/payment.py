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
    CustomCreditConfigResponse,
    CreateOrderRequest,
    CreateOrderResponse,
    CreditPurchaseResponse,
    VerifyPaymentRequest,
)

router = APIRouter(prefix="/api/payments", tags=["payments"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pricing & Plan definitions
# ---------------------------------------------------------------------------

def calculate_credit_pricing(
    paid_credits: int,
    bonus_credits_override: int | None = None,
) -> dict:
    """Calculate pricing, bonus credits, and amounts including GST."""
    if paid_credits < 1:
        raise ValueError("Credits must be at least 1")

    rs_per_credit = settings.credit_value_rs
    base_amount_rs = paid_credits * rs_per_credit
    gst_percent = settings.gst_percent
    gst_amount_rs = round(base_amount_rs * gst_percent / 100)
    amount_rs = base_amount_rs + gst_amount_rs
    amount_paise = amount_rs * 100

    if bonus_credits_override is not None:
        bonus_credits = bonus_credits_override
    elif paid_credits > settings.bonus_credit_threshold:
        bonus_credits = int(paid_credits * settings.bonus_credit_percent / 100)
    else:
        bonus_credits = 0

    total_credits = paid_credits + bonus_credits

    return {
        "paid_credits": paid_credits,
        "bonus_credits": bonus_credits,
        "total_credits": total_credits,
        "base_amount_rs": base_amount_rs,
        "gst_amount_rs": gst_amount_rs,
        "gst_percent": gst_percent,
        "amount_rs": amount_rs,
        "amount_paise": amount_paise,
    }


def _build_plans() -> list[CreditPlanResponse]:
    basic_calc = calculate_credit_pricing(5, bonus_credits_override=0)
    inter_calc = calculate_credit_pricing(10, bonus_credits_override=2)
    pro_calc = calculate_credit_pricing(15, bonus_credits_override=3)

    return [
        CreditPlanResponse(
            id="basic",
            name="Basic",
            badge=None,
            description="Great for getting started with trading signals.",
            **basic_calc,
        ),
        CreditPlanResponse(
            id="intermediate",
            name="Intermediate",
            badge="Most Popular",
            description="Best value — 2 bonus credits included free!",
            **inter_calc,
        ),
        CreditPlanResponse(
            id="pro",
            name="Pro",
            badge="Best Deal",
            description="Maximum credits for power traders — 3 bonus credits free!",
            **pro_calc,
        ),
    ]


def _get_plan(plan_id: str) -> CreditPlanResponse:
    plans = {p.id: p for p in _build_plans()}
    if plan_id not in plans:
        raise HTTPException(status_code=404, detail=f"Plan not found: {plan_id}")
    return plans[plan_id]


def _get_plan_or_custom(plan_id: str, custom_credits: int | None = None) -> CreditPlanResponse:
    if plan_id == "custom":
        if custom_credits is None:
            raise HTTPException(status_code=422, detail="credits is required for custom plan")
        if custom_credits < settings.custom_credits_min or custom_credits > settings.custom_credits_max:
            raise HTTPException(
                status_code=422,
                detail=f"Custom credits must be between {settings.custom_credits_min} and {settings.custom_credits_max}",
            )
        calc = calculate_credit_pricing(custom_credits)
        badge = f"+{calc['bonus_credits']} Bonus" if calc["bonus_credits"] > 0 else None
        desc = (
            f"Custom pack: {calc['paid_credits']} credits + {calc['bonus_credits']} bonus free!"
            if calc["bonus_credits"] > 0
            else f"Custom pack: {calc['paid_credits']} credits"
        )
        return CreditPlanResponse(
            id="custom",
            name="Custom Plan",
            badge=badge,
            description=desc,
            **calc,
        )
    return _get_plan(plan_id)


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


@router.get("/custom-config", response_model=CustomCreditConfigResponse)
def get_custom_config():
    """
    Public — returns limits and rules for custom credit purchases.
    """
    return CustomCreditConfigResponse(
        min_credits=settings.custom_credits_min,
        max_credits=settings.custom_credits_max,
        credit_value_rs=settings.credit_value_rs,
        bonus_credit_threshold=settings.bonus_credit_threshold,
        bonus_credit_percent=settings.bonus_credit_percent,
        gst_percent=settings.gst_percent,
    )


@router.post("/orders", response_model=CreateOrderResponse)
def create_order(
    body: CreateOrderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a Razorpay Order for the chosen plan or custom credit count.
    Returns the order details needed by the mobile SDK to launch Checkout.
    """
    plan = _get_plan_or_custom(body.plan_id, body.credits)
    client = _razorpay_client()

    ts = int(dt.datetime.utcnow().timestamp())
    receipt = f"u{current_user.id}_{plan.id}_{ts}"[:40]
    try:
        rzp_order = client.order.create({
            "amount": plan.amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "notes": {
                "user_id": str(current_user.id),
                "user_email": current_user.email,
                "plan_id": plan.id,
                "paid_credits": str(plan.paid_credits),
                "bonus_credits": str(plan.bonus_credits),
                "total_credits": str(plan.total_credits),
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

    # 4. Confirm with Razorpay that the money was actually captured for this order and amount
    client = _razorpay_client()
    try:
        rzp_payment = client.payment.fetch(body.razorpay_payment_id)
        if rzp_payment.get("status") == "authorized":
            rzp_payment = client.payment.capture(
                body.razorpay_payment_id, purchase.amount_paise, {"currency": "INR"}
            )
    except Exception as exc:
        logger.exception("Razorpay payment lookup failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not confirm payment with Razorpay. Please try again.")

    if (
        rzp_payment.get("order_id") != body.razorpay_order_id
        or rzp_payment.get("amount") != purchase.amount_paise
    ):
        logger.error(
            "Razorpay payment mismatch: payment=%s order=%s amount=%s expected_order=%s expected_amount=%s",
            body.razorpay_payment_id,
            rzp_payment.get("order_id"),
            rzp_payment.get("amount"),
            body.razorpay_order_id,
            purchase.amount_paise,
        )
        raise HTTPException(status_code=400, detail="Payment details do not match this order.")

    if rzp_payment.get("status") != "captured":
        raise HTTPException(status_code=402, detail="Payment was not completed. No credits were added.")

    # 5. Credit the user
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
        order_id = payment_entity.get("order_id")
    except KeyError:
        return {"status": "ignored", "reason": "missing payment payload"}

    # 1. Idempotency by payment_id
    existing_by_payment = db.query(CreditPurchase).filter_by(razorpay_payment_id=payment_id).first()
    if existing_by_payment and existing_by_payment.status == "paid":
        return {"status": "already processed"}

    # 2. In-app checkout: match by razorpay_order_id
    if order_id:
        purchase = db.query(CreditPurchase).filter_by(razorpay_order_id=order_id).first()
        if purchase:
            if purchase.status == "paid":
                return {"status": "already processed"}
            user = db.query(User).filter_by(id=purchase.user_id).first()
            if not user:
                logger.error("User %s for purchase %s not found", purchase.user_id, purchase.id)
                return {"status": "ignored", "reason": "user not found"}
            now = dt.datetime.utcnow()
            user.credits = int(user.credits or 0) + purchase.total_credits
            purchase.status = "paid"
            purchase.razorpay_payment_id = payment_id
            purchase.razorpay_signature = "webhook_verified"
            purchase.paid_at = now
            db.commit()
            logger.info("Webhook marked order %s as paid (+%d credits)", order_id, purchase.total_credits)
            return {"status": "success", "credits_added": purchase.total_credits}

    # 3. Fallback for external payment links (no prior order in database)
    if not email:
        logger.warning(f"Webhook payment {payment_id} missing email, skipping")
        return {"status": "ignored", "reason": "no email"}

    user = db.query(User).filter(User.email == email).first()
    if not user:
        logger.warning(f"Webhook payment {payment_id} from unknown email {email}, skipping")
        return {"status": "ignored", "reason": "user not found"}

    # Match amount to a plan (with or without GST)
    plan = None
    for p in _build_plans():
        if amount_paise == p.amount_paise or amount_paise == (p.base_amount_rs * 100):
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
        razorpay_order_id=order_id or f"manual_{payment_id}",
        razorpay_payment_id=payment_id,
        razorpay_signature="webhook_verified",
        paid_at=now
    )
    user.credits = int(user.credits or 0) + plan.total_credits

    db.add(purchase)
    db.commit()

    logger.info(f"Webhook processed: user={user.id} ({email}) plan={plan.id} credits={plan.total_credits} payment={payment_id}")
    return {"status": "success", "credits_added": plan.total_credits}

