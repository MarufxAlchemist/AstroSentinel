import { WebSocketServer, WebSocket } from "ws";
import { logger } from "./logger";

let wss: WebSocketServer | null = null;

export function setWebSocketServer(server: WebSocketServer) {
  wss = server;
}

export function broadcastEvent(event: Record<string, unknown>) {
  if (!wss) return;

  // Primary event message
  const eventMsg = JSON.stringify({ type: "new_event", data: event });

  // Notification message alongside the event
  const snr = typeof event["snr"] === "number" ? event["snr"] : 0;
  const far = typeof event["far"] === "number" ? event["far"] : 1;
  const priority = snr >= 20 || far < 1e-6 ? "high" : "normal";
  const notifMsg = JSON.stringify({
    type: "notification",
    event_id: event["eventId"],
    event_type: event["eventType"],
    observatory: event["observatory"],
    timestamp: event["detectionTime"],
    priority,
  });

  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(eventMsg);
      client.send(notifMsg);
      count++;
    }
  });
  logger.info({ clientCount: count, eventId: event["eventId"] }, "Broadcasted event to WS clients");
}
