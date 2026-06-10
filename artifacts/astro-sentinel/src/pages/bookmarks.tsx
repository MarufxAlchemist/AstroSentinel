import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Bookmark,
  ArrowRight,
  Trash2,
  Clock,
  Activity,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EventBadge } from "@/components/EventBadge";
import { useAuth } from "@/lib/AuthContext";
import { formatMicrosecondDate } from "@/lib/formatters";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BookmarkedEvent {
  id: string;
  eventId: string;
  eventType: string;
  detectionTime: string;
  ra: number;
  dec: number;
  snr: number;
  far: number;
  status: string;
  createdAt: string;
}

interface BookmarkEntry {
  id: string;
  eventId: string;
  note: string | null;
  createdAt: string;
  event: BookmarkedEvent | null;
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyBookmarks() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3 select-none">
      <div className="bg-muted/50 p-5 rounded-xl border border-border">
        <Bookmark className="w-8 h-8 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">No bookmarks yet</p>
      <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
        Bookmark events from the Event Archive or event detail page to save them here for quick access.
      </p>
      <Link
        href="/events"
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
      >
        Browse Events
        <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

// ─── Bookmark card ───────────────────────────────────────────────────────────

function BookmarkCard({
  bookmark,
  onRemove,
}: {
  bookmark: BookmarkEntry;
  onRemove: (id: string, eventId: string) => void;
}) {
  const ev = bookmark.event;
  const savedDate = new Date(bookmark.createdAt);

  if (!ev) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-4 text-xs text-muted-foreground">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>Event {bookmark.eventId} no longer available</span>
        <button
          onClick={() => onRemove(bookmark.id, bookmark.eventId)}
          className="ml-auto p-1 rounded hover:text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="group relative rounded-lg border border-border/50 bg-card hover:border-border transition-colors overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        {/* Left: event info */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <EventBadge type={ev.eventType} />
            <span className="font-mono font-bold text-sm text-foreground">{ev.eventId}</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                ev.status === "confirmed"
                  ? "text-green-600 border-green-500/40 bg-green-500/10 dark:text-green-400"
                  : "text-amber-600 border-amber-500/40 bg-amber-500/10 dark:text-amber-400"
              }`}
            >
              {ev.status}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(ev.detectionTime).toLocaleString(undefined, {
                month: "short", day: "numeric", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </span>
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3" />
              SNR {ev.snr.toFixed(1)}σ
            </span>
            <span className="font-mono">
              RA {ev.ra.toFixed(2)}° · Dec {ev.dec.toFixed(2)}°
            </span>
          </div>

          {bookmark.note && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-2">
              {bookmark.note}
            </p>
          )}

          <div className="text-[10px] text-muted-foreground">
            Bookmarked{" "}
            {savedDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Link
            href={`/events/${ev.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
          >
            View Event
            <ArrowRight className="w-3 h-3" />
          </Link>
          <button
            onClick={() => onRemove(bookmark.id, bookmark.eventId)}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all"
            title="Remove bookmark"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function BookmarksPage() {
  const { token } = useAuth();
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch("/api/bookmarks", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data: { bookmarks?: BookmarkEntry[]; error?: string }) => {
        if (data.bookmarks) setBookmarks(data.bookmarks);
        else setError(data.error ?? "Failed to load bookmarks");
      })
      .catch(() => setError("Network error loading bookmarks"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleRemove(bookmarkId: string, eventId: string) {
    try {
      await fetch(`/api/events/${eventId}/bookmark`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
    } catch {
      setError("Failed to remove bookmark");
    }
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: "hsl(var(--background))" }}
    >
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-5 shrink-0">
        <div className="max-w-screen-xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-primary/15 p-2 rounded-lg border border-primary/30 shrink-0">
              <Bookmark className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">Bookmarks</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your saved events for quick reference
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              {loading ? "—" : `${bookmarks.length} bookmark${bookmarks.length !== 1 ? "s" : ""}`}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-screen-xl mx-auto">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-lg border border-border/50 bg-card animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-red-500 p-4 rounded-lg border border-red-500/20 bg-red-500/5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          ) : bookmarks.length === 0 ? (
            <EmptyBookmarks />
          ) : (
            <div className="grid gap-3">
              {bookmarks.map((bm) => (
                <BookmarkCard key={bm.id} bookmark={bm} onRemove={handleRemove} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
