# End-to-End Deployment Guide

This guide walks through **every step** from a fresh AWS account to a fully
running backend — including PostgreSQL, Firebase FCM, IPv6 per-user IP
assignment, Nginx, systemd, and automatic GitHub Actions CD.

---

## Overview

```
Mobile App
    │
    ▼ HTTPS
AWS EC2 (ap-south-1, 13.234.232.51)
    │
    ├── Nginx (port 80/443) ──► FastAPI / Uvicorn (port 8000)
    │                               │
    │                               ├── PostgreSQL (port 5432)
    │                               ├── Firebase Admin SDK (FCM push)
    │                               └── Dhan API  ←── bound to user's IPv6
    │
    └── ENI: 2406:da1a:c1e:f000:bb82::/80  (one address per user)
```

**GitHub Actions** deploys automatically on every push to `aws-prod`.

---

## Prerequisites

| Item | Value / Notes |
|------|--------------|
| AWS EC2 instance | `i-0cbb6ceca01ea6569` · `t3.micro` · Amazon Linux 2023 |
| Public IPv4 | `13.234.232.51` |
| IPv6 prefix on ENI | `2406:da1a:c1e:f000:bb82::/80` (already delegated — see `poc.md`) |
| SSH key | `dhan-test-key.pem` |
| GitHub repo | `aws-prod` branch pushed |
| Firebase project | needed for FCM push notifications |
| Dhan developer account | for registering per-user IPv6 addresses |

---

## Section A — GitHub Setup (one-time, from your laptop)

### A1. Push the aws-prod branch

```bash
git push -u origin aws-prod
```

### A2. Add GitHub Actions secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|-------------|-------|
| `AWS_EC2_HOST` | `13.234.232.51` |
| `AWS_EC2_USER` | `ec2-user` |
| `AWS_EC2_SSH_KEY` | Full contents of `dhan-test-key.pem` (including `-----BEGIN...` lines) |

After this, every push to `aws-prod` auto-deploys via `.github/workflows/cd-aws.yml`.

---

## Section B — EC2 First-Time Setup

SSH in:

```bash
ssh -i dhan-test-key.pem ec2-user@13.234.232.51
```

### B1. System packages

```bash
sudo dnf update -y
sudo dnf install -y git python3 python3-pip python3-venv nginx
```

### B2. PostgreSQL

```bash
sudo dnf install -y postgresql15-server postgresql15
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql

# Create the database and user
sudo -u postgres psql << 'EOF'
CREATE USER automate_user WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE automate_trading OWNER automate_user;
EOF
```

> **Production alternative:** Use AWS RDS PostgreSQL 16 (same VPC).
> Set `DATABASE_URL` accordingly and skip the above steps.

Configure pg_hba so password auth works locally:

```bash
sudo sed -i 's/^local\s\+all\s\+all\s\+peer/local   all             all                                     md5/' \
    /var/lib/pgsql/data/pg_hba.conf
sudo systemctl restart postgresql

# Test
psql -h localhost -U automate_user -d automate_trading -c '\l'
```

### B3. Clone the repository

```bash
sudo mkdir -p /var/www
sudo chown ec2-user:ec2-user /var/www
cd /var/www
git clone -b aws-prod https://github.com/YOUR_ORG/auto_trade.git
cd auto_trade
```

### B4. Python virtual environment

```bash
cd /var/www/auto_trade/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
```

### B5. Generate secrets

Run these commands and **save the output** — you need them for `.env`:

```bash
# Fernet encryption key (for Dhan access tokens)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Two random secrets (one for INTERNAL_SECRET, one for ADMIN_SECRET)
openssl rand -base64 32
openssl rand -base64 32
```

### B6. Create the .env file

```bash
cp /var/www/auto_trade/backend/.env.example /var/www/auto_trade/backend/.env
nano /var/www/auto_trade/backend/.env
```

Fill in every value:

```env
DATABASE_URL=postgresql+psycopg://automate_user:REPLACE_WITH_STRONG_PASSWORD@localhost:5432/automate_trading

CORS_ORIGINS=*

TOKEN_ENCRYPTION_KEY=<paste Fernet key from B5>
INTERNAL_SECRET=<paste first random secret from B5>
ADMIN_SECRET=<paste second random secret from B5>

AUTH_SESSION_HOURS=168
OTP_EXPIRY_MINUTES=10

# Email (for password-reset OTPs) — use a Gmail App Password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-gmail@gmail.com
SMTP_PASSWORD=your-gmail-app-password
SMTP_FROM_EMAIL=your-gmail@gmail.com

# Firebase (fill in after Section C)
FIREBASE_CREDENTIALS_PATH=/etc/automate-trading/firebase-service-account.json

# IPv6 pool — addresses ::10 onwards (::1–::f already used in POC testing)
IPV6_POOL_PREFIX=2406:da1a:c1e:f000:bb82:
IPV6_POOL_START=16
```

