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
  session_id: string;
  server_time: string;
  subscribed_topics: string[];
  buffer_size: number;
  heartbeat_interval: number;
  deprecated: boolean;
}

interface AlertMessage extends BaseMessage {
  type: "alert";
  sequence: number;
  event: RawEvent;
  notification: RawNotification;
}

interface HeartbeatMessage extends BaseMessage {
  type: "heartbeat";
  listener_alive: boolean;
  kafka_connected: boolean;
  last_alert_at: string | null;
  last_sequence: number | null;
  active_connections: number;
}

interface HistoryStartMessage extends BaseMessage {
  type: "history_start";
  request_id: string;
  since: string;
  total_events: number;
}

interface HistoryEventMessage extends BaseMessage {
  type: "history_event";
  request_id: string;
  event: RawEvent;
  notification: RawNotification;
}

interface HistoryEndMessage extends BaseMessage {
  type: "history_end";
  request_id: string;
  events_sent: number;
  truncated: boolean;
}

interface PongMessage extends BaseMessage {
  type: "pong";
  echo_sent_at: string;
}

interface ErrorMessage extends BaseMessage {
  type: "error";
  code: string;
  detail: string;
  request_id?: string;
}

type ServerMessage =
  | ConnectionAckMessage
  | AlertMessage
  | HeartbeatMessage
  | HistoryStartMessage
  | HistoryEventMessage
  | HistoryEndMessage
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
  raw: any;
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
const DEFAULT_WATCHDOG_MS = 45_000;

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
// Helpers
// ---------------------------------------------------------------------------

/** crypto.randomUUID() is only available on HTTPS or localhost.
 *  This fallback works on plain HTTP (e.g. dev via LAN IP).  */
function safeUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC-4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAstroWebSocketResult {
  events: AstroEvent[];
  isConnected: boolean;
  listenerAlive: boolean;
  kafkaConnected: boolean;
  latestNotification: Omit<AlertNotification, "id" | "seenAt"> | null;
  subscribedTopics: string[];
  retryCount: number;
  gaveUp: boolean;
}

export function useAstroWebSocket(): UseAstroWebSocketResult {
  const [events,               setEvents]               = useState<AstroEvent[]>([]);
  const [isConnected,          setIsConnected]          = useState(false);
  const [listenerAlive,        setListenerAlive]        = useState(false);
  const [kafkaConnected,       setKafkaConnected]       = useState(true);
  const [latestNotification,   setLatestNotification]   = useState<Omit<AlertNotification, "id" | "seenAt"> | null>(null);
  const [subscribedTopics,     setSubscribedTopics]     = useState<string[]>([]);
  const [retryCount,           setRetryCount]           = useState(0);
  const [gaveUp,               setGaveUp]               = useState(false);

  const wsRef            = useRef<WebSocket | null>(null);
  const retryCountRef    = useRef(0);
  const reconnectTimer   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const watchdogTimer    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unmountedRef     = useRef(false);

  const lastEventTimeRef = useRef<string | null>(null);
  const lastSequenceRef  = useRef<number | null>(null);
  const watchdogMsRef    = useRef<number>(DEFAULT_WATCHDOG_MS);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  const sendJson = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const resetWatchdog = useCallback(() => {
    clearTimeout(watchdogTimer.current);
    watchdogTimer.current = setTimeout(() => {
      console.warn("[ws] Heartbeat watchdog expired — forcing reconnect");
      setListenerAlive(false);
      wsRef.current?.close(1001, "watchdog");
    }, watchdogMsRef.current);
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

    if (msg.schema_version && msg.schema_version !== "1") {
      console.warn(`[ws] Unsupported schema_version: ${msg.schema_version}`);
    }

    switch (msg.type) {
      case "connection_ack": {
        setSubscribedTopics(msg.subscribed_topics);
        setListenerAlive(true);
        watchdogMsRef.current = msg.heartbeat_interval * 1500; // x1.5
        resetWatchdog();
        console.info("[ws] Connected. Topics:", msg.subscribed_topics);

        if (msg.deprecated) {
          console.warn("[ws] Server indicated this API version is deprecated.");
        }

        // Request history if we have a cursor
        if (lastEventTimeRef.current) {
          sendJson({
            type: "history_request",
            schema_version: "1",
            sent_at: new Date().toISOString(),
            request_id: safeUUID(),
            since: lastEventTimeRef.current,
            last_sequence: lastSequenceRef.current
          });
        }
        break;
      }

      case "alert": {
        const event = toAstroEvent(msg.event);
        
        lastEventTimeRef.current = event.detectionTime;
        lastSequenceRef.current = msg.sequence;

        setEvents(prev => {
          if (prev.some(e => e.id === event.id)) return prev;
          return [event, ...prev].slice(0, 100);
        });

        const { event_id, event_type, observatory, timestamp, priority } = msg.notification;
        setLatestNotification({
          event_id,
          event_type,
          observatory,
          timestamp,
          priority,
        });

        if (priority === "high") {
          sendJson({
            type: "ack",
            schema_version: "1",
            sent_at: new Date().toISOString(),
            event_id: event.eventId,
            sequence: msg.sequence
          });
        }
        break;
      }

      case "heartbeat": {
        setListenerAlive(msg.listener_alive);
        setKafkaConnected(msg.kafka_connected);
        resetWatchdog();
        break;
      }

      case "history_start": {
        console.info(`[ws] History replay starting... (${msg.total_events} events expected)`);
        break;
      }

      case "history_event": {
        const event = toAstroEvent(msg.event);
        
        // Update cursors if this is newer
        if (!lastEventTimeRef.current || event.detectionTime > lastEventTimeRef.current) {
           lastEventTimeRef.current = event.detectionTime;
        }

        setEvents(prev => {
          if (prev.some(e => e.id === event.id)) return prev;
          // Sort after adding history to ensure chronological order
          const newEvents = [event, ...prev].sort(
            (a, b) => new Date(b.detectionTime).getTime() - new Date(a.detectionTime).getTime()
          );
          return newEvents.slice(0, 100);
        });
        break;
      }

      case "history_end": {
        console.info(`[ws] History replay complete. Truncated: ${msg.truncated}`);
        break;
      }

      case "pong": {
        // Optional latency calc
        break;
      }

      case "error": {
        console.error(`[ws] Server error ${msg.code}: ${msg.detail}`);
        break;
      }

      default: {
        console.debug("[ws] Unknown message type:", (msg as BaseMessage).type);
      }
    }
  }, [resetWatchdog, sendJson]);

  // ------------------------------------------------------------------
  // Connect / reconnect
  // ------------------------------------------------------------------

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (gaveUp) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = `${protocol}//${window.location.host}/api/ws?v=1`;
    
    if (lastEventTimeRef.current) {
        wsUrl += `&since=${encodeURIComponent(lastEventTimeRef.current)}`;
    }

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      if (unmountedRef.current) { socket.close(); return; }
      setIsConnected(true);
      setRetryCount(0);
      retryCountRef.current = 0;
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
    kafkaConnected,
    latestNotification,
    subscribedTopics,
    retryCount,
    gaveUp,
  };
}
