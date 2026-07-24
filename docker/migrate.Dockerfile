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

# ── Migration runner script ───────────────────────────────────────────────────
# We use a Node.js child-process wrapper instead of a shell command because
# drizzle-kit emits ANSI escape codes (cursor movement, erase-line) that defeat
# both `tr '\r' '\n'` and file-redirect approaches in CI/non-TTY environments.
# spawnSync with stdio:'pipe' intercepts output before any codes are interpreted.
RUN cat > /run-migrate.cjs << 'JSEOF'
const { spawnSync } = require('child_process');
const r = spawnSync(
  'node_modules/.bin/drizzle-kit',
  ['migrate', '--config', './drizzle.config.ts'],
  {
    cwd: '/workspace/lib/db',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  }
);
const strip = s => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '\n');
const out = strip((r.stdout || Buffer.alloc(0)).toString());
const err = strip((r.stderr || Buffer.alloc(0)).toString());
console.log('=== drizzle-kit stdout ===');
process.stdout.write(out);
console.log('=== drizzle-kit stderr ===');
process.stderr.write(err);
console.log('=== exit code:', r.status, '===');
process.exit(r.status !== null ? r.status : 1);
JSEOF

# ── Run migrations ────────────────────────────────────────────────────────────
# DATABASE_URL is injected at runtime by docker-compose.
CMD ["node", "/run-migrate.cjs"]
