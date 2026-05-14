# Workspace: Automate Trading (Upstox GTT + Telegram)

## Stack
- Backend: FastAPI + SQLAlchemy (SQLite)
- Bot: python-telegram-bot (polling) -> calls backend
- Webapp: Angular -> updates token + consent

## Requirements & scope
- Focus only on Upstox GTT placement (no Redis/Celery/RQ).
- Webapp stores client tokens with consent.
- Telegram group message triggers batch placement for all consented clients.

## Key endpoints
- `POST /api/tokens` upsert client token (encrypted at rest)
- `GET /api/tokens` list client IDs + consent + updated time
- `POST /api/telegram/ingest` internal endpoint used by the bot

## Env vars
- Backend: `TOKEN_ENCRYPTION_KEY`, `INTERNAL_SECRET`, `DATABASE_URL`, `CORS_ORIGINS`
- Bot: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, `BACKEND_BASE_URL`, `BACKEND_INTERNAL_SECRET`

## Dev workflow (Windows)
- Backend: run `uvicorn app.main:app --reload --port 8000` from `backend/`
- Webapp: run `npm start` from `webapp/` (uses proxy to backend)
- Bot: run `python bot.py` from `bot/`
