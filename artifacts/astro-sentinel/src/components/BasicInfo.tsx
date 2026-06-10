import type { AstroEvent } from "@workspace/api-client-react";
import { formatMicrosecondDate, formatLatency } from "@/lib/formatters";

interface Props { event: AstroEvent; }

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline border-b border-border/40 py-1 gap-2">
      <span className="text-[10px] text-muted-foreground font-mono shrink-0">{label}</span>
      <span className="text-[10px] text-foreground font-mono text-right">{value}</span>
    </div>
  );
}

const EXTERNAL_LINKS = [
  { name: "GCN", desc: "Follow link for further information.", icon: "📡" },
  { name: "ALADIN", desc: "Displays event in an interactive sky atlas", icon: "🌌" },
  { name: "ESASky", desc: "Displays event in an interactive sky atlas", icon: "🔭" },
  { name: "TNS", desc: "Transient Name Server", icon: "🌟" },
];

export function BasicInfo({ event }: Props) {
  return (
    <div className="flex flex-col">
      <div className="p-3 space-y-0.5">
        <Row label="Event ID" value={event.eventId} />
        <Row label="Type" value={event.eventType === "GRB" ? "Gamma-ray burst" : event.eventType === "GW" ? "Gravitational wave" : "Fast radio burst"} />
        <Row label="Date [UTC]" value={formatMicrosecondDate(event.detectionTime).slice(0, 19).replace("T", " ")} />
        <Row label="Observatory" value={event.observatory} />
        <Row label="Instrument" value={`${event.observatory}/${event.eventType}`} />
        <Row label="RA [deg]" value={event.ra.toFixed(4) + "°"} />
        <Row label="Dec [deg]" value={event.dec.toFixed(4) + "°"} />
        <Row label="Err radius" value={event.errorRadius.toFixed(2) + "'"} />
        <Row label="Gal. lon" value={event.galLon.toFixed(2) + "°"} />
        <Row label="Gal. lat" value={event.galLat.toFixed(2) + "°"} />
        <Row label="SNR" value={event.snr.toFixed(2) + " σ"} />
        <Row label="FAR" value={event.far.toExponential(3) + " Hz"} />
        <Row label="Sun dist." value={event.sunDistance.toFixed(1) + "°"} />
        <Row label="Moon dist." value={event.moonDistance.toFixed(1) + "°"} />
        <Row label="Latency" value={formatLatency(event.latencyUs)} />
        {event.fluence != null && <Row label="Fluence" value={event.fluence.toExponential(3) + " erg/cm²"} />}
        {event.dm != null && <Row label="DM" value={event.dm.toFixed(1) + " pc/cm³"} />}
      </div>
      <div className="border-t border-border p-2 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">External information:</span>
          <div className="flex gap-1">
            {[0,1,2,3].map(i => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === 0 ? "bg-primary" : "bg-border"}`} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {EXTERNAL_LINKS.map(link => (
            <div key={link.name} className="flex gap-2 p-2 rounded border border-border bg-card hover:border-muted-foreground hover:bg-accent/30 transition-colors cursor-pointer">
              <span className="text-base leading-none shrink-0">{link.icon}</span>
              <div>
                <div className="text-[11px] font-semibold text-foreground">{link.name}</div>
                <div className="text-[9px] text-muted-foreground leading-tight">{link.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
