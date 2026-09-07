"""
Standalone Telegram bot process: listens to the admin's Telegram group and forwards
every message to the backend's /api/telegram/ingest endpoint. The backend decides
whether a message is a well-formed trading signal (and creates it) or ignores it —
this process does no signal validation itself beyond emoji cleanup.

Run separately from the FastAPI backend:
    python bot.py

Env vars (see .env.example):
    TELEGRAM_BOT_TOKEN        - bot token from @BotFather
    TELEGRAM_ALLOWED_CHAT_IDS - comma-separated chat ids to forward messages from (preferred)
    TELEGRAM_ALLOWED_CHAT_ID  - single chat id (legacy, still supported if the plural var isn't set)
    BACKEND_BASE_URL          - e.g. http://localhost:8000
    BACKEND_INTERNAL_SECRET   - must match the backend's INTERNAL_SECRET env var
"""

from __future__ import annotations

import logging
import os
import re

import httpx
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

load_dotenv()

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]

_allowed_ids_raw = os.environ.get("TELEGRAM_ALLOWED_CHAT_IDS")
if _allowed_ids_raw:
    TELEGRAM_ALLOWED_CHAT_IDS = [int(cid.strip()) for cid in _allowed_ids_raw.split(",") if cid.strip()]
else:
    TELEGRAM_ALLOWED_CHAT_IDS = [int(os.environ["TELEGRAM_ALLOWED_CHAT_ID"])]

BACKEND_BASE_URL = os.environ["BACKEND_BASE_URL"].rstrip("/")
BACKEND_INTERNAL_SECRET = os.environ["BACKEND_INTERNAL_SECRET"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("telegram_bot")

# Same emoji ranges stripped by backend/app/signal_parser.py, kept in sync so logs
# already show the cleaned text the backend will see.
_EMOJI_PATTERN = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E6-\U0001F1FF"
    "\U00002190-\U000021FF"
    "\U00002B00-\U00002BFF"
    "\U0000FE0F"
    "\U0000200D"
    "]+",
    flags=re.UNICODE,
)


def _strip_emojis(text: str) -> str:
    return _EMOJI_PATTERN.sub("", text)


async def log_chat_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Always-on discovery aid: logs chat id/title/username for every message the bot sees,
    so a newly-added Telegram group's chat_id can be read from the logs and added to
    TELEGRAM_ALLOWED_CHAT_IDS — regardless of whether it's currently allow-listed."""
    chat = update.effective_chat
    if chat is None:
        return
    logger.info("Message seen in chat_id=%s title=%r username=%r", chat.id, chat.title, chat.username)


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if message is None or not message.text:
        return

    cleaned = _strip_emojis(message.text)
    chat = update.effective_chat
    channel_name = (chat.username or chat.title or "") if chat else ""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{BACKEND_BASE_URL}/api/telegram/ingest",
                json={"raw_text": cleaned, "channel_name": channel_name},
                headers={"X-Internal-Secret": BACKEND_INTERNAL_SECRET},
            )
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code >= 400:
            logger.warning("Ingest rejected (HTTP %s): %s", resp.status_code, data or resp.text[:300])
        elif data.get("created"):
            logger.info("Signal created: %s (id=%s)", data.get("title"), data.get("signal_id"))
        else:
            logger.info("Message ignored: %s", data.get("reason"))
    except Exception:
        logger.exception("Failed to forward message to backend")
    # No reply is ever posted back to the group, by design.


def main() -> None:
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    # Discovery handler runs for every message the bot receives (group_id=0), regardless of allow-list.
    app.add_handler(MessageHandler(filters.TEXT, log_chat_id), group=0)
    app.add_handler(
        MessageHandler(filters.Chat(chat_id=TELEGRAM_ALLOWED_CHAT_IDS) & filters.TEXT, handle_message),
        group=1,
    )
    logger.info("Telegram bot starting (polling), listening to chats %s", TELEGRAM_ALLOWED_CHAT_IDS)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
