import crypto from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { setWebSocketServer } from "./lib/eventBroadcaster";
import { startIngestion } from "./lib/eventIngestion";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

const wss = new WebSocketServer({ server, path: "/api/ws" });
setWebSocketServer(wss);

wss.on("connection", (ws, req) => {
  logger.info({ ip: req.socket.remoteAddress }, "WebSocket client connected");

  // Send connection ack
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "connection_ack",
      schema_version: "1",
      sent_at: new Date().toISOString(),
      session_id: crypto.randomUUID(),
      server_time: new Date().toISOString(),
      subscribed_topics: ["events"],
      buffer_size: 100,
      heartbeat_interval: 30000,
      deprecated: false
    }));
  }

  // Set up heartbeat
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "heartbeat",
        schema_version: "1",
        sent_at: new Date().toISOString(),
        listener_alive: true,
        kafka_connected: true,
        last_alert_at: null,
        last_sequence: null,
        active_connections: wss.clients.size
      }));
    }
  }, 30000);

  ws.on("close", () => {
    logger.info("WebSocket client disconnected");
    clearInterval(interval);
  });

  ws.on("error", (err) => {
    logger.error({ err }, "WebSocket error");
  });
});

server.listen(port, () => {
  logger.info({ port }, "Server listening (HTTP + WebSocket)");
  startIngestion();
});
