# Deployment Guide: Hostinger VPS (No Domain)

This guide deploys the Automate Trading app on a Hostinger VPS using the server IP.

## Prerequisites

- Hostinger VPS with Ubuntu 22.04 or similar
- SSH access to the VPS
- Root or sudo access
- Your server's public IP address (e.g., `123.45.67.89`)

---

## Step 1: Prepare the VPS

SSH into your VPS:

```bash
ssh root@YOUR_SERVER_IP
```

Update packages:

```bash
apt update && apt upgrade -y
```

Install dependencies:

```bash
apt install -y git nginx postgresql postgresql-contrib python3 python3-venv python3-pip curl
```

Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
apt install -y nodejs
```

Verify versions:

```bash
python3 --version
node --version
npm --version
psql --version
```

---

## Step 2: Clone the Repository

Create the app directory:

```bash
mkdir -p /var/www
cd /var/www
```

Clone your repo (or upload via SFTP):

```bash
git clone https://github.com/YOUR_USERNAME/automate_trading.git
cd automate_trading
```

If you don't have Git set up, you can upload the folder via SFTP instead. The rest assumes it's in `/var/www/automate_trading`.

---

## Step 3: Setup PostgreSQL Database

Start PostgreSQL:

```bash
systemctl start postgresql
systemctl enable postgresql
```

Create the database and user:

```bash
sudo -u postgres psql << EOF
CREATE USER automate_user WITH PASSWORD 'YOUR_POSTGRES_PASSWORD';
CREATE DATABASE automate_trading OWNER automate_user;
ALTER ROLE automate_user SET client_encoding TO 'utf8';
ALTER ROLE automate_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE automate_user SET default_transaction_deferrable TO on;
ALTER ROLE automate_user SET default_transaction_level TO 'read committed';
\q
EOF
```

Replace `YOUR_POSTGRES_PASSWORD` with a strong password. Save it.

---

## Step 4: Backend Setup

Go to the backend folder:

```bash
cd /var/www/automate_trading/backend
```

Create a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

Generate encryption key:

```bash
python3 << EOF
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
EOF
```

Copy the output (it will look like `abc123...==`). You'll need it for `.env`.

Create `.env` file:

```bash
cat > .env << EOF
DATABASE_URL=postgresql+psycopg://automate_user:YOUR_POSTGRES_PASSWORD@localhost:5432/automate_trading
CORS_ORIGINS=http://YOUR_SERVER_IP:4000
TOKEN_ENCRYPTION_KEY=YOUR_ENCRYPTION_KEY_FROM_ABOVE
INTERNAL_SECRET=your-internal-secret-generate-this
ADMIN_SECRET=your-admin-secret-generate-this
UPSTOX_BASE_URL=https://api.upstox.com
UPSTOX_X_ALGO_NAME=
AUTH_SESSION_HOURS=168
OTP_EXPIRY_MINUTES=10
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-gmail@gmail.com
SMTP_PASSWORD=your-gmail-app-password
SMTP_FROM_EMAIL=your-gmail@gmail.com
EOF
```

Replace all `YOUR_*` values with actual values.

For `INTERNAL_SECRET` and `ADMIN_SECRET`, generate random strings:

```bash
openssl rand -base64 32
```

Run this twice, use each output for one secret.

Test the backend:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

You should see `Application startup complete`. Press `Ctrl+C` to stop.

---

## Step 5: Webapp Setup

Go to the webapp folder:

```bash
cd /var/www/automate_trading/webapp
```

Install dependencies:

```bash
npm install
```

Build for production:

```bash
npm run build
```

This will create a `dist/` folder with the compiled app and SSR server.

Test it:

```bash
BACKEND_BASE_URL=http://127.0.0.1:8000 node dist/webapp/server/server.mjs
```

Open another terminal and check if it works:

```bash
curl http://localhost:4000
```

You should see HTML. Press `Ctrl+C` to stop the server.

---

## Step 6: Bot Setup (Optional)

Go to the bot folder:

```bash
cd /var/www/automate_trading/bot
```

Create a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create `.env`:

```bash
cat > .env << EOF
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_ALLOWED_CHAT_ID=your-telegram-group-id
BACKEND_BASE_URL=http://127.0.0.1:8000
BACKEND_INTERNAL_SECRET=same-as-backend-INTERNAL_SECRET
EOF
```

Test it:

```bash
python bot.py
```

You should see `Bot started`. Press `Ctrl+C` to stop.

---

## Step 7: Create Systemd Services

### Backend Service

Create `/etc/systemd/system/automate-backend.service`:

```bash
sudo tee /etc/systemd/system/automate-backend.service > /dev/null << EOF
[Unit]
Description=Automate Trading Backend
After=network.target postgresql.service

[Service]
Type=notify
User=root
WorkingDirectory=/var/www/automate_trading/backend
Environment="PATH=/var/www/automate_trading/backend/.venv/bin"
ExecStart=/var/www/automate_trading/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### Webapp Service

Create `/etc/systemd/system/automate-webapp.service`:

