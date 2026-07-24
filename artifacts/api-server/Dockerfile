##############################################################################
# artifacts/api-server/Dockerfile
# Node 22-slim — Express + WebSocket + Drizzle ORM API server
#
# BUILD CONTEXT: repo root (required for pnpm workspace resolution)
# The docker-compose.yml sets context: . and dockerfile: artifacts/api-server/Dockerfile
#
# Multi-stage build:
#   Stage 1 (builder) — install all deps, compile TypeScript via esbuild
#   Stage 2 (runner)  — copy only what is needed at runtime
##############################################################################

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# Enable corepack so we can use pnpm without a separate install step
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# ── Copy workspace manifests first (layer cache optimisation) ─────────────────
# pnpm resolves dependencies from these files before touching source code.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy every package.json in the workspace so pnpm can resolve the graph.
# We copy them individually to maintain the directory structure.
COPY lib/db/package.json                    ./lib/db/package.json
COPY lib/api-zod/package.json               ./lib/api-zod/package.json
COPY lib/api-spec/package.json              ./lib/api-spec/package.json
COPY lib/api-client-react/package.json      ./lib/api-client-react/package.json
COPY artifacts/api-server/package.json      ./artifacts/api-server/package.json
COPY artifacts/astro-sentinel/package.json  ./artifacts/astro-sentinel/package.json

# ── Install all workspace dependencies ────────────────────────────────────────
RUN pnpm install --frozen-lockfile

# ── Copy all source code ──────────────────────────────────────────────────────
COPY lib/         ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

# ── Build the api-server bundle ───────────────────────────────────────────────
# Runs: node ./build.mjs  (esbuild → dist/index.mjs)
# Must run from the package directory so build.mjs resolves paths correctly.
RUN pnpm --filter @workspace/api-server run build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

# Enable corepack for pnpm availability in runner (needed only if we run pnpm commands;
# we don't here but it is good practice to keep consistent)
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Copy the esbuild bundle ───────────────────────────────────────────────────
# esbuild bundles everything except native modules (bcrypt, *.node files).
# Those are in node_modules and must be carried over.
COPY --from=builder /workspace/artifacts/api-server/dist/ ./dist/

# ── Copy node_modules ─────────────────────────────────────────────────────────
# We copy the full node_modules from the builder to ensure native modules
# (bcrypt, bufferutil, etc.) that are externalized by esbuild are available.
COPY --from=builder /workspace/node_modules/ ./node_modules/
COPY --from=builder /workspace/artifacts/api-server/node_modules/ ./artifacts/api-server/node_modules/

# ── Copy bootstrap seed data ──────────────────────────────────────────────────
# bootstrap.ts (src/lib/bootstrap.ts) resolves the file path as:
#   path.resolve(__dirname, "..", "recent_events.json")
# where __dirname = the directory of dist/index.mjs = /app/dist/
# Therefore recent_events.json must be at /app/recent_events.json (WORKDIR root).
COPY artifacts/api-server/recent_events.json ./recent_events.json

# ── Expose port ───────────────────────────────────────────────────────────────
EXPOSE 8000

# ── Runtime command ───────────────────────────────────────────────────────────
# Matches the `start` script in artifacts/api-server/package.json.
# PORT, DATABASE_URL, PYTHON_BACKEND_URL etc. are injected by docker-compose.
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
