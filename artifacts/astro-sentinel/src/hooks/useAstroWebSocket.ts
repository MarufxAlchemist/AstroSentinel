import { useState, useEffect, useRef, useCallback } from "react";
import type { AstroEvent } from "@workspace/api-client-react/src/generated/api.schemas";
import type { AlertNotification } from "@/lib/NotificationsContext";

// ---------------------------------------------------------------------------
// Server message types (discriminated union, schema_version 1)
// ---------------------------------------------------------------------------

interface BaseMessage {
  type: string;
  schema_version: string;
  sent_at: string;
}

interface ConnectionAckMessage extends BaseMessage {
  type: "connection_ack";
  subscribed_topics: string[];
  server_time: string;
}

interface AlertMessage extends BaseMessage {
  type: "alert";
  event: RawEvent;
  notification: RawNotification;
}

interface HeartbeatMessage extends BaseMessage {
  type: "heartbeat";
  listener_alive: boolean;
  last_alert_at: string | null;
  active_connections: number;
}

interface PongMessage extends BaseMessage {
  type: "pong";
}

interface ErrorMessage extends BaseMessage {
  type: "error";
  code: string;
  detail: string;
}

type ServerMessage =
  | ConnectionAckMessage
  | AlertMessage
  | HeartbeatMessage
  | PongMessage
  | ErrorMessage;

// ---------------------------------------------------------------------------
// Raw backend shapes (snake_case) → mapped to camelCase AstroEvent below
// ---------------------------------------------------------------------------

interface RawEvent {
  id: string;
  eventId: string;
  eventType: string;
  observatory: string;
  topic: string;
  detectionTime: string;
  ra: number;
  dec: number;
  errorRadius: number;
  snr: number;
  far: number;
  latencyUs: number;
  galLon: number;
  galLat: number;
  sunDistance: number;
  moonDistance: number;
  fluence: number | null;
  dm: number | null;
}

interface RawNotification {
  event_id: string;
  event_type: string;
  observatory: string;
  timestamp: string;
  priority: "normal" | "high";
}

// ---------------------------------------------------------------------------
// Adapter: RawEvent → AstroEvent
// The backend already sends camelCase fields; this validates/casts them.
// ---------------------------------------------------------------------------

function toAstroEvent(raw: RawEvent): AstroEvent {
  return {
    id:            raw.id,
    eventId:       raw.eventId,
    eventType:     raw.eventType as AstroEvent["eventType"],
    observatory:   raw.observatory,
    detectionTime: raw.detectionTime,
    ra:            raw.ra,
    dec:           raw.dec,
    errorRadius:   raw.errorRadius,
    snr:           raw.snr,
    far:           raw.far,
    latencyUs:     raw.latencyUs,
    galLon:        raw.galLon,
    galLat:        raw.galLat,
    sunDistance:   raw.sunDistance,
    moonDistance:  raw.moonDistance,
    fluence:       raw.fluence ?? null,
    dm:            raw.dm ?? null,
  } as AstroEvent;
}

// ---------------------------------------------------------------------------
// Reconnect config
// ---------------------------------------------------------------------------

const BASE_DELAY_MS  = 1_000;
const MAX_DELAY_MS   = 30_000;
const MAX_RETRIES    = 10;
// If no heartbeat is received within this window, treat as dead
const HEARTBEAT_WATCHDOG_MS = 45_000;
// Close codes that should NOT trigger reconnect
const NO_RECONNECT_CODES = new Set([
  1000, // Normal closure (server intentional)
  4001, // App-level: auth failure
  4002, // App-level: unsupported version
]);

function backoffDelay(attempt: number): number {
  const jitter = Math.random() * 1_000;
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS) + jitter;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAstroWebSocketResult {
  events: AstroEvent[];
  isConnected: boolean;
  listenerAlive: boolean;
  latestNotification: Omit<AlertNotification, "id" | "seenAt"> | null;
  subscribedTopics: string[];
  retryCount: number;
  gaveUp: boolean;
}

