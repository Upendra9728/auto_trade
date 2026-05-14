-- Postgres schema for Automate Trading (Upstox GTT + Telegram)
-- Matches the SQLAlchemy models in backend/app/models.py
--
-- Usage:
--   psql -h localhost -U postgres -d automate_trading -f sql_setup.sql
--
-- Notes:
-- - Uses IF NOT EXISTS so it is safe to re-run.
-- - This does not manage migrations; it is a one-time bootstrap script.

BEGIN;

CREATE TABLE IF NOT EXISTS client_tokens (
    id BIGSERIAL PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL UNIQUE,
    consent BOOLEAN NOT NULL DEFAULT TRUE,
    access_token_encrypted TEXT NOT NULL,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_client_tokens_client_id ON client_tokens (client_id);


CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    phone_number VARCHAR(32) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);


CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_user_sessions_token_hash ON user_sessions (token_hash);


CREATE TABLE IF NOT EXISTS password_reset_otps (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp_hash VARCHAR(128) NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITHOUT TIME ZONE NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_password_reset_otps_user_id ON password_reset_otps (user_id);
CREATE INDEX IF NOT EXISTS ix_password_reset_otps_otp_hash ON password_reset_otps (otp_hash);


CREATE TABLE IF NOT EXISTS order_batches (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    source VARCHAR(32) NOT NULL DEFAULT 'telegram',
    raw_text TEXT NOT NULL,
    parsed_payload_json TEXT NOT NULL,
    telegram_chat_id VARCHAR(64) NULL,
    telegram_message_id VARCHAR(64) NULL
);


CREATE TABLE IF NOT EXISTS order_results (
    id BIGSERIAL PRIMARY KEY,
    batch_id BIGINT NOT NULL REFERENCES order_batches(id) ON DELETE CASCADE,
    client_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    gtt_order_ids TEXT NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),

    CONSTRAINT uq_batch_client UNIQUE (batch_id, client_id)
);

CREATE INDEX IF NOT EXISTS ix_order_results_batch_id ON order_results (batch_id);
CREATE INDEX IF NOT EXISTS ix_order_results_client_id ON order_results (client_id);

COMMIT;
