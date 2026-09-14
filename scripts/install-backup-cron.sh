#!/usr/bin/env bash
# Install daily AbexCore DB + files backup cron (midnight Africa/Nairobi by default).
#
# Usage (on Contabo as root):
#   cd ~/Abexcore
#   git pull origin main
#   chmod +x scripts/install-backup-cron.sh scripts/server-backup.sh
#   ./scripts/install-backup-cron.sh
#
# Override schedule/timezone:
#   BACKUP_CRON='0 0 * * *' BACKUP_TZ='Africa/Nairobi' ./scripts/install-backup-cron.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_SCRIPT="$ROOT_DIR/scripts/server-backup.sh"
LOG_FILE="${BACKUP_LOG:-/var/log/abexcore-backup.log}"
CRON_SCHEDULE="${BACKUP_CRON:-0 0 * * *}"
CRON_TZ="${BACKUP_TZ:-Africa/Nairobi}"

if [[ ! -x "$BACKUP_SCRIPT" ]]; then
  chmod +x "$BACKUP_SCRIPT" "$ROOT_DIR/scripts/server-restore.sh" 2>/dev/null || true
fi

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "ERROR: $ROOT_DIR/.env not found. Run contabo-prod-setup.sh first."
  exit 1
fi

CRON_LINE="$CRON_SCHEDULE cd $ROOT_DIR && $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

# Replace existing abexcore backup lines if present
( crontab -l 2>/dev/null | grep -v 'scripts/server-backup.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=$CRON_TZ"
  echo "$CRON_LINE"
) | crontab -

mkdir -p "${BACKUP_ROOT:-$HOME/Abexcore-backups}"
touch "$LOG_FILE" 2>/dev/null || LOG_FILE="$HOME/abexcore-backup.log"

echo "==> Backup cron installed"
echo "    Timezone : $CRON_TZ"
echo "    Schedule : $CRON_SCHEDULE (midnight daily when using default 0 0 * * *)"
echo "    Script   : $BACKUP_SCRIPT"
echo "    Log      : $LOG_FILE"
echo "    Storage  : ${BACKUP_ROOT:-$HOME/Abexcore-backups}"
echo ""
echo "Run a test backup now:"
echo "  $BACKUP_SCRIPT"
echo ""
echo "List cron jobs:"
echo "  crontab -l"