```bash
sudo tee /etc/systemd/system/automate-webapp.service > /dev/null << EOF
[Unit]
Description=Automate Trading Webapp
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/automate_trading/webapp
Environment="BACKEND_BASE_URL=http://127.0.0.1:8000"
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node dist/webapp/server/server.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### Bot Service (Optional)

Create `/etc/systemd/system/automate-bot.service`:

```bash
sudo tee /etc/systemd/system/automate-bot.service > /dev/null << EOF
[Unit]
Description=Automate Trading Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/automate_trading/bot
Environment="PATH=/var/www/automate_trading/bot/.venv/bin"
ExecStart=/var/www/automate_trading/bot/.venv/bin/python bot.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

---

## Step 8: Enable and Start Services

Reload systemd:

```bash
sudo systemctl daemon-reload
```

Enable backend:

```bash
sudo systemctl enable automate-backend
sudo systemctl start automate-backend
```

Enable webapp:

```bash
sudo systemctl enable automate-webapp
sudo systemctl start automate-webapp
```

Enable bot (if you set it up):

```bash
sudo systemctl enable automate-bot
sudo systemctl start automate-bot
```

Check status:

```bash
sudo systemctl status automate-backend
sudo systemctl status automate-webapp
sudo systemctl status automate-bot
```

View logs:

```bash
sudo journalctl -u automate-backend -f
sudo journalctl -u automate-webapp -f
sudo journalctl -u automate-bot -f
```

---

## Step 9: Configure Nginx

Create `/etc/nginx/sites-available/automate`:

```bash
sudo tee /etc/nginx/sites-available/automate > /dev/null << EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:8000;
        access_log off;
    }
}
EOF
```

Enable the site:

```bash
sudo ln -sf /etc/nginx/sites-available/automate /etc/nginx/sites-enabled/automate
```

Remove default site (optional):

```bash
sudo rm /etc/nginx/sites-enabled/default
```

Test Nginx config:

```bash
sudo nginx -t
```

Reload Nginx:

```bash
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

## Step 10: Access Your App

Open your browser and go to:

```
http://YOUR_SERVER_IP
```

You should see the login page.

---

## Step 11: Verify Everything Works

1. **Register**: Click "Create account" and fill in the form.
2. **Login**: Log in with the account you just created.
3. **Add token**: Paste your Upstox token on the user page and click "Create Token".
4. **Admin panel**: Go to `http://YOUR_SERVER_IP/admin` and use your `ADMIN_SECRET` to log in.

---

## Useful Commands

### View logs

```bash
sudo journalctl -u automate-backend -n 50
sudo journalctl -u automate-webapp -n 50
```

### Restart services

```bash
sudo systemctl restart automate-backend
sudo systemctl restart automate-webapp
sudo systemctl restart automate-bot
```

### Stop services

```bash
sudo systemctl stop automate-backend
sudo systemctl stop automate-webapp
sudo systemctl stop automate-bot
```

### Check if ports are listening

```bash
sudo netstat -tlnp | grep -E '8000|4000'
```

### Check database

```bash
sudo -u postgres psql -d automate_trading
\dt  # list tables
\q   # quit
```

---

## Troubleshooting

### Backend won't start

```bash
sudo systemctl status automate-backend
sudo journalctl -u automate-backend -n 50
```

Check `.env` values, especially `DATABASE_URL` and `TOKEN_ENCRYPTION_KEY`.

### Webapp shows blank page

Check browser console for errors. View logs:

```bash
sudo journalctl -u automate-webapp -f
```

Ensure `BACKEND_BASE_URL=http://127.0.0.1:8000` is set in the webapp service.

### Can't connect to database

Test connection:

```bash
psql -h localhost -U automate_user -d automate_trading
```

Enter the password you set. If it fails, verify the password and database name match `.env`.

### Port already in use

If port `8000` or `4000` is already in use:

```bash
sudo lsof -i :8000
sudo lsof -i :4000
```

Kill the process or change the port in the systemd service and rebuild.

---

## Next Steps (Optional)

1. **Add a domain** with Hostinger and update `CORS_ORIGINS` to your domain.
2. **Enable HTTPS** with Certbot:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx
   ```
3. **Backups**: Set up automated backups of the database and app folder.
4. **Monitoring**: Use `htop` or Prometheus to monitor VPS health.

---

## Optional Step 12: Enable GitHub CI/CD

This repository includes:

1. `.github/workflows/ci.yml` for backend, bot, and webapp checks.
2. `.github/workflows/cd-hostinger.yml` for deploy on push to `main`.
3. `scripts/deploy.sh` to pull latest code, rebuild, restart services, and run health checks.

Before using CD, add these GitHub repository secrets:

1. `VPS_HOST` (server IP)
2. `VPS_USER` (for example `root`)
3. `VPS_SSH_KEY` (private SSH key content)
4. `VPS_PORT` (optional; default `22`)
5. `VPS_APP_DIR` (optional; default `/var/www/automate_trading`)
6. `DEPLOY_BOT` (optional; `true` or `false`)

After secrets are set:

1. Push to `main` to trigger deployment automatically.
2. Or run the `CD Hostinger` workflow manually from GitHub Actions.

---

## Support

If anything fails, check:

1. Service logs: `sudo journalctl -u SERVICE_NAME -n 50`
2. Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Database: `sudo -u postgres psql -l`
4. Open ports: `sudo netstat -tlnp`
