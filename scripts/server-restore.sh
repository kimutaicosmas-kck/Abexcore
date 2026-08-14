#!/usr/bin/env bash
# AbexCore ERP — restore from a server backup folder or bundle
#
# Usage:
#   ./scripts/server-restore.sh ~/Abexcore-backups/2026-08-14
#   ./scripts/server-restore.sh ~/Abexcore-backups/abexcore_backup_20260814_020001.tar.gz
#
# Restores MySQL + uploads + reports. STOP: take a fresh backup before restoring.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SOURCE="${1:-}"
if [[ -z "$SOURCE" ]]; then
  echo "Usage: $0 <backup-folder-or-bundle.tar.gz>"
  echo "Example: $0 ~/Abexcore-backups/2026-08-14"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found in $ROOT_DIR"
  exit 1
fi

WORK_DIR=""
cleanup() {
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

if [[ -f "$SOURCE" && "$SOURCE" == *.tar.gz ]]; then
  WORK_DIR="$(mktemp -d)"
  tar xzf "$SOURCE" -C "$WORK_DIR"
  # Bundle contains a date folder (e.g. 2026-08-14/)
  SOURCE="$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)"
fi

if [[ ! -d "$SOURCE" ]]; then
  echo "ERROR: backup folder not found: $SOURCE"
  exit 1
fi

for f in database.sql.gz; do
  if [[ ! -f "$SOURCE/$f" ]]; then
    echo "ERROR: missing $SOURCE/$f"
    exit 1
  fi
done

if [[ -f docker-compose.prod.yml ]]; then
  COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env)
else
  COMPOSE=(docker compose --env-file .env)
fi

echo "WARNING: This will overwrite the current database and uploaded files."
echo "Backup source: $SOURCE"
read -r -p "Type RESTORE to continue: " confirm
if [[ "$confirm" != "RESTORE" ]]; then
  echo "Aborted."
  exit 1
fi

echo "==> Restoring MySQL..."
gunzip -c "$SOURCE/database.sql.gz" | "${COMPOSE[@]}" exec -T mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'

if [[ -f "$SOURCE/uploads.tar.gz" ]] && [[ -s "$SOURCE/uploads.tar.gz" ]]; then
  echo "==> Restoring uploads..."
  "${COMPOSE[@]}" exec -T backend sh -c 'mkdir -p /app/uploads && rm -rf /app/uploads/*'
  gunzip -c "$SOURCE/uploads.tar.gz" | "${COMPOSE[@]}" exec -T backend tar xzf - -C /app/uploads
fi

if [[ -f "$SOURCE/reports.tar.gz" ]] && [[ -s "$SOURCE/reports.tar.gz" ]]; then
  echo "==> Restoring reports..."
  "${COMPOSE[@]}" exec -T backend sh -c 'mkdir -p /app/reports && rm -rf /app/reports/*'
  gunzip -c "$SOURCE/reports.tar.gz" | "${COMPOSE[@]}" exec -T backend tar xzf - -C /app/reports
fi

echo "Restore complete. Restarting backend..."
"${COMPOSE[@]}" restart backend >/dev/null 2>&1 || true
echo "Done."
