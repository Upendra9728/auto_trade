# Deployment Guide: AWS EC2 (aws-prod branch)

This backend runs on a single AWS EC2 instance with an **IPv6 prefix delegated
to the ENI** (`/80`).  Each user is assigned a unique IPv6 address carved from
that prefix so that Dhan's per-client IP whitelist requirement is satisfied
without running multiple servers.

Refer to `poc.md` for the full proof-of-concept and the IPv6 setup steps that
were already completed on the EC2 instance.

---

## Current AWS resources (ap-south-1 / Mumbai)

| Resource | ID / Value |
|----------|-----------|
| EC2 instance | `i-0cbb6ceca01ea6569` (`t3.micro`) |
| Public IPv4 | `13.234.232.51` |
| IPv6 prefix on ENI | `2406:da1a:c1e:f000:bb82::/80` |
| Key pair | `dhan-test-key` |

---

## 1. First-time server setup (Amazon Linux 2023)

```bash
ssh -i dhan-test-key.pem ec2-user@13.234.232.51

# System packages
sudo dnf update -y
sudo dnf install -y git nginx python3 python3-pip python3-venv postgresql15

# Clone the repo
sudo mkdir -p /var/www
sudo chown ec2-user:ec2-user /var/www
cd /var/www
git clone -b aws-prod https://github.com/YOUR_USERNAME/auto_trade.git
cd auto_trade
```

### PostgreSQL

Option A — AWS RDS PostgreSQL (recommended for production):
- Create an RDS PostgreSQL 16 instance in the same VPC
- Set `DATABASE_URL` in `.env` accordingly

Option B — PostgreSQL on EC2:
```bash
sudo dnf install -y postgresql15-server
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER automate_user WITH PASSWORD 'STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE automate_trading OWNER automate_user;"
```

---

## 2. Backend setup

```bash
cd /var/www/auto_trade/backend

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

cp .env.example .env
nano .env          # fill in all required values (see .env.example)
```

Generate encryption key:
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```
Paste the output as `TOKEN_ENCRYPTION_KEY` in `.env`.

Generate secure random secrets:
```bash
openssl rand -base64 32   # use twice — one each for INTERNAL_SECRET and ADMIN_SECRET
```

### Firebase service account (FCM push notifications)
1. Go to Firebase Console → Project Settings → Service Accounts → Generate new private key.
2. Upload the JSON to the EC2:
   ```bash
   scp -i dhan-test-key.pem firebase-service-account.json ec2-user@13.234.232.51:/etc/automate-trading/
   ```
3. Set `FIREBASE_CREDENTIALS_PATH=/etc/automate-trading/firebase-service-account.json` in `.env`.

Test the backend:
```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
# Should print "Application startup complete"
# Ctrl+C to stop
```

---

## 3. Systemd service

```bash
sudo tee /etc/systemd/system/automate-backend.service > /dev/null << 'EOF'
[Unit]
Description=Automate Trading — Dhan Backend
After=network.target

[Service]
Type=notify
User=ec2-user
WorkingDirectory=/var/www/auto_trade/backend
Environment="PATH=/var/www/auto_trade/backend/.venv/bin"
ExecStart=/var/www/auto_trade/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now automate-backend
sudo systemctl status automate-backend --no-pager
```

---

## 4. Nginx reverse proxy

```bash
sudo tee /etc/nginx/conf.d/automate.conf > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location /api {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:8000;
        access_log off;
    }

    location /docs {
        proxy_pass http://127.0.0.1:8000;
    }
}
EOF

sudo nginx -t
sudo systemctl enable --now nginx
```

For HTTPS (strongly recommended for production):
```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

---

## 5. GitHub Actions CD (automatic deploy on push to aws-prod)

Add these secrets to your GitHub repository
(**Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Value |
|--------|-------|
| `AWS_EC2_HOST` | `13.234.232.51` |
| `AWS_EC2_USER` | `ec2-user` |
| `AWS_EC2_SSH_KEY` | Contents of `dhan-test-key.pem` |
| `AWS_EC2_PORT` | `22` (optional) |
| `AWS_APP_DIR` | `/var/www/auto_trade` (optional) |

Once secrets are set, every push to `aws-prod` automatically:
1. SSHes into the EC2 instance
2. `git pull` from `aws-prod`
3. Updates Python dependencies
4. Restarts the systemd service
5. Polls `/health` until the service is healthy (or fails the deploy)

---

## 6. Assigning IPv6 addresses to users

After a user registers in the mobile app:
1. Log in as admin via the app (or API).
2. Call `PUT /api/admin/users/{user_id}` with `{"assigned_ipv6": "2406:da1a:c1e:f000:bb82::1"}`.
3. The user's Dhan account must have that IPv6 registered via `/v2/ip/setIP` in the Dhan developer portal.

Available test addresses (already persistent on the EC2):
`2406:da1a:c1e:f000:bb82::1` through `::f` (15 addresses, see `poc.md`).

For 1000+ users, add more `/[Address]` stanzas to
`/etc/systemd/network/70-ens5.network.d/90-client-static-ips.conf`
and restart `systemd-networkd` — no new AWS resources are needed.

---

## 7. Useful commands

```bash
# Logs
sudo journalctl -u automate-backend -f
sudo journalctl -u automate-backend -n 50

# Restart
sudo systemctl restart automate-backend

# Health check
curl http://127.0.0.1:8000/health

# API docs (FastAPI Swagger)
curl http://13.234.232.51/docs

# Database (if local Postgres)
sudo -u postgres psql -d automate_trading
```

---

## 8. First-run checklist

- [ ] Backend starts and `/health` returns `{"status": "ok"}`
- [ ] Register a user: `POST /api/auth/register`
- [ ] Bootstrap admin: `POST /api/auth/admin-bootstrap` with `ADMIN_SECRET`
- [ ] Admin logs in and assigns IPv6 to a test user
- [ ] Test user saves Dhan credential: `POST /api/users/me/dhan`
- [ ] Admin creates a signal: `POST /api/admin/signals`
- [ ] Test user confirms notification — verify order appears in Dhan account
