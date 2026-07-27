#!/usr/bin/env bash
# Restore MySQL backup for APEXCORE ERP
# Usage: DATABASE_URL=mysql://... ./scripts/restore-mysql.sh backups/backup.sql.gz

set -euo pipefail
BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: DATABASE_URL=mysql://user:pass@host:port/db $0 <backup-file.sql or .sql.gz>"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required"
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

echo "Restoring from $BACKUP_FILE into $DB on $HOST:$PORT ..."

if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | mysql -h "$HOST" -P "$PORT" -u "$USER" -p"$PASS" "$DB"
else
  mysql -h "$HOST" -P "$PORT" -u "$USER" -p"$PASS" "$DB" < "$BACKUP_FILE"
fi

echo "Restore complete."
