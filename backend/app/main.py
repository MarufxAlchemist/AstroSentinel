from contextlib import asynccontextmanager
import asyncio
import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query

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


import os

@app.get("/health")
def health():
    return {"status": "healthy"}

@app.get("/api/events")
def get_events(limit: int = 100):
    events_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "historical_events.json")
    try:
        if os.path.exists(events_file):
            with open(events_file, "r") as f:
                events = json.load(f)
                return {"events": events[:limit], "total": len(events)}
    except Exception as e:
        print(f"Error loading historical_events.json: {e}")
    return {"events": [], "total": 0}

@app.get("/api/events/stats")
def get_event_stats():
    events_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "historical_events.json")
    try:
        if os.path.exists(events_file):
            with open(events_file, "r") as f:
                events = json.load(f)
                grb = sum(1 for e in events if e.get("eventType") == "GRB")
                gw = sum(1 for e in events if e.get("eventType") == "GW")
                frb = sum(1 for e in events if e.get("eventType") == "FRB")
                
                obs_counts = {}
                for e in events:
                    obs = e.get("observatory", "Unknown")
                    obs_counts[obs] = obs_counts.get(obs, 0) + 1
                
                by_observatory = [{"observatory": k, "count": v} for k, v in obs_counts.items()]
                
                return {
                    "totalEvents": len(events),
                    "byType": {"GRB": grb, "GW": gw, "FRB": frb},
                    "byObservatory": by_observatory,
                    "recentRate": 0.5,
                    "latestEvent": events[0] if events else None
                }
    except Exception as e:
        print(f"Error loading stats: {e}")
    return {
        "totalEvents": 0,
        "byType": {"GRB": 0, "GW": 0, "FRB": 0},
        "byObservatory": [],
        "recentRate": 0,
        "latestEvent": None
    }


@app.websocket("/api/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    v: str = Query(default="1"),
    since: str | None = Query(default=None),
):
    """
    Primary WebSocket endpoint.

    Query params
    ------------
    v     : schema version the client supports ("1")
    since : ISO-8601 timestamp — if present the client wants history replay
            after connection_ack (it will send a history_request message)

    Server → Client message flow
    ----------------------------
    1. connection_ack  (on connect)
    2. alert           (each GCN event, broadcast)
    3. heartbeat       (every 30 s, broadcast)
    4. history_start / history_event × N / history_end  (on history_request)
    5. pong            (on ping)
    6. error           (on bad client message)

    Client → Server messages handled
    ---------------------------------
    ping             → pong
    history_request  → history_start / history_event / history_end
    ack              → logged (no-op in v1; reserved for guaranteed delivery)
    """
    await manager.connect(websocket)

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, AttributeError):
                await manager.send_error(
                    websocket,
                    code="INVALID_MESSAGE",
                    detail="Frame is not valid JSON",
                )
                continue

            msg_type = msg.get("type")

            # ── ping ─────────────────────────────────────────────────────────
            if msg_type == "ping":
                await manager.send_pong(
                    websocket,
                    echo_sent_at=msg.get("sent_at", ""),
                )

            # ── history_request ───────────────────────────────────────────────
            elif msg_type == "history_request":
                req_since = msg.get("since")
                if not req_since:
                    await manager.send_error(
                        websocket,
                        code="INVALID_MESSAGE",
                        detail="history_request must include a 'since' field",
                        request_id=msg.get("request_id"),
                    )
                    continue

                await manager.send_history(
                    websocket,
                    request_id=msg.get("request_id", ""),
                    since=req_since,
                    last_sequence=msg.get("last_sequence"),
                )

            # ── ack ───────────────────────────────────────────────────────────
            elif msg_type == "ack":
                # Guaranteed-delivery hook — reserved for v1, no-op for now.
                # The event_id and sequence are available for future logging.
                print(
                    f"[ws] Client ack: event_id={msg.get('event_id')} "
                    f"seq={msg.get('sequence')}"
                )

            # ── unknown ───────────────────────────────────────────────────────
            elif msg_type is not None:
                await manager.send_error(
                    websocket,
                    code="UNKNOWN_TYPE",
                    detail=f"Unrecognized message type: {msg_type!r}",
                )

    except WebSocketDisconnect:
        manager.disconnect(websocket)
