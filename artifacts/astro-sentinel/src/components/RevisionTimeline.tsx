import { useEffect, useState } from "react";
import { History, AlertOctagon, AlertTriangle, Info, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * RevisionTimeline
 * ────────────────
 * The history of every notice received for an event, and what each one changed
 * (Phase 6, spec sections 27-28).
 *
 * Before this existed, a revision overwrote the event in place. A localization
 * that moved 40 degrees between the preliminary and updated notice left no
 * trace, and a researcher who had already pointed a telescope at the first
 * position had no way to discover that it had changed. This panel makes the
 * change visible.
 *
 * Two display rules carry the scientific meaning:
 *
 *   1. A CRITICAL revision — a retraction, a messenger-type change, or a
 *      position inconsistent with its own error bars — is styled distinctly
 *      from a routine refinement. Both were previously indistinguishable.
 *
 *   2. `significance === null` means the delta could NOT be computed. It is
 *      rendered as "changes unknown", never as "no changes" — a revision
 *      whose comparison never ran must not read as an uneventful one.
 */

interface Delta {
  level: "INFO" | "NOTICE" | "WARNING" | "ERROR" | "CRITICAL";
  code: string;
  field: string | null;
  message: string;
  previous?: unknown;
  current?: unknown;
  magnitude?: number | null;
}

interface Revision {
  id: string;
  revisionIndex: number;
  alertType?: string;
  lifecycle?: string;
  isRetraction: boolean;
  snapshot: Record<string, unknown>;
  delta?: { significance?: string | null; deltas?: Delta[]; error?: string; note?: string };
  significance: string | null;
  receivedAt: string;
}

const SIGNIFICANCE_STYLE: Record<string, { ring: string; text: string; label: string }> = {
  CRITICAL: { ring: "border-red-500/60 bg-red-500/5", text: "text-red-400", label: "Critical" },
  NOTABLE: { ring: "border-amber-500/50 bg-amber-500/5", text: "text-amber-400", label: "Notable" },
  ROUTINE: { ring: "border-border/50", text: "text-muted-foreground", label: "Routine" },
  NONE: { ring: "border-border/50", text: "text-muted-foreground", label: "No changes" },
};

const LEVEL_ICON: Record<string, React.ReactNode> = {
  CRITICAL: <AlertOctagon className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />,
  ERROR: <AlertOctagon className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />,
  WARNING: <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />,
  NOTICE: <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />,
  INFO: <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />,
};

export function RevisionTimeline({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<Revision[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setFailed(false);
    fetch(`/api/events/${eventId}/revisions`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: Revision[]) => { if (!cancelled) setRows(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [eventId]);

  if (failed) {
    return (
      <Card className="bg-card border-border/50 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="w-5 h-5 text-primary" />
            Revision History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-amber-500/80">
            The revision history could not be loaded, so whether this event was
            revised is unknown.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (rows === null) return null;

  return (
    <Card className="bg-card border-border/50 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="w-5 h-5 text-primary" />
          Revision History
          <span className="text-xs font-normal text-muted-foreground ml-1">
            {rows.length} notice{rows.length === 1 ? "" : "s"}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every notice received for this event, newest first, and what each one
          changed.
        </p>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No revision history was recorded for this event. Events ingested
            before revision tracking was added have none — this is not a
            statement that the event was never revised.
          </p>
        ) : (
          <ol className="space-y-3">
            {rows.map((r) => {
              const style =
                SIGNIFICANCE_STYLE[r.significance ?? ""] ?? SIGNIFICANCE_STYLE["ROUTINE"]!;
              const deltas = r.delta?.deltas ?? [];
              const unknown = r.significance === null && r.revisionIndex > 0;

              return (
                <li key={r.id} className={`rounded-md border p-3 ${style.ring}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-foreground">
                        {r.revisionIndex === 0
                          ? "Initial notice"
                          : `Revision ${r.revisionIndex}`}
                      </span>
                      {r.alertType && (
                        <span className="ml-2 text-xs font-mono text-muted-foreground">
                          {r.alertType}
                        </span>
                      )}
                      {r.isRetraction && (
                        <span className="ml-2 text-xs font-semibold text-red-400 uppercase">
                          Retracted
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 font-mono">
                      {new Date(r.receivedAt).toISOString().replace("T", " ").slice(0, 19)}Z
                    </span>
                  </div>

                  {r.revisionIndex === 0 ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      The first notice for this event — there is nothing earlier
                      to compare it against.
                    </p>
                  ) : unknown ? (
                    /* Never collapse "we could not tell" into "nothing changed". */
                    <p className="mt-1.5 text-xs text-amber-500/80 flex gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        {r.delta?.note ??
                          "The scientific changes carried by this revision could not be computed and are UNKNOWN."}
                        {r.delta?.error && (
                          <span className="block opacity-70 mt-0.5 font-mono">
                            {r.delta.error}
                          </span>
                        )}
                      </span>
                    </p>
                  ) : deltas.length === 0 ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      No scientific change detected between this notice and the
                      previous one.
                    </p>
                  ) : (
                    <>
                      <p className={`mt-1.5 text-xs font-medium ${style.text}`}>
                        {style.label} — {deltas.length} change
                        {deltas.length === 1 ? "" : "s"}
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {deltas.map((d, i) => (
                          <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                            {LEVEL_ICON[d.level] ?? LEVEL_ICON["INFO"]}
                            <span>{d.message}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