---

## Section C — Firebase Cloud Messaging (FCM)

FCM is used to push order signals to users' mobile devices.

### C1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `automate-trading`)
3. Disable Google Analytics if not needed → **Create project**

### C2. Generate a service account key

1. In Firebase Console → ⚙️ **Project Settings** → **Service accounts** tab
2. Click **Generate new private key** → **Generate key**
3. A JSON file downloads — keep it safe, it grants full Firebase admin access

### C3. Upload the key to EC2

From your laptop:

```bash
scp -i dhan-test-key.pem ~/Downloads/firebase-service-account.json \
    ec2-user@13.234.232.51:/tmp/firebase-key.json
```

On EC2:

```bash
sudo mkdir -p /etc/automate-trading
sudo mv /tmp/firebase-key.json /etc/automate-trading/firebase-service-account.json
sudo chmod 640 /etc/automate-trading/firebase-service-account.json
sudo chown root:ec2-user /etc/automate-trading/firebase-service-account.json
```

The path already matches `FIREBASE_CREDENTIALS_PATH` in your `.env`.

---

## Section D — Systemd Service

### D1. Create the service file

```bash
sudo tee /etc/systemd/system/automate-backend.service > /dev/null << 'EOF'
[Unit]
Description=Automate Trading — Dhan Backend
After=network.target postgresql.service

[Service]
Type=notify
User=ec2-user
WorkingDirectory=/var/www/auto_trade/backend
EnvironmentFile=/var/www/auto_trade/backend/.env
Environment="PATH=/var/www/auto_trade/backend/.venv/bin"
ExecStart=/var/www/auto_trade/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### D2. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable automate-backend
sudo systemctl start automate-backend

# Verify it started
sudo systemctl status automate-backend --no-pager
curl http://127.0.0.1:8000/health
# Expected: {"status":"ok"}
```

If it fails, check logs:

```bash
sudo journalctl -u automate-backend -n 50 --no-pager
```

---

## Section E — Nginx

### E1. Create the config

```bash
sudo tee /etc/nginx/conf.d/automate.conf > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 10M;

    location /api {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass  http://127.0.0.1:8000;
        access_log  off;
    }

    location /docs {
        proxy_pass http://127.0.0.1:8000;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:8000;
    }
}
EOF
```

### E2. Enable and test

```bash
sudo nginx -t                          # must print "syntax is ok"
sudo systemctl enable --now nginx

# Test from outside (replace with your machine IP if needed)
curl http://13.234.232.51/health
# Expected: {"status":"ok"}
```

### E3. HTTPS (strongly recommended for production)

```bash
# Requires a domain name pointed at 13.234.232.51
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
# Certbot auto-renews; verify:
sudo systemctl status certbot-renew.timer
```

---

## Section F — Security Group (AWS Console)

The current security group (`sg-063e1eb8d758a57c5`) allows SSH from anywhere.
Tighten it before going to production:

1. AWS Console → **EC2 → Security Groups → sg-063e1eb8d758a57c5 → Edit inbound rules**
2. Replace current rules with:

| Type | Protocol | Port | Source | Purpose |
|------|----------|------|--------|---------|
| SSH | TCP | 22 | Your office/home IP only | Admin access |
| HTTP | TCP | 80 | 0.0.0.0/0, ::/0 | Mobile app + LetsEncrypt |
| HTTPS | TCP | 443 | 0.0.0.0/0, ::/0 | Mobile app (after cert) |

---

## Section G — Bootstrap First Admin

Run these API calls from your laptop (or Postman):

### G1. Register your admin account

```bash
curl -s -X POST http://13.234.232.51/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin",
    "email": "admin@yourdomain.com",
    "phone_number": "+911234567890",
    "password": "StrongPass123!"
  }' | python3 -m json.tool
```

Expected response includes `"assigned_ipv6": "2406:da1a:c1e:f000:bb82::10"` — the first
auto-assigned address starting at pool_start=16 (0x10).

### G2. Promote to admin

```bash
curl -s -X POST http://13.234.232.51/api/auth/admin-bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "admin_secret": "PASTE_YOUR_ADMIN_SECRET_FROM_ENV",
    "email": "admin@yourdomain.com"
  }' | python3 -m json.tool
# Expected: {"status":"promoted","email":"...","role":"admin"}
```

### G3. Login and save the token

