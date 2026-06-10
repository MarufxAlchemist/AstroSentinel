import React, { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useGetEvent, getGetEventQueryKey } from "@workspace/api-client-react";
import { EventBadge } from "@/components/EventBadge";
import { formatMicrosecondDate, formatLatency } from "@/lib/formatters";
import { ArrowLeft, Target, Map, Activity, Clock, Zap, Database, FlaskConical, Bookmark, BookmarkCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SkyMap } from "@/components/SkyMap";
import { useAuth } from "@/lib/AuthContext";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);

  const { data: event, isLoading } = useGetEvent(id, {
    query: {
      enabled: !!id,
      queryKey: getGetEventQueryKey(id)
    }
  });

  // Check bookmark status once event is loaded
  useEffect(() => {
    if (!token || !event?.id) return;
    fetch(`/api/events/${event.id}/bookmark`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data: { bookmarked?: boolean }) => setBookmarked(!!data.bookmarked))
      .catch(() => {});
  }, [token, event?.id]);

  async function toggleBookmark() {
    if (!token || !event?.id || bookmarkLoading) return;
    setBookmarkLoading(true);
    try {
      const method = bookmarked ? "DELETE" : "POST";
      await fetch(`/api/events/${event.id}/bookmark`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      setBookmarked((v) => !v);
    } catch {
      // silent
    } finally {
      setBookmarkLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="container max-w-screen-xl mx-auto p-4 space-y-6">
        <Skeleton className="h-8 w-24 mb-6" />
        <Skeleton className="h-24 w-full" />
        <div className="grid md:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container max-w-screen-xl mx-auto p-4 flex flex-col items-center justify-center min-h-[50vh]">
        <h1 className="text-2xl font-bold mb-4">Event Not Found</h1>
        <Link href="/events" className="text-primary hover:underline">
          Return to Event Log
        </Link>
      </div>
    );
  }

  return (
    <div className="container max-w-screen-xl mx-auto p-4 space-y-6">
      <Link href="/events" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
        <ArrowLeft className="w-4 h-4" />
        Back to Log
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border/50 p-6 rounded-xl shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <EventBadge type={event.eventType} />
            <h1 className="text-3xl font-bold font-mono tracking-tight">{event.eventId}</h1>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground font-mono text-sm">
            <Clock className="w-4 h-4" />
            {formatMicrosecondDate(event.detectionTime)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex flex-col items-end">
            <span className="text-muted-foreground uppercase text-xs tracking-wider">Observatory</span>
            <span className="font-mono font-bold text-primary">{event.observatory}</span>
          </div>
          <div className="h-10 w-px bg-border"></div>
          <div className="flex flex-col items-end">
            <span className="text-muted-foreground uppercase text-xs tracking-wider">Latency</span>
            <span className="font-mono">{formatLatency(event.latencyUs)}</span>
          </div>
          <div className="h-10 w-px bg-border"></div>
          <button
            onClick={toggleBookmark}
            disabled={bookmarkLoading}
            title={bookmarked ? "Remove bookmark" : "Bookmark this event"}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
              bookmarked
                ? "bg-primary/20 border-primary/50 text-primary hover:bg-primary/10"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {bookmarked
              ? <BookmarkCheck className="w-3.5 h-3.5" />
              : <Bookmark className="w-3.5 h-3.5" />}
            {bookmarked ? "Bookmarked" : "Bookmark"}
          </button>
          <div className="h-10 w-px bg-border"></div>
          <Link
            href={`/events/${event.id}/workspace`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Open Research Workspace
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card border-border/50 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Map className="w-5 h-5 text-primary" />
                Localization Map
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-black/50 rounded-lg overflow-hidden border border-border/50">
                <SkyMap events={[event]} />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="w-5 h-5 text-primary" />
                Coordinate Data
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Right Ascension</p>
                  <p className="font-mono text-lg">{event.ra.toFixed(4)}&deg;</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Declination</p>
                  <p className="font-mono text-lg">{event.dec.toFixed(4)}&deg;</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Galactic Lon</p>
                  <p className="font-mono text-lg">{event.galLon.toFixed(4)}&deg;</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Galactic Lat</p>
                  <p className="font-mono text-lg">{event.galLat.toFixed(4)}&deg;</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Error Radius</p>
                  <p className="font-mono text-lg text-amber-500">{event.errorRadius.toFixed(2)}'</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Sun Distance</p>
                  <p className="font-mono text-lg">{event.sunDistance.toFixed(1)}&deg;</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Moon Distance</p>
                  <p className="font-mono text-lg">{event.moonDistance.toFixed(1)}&deg;</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-border/50 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="w-5 h-5 text-primary" />
                Signal Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Signal-to-Noise Ratio (SNR)</p>
                <div className="flex items-end gap-2">
                  <p className="font-mono text-3xl font-bold">{event.snr.toFixed(2)}</p>
                  <span className="text-sm text-muted-foreground mb-1">&sigma;</span>
                </div>
                <div className="w-full h-1.5 bg-muted mt-2 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary" 
                    style={{ width: `${Math.min(100, (event.snr / 20) * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">False Alarm Rate (FAR)</p>
                <p className="font-mono text-lg">{event.far.toExponential(2)} Hz</p>
                <p className="text-xs text-muted-foreground mt-1">
                  1 per {(1 / event.far / (3600 * 24 * 365)).toFixed(1)} years
                </p>
              </div>

              {event.fluence !== null && event.fluence !== undefined && (
                <div className="pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Fluence (GRB)
                  </p>
                  <p className="font-mono text-lg">{event.fluence.toExponential(3)} erg/cm&sup2;</p>
                </div>
              )}

              {event.dm !== null && event.dm !== undefined && (
                <div className="pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Database className="w-3 h-3" /> Dispersion Measure (FRB)
                  </p>
                  <p className="font-mono text-lg">{event.dm.toFixed(1)} pc/cm&sup3;</p>
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card className="bg-card border-border/50 shadow-none">
            <CardHeader className="py-4">
              <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">System Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Internal ID</span>
                <span className="font-mono truncate w-32 text-right">{event.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ingested At</span>
                <span className="font-mono">{new Date(event.createdAt).toISOString().split('T')[1].replace('Z', '')} UTC</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
