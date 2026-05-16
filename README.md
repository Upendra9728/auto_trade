# Automate Trading (Upstox GTT + Telegram)

This repo contains:
- `backend/`: FastAPI + SQLite DB to store client Upstox tokens and place **Upstox GTT** orders for all consented clients.
- `bot/`: Telegram bot that reads messages from a group and triggers batch GTT placement via the backend.
- `webapp/`: Angular app where users submit/update their Upstox access token (with consent).

## Server (VPS) quick commands

Basic service control (systemd):

```bash
sudo systemctl restart automate-backend
sudo systemctl restart automate-webapp
sudo systemctl restart automate-bot

sudo systemctl status automate-backend --no-pager
sudo systemctl status automate-webapp --no-pager
sudo systemctl status automate-bot --no-pager

sudo journalctl -u automate-backend -n 50
sudo journalctl -u automate-webapp -n 50
sudo journalctl -u automate-bot -n 50
```

Edit backend env on the server:

```bash
cd /var/www/automate_trading/backend
nano .env
sudo systemctl restart automate-backend
```

Edit bot env on the server:

```bash
cd /var/www/automate_trading/bot
nano .env
sudo systemctl restart automate-bot
```

Full VPS setup steps are in `DEPLOY.md`.

## 1) Backend (FastAPI)

### Setup (Windows PowerShell)

```powershell
cd c:\Users\kalle\Downloads\automate_trading\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

### Postgres setup

This backend is configured for Postgres by default.

Option A: Run Postgres with Docker (quick local dev):

```powershell
docker run --name automate-trading-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=automate_trading -p 5432:5432 -d postgres:16
```

Then ensure `backend/.env` has:

```dotenv
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/automate_trading
```

Option B: Use an existing Postgres instance

Set `DATABASE_URL` accordingly (user/password/host/db).

### Optional: SQL bootstrap script

If you want to create the tables manually (instead of letting SQLAlchemy auto-create on startup), run:

```powershell
psql -h localhost -U postgres -d automate_trading -f .\sql_setup.sql
```

The script is in `backend/sql_setup.sql`.

Generate an encryption key (required):

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Put it into `backend/.env` as `TOKEN_ENCRYPTION_KEY=...`.

Admin secret (required for admin-only token listing/deleting/updating):

```dotenv
ADMIN_SECRET=change-me
```

### Mock Upstox (optional, for testing)

If you want to test end-to-end without calling the real Upstox API, set this in `backend/.env`:

```dotenv
UPSTOX_BASE_URL=http://127.0.0.1:8000/mock/upstox
```

This uses the backend's built-in mock endpoint `POST /mock/upstox/v3/order/gtt/place`.

The mock endpoint now validates the full payload shape (type/quantity/product/instrument_token/transaction_type/rules)
and returns an Upstox-like JSON response including `status=success` and `data.gtt_order_ids`.

Example request (PowerShell):

```powershell
$body = @{
  type = "SINGLE"
  quantity = 1
  product = "D"
  instrument_token = "NSE_EQ|INE669E01016"
  transaction_type = "BUY"
  rules = @(
    @{ strategy = "ENTRY"; trigger_type = "ABOVE"; trigger_price = 6; market_protection = -1 }
  )
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8000/mock/upstox/v3/order/gtt/place" `
  -Headers @{ Authorization = "Bearer mock-token" } `
  -ContentType "application/json" `
  -Body $body
```

Example response:

```json
{
  "status": "success",
  "message": "GTT order placed successfully (mock)",
  "data": {
    "gtt_order_ids": ["gtt_20260508123456_ab12cd34"],
    "submitted_order": {"type": "SINGLE", "quantity": 1, "product": "D", "instrument_token": "NSE_EQ|INE669E01016", "transaction_type": "BUY", "rules": [/* ... */]}
  },
  "meta": {"mock": true, "timestamp": "2026-05-08T12:34:56.789Z"}
}
```

Run:

```powershell
uvicorn app.main:app --reload --port 8000
```

### Useful endpoints
- `POST /api/tokens` upsert a client token
- `GET /api/tokens` list clients
- `POST /api/telegram/ingest` (internal, used by bot)
- `GET /api/batches?limit=20` list recent batches (includes per-client results)
- `GET /api/batches/{batch_id}` get one batch (includes per-client results)

## 2) Telegram Bot

```powershell
cd c:\Users\kalle\Downloads\automate_trading\bot
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python bot.py
```

Tips:
- Send `/chatid` in the group to get the chat id to put into `TELEGRAM_ALLOWED_CHAT_ID`.
- The bot does not post any status/errors in the group. Set `TELEGRAM_NOTIFY_CHAT_ID` so results are sent to a private chat (you may need to start a DM with the bot first).

## 3) Web App (Angular)

Scaffolded in `webapp/`.

```powershell
cd c:\Users\kalle\Downloads\automate_trading\webapp
npm install
npm start
```

Open `http://localhost:4200`.

Pages:
- `http://localhost:4200/user` user page (save your client id + token)
- `http://localhost:4200/admin` admin page (requires `ADMIN_SECRET`)

## Telegram message formats

### Option A: JSON (recommended)
Paste a JSON object in the message:

```json
{
  "type": "SINGLE",
  "quantity": 1,
  "product": "D",
  "instrument_token": "NSE_EQ|INE669E01016",
  "transaction_type": "BUY",
  "rules": [
    {"strategy": "ENTRY", "trigger_type": "ABOVE", "trigger_price": 6, "market_protection": -1}
  ]
}
```

### Option B: key:value lines

```
type: SINGLE
quantity: 1
product: D
instrument_token: NSE_EQ|INE669E01016
transaction_type: BUY
rule: ENTRY ABOVE 6
```

Notes:
- Backend places **the same GTT** for every consented client token stored in DB.
- For SELL legs, Upstox may require EDIS authorization (per Upstox docs).
