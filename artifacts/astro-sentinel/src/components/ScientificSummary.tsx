import type { AstroEvent } from "@workspace/api-client-react";

interface Props {
  event: AstroEvent;
}

export function ScientificSummary({ event }: Props) {
  const summary =
    event.eventType === "GRB"
      ? "High-confidence long GRB detected. Strong fluence suggests bright afterglow. Optical follow-up recommended."
      : event.eventType === "GW"
      ? "Compact binary candidate with strong significance. Rapid multi-messenger follow-up advised."
      : "Fast transient detected. Radio characterization indicates a promising follow-up target.";

  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Scientific summary</div>
      <p className="text-[11px] leading-relaxed text-foreground">{summary}</p>
    </div>
  );
}
