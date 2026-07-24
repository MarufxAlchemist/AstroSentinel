# Cosmic Alert System (AstroSentinel)

Cosmic Alert System is a multi-tier application designed to ingest, analyze, and serve astronomical alerts (like GCN notices) in real-time. It features a Python backend for data ingestion (Kafka/FastAPI), a Node.js/Express API server with WebSockets for real-time updates, a Postgres/PostGIS database via Drizzle ORM, and a modern React frontend (AstroSentinel).

## Architecture

*   **Database (PostgreSQL 16 + PostGIS):** Stores astronomical events, localizations (using `geography` types), and system state.
*   **Python Backend (FastAPI):** Connects to external Kafka streams (e.g. NASA GCN), parses astronomical alerts, and streams them into the system.
*   **API Server (Node.js/Express):** Serves the main REST API and WebSocket connections for real-time frontend updates. Uses Drizzle ORM for database access.
*   **Frontend (React/Vite):** The "AstroSentinel" user interface, providing real-time dashboards and correlation analysis.
*   **Migrate Service:** A one-shot Docker container that automatically runs database migrations programmatically on startup.

## Prerequisites

*   **Docker & Docker Compose** (for containerized execution)
*   **Node.js 22+ & pnpm** (for local development)
*   **Python 3.12+** (for local backend development)
*   **PostgreSQL 16 with PostGIS extension** (if running services locally without Docker)

---

## 🚀 Running via Docker (Recommended for Production/Testing)

The repository includes a self-contained production Docker Compose stack (`docker-compose.prod.yml`). This will spin up the database, run migrations automatically, start the backend, API server, and serve the frontend via Nginx.

### 1. Environment Setup

Copy the example environment file and fill in your secrets.
```bash
cp .env.example .env
```
Ensure you have the required variables set:
*   `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
*   `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GEMINI_API_KEY`, `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`

### 2. Start the Stack

Run the following command to build the optimized multi-stage Docker images and start all services in detached mode:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 3. Accessing the Application

Once the services are healthy, Nginx will route traffic:
*   **Frontend UI:** `http://localhost:80` (or `https://localhost:443`)
*   **API Server:** Proxied internally.

### 4. Stopping the Stack

To stop the containers without destroying the database volume:
```bash
docker compose -f docker-compose.prod.yml down
```
*(Add `-v` if you wish to wipe the database volume).*

---

## 💻 Running Locally (Development Mode)

If you are developing features, you can run the services locally using `pnpm` and standard run commands.

### 1. Start the Database (Docker)

You will need a PostGIS-enabled database. You can use the `docker-compose.dev.yml` file to spin up just the database:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

### 2. Run Database Migrations

From the root of the repository, execute the Drizzle migrations:
```bash
pnpm --filter @workspace/db run migrate
```
*(Ensure `DATABASE_URL` is set in your `.env` file first).*

### 3. Start the API Server

```bash
cd artifacts/api-server
pnpm install
pnpm dev
```
The API server will start on `http://localhost:8000` (or your configured port).

### 4. Start the Frontend (AstroSentinel)

```bash
cd artifacts/astro-sentinel
pnpm install
pnpm dev
```
The Vite development server will be available at `http://localhost:5173`.

### 5. Start the Python Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Or `.\venv\Scripts\activate` on Windows
pip install -r requirements.txt

# Start the FastAPI / Kafka consumer service
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```
