import type { AstroEvent } from "@workspace/api-client-react";

interface Props {
  event: AstroEvent;
}

export function EventTimeline({ event }: Props) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Event timeline</div>
        <div className="text-[9px] font-mono text-muted-foreground">T0 → T+5min</div>
      </div>
      <div className="relative py-4">
        <div className="absolute left-3 right-3 top-1/2 h-px bg-border" />
        {[
          { label: "Trigger", left: "8%" },
          { label: "Follow-up", left: "58%" },
        ].map((marker) => (
          <div key={marker.label} className="absolute top-1/2 -translate-y-1/2" style={{ left: marker.left }}>
            <div className="w-2.5 h-2.5 rounded-full bg-primary border border-background shadow" />
            <div className="mt-1 text-[9px] font-mono text-muted-foreground whitespace-nowrap -translate-x-1/2">{marker.label}</div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
        <span>T0</span>
        <span>T+30s</span>
        <span>T+60s</span>
        <span>T+5min</span>
      </div>
    </div>
  );
}
