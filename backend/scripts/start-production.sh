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
