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

  ws.on("close", () => {
    logger.info("WebSocket client disconnected");
  });

  ws.on("error", (err) => {
    logger.error({ err }, "WebSocket error");
  });

  // Send a welcome ping
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "connected", message: "AstroSentinel WebSocket connected" }));
  }
});

server.listen(port, () => {
  logger.info({ port }, "Server listening (HTTP + WebSocket)");
  startIngestion();
});
