#!/usr/bin/env bash
# AbexCore ERP — Contabo production bootstrap (abexcore.co.ke)
# Run on the Ubuntu VPS after cloning the repo:
#   chmod +x scripts/contabo-prod-setup.sh
#   ./scripts/contabo-prod-setup.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> AbexCore ERP Contabo production setup"
echo "    Working directory: $ROOT_DIR"

if [[ ! -f .env ]]; then
  if [[ -f .env.production.example ]]; then
    cp .env.production.example .env
    echo "==> Created .env from .env.production.example"
  else
    echo "ERROR: .env missing and .env.production.example not found."
    exit 1
  fi
fi

rand() { openssl rand -base64 48 | tr -d '\n'; }
rand_pass() { openssl rand -base64 18 | tr -d '/+='; }

if grep -q 'CHANGE_ME_JWT_SECRET' .env; then
  sed -i "s|CHANGE_ME_JWT_SECRET_MIN_32_CHARS|$(rand)|" .env
fi
if grep -q 'CHANGE_ME_REFRESH_SECRET' .env; then
  sed -i "s|CHANGE_ME_REFRESH_SECRET_MIN_32_CHARS|$(rand)|" .env
fi
if grep -q 'CHANGE_ME_32_CHAR_ENCRYPTION' .env; then
  sed -i "s|CHANGE_ME_32_CHAR_ENCRYPTION_KEY_HERE|$(openssl rand -hex 16)|" .env
fi
if grep -q 'CHANGE_ME_ROOT_PASSWORD' .env; then
  sed -i "s|CHANGE_ME_ROOT_PASSWORD|$(rand_pass)|" .env
fi
if grep -q 'CHANGE_ME_DB_PASSWORD' .env; then
  sed -i "s|CHANGE_ME_DB_PASSWORD|$(rand_pass)|" .env
fi
if grep -q 'CHANGE_ME_ADMIN_PASSWORD' .env; then
  ADMIN_PASS="$(rand_pass)Aa1!"
  sed -i "s|CHANGE_ME_ADMIN_PASSWORD|${ADMIN_PASS}|g" .env
fi

# Ensure production bind + URLs
grep -q '^FRONTEND_HOST_BIND=' .env || echo 'FRONTEND_HOST_BIND=127.0.0.1:8080' >> .env
sed -i 's|^FRONTEND_HOST_BIND=.*|FRONTEND_HOST_BIND=127.0.0.1:8080|' .env
sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=https://abexcore.co.ke|' .env
sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=https://abexcore.co.ke|' .env

echo "==> Installing Docker (if needed)..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y docker-compose-plugin || true
fi

echo "==> Firewall (ufw)..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw --force enable || true
fi

echo "==> Building and starting stack (HTTP app + Caddy HTTPS)..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d

echo "==> Waiting for local app health on :8080..."
for i in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    echo "    App healthy."
    break
  fi
  sleep 5
  if [[ "$i" -eq 90 ]]; then
    echo "ERROR: App did not become healthy. Check: docker compose logs backend"
    exit 1
  fi
done

if grep -q '^SEED_ON_START=true' .env; then
  sed -i 's/^SEED_ON_START=true/SEED_ON_START=false/' .env
  echo "==> SEED_ON_START set to false"
fi

OWNER_EMAIL="$(grep -E '^PLATFORM_OWNER_EMAIL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
OWNER_PASS="$(grep -E '^PLATFORM_OWNER_PASSWORD=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
SLUG="$(grep -E '^PLATFORM_COMPANY_SLUG=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"

echo ""
echo "=============================================="
echo " AbexCore ERP is deploying at:"
echo "   https://abexcore.co.ke"
echo " Company slug: ${SLUG:-owner}"
echo " Email:        ${OWNER_EMAIL}"
echo " Password:     ${OWNER_PASS}"
echo "=============================================="
echo " SSL may take 1–2 minutes on first Caddy start."
echo " Save the password above — it will not be shown again."
echo "=============================================="
