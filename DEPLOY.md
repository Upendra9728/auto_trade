# End-to-End Deployment Guide

This guide starts from a **blank AWS account** and ends with a fully running
production backend with per-user IPv6 order placement.

```
Mobile App
    │
    ▼ HTTPS
AWS EC2 (ap-south-1)
    │
    ├── Nginx (80/443) ──► FastAPI / Uvicorn (8000)
    │                           │
    │                           ├── PostgreSQL (5432)
    │                           ├── Firebase Admin SDK (FCM push)
    │                           └── Dhan API  ◄── bound to user's IPv6
    │
    └── ENI  ←── /80 IPv6 prefix (one address per user, survives reboots)
```

---

## Section A — AWS Infrastructure (one-time)

Do everything in **ap-south-1 (Mumbai)** for lowest latency to Dhan.

> **CloudShell tip:** Use the region dropdown in the top-right of the AWS
> Console UI to select Mumbai *before* opening CloudShell. The env var
> `AWS_DEFAULT_REGION` takes precedence over `aws configure set region`.

Open **CloudShell** (or use the AWS CLI locally with your credentials).

### A1. VPC with IPv6

```bash
# Create VPC
VPC_ID=$(aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --amazon-provided-ipv6-cidr-block \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=automate-trading-vpc}]' \
  --query 'Vpc.VpcId' --output text)
echo "VPC: $VPC_ID"

# Enable DNS
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support

# Get the Amazon-provided IPv6 CIDR (e.g. 2406:da1a:xxxx:xx00::/56)
IPV6_CIDR=$(aws ec2 describe-vpcs --vpc-ids $VPC_ID \
  --query 'Vpcs[0].Ipv6CidrBlockAssociationSet[0].Ipv6CidrBlock' --output text)
echo "VPC IPv6 CIDR: $IPV6_CIDR"
# Save this — you will need the prefix later for the IPv6 pool config
```

### A2. Subnet

```bash
# Use the first /64 from the /56 block (replace the last octet of the prefix with 00)
SUBNET_IPV6=$(echo $IPV6_CIDR | sed 's|/56|/64|' | sed 's|00::/64|00::/64|')

SUBNET_ID=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID \
  --cidr-block 10.0.1.0/24 \
  --ipv6-cidr-block $SUBNET_IPV6 \
  --availability-zone ap-south-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=automate-trading-subnet}]' \
  --query 'Subnet.SubnetId' --output text)
echo "Subnet: $SUBNET_ID"

# Auto-assign public IPv4 on launch
aws ec2 modify-subnet-attribute --subnet-id $SUBNET_ID --map-public-ip-on-launch

# Auto-assign IPv6 on launch
aws ec2 modify-subnet-attribute --subnet-id $SUBNET_ID \
  --assign-ipv6-address-on-creation
```

### A3. Internet Gateway

```bash
IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=automate-trading-igw}]' \
  --query 'InternetGateway.InternetGatewayId' --output text)
aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID
echo "IGW: $IGW_ID"
```

### A4. Route table

```bash
RTB_ID=$(aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=association.main,Values=true" \
  --query 'RouteTables[0].RouteTableId' --output text)

# Default IPv4 route
aws ec2 create-route --route-table-id $RTB_ID \
  --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID

# Default IPv6 route
aws ec2 create-route --route-table-id $RTB_ID \
  --destination-ipv6-cidr-block ::/0 --gateway-id $IGW_ID

echo "Routes added to $RTB_ID"
```

### A5. Security group

```bash
SG_ID=$(aws ec2 create-security-group \
  --group-name automate-trading-sg \
  --description "Automate Trading backend" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text)

# SSH — restrict to your IP in production; use 0.0.0.0/0 only for initial setup
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 22 --cidr 0.0.0.0/0

# HTTP
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 80 --ipv6-cidr ::/0

# HTTPS
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 443 --ipv6-cidr ::/0

echo "Security group: $SG_ID"
```

### A6. Key pair

```bash
# Creates the key and saves it locally in CloudShell
aws ec2 create-key-pair --key-name automate-trading-key \
  --query 'KeyMaterial' --output text > ~/automate-trading-key.pem
chmod 400 ~/automate-trading-key.pem
echo "Key saved to ~/automate-trading-key.pem"
```

> Download the `.pem` file from CloudShell (Actions → Download file) and keep
> it somewhere safe — you cannot download it again.

### A7. Launch EC2 instance

