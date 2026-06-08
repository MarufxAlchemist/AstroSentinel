import type { AstroEvent } from "@workspace/api-client-react";

interface Props {
  event: AstroEvent;
}

export function ScientificSummary({ event }: Props) {
  let summary = "";
  if (event.eventType === "GRB") {
    const type = event.t90 != null && event.t90 < 2 ? "short" : "long";
    const strength = event.snr > 20 ? "High-confidence" : "Marginal";
    summary = `${strength} ${type} GRB detected. ${event.fluence && event.fluence > 1e-6 ? "Strong fluence suggests bright afterglow. " : ""}Optical follow-up recommended.`;
  } else if (event.eventType === "GW") {
    summary = `Compact binary candidate with ${event.snr > 15 ? "strong" : "moderate"} significance. ${event.chirpMass ? `Chirp mass is ~${event.chirpMass.toFixed(1)} M☉. ` : ""}Rapid multi-messenger follow-up advised.`;
  } else {
    summary = `Fast transient detected. ${event.dm ? `DM of ${event.dm.toFixed(1)} pc/cm³ indicates extragalactic origin. ` : ""}Radio characterization indicates a promising follow-up target.`;
  }

  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Scientific summary</div>
      <p className="text-[11px] leading-relaxed text-foreground">{summary}</p>
    </div>
  );
}
