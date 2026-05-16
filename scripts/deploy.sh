#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/auto_trade}"
BRANCH="${BRANCH:-main}"
DEPLOY_BOT="${DEPLOY_BOT:-false}"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"
}

log "Starting deployment in ${APP_DIR} on branch ${BRANCH}"
cd "${APP_DIR}"

log "Updating repository"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

log "Preparing backend"
cd backend
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m compileall app
deactivate

log "Building webapp"
cd ../webapp
npm ci
npm run build

if [ "${DEPLOY_BOT}" = "true" ]; then
  log "Preparing bot"
  cd ../bot
  python3 -m venv .venv
  . .venv/bin/activate
  python -m pip install --upgrade pip
  pip install -r requirements.txt
  python -m compileall bot.py
  deactivate
  cd ..
fi

log "Restarting services"
systemctl restart automate-backend
systemctl restart automate-webapp

if [ "${DEPLOY_BOT}" = "true" ]; then
  systemctl restart automate-bot
fi

log "Running health checks"
python3 - <<'PY'
import sys
import urllib.request
import time


def wait_for(url: str, attempts: int = 15, delay: float = 2.0) -> None:
  last_exc = None
  for _ in range(attempts):
    try:
      with urllib.request.urlopen(url, timeout=10) as resp:
        if resp.status >= 400:
          raise RuntimeError(f"Bad status {resp.status} from {url}")
      return
    except Exception as exc:
      last_exc = exc
      time.sleep(delay)
  raise RuntimeError(f"Health check failed for {url}: {last_exc}")

try:
  wait_for("http://127.0.0.1:8000/health")
  wait_for("http://127.0.0.1/")
except Exception as exc:
  print(str(exc))
  sys.exit(1)

print("Health checks passed")
PY

log "Deployment completed successfully"
