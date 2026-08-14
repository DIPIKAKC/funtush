# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Funtush API image
#
# This is a pnpm workspace (Turborepo) monorepo, so @funtush/api depends on
# several local workspace packages (@funtush/database, @funtush/auth, etc).
# The build context for this Dockerfile MUST be the repo root, e.g.:
#
#   docker build -f apps/api/Dockerfile -t funtush-api .
#
# docker-compose.yml already sets this up (context: ., dockerfile: apps/api/Dockerfile).
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base

# openssl/libc6-compat are required by Prisma's query engine on Alpine
RUN apk add --no-cache libc6-compat openssl

RUN corepack enable && corepack prepare pnpm@11.5.1 --activate

WORKDIR /app

# ---- deps ------------------------------------------------------------------
# Copy manifests first for better layer caching, then the rest of the source.
FROM base AS deps

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY config/package.json config/package.json

# Prisma's schema is needed for the @funtush/database "postinstall: prisma generate" hook
COPY packages/database/prisma packages/database/prisma

RUN pnpm install --frozen-lockfile

# ---- runtime ----------------------------------------------------------------
FROM deps AS runtime

COPY . .

# Re-run install so full source (incl. any patches) is linked; this is a
# no-op for already-satisfied deps thanks to pnpm's content-addressable store.
RUN pnpm install --frozen-lockfile --offline

# apps/api's "start"/"dev" scripts use `tsx --env-file=.env`; runtime config
# is injected via docker-compose `environment`/`env_file` instead, so this
# just needs to exist to satisfy --env-file.
RUN touch apps/api/.env

WORKDIR /app/apps/api

COPY apps/api/docker-entrypoint.sh /app/apps/api/docker-entrypoint.sh
RUN chmod +x /app/apps/api/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4000

ENTRYPOINT ["/app/apps/api/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
