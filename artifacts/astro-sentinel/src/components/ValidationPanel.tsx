import { useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, ChevronRight, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Diagnostic levels emitted by backend/app/science/diagnostics.py */
type Level = "INFO" | "NOTICE" | "WARNING" | "ERROR" | "CRITICAL";

interface Diagnostic {
  level: Level;
  code: string;
  field: string | null;
  message: string;
  value?: unknown;
}

interface QualityComponent {
  score: number | null;
  grade: string;
  weight: number;
  applicable?: boolean;
  deductions: { code: string; level: string; points: number; reason: string }[];
}

interface Quality {
  overall: number;
  grade: string;
  status: string;
  scoreCapped?: boolean;
  components: Record<string, QualityComponent>;
  effectiveWeight?: number;
  rubric?: Record<string, string>;
}

interface Validation {
  status: "PASS" | "WARNING" | "FAIL" | "UNKNOWN";
  worstLevel: Level | null;
  counts: Partial<Record<Level, number>>;
  diagnostics: Diagnostic[];
}

const LEVEL_STYLE: Record<Level, string> = {
  INFO:     "text-sky-400 border-sky-500/30 bg-sky-500/10",
  NOTICE:   "text-violet-400 border-violet-500/30 bg-violet-500/10",
  WARNING:  "text-amber-400 border-amber-500/30 bg-amber-500/10",
  ERROR:    "text-red-400 border-red-500/30 bg-red-500/10",
  CRITICAL: "text-red-300 border-red-500/50 bg-red-500/20",
};

const STATUS_STYLE: Record<string, { cls: string; Icon: typeof ShieldCheck }> = {
  PASS:    { cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10", Icon: ShieldCheck },
  WARNING: { cls: "text-amber-400 border-amber-500/40 bg-amber-500/10",     Icon: ShieldAlert },
  FAIL:    { cls: "text-red-400 border-red-500/40 bg-red-500/10",           Icon: ShieldX },
  UNKNOWN: { cls: "text-muted-foreground border-border bg-muted/20",        Icon: Info },
};

function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

function label(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ValidationPanel({
  validation,
  quality,
}: {
  validation?: Validation | null;
  quality?: Quality | null;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Events ingested before Phase 3 carry no report. Say so plainly rather
  // than implying the event passed validation.
  if (!validation) {
    return (
      <Card className="bg-card border-border/50 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Info className="w-5 h-5 text-muted-foreground" />
            Scientific Validation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not assessed — this event predates the validation pipeline.
          </p>
        </CardContent>
      </Card>
    );
  }

  const st = STATUS_STYLE[validation.status] ?? STATUS_STYLE.UNKNOWN;
  const StatusIcon = st.Icon;
  const diagnostics = validation.diagnostics ?? [];

  return (
    <Card className="bg-card border-border/50 shadow-none">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          <StatusIcon className="w-5 h-5 text-primary" />
          Scientific Validation
        </CardTitle>
        <span
          className={`inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-semibold rounded border uppercase tracking-wider ${st.cls}`}
        >
          {validation.status}
        </span>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Overall score */}
        {quality && (
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Data Quality
              </p>
              <span className="text-[10px] font-mono text-muted-foreground">
                {quality.grade}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <span className={`font-mono text-3xl font-bold ${scoreColor(quality.overall)}`}>
                {quality.overall}
              </span>
              <span className="text-sm text-muted-foreground mb-1">/ 100</span>
            </div>
            <div className="w-full h-1.5 bg-muted mt-2 rounded-full overflow-hidden">
              <div
                className={`h-full ${quality.overall >= 90 ? "bg-emerald-500" : quality.overall >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.max(0, Math.min(100, quality.overall))}%` }}
              />
            </div>
            {quality.scoreCapped && (
              <p className="text-[10px] text-red-400 mt-1.5">
                Capped: the event contains a physically impossible value, so it
                cannot grade above FAIL regardless of its other components.
              </p>
            )}
          </div>
        )}

        {/* Diagnostics */}
        {diagnostics.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No findings — all validation checks passed.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Findings ({diagnostics.length})
            </p>
            {diagnostics.map((d, i) => (
              <div
                key={`${d.code}-${i}`}
                className={`rounded border p-2.5 ${LEVEL_STYLE[d.level] ?? LEVEL_STYLE.INFO}`}
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-wider">
                    {d.level}
                  </span>
                  <span className="text-[10px] font-mono opacity-80">{d.code}</span>
                  {d.field && (
                    <span className="text-[10px] font-mono opacity-60">· {d.field}</span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-foreground/90">{d.message}</p>
              </div>
            ))}
          </div>
        )}

        {/* Score breakdown — every number traceable to its rules */}
        {quality?.components && (
          <div className="pt-2 border-t border-border">
            <button
              onClick={() => setShowBreakdown((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight
                className={`w-3 h-3 transition-transform ${showBreakdown ? "rotate-90" : ""}`}
              />
              Score breakdown
            </button>

            {showBreakdown && (
              <div className="mt-3 space-y-2">
                {Object.entries(quality.components).map(([name, c]) => (
                  <div key={name} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {label(name)}
                        <span className="opacity-50 ml-1">(weight {c.weight})</span>
                      </span>
                      <span className="font-mono">
                        {c.score === null ? (
                          <span className="text-muted-foreground">N/A</span>
                        ) : (
                          <span className={scoreColor(c.score)}>{c.score}</span>
                        )}
                      </span>
                    </div>
                    {c.deductions?.length > 0 && (
                      <ul className="mt-1 ml-3 space-y-0.5">
                        {c.deductions.map((d, i) => (
                          <li key={i} className="text-[10px] text-muted-foreground">
                            −{d.points} · <span className="font-mono">{d.code}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {quality.effectiveWeight !== undefined && quality.effectiveWeight < 100 && (
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Components with nothing to assess are marked N/A and excluded;
                    the remaining weights are renormalised (effective weight{" "}
                    {quality.effectiveWeight}).
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
