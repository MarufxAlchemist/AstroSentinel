import { useState } from "react";
import type { AstroEvent } from "@workspace/api-client-react";
import { Activity } from "lucide-react";

interface Props { event: AstroEvent; }

const DETECTORS: Record<string, string[]> = {
  GRB: ["NaI-0", "NaI-1", "NaI-2", "BGO-0", "BGO-1"],
  GW: ["H1", "L1", "V1", "K1"],
  FRB: ["Beam-0", "Beam-1", "Beam-2"],
};

export function Lightcurves({ event }: Props) {
  const detectors = DETECTORS[event.eventType] ?? DETECTORS.GRB;
  const [selected, setSelected] = useState(detectors[0]);

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div>
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Detector</div>
        <div className="flex flex-wrap gap-1">
          {detectors.map(d => (
            <button
              key={d}
              onClick={() => setSelected(d)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-all ${
                selected === d
                  ? "bg-primary/20 border-primary/60 text-primary"
                  : "bg-card border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col rounded border border-border bg-card overflow-hidden min-h-0">
        <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between shrink-0">
          <span className="text-[10px] font-mono text-foreground font-semibold">Lightcurve — {selected}</span>
          <span className="text-[9px] font-mono text-muted-foreground">{event.eventId}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-3 opacity-60">
          <svg viewBox="0 0 200 60" className="w-full" preserveAspectRatio="none">
            <polyline points="0,30 10,28 20,25 30,20 35,10 40,8 45,12 50,22 55,28 60,30 70,29 80,27 90,25 100,26 110,28 120,30 130,29 140,28 150,29 160,30 170,29 180,30 190,30 200,30" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinejoin="round" />
            <line x1="40" y1="0" x2="40" y2="60" stroke="hsl(var(--primary))" strokeWidth="0.75" strokeDasharray="2 2" opacity="0.5" />
            <text x="42" y="8" fontSize="5" fill="hsl(var(--primary))" fontFamily="monospace" opacity="0.7">T₀</text>
            <line x1="0" y1="55" x2="200" y2="55" stroke="hsl(var(--border))" strokeWidth="0.5" />
            <line x1="0" y1="0" x2="0" y2="60" stroke="hsl(var(--border))" strokeWidth="0.5" />
          </svg>
          <div className="flex justify-between w-full text-[8px] font-mono text-muted-foreground px-0.5">
            <span>−10 s</span><span>T₀</span><span>+30 s</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
        <Activity className="w-3 h-3 shrink-0" />
        <span>Time bin: 64 ms · Background: pre-burst −30 s to −5 s</span>
      </div>
    </div>
  );
}
