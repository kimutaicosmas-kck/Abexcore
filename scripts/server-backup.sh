#!/usr/bin/env bash
# AbexCore ERP — full server backup (MySQL + uploads + reports)
# Run on the VPS from the repo root, or via cron (see install-backup-cron.sh).
#
# Manual:
#   chmod +x scripts/server-backup.sh
#   ./scripts/server-backup.sh
#
# Env overrides:
#   BACKUP_ROOT=~/Abexcore-backups   where backups are stored
#   RETAIN_DAYS=14                   delete backup folders older than this
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_ROOT="${BACKUP_ROOT:-$HOME/Abexcore-backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DAY="$(date +%F)"
DEST="$BACKUP_ROOT/$DAY"
LOG_PREFIX="[abexcore-backup $TIMESTAMP]"

log() { echo "$LOG_PREFIX $*"; }

if [[ ! -f .env ]]; then
  log "ERROR: .env not found in $ROOT_DIR"
  exit 1
fi

if [[ -f docker-compose.prod.yml ]]; then
  COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env)
else
  COMPOSE=(docker compose --env-file .env)
fi

mkdir -p "$DEST"

if ! "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx mysql; then
  log "ERROR: mysql container is not running. Start the stack first."
  exit 1
fi

log "Backing up MySQL to $DEST/database.sql.gz"
"${COMPOSE[@]}" exec -T mysql sh -c \
  'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  | gzip > "$DEST/database.sql.gz"

if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx backend; then
  log "Backing up uploads volume"
  if "${COMPOSE[@]}" exec -T backend sh -c 'test -d /app/uploads && ls -A /app/uploads >/dev/null 2>&1'; then
    "${COMPOSE[@]}" exec -T backend tar czf - -C /app/uploads . > "$DEST/uploads.tar.gz"
  else
    log "Uploads directory empty — skipping uploads archive"
    : > "$DEST/uploads.tar.gz"
  fi

  log "Backing up reports volume"
  if "${COMPOSE[@]}" exec -T backend sh -c 'test -d /app/reports && ls -A /app/reports >/dev/null 2>&1'; then
    "${COMPOSE[@]}" exec -T backend tar czf - -C /app/reports . > "$DEST/reports.tar.gz"
  else
    log "Reports directory empty — skipping reports archive"
    : > "$DEST/reports.tar.gz"
  fi
else
  log "WARN: backend container not running — skipping file uploads/reports"
fi

{
  echo "timestamp=$TIMESTAMP"
  echo "date=$DAY"
  echo "host=$(hostname)"
  echo "path=$ROOT_DIR"
  echo "git=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "database_size_bytes=$(stat -c%s "$DEST/database.sql.gz" 2>/dev/null || stat -f%z "$DEST/database.sql.gz")"
  echo "uploads_size_bytes=$(stat -c%s "$DEST/uploads.tar.gz" 2>/dev/null || stat -f%z "$DEST/uploads.tar.gz")"
  echo "reports_size_bytes=$(stat -c%s "$DEST/reports.tar.gz" 2>/dev/null || stat -f%z "$DEST/reports.tar.gz")"
} > "$DEST/manifest.txt"

# Optional single-file bundle for download / off-site copy
BUNDLE="$BACKUP_ROOT/abexcore_backup_${TIMESTAMP}.tar.gz"
tar czf "$BUNDLE" -C "$BACKUP_ROOT" "$DAY"
log "Bundle created: $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"

# Retention — remove old dated folders and bundles
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETAIN_DAYS" -exec rm -rf {} + 2>/dev/null || true
find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'abexcore_backup_*.tar.gz' -mtime +"$RETAIN_DAYS" -delete 2>/dev/null || true

log "Done. Latest backup folder: $DEST"
log "Tip: copy $BUNDLE to another machine or cloud storage (S3, Google Drive, etc.)."
