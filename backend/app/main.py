from contextlib import asynccontextmanager
import asyncio
import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.websocket.manager import manager
from app.gcn.background_listener import start_listener


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(start_listener())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Cosmic Alert System API",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/")
def root():
    return {
        "status":  "online",
        "service": "Cosmic Alert System",
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Primary WebSocket endpoint.

    On connect:
      • Accepts the connection
      • Sends a connection_ack message (via manager.connect)

    Message loop:
      • Accepts client text frames (ping / pong protocol)
      • Responds to { "type": "ping" } with { "type": "pong" }
      • Ignores unknown client messages gracefully

    On disconnect:
      • Removes client from active_connections
    """
    await manager.connect(websocket)

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_json({
                        "type":           "pong",
                        "schema_version": "1",
                        "sent_at":        msg.get("sent_at"),
                    })
            except (json.JSONDecodeError, AttributeError):
                pass  # non-JSON frames are silently ignored

    except WebSocketDisconnect:
        manager.disconnect(websocket)