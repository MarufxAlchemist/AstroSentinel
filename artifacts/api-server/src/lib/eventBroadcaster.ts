import { WebSocketServer, WebSocket } from "ws";
import { logger } from "./logger";

let wss: WebSocketServer | null = null;

export function setWebSocketServer(server: WebSocketServer) {
  wss = server;
}

let sequenceCount = 1;

export function broadcastEvent(event: Record<string, unknown>) {
  if (!wss) return;

  const snr = typeof event["snr"] === "number" ? event["snr"] : 0;
  const far = typeof event["far"] === "number" ? event["far"] : 1;
  const priority = snr >= 20 || far < 1e-6 ? "high" : "normal";

  const notifMsg = {
    event_id:   event["eventId"],
    event_type: event["eventType"],
    observatory: event["observatory"],
    timestamp:  event["detectionTime"],
    priority,
  };

  const alertMsg = JSON.stringify({
    type: "alert",
    schema_version: "1",
    sent_at: new Date().toISOString(),
    sequence: sequenceCount++,
    event,
    notification: notifMsg,
  });

  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(alertMsg);
      count++;
    }
  });
  logger.info({ clientCount: count, eventId: event["eventId"] }, "Broadcasted new event to WS clients");
}

/**
 * Broadcast an in-place update for an existing event.
 * The frontend handles type:"event_updated" by replacing the existing card
 * (matched by eventId) rather than prepending a new one.
 */
export function broadcastEventUpdate(event: Record<string, unknown>) {
  if (!wss) return;

  const updateMsg = JSON.stringify({
    type: "event_updated",
    schema_version: "1",
    sent_at: new Date().toISOString(),
    sequence: sequenceCount++,
    event,
  });

  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(updateMsg);
      count++;
    }
  });
  logger.info(
    { clientCount: count, eventId: event["eventId"], revisionCount: event["revisionCount"] },
    "Broadcasted event_updated to WS clients",
  );
}
