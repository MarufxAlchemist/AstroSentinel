# Cosmic Alert System — Docker Guide

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker bridge network (cosmic / cosmic-prod / cosmic-dev)       │
│                                                                  │
│  ┌────────────┐    ┌──────────┐    ┌───────────────┐            │
│  │  postgres  │◄───│ migrate  │    │ python-backend│            │
│  │  :5432     │    │ (exits 0)│    │  :8001        │            │
│  └─────┬──────┘    └──────────┘    └───────┬───────┘            │
│        │                                   │                     │
│        └──────────────┬────────────────────┘                     │
│                       ▼                                          │
│               ┌───────────────┐                                  │
│               │  api-server   │                                  │
│               │  :8000        │                                  │
│               └───────┬───────┘                                  │
│                       ▼                                          │
│               ┌───────────────┐                                  │
│               │   frontend    │  (nginx: SPA + /api proxy)       │
│               │  :5173        │                                  │
│               └───────────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

| Service          | Image              | Port | Purpose                               |
|------------------|--------------------|------|---------------------------------------|
| `postgres`       | postgres:16-alpine | 5432 | Persistent database                   |
| `migrate`        | custom (Node 22)   | –    | Runs `drizzle-kit migrate` then exits |
| `python-backend` | custom (Python 3.12)| 8001 | GCN Kafka consumer + FastAPI WebSocket |
| `api-server`     | custom (Node 22)   | 8000 | Express REST API + WebSocket bridge   |
| `frontend`       | custom (nginx)     | 5173 | Vite SPA + `/api` reverse proxy       |

---

## Prerequisites

1. **Docker Desktop** installed and running
   - Download: https://www.docker.com/products/docker-desktop/
   - Confirm with: `docker version`

2. **Ports available** on your machine:
   - `5432` — PostgreSQL
   - `8001` — Python backend
   - `8000` — API server
   - `5173` — Frontend

3. **`.env` file** created from the template:
   ```bash
   cp .env.example .env
   # Edit .env and fill in all CHANGE_ME values
   ```

4. **`backend/.env` file** with GCN Kafka credentials:
   ```env
   GCN_CLIENT_ID=your_gcn_client_id
   GCN_CLIENT_SECRET=your_gcn_client_secret
   ```

---

## How to Build and Run

### Production (recommended)

```bash
# First run — builds all images and starts the full stack
docker compose -f docker-compose.prod.yml up --build

# Detached mode (runs in background)
docker compose -f docker-compose.prod.yml up --build -d
```

**Startup sequence (automatic):**
1. `postgres` starts and waits until accepting connections
2. `migrate` runs `drizzle-kit migrate` (applies pending SQL migrations) then exits
3. `python-backend` starts uvicorn FastAPI server
4. `api-server` starts only after postgres is healthy, migrate has completed, and python-backend is healthy
5. `frontend` starts after api-server passes its healthcheck

**Access the app:** http://localhost:5173

### Development

```bash
# Start backend services (postgres, migrate, python-backend, api-server)
docker compose -f docker-compose.dev.yml up --build

# In a separate terminal — start the frontend locally (live reload works!)
cd artifacts/astro-sentinel
pnpm dev
```

The frontend Vite dev server's proxy (`/api → http://127.0.0.1:8000`) connects to the containerized api-server on your machine's localhost:8000.

### Default (quick start)

```bash
docker compose up --build
```

Same as production but uses `restart: unless-stopped` instead of `restart: always`.

---

## How to Rebuild

### Rebuild everything

```bash
docker compose -f docker-compose.prod.yml up --build
```

### Rebuild a specific service

```bash
# Rebuild only the api-server
docker compose -f docker-compose.prod.yml build api-server
docker compose -f docker-compose.prod.yml up --no-deps api-server

# Or in one command
docker compose -f docker-compose.prod.yml up --build --no-deps api-server
```

### Force a clean rebuild (no cache)

```bash
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up
```

---

## How to Stop

### Stop containers (keep data)

```bash
docker compose -f docker-compose.prod.yml down
```

Postgres data is preserved in the `postgres_prod_data` named volume.

### Stop containers and wipe the database

> ⚠️ This permanently deletes all data.

```bash
docker compose -f docker-compose.prod.yml down -v
```

---

## How to Inspect Logs

### All services at once

```bash
docker compose -f docker-compose.prod.yml logs -f
```

### A specific service

```bash
docker compose -f docker-compose.prod.yml logs -f api-server
docker compose -f docker-compose.prod.yml logs -f python-backend
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f migrate
docker compose -f docker-compose.prod.yml logs -f frontend
```

### Last N lines

```bash
docker compose -f docker-compose.prod.yml logs --tail=100 api-server
```

### Check service health status

