#!/bin/sh
set -e

OUTPUT_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$OUTPUT_DIR/erp_backup_$TIMESTAMP.sql"

mkdir -p "$OUTPUT_DIR"

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

if ! command -v mysqldump >/dev/null 2>&1; then
  echo "mysqldump not found. Example with Docker:"
  echo "  docker compose exec mysql mysqldump -u erp_user -perp_password filter_erp > backup.sql"
  exit 1
fi

DB_URL="${DATABASE_URL#mysql://}"
CREDS="${DB_URL%%@*}"
REST="${DB_URL#*@}"
USER="${CREDS%%:*}"
PASS="${CREDS#*:}"
HOST_PORT="${REST%%/*}"
DB="${REST#*/}"
DB="${DB%%\?*}"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT#*:}"
PORT="${PORT:-3306}"

mysqldump -h "$HOST" -P "$PORT" -u "$USER" -p"$PASS" "$DB" > "$FILE"
gzip -f "$FILE"
echo "Backup complete: ${FILE}.gz"
