from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid

from .config import settings


def _build_email(*, to_email: str, subject: str, headline: str, otp: str, name: str | None = None) -> MIMEMultipart:
    from_email = settings.smtp_from_email or settings.smtp_username or "no-reply@automate.trading"
    from_header = formataddr(("Automate Trading", from_email))

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_header
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="gmail.com")

    greeting = f"Hi {name}," if name else "Hello,"
    text_content = (
        f"{greeting}\n\n"
        f"{headline}\n\n"
        f"Your One-Time Password (OTP) is: {otp}\n\n"
        f"This code will expire in {settings.otp_expiry_minutes} minutes. "
        f"If you did not request this code, please ignore this email.\n\n"
        f"Regards,\nAutomate Trading Team"
    )

    html_content = f"""\
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; background-color: #f3f4f6;">
    <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 32px; border: 1px solid #e5e7eb;">
      <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Automate Trading</h2>
      <p style="font-size: 15px; line-height: 1.5; color: #374151;">{greeting}</p>
      <p style="font-size: 15px; line-height: 1.5; color: #374151;">{headline}</p>
      <div style="background-color: #f3f4f6; border-radius: 6px; padding: 16px; text-align: center; margin: 24px 0;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #111827; font-family: monospace;">{otp}</span>
      </div>
      <p style="color: #6b7280; font-size: 13px; line-height: 1.4;">This code will expire in <strong>{settings.otp_expiry_minutes} minutes</strong>. If you did not request this code, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Automate Trading Team</p>
    </div>
  </body>
</html>
"""

    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))
    return msg


def send_password_reset_email(*, to_email: str, otp: str, name: str | None = None) -> None:
    if not settings.smtp_username or not settings.smtp_password:
        raise RuntimeError("SMTP credentials are not configured")

    msg = _build_email(
        to_email=to_email,
        subject="Automate Trading — Password Reset OTP",
        headline="We received a request to reset your password.",
        otp=otp,
        name=name,
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
        smtp.starttls()
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


def send_email_verification_email(*, to_email: str, otp: str, name: str | None = None) -> None:
    if not settings.smtp_username or not settings.smtp_password:
        raise RuntimeError("SMTP credentials are not configured")

    msg = _build_email(
        to_email=to_email,
        subject="Automate Trading — Email Verification OTP",
        headline="Thank you for registering. Please verify your email address.",
        otp=otp,
        name=name,
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
        smtp.starttls()
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)

