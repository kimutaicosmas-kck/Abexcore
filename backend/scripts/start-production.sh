#!/bin/sh
set -e

echo "Generating Prisma client..."
npx prisma generate

echo "Syncing database schema..."
if [ "$USE_DB_PUSH" = "true" ]; then
  npx prisma db push --skip-generate
else
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

echo "Starting ApexCore ERP API..."
exec node dist/index.js
