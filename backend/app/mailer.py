from __future__ import annotations

import smtplib
from email.mime.text import MIMEText

from .config import settings


def send_password_reset_email(*, to_email: str, otp: str) -> None:
    if not settings.smtp_username or not settings.smtp_password:
        raise RuntimeError("SMTP credentials are not configured")

    from_email = settings.smtp_from_email or settings.smtp_username

    msg = MIMEText(
        "Your OTP for password reset is "
        f"{otp}. It expires in {settings.otp_expiry_minutes} minutes.",
        "plain",
        "utf-8",
    )
    msg["Subject"] = "Automate Trading Password Reset OTP"
    msg["From"] = from_email
    msg["To"] = to_email

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
        smtp.starttls()
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)
