import type { AstroEvent } from "@workspace/api-client-react";
import { Zap } from "lucide-react";

interface Props { event: AstroEvent; }

function Param({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40">
      <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-[11px] font-mono font-semibold text-foreground">{value}</span>
        {unit && <span className="text-[9px] font-mono text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

const MODELS: Record<string, { label: string; params: { label: string; value: string; unit?: string }[] }> = {
  GRB: {
    label: "Band function",
    params: [
      { label: "Model", value: "Band" },
      { label: "Ep", value: "300", unit: "keV" },
      { label: "Alpha", value: "−0.8" },
      { label: "Beta", value: "−2.4" },
      { label: "Flux", value: "1.0×10⁻⁶", unit: "erg/cm²/s" },
      { label: "Fluence", value: "4.2×10⁻⁵", unit: "erg/cm²" },
    ],
  },
  GW: {
    label: "CBC template",
    params: [
      { label: "Model", value: "IMRPhenomD" },
      { label: "Mchirp", value: "28.3", unit: "M☉" },
      { label: "q", value: "0.82" },
      { label: "χ_eff", value: "0.05" },
      { label: "d_L", value: "410", unit: "Mpc" },
      { label: "SNR", value: "12.1" },
    ],
  },
  FRB: {
    label: "Simple burst",
    params: [
      { label: "Model", value: "Gaussian" },
      { label: "Width", value: "1.2", unit: "ms" },
      { label: "DM", value: "580", unit: "pc/cm³" },
      { label: "Peak S/N", value: "22.4" },
      { label: "Fluence", value: "32", unit: "Jy·ms" },
      { label: "Scattering", value: "0.3", unit: "ms" },
    ],
  },
};

export function SpectralFit({ event }: Props) {
  const model = MODELS[event.eventType] ?? MODELS.GRB;

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-primary/30 bg-primary/10">
        <Zap className="w-3 h-3 text-primary shrink-0" />
        <span className="text-[11px] font-mono font-semibold text-primary">{model.label}</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {model.params.map(p => (
          <Param key={p.label} {...p} />
        ))}
      </div>
      <div className="rounded border border-border bg-card p-2.5 space-y-1.5">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Fit quality</div>
        <div className="flex justify-between text-[10px] font-mono">
          <span className="text-muted-foreground">χ² / d.o.f.</span>
          <span className="text-foreground">1.04 / 118</span>
        </div>
        <div className="flex justify-between text-[10px] font-mono">
          <span className="text-muted-foreground">p-value</span>
          <span className="text-green-700 dark:text-green-400 font-semibold">0.38 (good)</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-border mt-1 overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: "72%" }} />
        </div>
        <div className="text-[9px] font-mono text-muted-foreground">Confidence: 72%</div>
      </div>
      <div className="text-[9px] font-mono text-muted-foreground/60 text-center">Mock fit — real pipeline pending</div>
    </div>
  );
}
