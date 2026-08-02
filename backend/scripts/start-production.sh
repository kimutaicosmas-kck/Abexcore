#!/bin/sh
set -e

echo "Generating Prisma client..."
npx prisma generate

# Fresh Contabo/MySQL installs have no baseline migration history.
# Strip CR (Windows .env) and default to db push unless explicitly "false".
USE_DB_PUSH="$(printf '%s' "${USE_DB_PUSH:-true}" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
echo "Syncing database schema (USE_DB_PUSH=${USE_DB_PUSH})..."
if [ "$USE_DB_PUSH" != "false" ]; then
  echo "Using: prisma db push"
  npx prisma db push --skip-generate --accept-data-loss
else
  echo "Using: prisma migrate deploy"
  npx prisma migrate deploy
fi

if [ "$(printf '%s' "${SEED_ON_START:-false}" | tr -d '\r' | tr '[:upper:]' '[:lower:]')" = "true" ]; then
  echo "Seeding database..."
  if [ "$(printf '%s' "${SEED_PRODUCTION:-false}" | tr -d '\r' | tr '[:upper:]' '[:lower:]')" = "true" ]; then
    npm run db:seed:production
  else
    npm run db:seed
  fi
fi

echo "Starting AbexCore ERP API..."
exec node dist/index.js
