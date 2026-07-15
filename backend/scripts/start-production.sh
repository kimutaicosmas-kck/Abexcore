#!/bin/sh
set -e

echo "Generating Prisma client..."
npx prisma generate

echo "Syncing database schema..."
if [ "$USE_MIGRATE_DEPLOY" = "true" ]; then
  npx prisma migrate deploy
else
  npx prisma db push --skip-generate
fi

if [ "$SEED_ON_START" = "true" ]; then
  echo "Seeding database..."
  npm run db:seed
fi

echo "Starting ApexCore ERP API..."
exec node dist/index.js
