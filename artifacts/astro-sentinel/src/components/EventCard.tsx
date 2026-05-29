import { Link } from "wouter";
import { AstroEvent } from "@workspace/api-client-react/src/generated/api.schemas";
import { formatMicrosecondDate, formatLatency } from "@/lib/formatters";

interface EventCardProps {
  event: AstroEvent;
  animate?: boolean;
}

function typeColor(type: string) {
  switch (type) {
    case "GRB": return { bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-400", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", dot: "bg-amber-500" };
    case "GW":  return { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", dot: "bg-emerald-500" };
    case "FRB": return { bg: "bg-yellow-400/10", border: "border-yellow-400/40", text: "text-yellow-300", badge: "bg-yellow-400/15 text-yellow-300 border-yellow-400/30", dot: "bg-yellow-400" };
    default:    return { bg: "bg-blue-500/10", border: "border-blue-500/40", text: "text-blue-400", badge: "bg-blue-500/15 text-blue-400 border-blue-500/30", dot: "bg-blue-500" };
  }
}

export function EventCard({ event, animate = false }: EventCardProps) {
  const c = typeColor(event.eventType);
  const time = formatMicrosecondDate(event.detectionTime).slice(11, 19);

  return (
    <Link href={`/events/${event.id}`}>
      <div
        className={`group p-3 rounded-lg border bg-card hover:bg-accent/30 cursor-pointer transition-all hover:border-border ${c.border} ${
          animate ? "animate-in fade-in slide-in-from-top-2 duration-400" : ""
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${c.dot} shadow-[0_0_5px_currentColor]`} />
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${c.badge}`}>
              {event.eventType}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">{event.observatory}</span>
        </div>
        <div className="font-mono text-xs font-bold text-foreground group-hover:text-primary transition-colors truncate mb-1.5">
          {event.eventId}
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
          <div><span className="text-foreground/60">RA </span>{event.ra.toFixed(1)}°</div>
          <div><span className="text-foreground/60">Dec </span>{event.dec.toFixed(1)}°</div>
          <div><span className="text-foreground/60">SNR </span>{event.snr.toFixed(1)}σ</div>
          <div><span className="text-foreground/60">T </span>{time} UTC</div>
        </div>
      </div>
    </Link>
  );
}
