#!/bin/sh
set -e

echo "Generating Prisma client..."
npx prisma generate

# Fresh Contabo/MySQL installs have no baseline migration history.
# Default to db push unless explicitly disabled (USE_DB_PUSH=false).
echo "Syncing database schema (USE_DB_PUSH=${USE_DB_PUSH:-true})..."
if [ "${USE_DB_PUSH:-true}" != "false" ]; then
  echo "Using: prisma db push"
  npx prisma db push --skip-generate --accept-data-loss
else
  echo "Using: prisma migrate deploy"
  npx prisma migrate deploy
fi

if [ "$SEED_ON_START" = "true" ]; then
  echo "Seeding database..."
  if [ "$SEED_PRODUCTION" = "true" ]; then
    npm run db:seed:production
  else
    npm run db:seed
  fi
fi

echo "Starting AbexCore ERP API..."
exec node dist/index.js