```bash
curl -s -X POST http://13.234.232.51/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourdomain.com",
    "password": "StrongPass123!"
  }' | python3 -m json.tool
```

Save the `access_token` — use it as `Authorization: Bearer <token>` in all
subsequent admin calls.

---

## Section H — Per-User Onboarding Flow

For each new Dhan client:

### H1. User registers via mobile app

`POST /api/auth/register` — the backend automatically assigns the next IPv6
address from the pool (e.g. `::11`, `::12`, …).

The assigned address is returned in the response as `assigned_ipv6`.

### H2. Admin registers that IPv6 with Dhan

The user's assigned IPv6 must be whitelisted in their Dhan account before
any orders can be placed.

Call Dhan's IP registration API **using that user's own Dhan access token**:

```bash
curl -X POST https://api.dhan.co/v2/ip/setIP \
  -H "access-token: USER_DHAN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"primaryIP": "2406:da1a:c1e:f000:bb82::11"}'
```

> This must be done once per user, from any machine. After this, Dhan only
> accepts orders for that account when the request originates from that IPv6.

### H3. User saves their Dhan credential via mobile app

`POST /api/users/me/dhan` — stores the Dhan client ID and access token
(encrypted at rest with Fernet).

### H4. Verify with the admin dashboard

```bash
curl -s http://13.234.232.51/api/admin/dashboard \
  -H "Authorization: Bearer ADMIN_TOKEN" | python3 -m json.tool
```

Check `users.with_ipv6_assigned` and `users.with_dhan_credential` counts.

---

## Section I — Adding More IPv6 Addresses (Scaling)

The existing `/80` prefix has room for billions of addresses.
When you need more than the 15 already configured on the OS (`::1`–`::f`),
add more stanzas to the persistent systemd-networkd drop-in on the EC2:

```bash
sudo nano /etc/systemd/network/70-ens5.network.d/90-client-static-ips.conf
```

Add new `[Address]` blocks (hex suffix, no leading zeros):

```ini
[Address]
Address=2406:da1a:c1e:f000:bb82::10/128
[Address]
Address=2406:da1a:c1e:f000:bb82::11/128
# ... up to however many users you have
```

Apply without a reboot:

```bash
sudo systemctl restart systemd-networkd
# Verify
ip -6 addr show ens5 | grep bb82
```

Addresses survive reboots automatically (this is the `/etc/systemd/network/`
persistent drop-in, not the runtime `/run/` one — see `poc.md` for details).

---

## Section J — Ongoing Operations

### Restart backend

```bash
sudo systemctl restart automate-backend
```

### View logs

```bash
sudo journalctl -u automate-backend -f          # live
sudo journalctl -u automate-backend -n 100      # last 100 lines
```

### Deploy a code update manually (CD does this automatically)

```bash
cd /var/www/auto_trade
git pull origin aws-prod
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
deactivate
sudo systemctl restart automate-backend
```

### API documentation (Swagger UI)

```
http://13.234.232.51/docs
```

### Check which IPv6 addresses are live on the instance

```bash
ip -6 addr show ens5 | grep "2406:da1a"
```

### Test egress from a specific user's IPv6

```bash
curl -6 --interface 2406:da1a:c1e:f000:bb82::10 https://icanhazip.com
# Must return exactly: 2406:da1a:c1e:f000:bb82::10
```

---

## Quick Reference

| Endpoint | Method | Who | Purpose |
|----------|--------|-----|---------|
| `/api/auth/register` | POST | User | Register + auto-get IPv6 |
| `/api/auth/login` | POST | User/Admin | Get bearer token |
| `/api/auth/admin-bootstrap` | POST | Setup | Promote first admin |
| `/api/users/me` | GET | User | Profile + assigned IPv6 |
| `/api/users/me/fcm-token` | PUT | User | Save device push token |
| `/api/users/me/dhan` | POST | User | Save Dhan credentials |
| `/api/users/me/notifications` | GET | User | Pending order signals |
| `/api/users/me/notifications/{id}/confirm` | POST | User | Confirm → places order |
| `/api/users/me/notifications/{id}/reject` | POST | User | Reject signal |
| `/api/admin/signals` | POST | Admin | Create + broadcast signal |
| `/api/admin/signals` | GET | Admin | List all signals |
| `/api/admin/signals/{id}` | GET | Admin | Signal + per-user status |
| `/api/admin/signals/{id}/cancel` | PUT | Admin | Cancel signal |
| `/api/admin/users` | GET | Admin | List all users |
| `/api/admin/users/{id}` | PUT | Admin | Assign IPv6 / role / active |
| `/api/admin/dashboard` | GET | Admin | Stats |
| `/health` | GET | Anyone | Health check |
