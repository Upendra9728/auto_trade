# Backend context

## What this backend does
This FastAPI service powers the Dhan ordering workflow for the mobile app.
It stores user accounts, Dhan credentials, assigned IPv6 addresses, trading signals, and per-user notification/order status.

The key business flow is:
1. Admin creates a trading signal.
2. The backend creates one notification per eligible user.
3. A user confirms a notification.
4. The backend immediately sends a Dhan super-order request from the user’s assigned IPv6 address.

## Main stack
- FastAPI
- SQLAlchemy + SQLite (default config; Postgres is also supported via DATABASE_URL)
- Pydantic models / schemas
- httpx for outbound Dhan API calls
- cryptography for encrypted token storage

## Important architecture
- Entry point: backend/app/main.py
- Settings/env: backend/app/config.py
- DB init & session handling: backend/app/db.py
- Auth/session logic: backend/app/auth.py, backend/app/routers/auth.py
- Dependency injection / auth dependency: backend/app/deps.py
- Models: backend/app/models.py
- Order execution: backend/app/order_service.py and backend/app/dhan_client.py
- Notifications / FCM: backend/app/notifications.py
- IPv6 allocation: backend/app/ipv6_pool.py
- Dhan token auto-renewal: backend/app/token_refresh.py

## Core data model
- User
  - account, role, assigned_ipv6, fcm_token, is_active
- DhanCredential
  - per-user Dhan client ID + encrypted access token + token_expires_at (UTC)
- Signal
  - admin-created trading signal with price / target / stop-loss / trailing jump
- SignalNotification
  - per-user state for a signal: pending, confirmed, rejected, placed, failed
- UserSession
  - login/session tokens
- PasswordResetOtp
  - reset flow support

## Key behaviors
### Authentication
- Registration and login are handled by the auth router.
- Login creates a session token stored in the DB.
- The mobile client sends the token in the Authorization header.

### Dhan credential handling
- Users save their Dhan client ID and access token through the user router.
- An optional `token_expires_at` (UTC) can be sent alongside the token so the backend knows when to renew.
- Access tokens are encrypted before storage.
- The backend validates that the user has an active Dhan credential and an assigned IPv6 before placing an order.

### Automatic token renewal
- `token_refresh.py` runs as an asyncio background task started at app startup.
- Every hour it queries all active credentials whose `token_expires_at` is within 2 hours, or whose `updated_at` is 22+ hours old (covers manually pasted tokens with no known expiry).
- For each, it calls Dhan's `POST /v2/RenewToken` API, re-encrypts the new token, and updates `token_expires_at`.
- `order_service.py` also performs a just-in-time renewal check immediately before placing an order (threshold: <30 min to expiry, or age >23.5 h).
- `DhanClient.renew_token()` in `dhan_client.py` handles the HTTP call.
- Dhan's `expiryTime` is IST; `token_refresh.parse_dhan_expiry()` converts it to UTC before storing.
- RenewToken only works for active tokens. If a token is already expired, the user must paste a fresh one once.

### Signal broadcasting
- Admin creates a signal through POST /api/admin/signals.
- Eligible users are those who are active, have an active Dhan credential, and have an assigned IPv6.
- A SignalNotification row is created for each eligible user.

### Order placement
- When a user confirms a notification, the backend calls place_order_for_notification.
- It decrypts the stored token, builds the Dhan payload, and sends it with httpx.
- The outbound request is bound to the user’s assigned IPv6 so Dhan can see the correct source IP.

## Current important implementation note
The current order flow passes the signal values directly to Dhan:
- price
- target_price
- stop_loss_price
- trailing_jump

There is no extra buffer/offset logic in the backend today. The values are sent as-is unless the signal itself was created with modified values.

## Environment variables
Required or commonly used:
- TOKEN_ENCRYPTION_KEY
- INTERNAL_SECRET
- DATABASE_URL
- CORS_ORIGINS
- ADMIN_SECRET
- SMTP_* (for password reset emails)
- FIREBASE_* (for FCM notifications)
- IPV6_POOL_PREFIX / IPV6_POOL_START (optional)

## Useful run commands
From backend/:
- python -m venv .venv
- .\.venv\Scripts\Activate.ps1
- pip install -r requirements.txt
- copy .env.example .env
- uvicorn app.main:app --reload --port 8000

## Key API areas
- Auth: /api/auth/*
- User: /api/users/*
- Admin: /api/admin/*
- Health: /health

### Admin excel exports
- `GET /api/admin/users/export` — all users (respects `search`/`date_from`/`date_to`) as `.xlsx`.
- `GET /api/admin/orders/export` — all `SignalNotification` rows across all signals (respects `date_from`/`date_to`, filtered on notification `created_at`) as `.xlsx`, one row per user/signal with quantity, status, live exchange status, traded qty/price, etc.
- Both return a `StreamingResponse` built by `backend/app/xlsx_export.py` (`openpyxl`), with `Content-Disposition: attachment`.
- Route ordering note: `/users/export` must be declared before `/users/{user_id}` or FastAPI/Starlette will try to match it as a user_id path param first.

## Notes for future LLMs
- Do not assume this is an Upstox/GTT project; the current implementation is centered on Dhan super-order placement.
- The most important files for order behavior are:
  - backend/app/order_service.py
  - backend/app/dhan_client.py
  - backend/app/models.py
  - backend/app/routers/user.py
  - backend/app/routers/admin.py
- Token auto-renewal logic lives in `token_refresh.py`. Do not remove the `asyncio.create_task(token_refresh_loop())` call in `main.py`.
- `db.py` contains `_apply_migrations()` which runs on startup and handles column additions for existing databases. Add future schema additions there.
- All datetimes in the DB are UTC naive. Dhan's `expiryTime` is IST and must be converted (subtract 5h30m) before storing.