```bash
# Amazon Linux 2023 in ap-south-1 (verify latest AMI if needed)
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters 'Name=name,Values=al2023-ami-2023*-x86_64' \
            'Name=state,Values=available' \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
echo "Using AMI: $AMI_ID"

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t3.small \
  --key-name automate-trading-key \
  --security-group-ids $SG_ID \
  --subnet-id $SUBNET_ID \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=automate-trading}]' \
  --query 'Instances[0].InstanceId' --output text)
echo "Instance: $INSTANCE_ID"

# Wait for it to be running
aws ec2 wait instance-running --instance-ids $INSTANCE_ID

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "Public IP: $PUBLIC_IP"
```

> Note: Use **t3.small** (or larger) rather than t3.micro.
> t3.micro allows only 2 IPv6 slots per ENI (individual addresses + prefixes
> combined). t3.small allows more, giving you headroom for the prefix
> delegation plus any individually-assigned addresses.

### A8. Delegate an IPv6 /80 prefix to the ENI

```bash
ENI_ID=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].NetworkInterfaces[0].NetworkInterfaceId' \
  --output text)
echo "ENI: $ENI_ID"

aws ec2 assign-ipv6-addresses \
  --network-interface-id $ENI_ID \
  --ipv6-prefix-count 1

# Confirm the delegated prefix
aws ec2 describe-network-interfaces --network-interface-ids $ENI_ID \
  --query 'NetworkInterfaces[0].Ipv6Prefixes'
# Output example: [{"Ipv6Prefix": "2406:da1a:xxxx:xx00:abcd::/80"}]
# Save the prefix — you need it for .env  (IPV6_POOL_PREFIX)
```

---

## Section B — OS IPv6 Setup (SSH into the instance)

```bash
ssh -i automate-trading-key.pem ec2-user@<PUBLIC_IP>
```

### B1. Find the network interface name

```bash
ip link show
# Usually 'ens5' on Amazon Linux 2023 / Nitro instances
IFACE=ens5
```

### B2. Configure static IPv6 addresses (persistent across reboots)

Amazon Linux 2023 uses `systemd-networkd`. The correct place for
persistent custom addresses is a drop-in in `/etc/systemd/network/`
(not `/run/systemd/network/` which is wiped on reboot).

```bash
sudo mkdir -p /etc/systemd/network/70-${IFACE}.network.d

# Replace 2406:da1a:xxxx:xx00:abcd: with your actual delegated prefix
sudo tee /etc/systemd/network/70-${IFACE}.network.d/90-client-static-ips.conf > /dev/null << 'EOF'
# Add one [Address] block per user.
# Addresses ::1 onward; the app auto-assigns starting from IPV6_POOL_START.
# You only need to list addresses here that the OS should bind.
# Start with a batch; add more as users register (no reboot required).
[Address]
Address=2406:da1a:xxxx:xx00:abcd::1/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::2/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::3/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::4/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::5/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::6/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::7/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::8/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::9/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::a/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::b/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::c/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::d/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::e/128
[Address]
Address=2406:da1a:xxxx:xx00:abcd::f/128
EOF

sudo systemctl restart systemd-networkd
```

Verify all addresses are live:

```bash
ip -6 addr show $IFACE | grep "2406:da1a"
# Should list all 15 addresses
```

Test egress from one address:

```bash
curl -6 --interface 2406:da1a:xxxx:xx00:abcd::1 https://icanhazip.com
# Must return exactly: 2406:da1a:xxxx:xx00:abcd::1
```

> If curl returns the wrong IP, see **Troubleshooting** at the bottom.

---

## Section C — Application Setup

### C1. System packages

```bash
sudo dnf update -y
sudo dnf install -y git python3 python3-pip python3-venv nginx
```

### C2. PostgreSQL

```bash
sudo dnf install -y postgresql15-server postgresql15
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql

sudo -u postgres psql << 'EOF'
CREATE USER automate_user WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE automate_trading OWNER automate_user;
EOF

# Enable password auth for local connections
sudo sed -i \
  's/^local\s\+all\s\+all\s\+peer/local   all             all                                     md5/' \
  /var/lib/pgsql/data/pg_hba.conf
sudo systemctl restart postgresql

# Test
psql -h localhost -U automate_user -d automate_trading -c '\l'
```

### C3. Clone the repository

```bash
sudo mkdir -p /var/www
sudo chown ec2-user:ec2-user /var/www
cd /var/www
git clone -b aws-prod https://github.com/YOUR_ORG/auto_trade.git
cd auto_trade
```

### C4. Python virtual environment

```bash
cd /var/www/auto_trade/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
```

### C5. Generate secrets

