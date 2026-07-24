##############################################################################
# artifacts/astro-sentinel/Dockerfile
# Node 22-slim (build) → nginx:alpine (serve)
#
# BUILD CONTEXT: repo root (required for pnpm workspace resolution)
# The docker-compose.yml sets context: . and dockerfile: artifacts/astro-sentinel/Dockerfile
#
# Multi-stage build:
#   Stage 1 (builder) — install all workspace deps, run vite build
#   Stage 2 (runner)  — nginx:alpine serving static files + proxying /api
#
# Why nginx instead of `vite preview`?
#   vite.config.ts hardcodes the proxy target as http://127.0.0.1:8000.
#   Modifying application code is out of scope. nginx gives us full control
#   over the proxy target (api-server:8000) without touching source files.
##############################################################################

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# ── Copy workspace manifests (layer cache optimisation) ───────────────────────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

COPY lib/db/package.json                    ./lib/db/package.json
COPY lib/api-zod/package.json               ./lib/api-zod/package.json
COPY lib/api-spec/package.json              ./lib/api-spec/package.json
COPY lib/api-client-react/package.json      ./lib/api-client-react/package.json
COPY artifacts/api-server/package.json      ./artifacts/api-server/package.json
COPY artifacts/astro-sentinel/package.json  ./artifacts/astro-sentinel/package.json

# ── Install all workspace dependencies ────────────────────────────────────────
RUN pnpm install --frozen-lockfile

# ── Copy all source code needed by the frontend ───────────────────────────────
COPY lib/              ./lib/
COPY artifacts/astro-sentinel/ ./artifacts/astro-sentinel/

# ── Vite build ────────────────────────────────────────────────────────────────
# Outputs to: artifacts/astro-sentinel/dist/public/
# (configured in vite.config.ts → build.outDir)
# PORT is required by vite.config.ts even for builds (it reads process.env.PORT)
ENV PORT=5173
ENV BASE_PATH=/
RUN pnpm --filter @workspace/astro-sentinel run build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM nginx:alpine AS runner

# Remove the default nginx welcome page config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom nginx config
COPY artifacts/astro-sentinel/nginx.conf /etc/nginx/conf.d/astro-sentinel.conf

# Copy the Vite build output into the nginx document root
COPY --from=builder /workspace/artifacts/astro-sentinel/dist/public/ /usr/share/nginx/html/

# ── Expose port ───────────────────────────────────────────────────────────────
EXPOSE 5173

# ── Runtime command ───────────────────────────────────────────────────────────
# nginx -g daemon off; keeps the process in the foreground so Docker can track it.
CMD ["nginx", "-g", "daemon off;"]
