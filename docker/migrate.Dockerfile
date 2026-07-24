# syntax=docker/dockerfile:1
##############################################################################
# docker/migrate.Dockerfile
# One-shot container: applies pending Drizzle SQL migrations then exits.
#
# BUILD CONTEXT: repo root
# Strategy: drizzle-kit migrate reads migrations/_journal.json to determine
#   which SQL files from migrations/ have NOT yet been applied and runs them
#   in order. It is fully idempotent — already-applied migrations are skipped.
#
# Lifecycle in docker-compose:
#   depends_on: postgres (service_healthy)
#   restart: "no"
#   api-server depends_on: migrate (service_completed_successfully)
##############################################################################

FROM node:22-slim

# ── pnpm via corepack ─────────────────────────────────────────────────────────
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# ── Workspace manifests — copied before source for layer cache ────────────────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# tsconfig.base.json is extended by lib/db/tsconfig.json (and all other lib packages).
# drizzle-kit parses drizzle.config.ts via TypeScript, so the extends chain must resolve.
COPY tsconfig.base.json ./

# Only the packages needed for migration
COPY lib/db/package.json        ./lib/db/package.json
COPY lib/api-zod/package.json   ./lib/api-zod/package.json
COPY lib/api-spec/package.json  ./lib/api-spec/package.json
COPY lib/api-client-react/package.json    ./lib/api-client-react/package.json
COPY artifacts/api-server/package.json   ./artifacts/api-server/package.json
COPY artifacts/astro-sentinel/package.json ./artifacts/astro-sentinel/package.json
COPY scripts/package.json                ./scripts/package.json

# ── Install dependencies with BuildKit pnpm cache ─────────────────────────────
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Copy migration source (schema + config + SQL files) ───────────────────────
# drizzle-kit migrate reads:
#   - drizzle.config.ts  → database credentials + out directory
#   - migrations/*.sql   → the SQL to apply
#   - migrations/meta/_journal.json → which ones are already applied
COPY lib/db/ ./lib/db/

# ── Run migrations ────────────────────────────────────────────────────────────
# drizzle-kit is a devDependency of @workspace/db → lives at lib/db/node_modules/.bin/
# Output is captured to /tmp/drizzle.log first, then printed after exit.
# This defeats drizzle-kit's Ora spinner which uses ANSI escape codes to
# overwrite lines in-place — in CI those rewrites erase the real error text.
# DATABASE_URL is injected at runtime by docker-compose.
CMD ["/bin/bash", "-c", "cd /workspace/lib/db && NO_COLOR=1 node_modules/.bin/drizzle-kit migrate --config ./drizzle.config.ts > /tmp/drizzle.log 2>&1; EXIT=$?; echo '=== drizzle-kit output ==='; tr '\\r' '\\n' < /tmp/drizzle.log; echo '=== exit code:' $EXIT '==='; exit $EXIT"]
