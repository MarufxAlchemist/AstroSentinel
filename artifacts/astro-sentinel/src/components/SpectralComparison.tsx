import type { AstroEvent } from "@workspace/api-client-react";

interface Props {
  event: AstroEvent;
}

const MODELS = [
  { model: "Band", aic: 501, status: "BEST" },
  { model: "CPL", aic: 515, status: "" },
  { model: "SPL", aic: 588, status: "" },
  { model: "BB", aic: 621, status: "" },
];

export function SpectralComparison({ event }: Props) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Spectral comparison</div>
        <div className="text-[9px] font-mono text-muted-foreground">{event.eventType}</div>
      </div>
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-muted-foreground border-b border-border/50">
            <th className="text-left py-1 font-normal">Model</th>
            <th className="text-left py-1 font-normal">AIC</th>
            <th className="text-left py-1 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {MODELS.map((row) => (
            <tr key={row.model} className={`border-b border-border/30 ${row.status ? "bg-primary/10" : ""}`}>
              <td className="py-1.5 text-foreground">{row.model}</td>
              <td className="py-1.5 text-foreground">{row.aic}</td>
              <td className={`py-1.5 ${row.status === "BEST" ? "text-primary font-semibold" : "text-muted-foreground"}`}>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
