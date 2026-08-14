#!/usr/bin/env bash
# Install daily AbexCore backup cron on the VPS (02:00 Africa/Nairobi server local time).
#
# Usage (on Contabo as root):
#   cd ~/Abexcore
#   git pull origin main
#   chmod +x scripts/install-backup-cron.sh scripts/server-backup.sh
#   ./scripts/install-backup-cron.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_SCRIPT="$ROOT_DIR/scripts/server-backup.sh"
LOG_FILE="${BACKUP_LOG:-/var/log/abexcore-backup.log}"
CRON_SCHEDULE="${BACKUP_CRON:-0 2 * * *}"

if [[ ! -x "$BACKUP_SCRIPT" ]]; then
  chmod +x "$BACKUP_SCRIPT" "$ROOT_DIR/scripts/server-restore.sh" 2>/dev/null || true
fi

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "ERROR: $ROOT_DIR/.env not found. Run contabo-prod-setup.sh first."
  exit 1
fi

CRON_LINE="$CRON_SCHEDULE cd $ROOT_DIR && $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

# Replace existing abexcore backup line if present
( crontab -l 2>/dev/null | grep -v 'scripts/server-backup.sh' || true
  echo "$CRON_LINE"
) | crontab -

mkdir -p "${BACKUP_ROOT:-$HOME/Abexcore-backups}"
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="$HOME/abexcore-backup.log"

echo "==> Backup cron installed"
echo "    Schedule : $CRON_SCHEDULE (server local time)"
echo "    Script   : $BACKUP_SCRIPT"
echo "    Log      : $LOG_FILE"
echo "    Storage  : ${BACKUP_ROOT:-$HOME/Abexcore-backups}"
echo ""
echo "Run a test backup now:"
echo "  $BACKUP_SCRIPT"
echo ""
echo "List cron jobs:"
echo "  crontab -l"
