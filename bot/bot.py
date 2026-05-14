from __future__ import annotations

import os
import re
from typing import Any

import httpx
from dotenv import load_dotenv
from telegram import Update
from telegram.error import Conflict
from telegram.error import InvalidToken
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

load_dotenv()

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
ALLOWED_CHAT_ID = os.environ.get("TELEGRAM_ALLOWED_CHAT_ID", "").strip()
NOTIFY_CHAT_ID = os.environ.get("TELEGRAM_NOTIFY_CHAT_ID", "").strip()
BACKEND_BASE_URL = os.environ.get("BACKEND_BASE_URL", "http://localhost:8000").strip().rstrip("/")
BACKEND_INTERNAL_SECRET = os.environ.get("BACKEND_INTERNAL_SECRET", "").strip()


_TELEGRAM_TOKEN_RE = re.compile(r"^\d+:[A-Za-z0-9_-]{20,}$")


def _validate_env() -> None:
    if not BOT_TOKEN:
        raise SystemExit("TELEGRAM_BOT_TOKEN is required (get it from @BotFather)")
    if BOT_TOKEN.lower().startswith("http://") or BOT_TOKEN.lower().startswith("https://"):
        raise SystemExit(
            "TELEGRAM_BOT_TOKEN looks like a URL. Did you accidentally paste BACKEND_BASE_URL there? "
            "Set TELEGRAM_BOT_TOKEN to the token from @BotFather (format like 123456789:ABC...)."
        )
    if not _TELEGRAM_TOKEN_RE.match(BOT_TOKEN):
        raise SystemExit(
            "TELEGRAM_BOT_TOKEN does not look valid. It should look like 123456789:ABC... (from @BotFather)."
        )
    if not BACKEND_INTERNAL_SECRET:
        raise SystemExit("BACKEND_INTERNAL_SECRET is required (must match backend INTERNAL_SECRET)")


def _notify_chat_id(update: Update) -> str | None:
    if NOTIFY_CHAT_ID:
        return NOTIFY_CHAT_ID
    if update.effective_user is not None:
        return str(update.effective_user.id)
    return None


async def _send_private(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    chat_id = _notify_chat_id(update)
    if not chat_id:
        return
    try:
        await context.bot.send_message(chat_id=chat_id, text=text)
    except Exception:
        # If the user never started the bot, Telegram may block DMs.
        # Intentionally do not post back into the group.
        return


def _split_message(text: str, *, max_len: int = 3500) -> list[str]:
    if len(text) <= max_len:
        return [text]

    parts: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= max_len:
            parts.append(remaining)
            break

        split_at = remaining.rfind("\n", 0, max_len)
        if split_at <= 0:
            split_at = max_len
        parts.append(remaining[:split_at].rstrip())
        remaining = remaining[split_at:].lstrip("\n")

    return parts


def _format_batch_detail(batch: dict[str, Any]) -> str:
    batch_id = batch.get("batch_id")
    created_at = batch.get("created_at")
    results = batch.get("results") or []

    success = 0
    error = 0
    lines: list[str] = []
    for r in results:
        status = str(r.get("status") or "")
        client_id = str(r.get("client_id") or "")
        if status == "success":
            success += 1
            order_ids = r.get("gtt_order_ids") or []
            suffix = f" | {', '.join(map(str, order_ids))}" if order_ids else ""
            lines.append(f"- {client_id}: success{suffix}")
        else:
            error += 1
            msg = str(r.get("error_message") or "").strip()
            msg = (msg[:300] + "…") if len(msg) > 300 else msg
            suffix = f" | {msg}" if msg else ""
            lines.append(f"- {client_id}: error{suffix}")

    header = f"Batch #{batch_id}"
    if created_at:
        header += f" @ {created_at}"

    return "\n".join(
        [
            header,
            f"Total: {len(results)} | success={success} error={error}",
            "Results:",
            *lines,
        ]
    ).strip()


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat is None or update.message is None:
        return

    chat_id = str(update.effective_chat.id)
    if ALLOWED_CHAT_ID and chat_id != ALLOWED_CHAT_ID:
        return

    text = (update.message.text or "").strip()
    if not text:
        return

    payload = {
        "text": text,
        "telegram_chat_id": chat_id,
        "telegram_message_id": str(update.message.message_id),
    }

    headers = {"X-Internal-Secret": BACKEND_INTERNAL_SECRET}

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{BACKEND_BASE_URL}/api/telegram/ingest", json=payload, headers=headers)

    if resp.status_code >= 400:
        await _send_private(update, context, f"Backend error: HTTP {resp.status_code}: {resp.text[:2000]}")
        return

    data = resp.json()
    batch_id = data.get("batch_id")
    if not batch_id:
        await _send_private(update, context, f"Placed batch | {data}")
        return

    detail_text: str | None = None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            detail = await client.get(f"{BACKEND_BASE_URL}/api/batches/{batch_id}")
        if detail.status_code < 400:
            detail_text = _format_batch_detail(detail.json())
    except Exception:
        detail_text = None

    if not detail_text:
        detail_text = f"Placed batch #{batch_id} | success={data.get('success')} error={data.get('error')}"

    for part in _split_message(detail_text):
        await _send_private(update, context, part)


async def chatid(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat is None or update.message is None:
        return

    chat_id = str(update.effective_chat.id)

    # Never post in group; DM the requester or the configured notify chat.
    if update.effective_chat.type == "private":
        await update.message.reply_text(f"Chat ID: {chat_id}")
        return

    await _send_private(update, context, f"Chat ID: {chat_id}")


def main() -> None:
    _validate_env()

    try:
        app = Application.builder().token(BOT_TOKEN).build()

        async def _on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
            # Avoid noisy tracebacks; never post into the group.
            err = context.error
            if isinstance(err, Conflict):
                # Common when another instance is polling with the same bot token.
                print(
                    "Telegram Conflict: another getUpdates poller is running for this bot token. "
                    "Stop the other bot instance (or any other machine polling with the same token) and restart."
                )
                try:
                    await context.application.stop()
                except Exception:
                    return
                return

        app.add_error_handler(_on_error)
        app.add_handler(CommandHandler("chatid", chatid))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
        app.run_polling(allowed_updates=Update.ALL_TYPES)
    except InvalidToken:
        raise SystemExit(
            "Telegram rejected TELEGRAM_BOT_TOKEN. Re-check bot/.env and copy the token again from @BotFather."
        )


if __name__ == "__main__":
    main()