```bash
# Run each command and copy the output:

# 1. Fernet key (encrypts Dhan tokens in DB)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# 2. INTERNAL_SECRET
openssl rand -base64 32

# 3. ADMIN_SECRET
openssl rand -base64 32
```

### C6. Create .env

```bash
cp /var/www/auto_trade/backend/.env.example /var/www/auto_trade/backend/.env
nano /var/www/auto_trade/backend/.env
```

Fill in every value — replace ALL placeholders:

```env
DATABASE_URL=postgresql+psycopg://automate_user:REPLACE_WITH_STRONG_PASSWORD@localhost:5432/automate_trading

CORS_ORIGINS=*

TOKEN_ENCRYPTION_KEY=<Fernet key from C5 step 1>
INTERNAL_SECRET=<random secret from C5 step 2>
ADMIN_SECRET=<random secret from C5 step 3>

AUTH_SESSION_HOURS=168
OTP_EXPIRY_MINUTES=10

# Email — required for password-reset OTPs
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-gmail@gmail.com
SMTP_PASSWORD=your-gmail-app-password
SMTP_FROM_EMAIL=your-gmail@gmail.com

# Firebase — fill in after Section D
FIREBASE_CREDENTIALS_PATH=/etc/automate-trading/firebase-service-account.json

# IPv6 pool — use YOUR actual delegated prefix, e.g. 2406:da1a:xxxx:xx00:abcd:
# The app assigns ::1, ::2, ... starting at IPV6_POOL_START
IPV6_POOL_PREFIX=2406:da1a:xxxx:xx00:abcd:
IPV6_POOL_START=1

# Telegram <-> app signal integration — see Section E2 for the bot/ process itself.
# TELEGRAM_BOT_TOKEN: from @BotFather. TELEGRAM_GROUP_CHAT_ID: the admin group's chat id
# (send any message in the group, then GET https://api.telegram.org/bot<TOKEN>/getUpdates
# and read the "chat":{"id": ...} field — group privacy mode must be disabled in BotFather
# for the bot to see normal messages, not just commands).
TELEGRAM_BOT_TOKEN=<bot token from @BotFather>
TELEGRAM_GROUP_CHAT_ID=<admin group chat id, e.g. -1001234567890>
TELEGRAM_SIGNAL_ADMIN_EMAIL=<email of the admin user Telegram signals are attributed to>
```

---

## Section D — Firebase Cloud Messaging (FCM)

### D1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → enter a name → **Create project**

### D2. Generate a service account key

1. **Project Settings** (⚙️) → **Service accounts** tab
2. Click **Generate new private key** → **Generate key**
3. A JSON file downloads — this is your Firebase credentials

### D3. Upload to EC2

From your laptop:

```bash
scp -i automate-trading-key.pem ~/Downloads/firebase-key.json \
    ec2-user@<PUBLIC_IP>:/tmp/firebase-key.json
```

On EC2:

```bash
sudo mkdir -p /etc/automate-trading
sudo mv /tmp/firebase-key.json /etc/automate-trading/firebase-service-account.json
sudo chmod 640 /etc/automate-trading/firebase-service-account.json
sudo chown root:ec2-user /etc/automate-trading/firebase-service-account.json
```

---

## Section E — Systemd Service

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

sudo systemctl daemon-reload
sudo systemctl enable automate-backend
sudo systemctl start automate-backend

# Verify
sudo systemctl status automate-backend --no-pager
curl http://127.0.0.1:8000/health
# Expected: {"status":"ok"}
```

If it fails:

```bash
sudo journalctl -u automate-backend -n 50 --no-pager
```

---

## Section E2 — Telegram Bot (systemd service)

The bot is a separate standalone process (`bot/`) — it does not run inside the
FastAPI backend. It needs its own virtual environment and its own `.env`
(never committed — `bot/.env.example` only holds placeholders).

### E2.1 Virtual environment

```bash
cd /var/www/auto_trade/bot
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
```

### E2.2 Create .env

```bash
cp /var/www/auto_trade/bot/.env.example /var/www/auto_trade/bot/.env
nano /var/www/auto_trade/bot/.env
```

```env
TELEGRAM_BOT_TOKEN=<same bot token as backend's TELEGRAM_BOT_TOKEN>
TELEGRAM_ALLOWED_CHAT_ID=<same value as backend's TELEGRAM_GROUP_CHAT_ID>
BACKEND_BASE_URL=http://127.0.0.1:8000
BACKEND_INTERNAL_SECRET=<same value as backend's INTERNAL_SECRET>
```

### E2.3 Systemd service

```bash
sudo tee /etc/systemd/system/automate-telegram-bot.service > /dev/null << 'EOF'
[Unit]
Description=Automate Trading — Telegram Bot
After=network.target automate-backend.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/var/www/auto_trade/bot
EnvironmentFile=/var/www/auto_trade/bot/.env
Environment="PATH=/var/www/auto_trade/bot/.venv/bin"
ExecStart=/var/www/auto_trade/bot/.venv/bin/python bot.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now automate-telegram-bot

