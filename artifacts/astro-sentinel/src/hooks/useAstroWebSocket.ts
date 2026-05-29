import { useState, useEffect, useRef } from "react";
import type { AstroEvent } from "@workspace/api-client-react/src/generated/api.schemas";
import type { AlertNotification } from "@/lib/NotificationsContext";

interface UseAstroWebSocketResult {
  events: AstroEvent[];
  isConnected: boolean;
  latestNotification: Omit<AlertNotification, "id" | "seenAt"> | null;
}

export function useAstroWebSocket(): UseAstroWebSocketResult {
  const [events, setEvents] = useState<AstroEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [latestNotification, setLatestNotification] = useState<Omit<AlertNotification, "id" | "seenAt"> | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/ws`;

      const socket = new WebSocket(wsUrl);

      socket.onopen = () => setIsConnected(true);

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as {
            type: string;
            data?: AstroEvent;
            event_id?: string;
            event_type?: string;
            observatory?: string;
            timestamp?: string;
            priority?: "normal" | "high";
          };

          if (message.type === "new_event" && message.data) {
            setEvents((prev) => [message.data!, ...prev].slice(0, 100));
          }

          if (message.type === "notification" && message.event_id) {
            setLatestNotification({
              event_id:    message.event_id,
              event_type:  message.event_type  ?? "unknown",
              observatory: message.observatory ?? "unknown",
              timestamp:   message.timestamp   ?? new Date().toISOString(),
              priority:    message.priority    ?? "normal",
            });
          }
        } catch (e) {
          console.error("Failed to parse websocket message", e);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.current = socket;
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      ws.current?.close();
    };
  }, []);

  return { events, isConnected, latestNotification };
}
