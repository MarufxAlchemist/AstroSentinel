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
  // Ep (spectral peak energy) is NOT reported by the current ingestion path
  // and cannot be derived from anything we store.
  //
  // This previously read `(event.snr * 9.2).toFixed(0)` — multiplying the
  // signal-to-noise ratio by a constant and labelling the result "keV".
  // There is no physical relationship between SNR and peak energy; that
  // produced an invented spectral measurement displayed as though observed
  // (e.g. SNR 14.7 -> "135 keV"). Ep must come from the spectral fit in the
  // originating notice, so until that is parsed it is UNKNOWN.
  const ep = "—";
  const t90 = event.t90 != null ? event.t90.toFixed(1) : "—";
  const fluence = event.fluence != null ? event.fluence.toExponential(3) : "—";
  const peakFlux = event.peakFlux != null ? event.peakFlux.toExponential(3) : "—";
  const chirpMass = event.chirpMass != null ? event.chirpMass.toFixed(2) : "—";
  const lumDist = event.luminosityDistance != null ? event.luminosityDistance.toFixed(0) : "—";

  return (
    <div className="rounded border border-border bg-card p-3 space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Derived parameters</div>
      {event.eventType === "GRB" && <Item label="Ep" value={`${ep} keV`} />}
      {event.eventType !== "GW" && <Item label="T90" value={`${t90} s`} />}
      {event.eventType === "GRB" && <Item label="Fluence" value={`${fluence} erg/cm²`} />}
      {event.eventType !== "GW" && <Item label="Peak Flux" value={peakFlux} />}
      {event.eventType === "GW" && <Item label="Chirp Mass" value={`${chirpMass} M☉`} />}
      {event.eventType === "GW" && <Item label="Lum. Dist" value={`${lumDist} Mpc`} />}
      <Item label="Classification" value={getClassification(event)} />
    </div>
  );
}
