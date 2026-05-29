import React, { useState } from "react";
import { useListEvents } from "@workspace/api-client-react";
import { ListEventsEventType } from "@workspace/api-client-react/src/generated/api.schemas";
import { EventCard } from "@/components/EventCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Filter } from "lucide-react";

const ITEMS_PER_PAGE = 24;

export default function EventsPage() {
  const [page, setPage] = useState(0);
  const [eventType, setEventType] = useState<ListEventsEventType | "ALL">("ALL");
  const [observatory, setObservatory] = useState<string>("ALL");

  const { data, isLoading } = useListEvents({
    limit: ITEMS_PER_PAGE,
    offset: page * ITEMS_PER_PAGE,
    ...(eventType !== "ALL" ? { eventType } : {}),
    ...(observatory !== "ALL" ? { observatory } : {})
  });

  const totalPages = data ? Math.ceil(data.total / ITEMS_PER_PAGE) : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header strip */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-[hsl(220_50%_7%)] shrink-0">
        <div>
          <h1 className="text-sm font-bold tracking-tight text-foreground">Event Archive</h1>
          <p className="text-[10px] text-muted-foreground font-mono">Historical signal database</p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <Select value={eventType} onValueChange={(val: any) => { setEventType(val); setPage(0); }}>
            <SelectTrigger className="h-7 text-xs w-[160px] bg-card border-border">
              <SelectValue placeholder="Event Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              <SelectItem value="GRB">Gamma-ray Bursts</SelectItem>
              <SelectItem value="GW">Gravitational Waves</SelectItem>
              <SelectItem value="FRB">Fast Radio Bursts</SelectItem>
            </SelectContent>
          </Select>
          <Select value={observatory} onValueChange={(val) => { setObservatory(val); setPage(0); }}>
            <SelectTrigger className="h-7 text-xs w-[150px] bg-card border-border">
              <SelectValue placeholder="Observatory" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Observatories</SelectItem>
              <SelectItem value="Swift">Swift</SelectItem>
              <SelectItem value="Fermi">Fermi</SelectItem>
              <SelectItem value="INTEGRAL">INTEGRAL</SelectItem>
              <SelectItem value="LIGO">LIGO</SelectItem>
              <SelectItem value="Virgo">Virgo</SelectItem>
              <SelectItem value="KAGRA">KAGRA</SelectItem>
              <SelectItem value="CHIME">CHIME</SelectItem>
              <SelectItem value="ASKAP">ASKAP</SelectItem>
              <SelectItem value="Parkes">Parkes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto text-xs font-mono text-muted-foreground">
          {data?.total ?? 0} events
        </div>
      </div>

      {/* Event grid */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : data?.events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-muted-foreground text-sm mb-3">No events match your filters.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setEventType("ALL"); setObservatory("ALL"); }}
            >
              Clear Filters
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {data?.events.map(event => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-2 border-t border-border shrink-0 bg-[hsl(220_50%_7%)]">
          <Button
            variant="outline"
            size="icon"
            className="w-7 h-7"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="w-7 h-7"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
