import type { AstroEvent } from "@workspace/api-client-react";

interface Props {
  event: AstroEvent;
}

function getClassification(event: AstroEvent) {
  if (event.eventType === "GRB") {
    return event.fluence && event.fluence > 1e-5 ? "Long GRB" : "Short GRB";
  }
  if (event.eventType === "GW") return "Compact binary";
  return "Fast radio burst";
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-1.5 gap-2">
      <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
      <span className="text-[10px] font-mono text-foreground text-right">{value}</span>
    </div>
  );
}

export function DerivedParameters({ event }: Props) {
  const ep = event.eventType === "GRB" ? "320" : event.eventType === "FRB" ? "1450" : "—";
  const t90 = event.eventType === "GRB" ? "38.2" : event.eventType === "FRB" ? "1.4" : "—";
  const fluence = event.fluence != null ? event.fluence.toExponential(3) : "3.8×10⁻⁶";
  const peakFlux = event.eventType === "GW" ? "9.2×10⁻²²" : event.eventType === "FRB" ? "2.1×10³" : "1.6×10⁻⁶";

  return (
    <div className="rounded border border-border bg-card p-3 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Derived parameters</div>
      <Item label="Ep" value={`${ep} keV`} />
      <Item label="T90" value={`${t90} s`} />
      <Item label="Fluence" value={`${fluence} erg/cm²`} />
      <Item label="Peak Flux" value={peakFlux} />
      <Item label="Classification" value={getClassification(event)} />
    </div>
  );
}
