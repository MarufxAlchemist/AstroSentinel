##############################################################################
# backend/Dockerfile
# Python 3.12-slim — FastAPI + uvicorn GCN Kafka consumer
#
# Single stage: pure Python, nothing to "compile", no multi-stage needed.
# The image is kept small by using the slim base and not installing extras.
##############################################################################

FROM python:3.12-slim

# ── System dependencies ───────────────────────────────────────────────────────
# astropy needs gcc/libgfortran at install time (C extensions).
# We install them, build, then remove build tools in the same RUN layer
# to keep the layer diff small.
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libgfortran5 \
    && rm -rf /var/lib/apt/lists/*

# ── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ── Python dependencies ───────────────────────────────────────────────────────
# Copy requirements first so Docker can cache this layer independently
# of source code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Application source ────────────────────────────────────────────────────────
# Copy the entire backend/ directory content into /app
COPY . .

# ── Expose port ───────────────────────────────────────────────────────────────
EXPOSE 8001

# ── Runtime command ───────────────────────────────────────────────────────────
# Matches the exact command from run-commands.txt.
# --host 0.0.0.0 is required so the container port is reachable from other
# containers and from the host machine.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
