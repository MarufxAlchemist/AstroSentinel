import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "@/lib/NotificationsContext";
import type { AlertNotification } from "@/lib/NotificationsContext";

function priorityDot(p: AlertNotification["priority"]) {
  return p === "high"
    ? "bg-red-500 dark:bg-red-400"
    : "bg-primary";
}

function timeAgo(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60)  return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function toggle() {
    if (!open) markAllRead();
    setOpen(v => !v);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="relative p-1.5 rounded hover:bg-accent hover:text-foreground text-muted-foreground transition-colors"
        title="Alert notifications"
      >
        <Bell className="w-3.5 h-3.5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 z-50 rounded border border-border shadow-xl"
          style={{ background: "hsl(var(--navbar-bg))" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[11px] font-semibold text-foreground font-mono uppercase tracking-wider">
              Alerts
            </span>
            <button onClick={clearAll} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              Clear all
            </button>
          </div>

          {/* List */}
          <div className="max-h-64 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                No alerts yet
              </div>
            ) : notifications.map(n => (
              <div key={n.id}
                className={`flex items-start gap-2 px-3 py-2 border-b border-border/40 last:border-b-0 hover:bg-accent/20 transition-colors ${
                  n.priority === "high" ? "bg-red-500/5" : ""
                }`}>
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot(n.priority)}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] font-mono font-semibold text-foreground truncate">{n.event_id}</span>
                    {n.priority === "high" && (
                      <span className="text-[9px] font-mono text-red-500 dark:text-red-400 uppercase shrink-0">HIGH</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{n.event_type} · {n.observatory}</div>
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0 mt-0.5 font-mono">{timeAgo(n.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