```bash
docker compose -f docker-compose.prod.yml ps
```

---

## How to Connect to PostgreSQL Inside Docker

### Using psql (if installed locally)

```bash
psql "postgresql://postgres:YOUR_PASSWORD@localhost:5432/Astro-sentinel"
```

### Via docker exec (no local psql needed)

```bash
# Open an interactive psql shell inside the container
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U postgres -d Astro-sentinel

# Run a one-off query
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U postgres -d Astro-sentinel -c "SELECT COUNT(*) FROM events;"
```

### Using a GUI (DBeaver / TablePlus)

```
Host:     localhost
Port:     5432
User:     postgres
Password: (your POSTGRES_PASSWORD from .env)
Database: Astro-sentinel
```

---

## Database Migrations

Migrations are applied **automatically** by the `migrate` service on every `docker compose up`. No manual steps required.

Migrations use `drizzle-kit migrate` which reads:
- `lib/db/migrations/meta/_journal.json` — tracks which files have been applied
- `lib/db/migrations/0000_*.sql` through `0006_*.sql` — ordered SQL files

The migrate container exits with code 0 on success. The api-server waits for `service_completed_successfully` before starting, guaranteeing all schema changes are applied.

### Re-run migrations manually

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
```

---

## Environment Variables Reference

All variables come from the root `.env` file. Secrets are **never** baked into images.

| Variable | Used by | Description |
|---|---|---|
| `POSTGRES_USER` | postgres, migrate, api-server | DB username |
| `POSTGRES_PASSWORD` | postgres | DB password (plain) |
| `POSTGRES_PASSWORD_URLENC` | migrate, api-server | URL-encoded password (@ → %40) |
| `POSTGRES_DB` | postgres, api-server | Database name |
| `DATABASE_URL` | local dev only | Full connection string (not used in compose) |
| `JWT_SECRET` | api-server | Signs/verifies JWTs |
| `GOOGLE_CLIENT_ID` | api-server | OAuth2 client ID |
| `GEMINI_API_KEY` | api-server | Gemini AI API key |
| `ORCID_CLIENT_ID` | api-server | ORCID OAuth |
| `ORCID_CLIENT_SECRET` | api-server | ORCID OAuth |
| `GCN_CLIENT_ID` | python-backend | GCN Kafka credentials |
| `GCN_CLIENT_SECRET` | python-backend | GCN Kafka credentials |

---

## File Structure

```
.
├── docker-compose.yml          ← Default / quick-start
├── docker-compose.prod.yml     ← Production (restart: always, all healthchecks)
├── docker-compose.dev.yml      ← Development (no frontend, live reload)
├── docker/
│   └── migrate.Dockerfile      ← One-shot DB migration container
├── backend/
│   ├── Dockerfile              ← Python FastAPI (BuildKit pip cache)
│   └── .dockerignore
├── artifacts/
│   ├── api-server/
│   │   ├── Dockerfile          ← Node 22 multi-stage (BuildKit pnpm cache)
│   │   └── .dockerignore
│   └── astro-sentinel/
│       ├── Dockerfile          ← Vite build → nginx:alpine
│       ├── nginx.conf          ← SPA + /api proxy + WebSocket upgrade
│       └── .dockerignore
├── .dockerignore               ← Root build context exclusions
├── .env                        ← Secrets (gitignored)
└── .env.example                ← Safe template (committed)
```

---

## BuildKit Cache

All Dockerfiles use `# syntax=docker/dockerfile:1` to enable BuildKit features:

- **Python backend**: `--mount=type=cache,target=/root/.cache/pip` caches pip downloads between builds
- **Node services**: `--mount=type=cache,id=pnpm-store,target=/pnpm/store` caches pnpm's content-addressable store

Enable BuildKit explicitly if needed:

```bash
DOCKER_BUILDKIT=1 docker compose -f docker-compose.prod.yml build
```

Docker Desktop has BuildKit enabled by default since Docker 23+.

---

## Troubleshooting

### Container exits immediately

```bash
docker compose -f docker-compose.prod.yml logs <service-name>
```

### api-server waiting forever for dependencies

Check if postgres, migrate, and python-backend are healthy:
```bash
docker compose -f docker-compose.prod.yml ps
```

### Migrations failing

```bash
docker compose -f docker-compose.prod.yml logs migrate
```

Common cause: `POSTGRES_PASSWORD_URLENC` not set or contains special characters that need additional encoding.

### Port already in use

```bash
# Find what's using port 8000
netstat -ano | findstr :8000
```

Stop the local process or change the host port in the compose file (e.g., `"8080:8000"`).

### Full reset

```bash
docker compose -f docker-compose.prod.yml down -v --rmi local
docker compose -f docker-compose.prod.yml up --build
```
