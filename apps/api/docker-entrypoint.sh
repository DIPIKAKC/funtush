#!/bin/sh
set -e

# Apply any committed Prisma migrations non-interactively. Safe to re-run;
# it's a no-op once the DB is already up to date. (Unlike `prisma migrate dev`,
# `deploy` never prompts, so it's safe in a non-interactive container.)
echo "[funtush-api] Applying database migrations..."
pnpm --filter @funtush/database exec prisma migrate deploy --schema=./prisma/schema.prisma || \
  echo "[funtush-api] Migration step skipped/failed - continuing startup."

echo "[funtush-api] Starting API..."
exec "$@"
