# syntax=docker/dockerfile:1
##############################################################################
# artifacts/astro-sentinel/Dockerfile
# Node 22-slim (Vite build) → nginx:alpine (serve)
#
# BUILD CONTEXT: repo root (required for pnpm workspace resolution)
#
# Multi-stage (v2):
#   builder → pnpm install + vite build → static bundle in dist/public/
#   runner  → nginx:alpine + curl (healthcheck) + static files
#
# Why nginx instead of vite preview?
#   vite.config.ts hardcodes proxy target as http://127.0.0.1:8000.
#   nginx replaces this with a configurable proxy_pass to api-server:8000
#   without touching application code.
##############################################################################

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# ── Workspace manifests (cached layer) ────────────────────────────────────────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# tsconfig.base.json must be present before the build step:
# artifacts/astro-sentinel/tsconfig.json extends "../../tsconfig.base.json"
# which resolves to /workspace/tsconfig.base.json inside the builder stage.
# Without it, Vite's TypeScript compilation fails with "File not found".
COPY tsconfig.base.json ./

COPY lib/db/package.json                    ./lib/db/package.json
COPY lib/api-zod/package.json               ./lib/api-zod/package.json
COPY lib/api-spec/package.json              ./lib/api-spec/package.json
COPY lib/api-client-react/package.json      ./lib/api-client-react/package.json
COPY artifacts/api-server/package.json      ./artifacts/api-server/package.json
COPY artifacts/astro-sentinel/package.json  ./artifacts/astro-sentinel/package.json

# ── Install with BuildKit pnpm store cache ────────────────────────────────────
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Source ────────────────────────────────────────────────────────────────────
COPY lib/                   ./lib/
COPY artifacts/astro-sentinel/ ./artifacts/astro-sentinel/

# ── Vite build ────────────────────────────────────────────────────────────────
# vite.config.ts reads PORT (required, even for builds) and BASE_PATH.
# Output: artifacts/astro-sentinel/dist/public/
ENV PORT=5173
ENV BASE_PATH=/
RUN pnpm --filter @workspace/astro-sentinel run build

# ── Stage 2: runner (nginx) ───────────────────────────────────────────────────
FROM nginx:alpine AS runner

# curl: used by the HEALTHCHECK below — nginx:alpine does not include it by default.
RUN apk add --no-cache curl

# Remove the default nginx page and config
RUN rm /etc/nginx/conf.d/default.conf

# Our custom nginx config: SPA fallback + /api proxy + WebSocket upgrade
COPY artifacts/astro-sentinel/nginx.conf /etc/nginx/conf.d/astro-sentinel.conf

# Static bundle from the builder stage
COPY --from=builder /workspace/artifacts/astro-sentinel/dist/public/ /usr/share/nginx/html/

# ── Port ─────────────────────────────────────────────────────────────────────
EXPOSE 5173

# ── Runtime ──────────────────────────────────────────────────────────────────
CMD ["nginx", "-g", "daemon off;"]