export function useAstroWebSocket(): UseAstroWebSocketResult {
  const [events,               setEvents]               = useState<AstroEvent[]>([]);
  const [isConnected,          setIsConnected]          = useState(false);
  const [listenerAlive,        setListenerAlive]        = useState(false);
  const [latestNotification,   setLatestNotification]   = useState<Omit<AlertNotification, "id" | "seenAt"> | null>(null);
  const [subscribedTopics,     setSubscribedTopics]     = useState<string[]>([]);
  const [retryCount,           setRetryCount]           = useState(0);
  const [gaveUp,               setGaveUp]               = useState(false);

  const wsRef            = useRef<WebSocket | null>(null);
  const retryCountRef    = useRef(0);
  const reconnectTimer   = useRef<ReturnType<typeof setTimeout>>();
  const watchdogTimer    = useRef<ReturnType<typeof setTimeout>>();
  const unmountedRef     = useRef(false);

  // ------------------------------------------------------------------
  // Heartbeat watchdog — resets every time a heartbeat arrives
  // ------------------------------------------------------------------

  const resetWatchdog = useCallback(() => {
    clearTimeout(watchdogTimer.current);
    watchdogTimer.current = setTimeout(() => {
      console.warn("[ws] Heartbeat watchdog expired — forcing reconnect");
      setListenerAlive(false);
      wsRef.current?.close(1001, "watchdog");
    }, HEARTBEAT_WATCHDOG_MS);
  }, []);

  // ------------------------------------------------------------------
  // Message dispatcher
  // ------------------------------------------------------------------

  const handleMessage = useCallback((raw: string) => {
    let msg: ServerMessage;

    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      console.error("[ws] Unparseable message", raw);
      return;
    }

    // Version guard — log and continue with best-effort parse
    if (msg.schema_version && msg.schema_version !== "1") {
      console.warn(`[ws] Unsupported schema_version: ${msg.schema_version}`);
    }

    switch (msg.type) {

      case "connection_ack": {
        setSubscribedTopics(msg.subscribed_topics);
        setListenerAlive(true);
        resetWatchdog();
        console.info("[ws] Connected. Topics:", msg.subscribed_topics);
        break;
      }

      case "alert": {
        const event = toAstroEvent(msg.event);
        setEvents(prev => [event, ...prev].slice(0, 100));

        const { event_id, event_type, observatory, timestamp, priority } =
          msg.notification;
        setLatestNotification({
          event_id,
          event_type,
          observatory,
          timestamp,
          priority,
        });
        break;
      }

      case "heartbeat": {
        setListenerAlive(msg.listener_alive);
        resetWatchdog();
        break;
      }

      case "pong": {
        // Optional: could measure round-trip latency here
        break;
      }

      case "error": {
        console.error(`[ws] Server error ${msg.code}: ${msg.detail}`);
        break;
      }

      default: {
        // Unknown type — ignore gracefully (forward-compatibility)
        console.debug("[ws] Unknown message type:", (msg as BaseMessage).type);
      }
    }
  }, [resetWatchdog]);

  // ------------------------------------------------------------------
  // Connect / reconnect
  // ------------------------------------------------------------------

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (gaveUp) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl    = `${protocol}//${window.location.host}/api/ws?v=1`;

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      if (unmountedRef.current) { socket.close(); return; }
      setIsConnected(true);
      setRetryCount(0);
      retryCountRef.current = 0;
      // connection_ack arrives from server immediately after open
    };

    socket.onmessage = (ev) => handleMessage(ev.data as string);

    socket.onclose = (ev) => {
      if (unmountedRef.current) return;

      clearTimeout(watchdogTimer.current);
      setIsConnected(false);
      setListenerAlive(false);

      if (NO_RECONNECT_CODES.has(ev.code)) {
        console.warn(`[ws] Clean close (${ev.code}) — not reconnecting`);
        return;
      }

      const attempt = retryCountRef.current;

      if (attempt >= MAX_RETRIES) {
        setGaveUp(true);
        console.error("[ws] Max retries reached — giving up");
        return;
      }

      const delay = backoffDelay(attempt);
      retryCountRef.current += 1;
      setRetryCount(retryCountRef.current);

      console.info(
        `[ws] Reconnecting in ${(delay / 1000).toFixed(1)}s ` +
        `(attempt ${retryCountRef.current}/${MAX_RETRIES})`
      );

      reconnectTimer.current = setTimeout(connect, delay);
    };

    socket.onerror = (err) => {
      console.error("[ws] Socket error", err);
      // onclose fires after onerror — reconnect logic lives there
    };
  }, [gaveUp, handleMessage]);

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      clearTimeout(reconnectTimer.current);
      clearTimeout(watchdogTimer.current);
      wsRef.current?.close(1000, "unmount");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    events,
    isConnected,
    listenerAlive,
    latestNotification,
    subscribedTopics,
    retryCount,
    gaveUp,
  };
}
