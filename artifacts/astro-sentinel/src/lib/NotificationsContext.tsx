import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface AlertNotification {
  id: string;
  event_id: string;
  event_type: string;
  observatory: string;
  timestamp: string;
  priority: "normal" | "high";
  seenAt?: number;
}

interface NotificationsContextValue {
  notifications: AlertNotification[];
  unreadCount: number;
  addNotification: (n: Omit<AlertNotification, "id" | "seenAt">) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AlertNotification[]>([]);
  const [readAt, setReadAt] = useState<number>(Date.now());

  const addNotification = useCallback((n: Omit<AlertNotification, "id" | "seenAt">) => {
    const id = `${n.event_id}-${Date.now()}`;
    setNotifications(prev => [{ ...n, id }, ...prev].slice(0, 50));
  }, []);

  const markAllRead = useCallback(() => setReadAt(Date.now()), []);
  const clearAll    = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter(n => !n.seenAt || n.seenAt > readAt).length;

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, addNotification, markAllRead, clearAll }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
