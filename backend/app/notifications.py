from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

_firebase_app = None


def _get_firebase_app():
    """Lazily initialise the Firebase Admin SDK app (once per process)."""
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app

    try:
        import firebase_admin
        from firebase_admin import credentials as fb_credentials
    except ImportError:
        logger.warning(
            "firebase-admin is not installed. Push notifications are disabled. "
            "Install it with: pip install firebase-admin"
        )
        return None

    from .config import settings

    if settings.firebase_credentials_json:
        try:
            cred_dict = json.loads(settings.firebase_credentials_json)
            cred = fb_credentials.Certificate(cred_dict)
        except Exception as exc:
            logger.error("Failed to parse FIREBASE_CREDENTIALS_JSON: %s", exc)
            return None
    elif settings.firebase_credentials_path:
        try:
            cred = fb_credentials.Certificate(settings.firebase_credentials_path)
        except Exception as exc:
            logger.error("Failed to load Firebase credentials from path: %s", exc)
            return None
    else:
        logger.warning(
            "Neither FIREBASE_CREDENTIALS_JSON nor FIREBASE_CREDENTIALS_PATH is set. "
            "Push notifications are disabled."
        )
        return None

    try:
        _firebase_app = firebase_admin.initialize_app(cred)
    except ValueError:
        # App already initialised (e.g. during hot-reload)
        _firebase_app = firebase_admin.get_app()

    return _firebase_app


def send_push_notification(
    *,
    fcm_token: str,
    title: str,
    body: str,
    data: dict[str, str] | None = None,
) -> bool:
    """
    Send a single FCM push notification to a device token.
    Returns True on success, False on failure (logs the error).
    """
    app = _get_firebase_app()
    if app is None:
        return False

    try:
        from firebase_admin import messaging

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=data or {},
            token=fcm_token,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id="trading-signals",
                    sound="default",
                    priority="high",
                    default_sound=True,
                    default_vibrate_timings=True,
                ),
            ),
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(sound="default", badge=1),
                ),
            ),
        )
        messaging.send(message, app=app)
        logger.info("FCM notification sent to token ...%s", fcm_token[-8:])
        return True
    except Exception as exc:
        logger.warning("Failed to send FCM notification: %s", exc)
        return False


def send_signal_notifications(
    *,
    signal_id: int,
    signal_title: str,
    fcm_tokens: list[str],
) -> dict[str, Any]:
    """
    Broadcast a signal notification to a list of FCM device tokens.
    Returns a summary dict with sent/failed counts.
    """
    sent = 0
    failed = 0

    for token in fcm_tokens:
        ok = send_push_notification(
            fcm_token=token,
            title="New Trading Signal",
            body=signal_title,
            data={
                "signal_id": str(signal_id),
                "type": "SIGNAL",
            },
        )
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "failed": failed, "total": len(fcm_tokens)}


def send_signal_cancelled_notifications(
    *,
    signal_id: int,
    signal_title: str,
    fcm_tokens: list[str],
) -> dict[str, Any]:
    """
    Notify users whose pending signal was cancelled by the admin before they acted on it.
    """
    sent = 0
    failed = 0

    for token in fcm_tokens:
        ok = send_push_notification(
            fcm_token=token,
            title="Signal Cancelled",
            body=f'"{signal_title}" was cancelled by admin.',
            data={
                "signal_id": str(signal_id),
                "type": "SIGNAL_CANCELLED",
            },
        )
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "failed": failed, "total": len(fcm_tokens)}