# Verify
sudo systemctl status automate-telegram-bot --no-pager
```

If it fails:

```bash
sudo journalctl -u automate-telegram-bot -n 50 --no-pager
```

> The GitHub Actions CD workflow (Section G) reinstalls `bot/requirements.txt`
> into `bot/.venv` and restarts `automate-telegram-bot` on every push, exactly
> like the backend — no manual redeploy needed after this one-time setup.

---

## Section F — Nginx

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
        proxy_pass http://127.0.0.1:8000;
        access_log off;
    }

    location /docs        { proxy_pass http://127.0.0.1:8000; }
    location /openapi.json { proxy_pass http://127.0.0.1:8000; }
}
EOF

sudo nginx -t                          # must print "syntax is ok"
sudo systemctl enable --now nginx
```

Test from outside:

```bash
curl http://<PUBLIC_IP>/health
# Expected: {"status":"ok"}
```

### HTTPS (recommended for production)

```bash
# Requires a domain name pointed at <PUBLIC_IP>
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
sudo systemctl status certbot-renew.timer   # verify auto-renewal
```

---

## Section G — GitHub Actions CD

### G1. Add secrets to GitHub

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|-------|
| `AWS_EC2_HOST` | `<PUBLIC_IP>` |
| `AWS_EC2_USER` | `ec2-user` |
| `AWS_EC2_SSH_KEY` | Full contents of `automate-trading-key.pem` |

### G2. How it works

Every push to `aws-prod` triggers `.github/workflows/cd-aws.yml`:

1. SSHes into the EC2 instance
2. `git pull` from `aws-prod`
3. Updates backend Python dependencies, restarts `automate-backend`, polls `/health`
4. Updates bot Python dependencies, restarts `automate-telegram-bot`, checks it's active
5. Fails the deploy if either service doesn't come up healthy

> Requires the one-time `bot/.venv` setup and `automate-telegram-bot` systemd
> service from Section E2 to already exist on the server.

---

## Section H — Bootstrap First Admin

Run from your laptop (or Postman/curl). Replace `<PUBLIC_IP>` and secrets.

```bash
BASE=http://<PUBLIC_IP>

# 1. Register your account (gets auto-assigned first IPv6 ::1)
curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin",
    "email": "admin@yourdomain.com",
    "phone_number": "+911234567890",
    "password": "StrongPass123!"
  }' | python3 -m json.tool

# 2. Promote to admin using ADMIN_SECRET from .env
curl -s -X POST $BASE/api/auth/admin-bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "admin_secret": "YOUR_ADMIN_SECRET",
    "email": "admin@yourdomain.com"
  }' | python3 -m json.tool

# 3. Login — save the access_token from the response
curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourdomain.com",
    "password": "StrongPass123!"
  }' | python3 -m json.tool
```

Use `Authorization: Bearer <access_token>` for all subsequent admin API calls.

---

## Section I — Per-User Onboarding Flow

For every new Dhan client that joins:

### Step 1 — User registers via mobile app

`POST /api/auth/register` automatically assigns the next IPv6 from the pool
(`::1`, `::2`, `::3`, …). The address is returned in `assigned_ipv6`.

### Step 2 — Add that IPv6 to the OS (if not already there)

If the address was not pre-configured in Section B2, add it now:

```bash
sudo tee -a /etc/systemd/network/70-ens5.network.d/90-client-static-ips.conf << EOF
[Address]
Address=2406:da1a:xxxx:xx00:abcd::NEW_SUFFIX/128
EOF

sudo systemctl restart systemd-networkd
```

Verify:

```bash
curl -6 --interface 2406:da1a:xxxx:xx00:abcd::NEW_SUFFIX https://icanhazip.com
```

### Step 3 — Register the IPv6 with Dhan

Using the **user's own Dhan access token**, call Dhan's IP whitelist API:

```bash
curl -X POST https://api.dhan.co/v2/ip/setIP \
  -H "access-token: USER_DHAN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"primaryIP": "2406:da1a:xxxx:xx00:abcd::NEW_SUFFIX"}'
```

