#!/bin/sh
set -e

echo "Generating Prisma client..."
npx prisma generate

# Default: migrate deploy (enterprise schema discipline).
# Set USE_DB_PUSH=true only for emergency recovery on broken migration history.
USE_DB_PUSH="$(printf '%s' "${USE_DB_PUSH:-false}" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"
echo "Syncing database schema (USE_DB_PUSH=${USE_DB_PUSH})..."
if [ "$USE_DB_PUSH" = "true" ]; then
  echo "Using: prisma db push (emergency mode)"
  if ! npx prisma db push --skip-generate --accept-data-loss; then
    echo "ERROR: prisma db push failed — login and writes will break until schema matches."
    exit 1
  fi
else
  echo "Using: prisma migrate deploy"
  if ! npx prisma migrate deploy; then
    echo "ERROR: prisma migrate deploy failed — login and writes will break until schema matches."
    exit 1
  fi
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
