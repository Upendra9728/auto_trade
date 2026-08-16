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

        message = _build_message(title=title, body=body, data=data, token=fcm_token)
        messaging.send(message, app=app)
        logger.info("FCM notification sent to token ...%s", fcm_token[-8:])
        return True
    except Exception as exc:
        logger.warning("Failed to send FCM notification: %s", exc)
        return False


def _build_message(*, title: str, body: str, data: dict[str, str] | None, token: str):
    from firebase_admin import messaging

    return messaging.Message(
        notification=messaging.Notification(title=title, body=body),
        data=data or {},
        token=token,
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


# FCM's batch endpoint accepts at most 500 messages per call
_FCM_BATCH_SIZE = 500


def _send_batch(*, title: str, body: str, data: dict[str, str], fcm_tokens: list[str]) -> dict[str, Any]:
    """
    Send the same notification to many tokens using Firebase's batched send_each(),
    which dispatches all messages concurrently in one call instead of one HTTP
    round-trip per token — dramatically faster than a sequential loop for
    broadcasts to dozens/hundreds of users.
    """
    app = _get_firebase_app()
    if app is None or not fcm_tokens:
        return {"sent": 0, "failed": len(fcm_tokens), "total": len(fcm_tokens)}

    from firebase_admin import messaging

    sent = 0
    failed = 0
    for i in range(0, len(fcm_tokens), _FCM_BATCH_SIZE):
        chunk = fcm_tokens[i:i + _FCM_BATCH_SIZE]
        messages = [_build_message(title=title, body=body, data=data, token=t) for t in chunk]
        try:
            batch_response = messaging.send_each(messages, app=app)
            for token, resp in zip(chunk, batch_response.responses):
                if resp.success:
                    sent += 1
                else:
                    failed += 1
                    logger.warning("FCM send failed for token ...%s: %s", token[-8:], resp.exception)
        except Exception as exc:
            logger.warning("FCM batch send failed for %d token(s): %s", len(chunk), exc)
            failed += len(chunk)

    return {"sent": sent, "failed": failed, "total": len(fcm_tokens)}


def send_signal_notifications(
    *,
    signal_id: int,
    signal_title: str,
    fcm_tokens: list[str],
) -> dict[str, Any]:
    """Broadcast a signal notification to a list of FCM device tokens (batched)."""
    return _send_batch(
        title="New Trading Signal",
        body=signal_title,
        data={"signal_id": str(signal_id), "type": "SIGNAL"},
        fcm_tokens=fcm_tokens,
    )


def send_signal_cancelled_notifications(
    *,
    signal_id: int,
    signal_title: str,
    fcm_tokens: list[str],
) -> dict[str, Any]:
    """Notify users whose pending signal was cancelled by the admin before they acted on it (batched)."""
    return _send_batch(
        title="Signal Cancelled",
        body=f'"{signal_title}" was cancelled by admin.',
        data={"signal_id": str(signal_id), "type": "SIGNAL_CANCELLED"},
        fcm_tokens=fcm_tokens,
    )