This must be done once per user. After this, Dhan only accepts orders from
that account when the request comes from that exact IPv6.

### Step 4 — User saves Dhan credentials via mobile app

`POST /api/users/me/dhan` — stores Dhan client ID + access token
(encrypted at rest).

### Step 5 — Verify in admin dashboard

```bash
curl -s http://<PUBLIC_IP>/api/admin/dashboard \
  -H "Authorization: Bearer ADMIN_TOKEN" | python3 -m json.tool
```

Check `users.with_ipv6_assigned` and `users.with_dhan_credential`.

---

## Section J — Sending a Signal (Admin Flow)

```bash
curl -s -X POST http://<PUBLIC_IP>/api/admin/signals \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "NIFTY 24000CE BUY",
    "exchange_segment": "NSE_FNO",
    "security_id": "35022",
    "transaction_type": "BUY",
    "product_type": "INTRADAY",
    "order_type": "LIMIT",
    "quantity": 50,
    "price": 120.0,
    "target_price": 150.0,
    "stop_loss_price": 100.0,
    "trailing_jump": 0
  }' | python3 -m json.tool
```

This:
1. Creates the signal in DB
2. Creates a `SignalNotification` (status=`pending`) for every eligible user
3. Sends an FCM push to every user's device

Users then confirm via the mobile app → `POST /api/users/me/notifications/{id}/confirm`
→ order placed from their IPv6 → status becomes `placed` or `failed`.

---

## Section K — Ongoing Operations

| Task | Command |
|------|---------|
| Restart backend | `sudo systemctl restart automate-backend` |
| View live logs | `sudo journalctl -u automate-backend -f` |
| View last 100 lines | `sudo journalctl -u automate-backend -n 100` |
| API docs (Swagger) | `http://<PUBLIC_IP>/docs` |
| Check active IPv6 addresses | `ip -6 addr show ens5 \| grep "2406:da1a"` |
| Test user's egress IP | `curl -6 --interface <IPv6> https://icanhazip.com` |

---

## Troubleshooting

**Backend won't start**
```bash
sudo journalctl -u automate-backend -n 50
# Check .env values — especially DATABASE_URL and TOKEN_ENCRYPTION_KEY
```

**curl to /health times out**
```bash
sudo systemctl status nginx
sudo nginx -t
```

**IPv6 egress test returns wrong IP**
- Confirm the address is up: `ip -6 addr show ens5`
- Confirm the prefix is delegated: `aws ec2 describe-network-interfaces --network-interface-ids <ENI_ID> --query 'NetworkInterfaces[0].Ipv6Prefixes'`
- If address is missing, restart systemd-networkd: `sudo systemctl restart systemd-networkd`

**Dhan rejects with "invalid IP" error**
- The IPv6 was not registered with Dhan (Section I Step 3 was skipped)
- Or the address on the OS does not match what was registered with Dhan
- Check the user's `assigned_ipv6`: `GET /api/admin/users/{id}`

---

## Quick API Reference

| Endpoint | Method | Who | Purpose |
|----------|--------|-----|---------|
| `/api/auth/register` | POST | User | Register + auto-get IPv6 |
| `/api/auth/login` | POST | User/Admin | Get bearer token |
| `/api/auth/admin-bootstrap` | POST | Setup | Promote first admin |
| `/api/auth/me` | GET | User | Profile + assigned IPv6 |
| `/api/users/me/fcm-token` | PUT | User | Save device push token |
| `/api/users/me/dhan` | POST | User | Save Dhan credentials |
| `/api/users/me/notifications` | GET | User | Pending order signals |
| `/api/users/me/notifications/{id}/confirm` | POST | User | Confirm → places order |
| `/api/users/me/notifications/{id}/reject` | POST | User | Reject signal |
| `/api/users/me/orders` | GET | User | Order history |
| `/api/admin/signals` | POST | Admin | Create + broadcast signal |
| `/api/admin/signals` | GET | Admin | List all signals |
| `/api/admin/signals/{id}` | GET | Admin | Signal + per-user status |
| `/api/admin/signals/{id}/cancel` | PUT | Admin | Cancel signal |
| `/api/admin/users` | GET | Admin | List all users |
| `/api/admin/users/{id}` | PUT | Admin | Assign IPv6 / role / active |
| `/api/admin/dashboard` | GET | Admin | Stats overview |
| `/health` | GET | Anyone | Health check |




ssh -i "dhan-prod-key.pem" ec2-user@13.126.206.167

sudo -u postgres psql -d automate_trading

cd /var/www/auto_trade/backend