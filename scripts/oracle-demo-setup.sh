#!/usr/bin/env bash
# ApexCore ERP — Oracle Cloud Always Free demo bootstrap
# Run on the Ubuntu VM after cloning the repo:
#   chmod +x scripts/oracle-demo-setup.sh
#   ./scripts/oracle-demo-setup.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> ApexCore ERP demo setup"
echo "    Working directory: $ROOT_DIR"

if [[ ! -f .env ]]; then
  if [[ -f .env.demo.example ]]; then
    cp .env.demo.example .env
    echo "==> Created .env from .env.demo.example"
  else
    echo "ERROR: .env missing and .env.demo.example not found."
    exit 1
  fi
fi

# Detect public IP (OCI metadata, then fallbacks)
PUBLIC_IP="$(curl -fsS --connect-timeout 2 http://169.254.169.254/opc/v2/vnics/ \
  -H 'Authorization: Bearer Oracle' 2>/dev/null \
  | grep -oE '"publicIp"\s*:\s*"[^"]+"' | head -1 | cut -d'"' -f4 || true)"
if [[ -z "${PUBLIC_IP}" ]]; then
  PUBLIC_IP="$(curl -fsS --connect-timeout 5 https://ifconfig.me || true)"
fi
if [[ -z "${PUBLIC_IP}" ]]; then
  PUBLIC_IP="$(curl -fsS --connect-timeout 5 https://api.ipify.org || true)"
fi

if [[ -n "${PUBLIC_IP}" ]]; then
  echo "==> Detected public IP: ${PUBLIC_IP}"
  sed -i "s|http://CHANGE_ME_PUBLIC_IP|http://${PUBLIC_IP}|g" .env
  # Keep FRONTEND_URL / PUBLIC_URL in sync if still placeholders
  grep -q 'CHANGE_ME_PUBLIC_IP' .env && sed -i "s|CHANGE_ME_PUBLIC_IP|${PUBLIC_IP}|g" .env || true
else
  echo "WARNING: Could not detect public IP. Edit PUBLIC_URL and FRONTEND_URL in .env manually."
fi

# Replace CHANGE_ME secrets if still present
rand() { openssl rand -base64 48 | tr -d '\n'; }
if grep -q 'CHANGE_ME_JWT_SECRET' .env; then
  sed -i "s|CHANGE_ME_JWT_SECRET_MIN_32_CHARS|$(rand)|" .env
fi
if grep -q 'CHANGE_ME_REFRESH_SECRET' .env; then
  sed -i "s|CHANGE_ME_REFRESH_SECRET_MIN_32_CHARS|$(rand)|" .env
fi
if grep -q 'CHANGE_ME_32_CHAR_ENCRYPTION' .env; then
  # 32+ chars for encryption key
  KEY="$(openssl rand -hex 16)"
  sed -i "s|CHANGE_ME_32_CHAR_ENCRYPTION_KEY_HERE|${KEY}|" .env
fi
if grep -q 'CHANGE_ME_ROOT_PASSWORD' .env; then
  sed -i "s|CHANGE_ME_ROOT_PASSWORD|$(openssl rand -base64 18 | tr -d '/+=')|" .env
fi
if grep -q 'CHANGE_ME_DB_PASSWORD' .env; then
  sed -i "s|CHANGE_ME_DB_PASSWORD|$(openssl rand -base64 18 | tr -d '/+=')|" .env
fi

echo "==> Installing Docker (if needed)..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

# Compose plugin
if ! docker compose version >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y docker-compose-plugin || true
fi

echo "==> Opening host firewall for HTTP/HTTPS (if ufw present)..."
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH || true
  sudo ufw allow 80/tcp || true
  sudo ufw allow 443/tcp || true
  sudo ufw --force enable || true
fi

# Oracle Linux / Ubuntu iptables quirk on OCI — ensure INPUT accepts 80
if command -v iptables >/dev/null 2>&1; then
  sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT || true
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT || true
  # Persist if netfilter-persistent exists
  if command -v netfilter-persistent >/dev/null 2>&1; then
    sudo netfilter-persistent save || true
  fi
fi

echo "==> Building and starting containers (first build can take 5–15 minutes)..."
sudo docker compose --env-file .env build
sudo docker compose --env-file .env up -d

echo "==> Waiting for API health..."
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then
    echo "    Healthy."
    break
  fi
  sleep 5
  if [[ "$i" -eq 60 ]]; then
    echo "ERROR: API did not become healthy. Check: sudo docker compose logs backend"
    exit 1
  fi
done

# Turn off auto-seed for future restarts
if grep -q '^SEED_ON_START=true' .env; then
  sed -i 's/^SEED_ON_START=true/SEED_ON_START=false/' .env
  echo "==> SEED_ON_START set to false (won't reseed on restart)"
fi

PUBLIC_URL="$(grep -E '^PUBLIC_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
OWNER_EMAIL="$(grep -E '^PLATFORM_OWNER_EMAIL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
OWNER_PASS="$(grep -E '^PLATFORM_OWNER_PASSWORD=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
SLUG="$(grep -E '^PLATFORM_COMPANY_SLUG=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"

cat <<EOF

============================================================
  ApexCore ERP demo is LIVE
============================================================
  Client URL:   ${PUBLIC_URL}
  Company slug: ${SLUG}
  Email:        ${OWNER_EMAIL}
  Password:     ${OWNER_PASS}

  Health check: ${PUBLIC_URL}/api/health

  Share the Client URL with your client.
  Change the password after first login.
============================================================

EOF
