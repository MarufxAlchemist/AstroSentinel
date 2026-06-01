from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

from app.gcn.topics import TOPICS

SCHEMA_VERSION = "1"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class ConnectionManager:

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        await self._send_ack(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    # ------------------------------------------------------------------
    # Typed send helpers
    # ------------------------------------------------------------------

    async def _send_ack(self, websocket: WebSocket) -> None:
        """Send connection_ack immediately after accepting a client."""
        ack = {
            "type":               "connection_ack",
            "schema_version":     SCHEMA_VERSION,
            "sent_at":            _now_iso(),
            "subscribed_topics":  TOPICS,
            "server_time":        _now_iso(),
        }
        try:
            await websocket.send_json(ack)
        except Exception as exc:
            print(f"[manager] Failed to send connection_ack: {exc}")
            self.disconnect(websocket)

    async def send_heartbeat(self, last_alert_at: str | None = None) -> None:
        """
        Broadcast a heartbeat to all connected clients.
        Called every 30 s by background_listener.
        """
        heartbeat = {
            "type":               "heartbeat",
            "schema_version":     SCHEMA_VERSION,
            "sent_at":            _now_iso(),
            "listener_alive":     True,
            "last_alert_at":      last_alert_at,
            "active_connections": len(self.active_connections),
        }
        await self.broadcast(heartbeat)

    # ------------------------------------------------------------------
    # Broadcast
    # ------------------------------------------------------------------

    async def broadcast(self, message: dict[str, Any]) -> None:
        """
        Send a message to all connected clients.
        Clients that fail are collected and disconnected after the loop
        to avoid mutating active_connections during iteration.
        """
        disconnected: list[WebSocket] = []

        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)

        for connection in disconnected:
            self.disconnect(connection)

    async def send_error(
        self,
        websocket: WebSocket,
        code: str,
        detail: str,
    ) -> None:
        """Send a structured error message to a single client."""
        error = {
            "type":           "error",
            "schema_version": SCHEMA_VERSION,
            "sent_at":        _now_iso(),
            "code":           code,
            "detail":         detail,
        }
        try:
            await websocket.send_json(error)
        except Exception:
            self.disconnect(websocket)


manager = ConnectionManager()