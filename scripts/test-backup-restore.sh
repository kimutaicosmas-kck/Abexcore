#!/usr/bin/env bash
# Verify backup + restore round-trip against a MySQL database (CI-friendly).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${BACKUP_DIR:-./backups/ci-test}"
mkdir -p "$BACKUP_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required"
  exit 1
fi

export BACKUP_DIR
bash scripts/backup-mysql.sh

LATEST="$(ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)"
if [ -z "$LATEST" ]; then
  echo "No backup file created"
  exit 1
fi

echo "Backup created: $LATEST"

# Restore into same database (destructive — use CI test DB only)
bash scripts/restore-mysql.sh "$LATEST"

echo "Backup restore verification passed."
