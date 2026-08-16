import { useState } from "react";
import { Compass, ChevronRight, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * ResearchInterestPanel
 * ─────────────────────
 * How scientifically worth studying an event is (spec section 44).
 *
 * This is the THIRD score in the interface and the one most easily misread, so
 * the panel works hard to say what it is not:
 *
 *   Data quality      Is the measurement trustworthy?   (ValidationPanel)
 *   Research interest Is the event worth studying?      (here)
 *
 * They diverge by design. A flawlessly-measured routine GRB scores 100 on
 * quality and 35 here; a nearby neutron-star merger with a 15000 deg² skymap
 * scores 90 on quality and 80 here. Presenting them as one number would bury
 * the merger.
 *
 * Two display rules:
 *   1. Every point is shown with the rule and rationale that produced it, so a
 *      researcher can disagree with a specific rule rather than with a total.
 *   2. An UNASSESSED event is rendered distinctly from a low-scoring one.
 *      "We looked and found little" and "we had nothing to look at" are
 *      different statements.
 */

interface Contribution {
  rule: string;
  points: number;
  reason: string;
}

interface ResearchInterest {
  score: number;
  band: "HIGH" | "MODERATE" | "LOW" | "MINIMAL" | "UNASSESSED";
  contributions: Contribution[];
  unassessed: string[];
  retracted?: boolean;
  maxScore?: number;
  note: string;
  disclaimer: string;
}

const BAND_STYLE: Record<string, { bar: string; text: string }> = {
  HIGH: { bar: "bg-emerald-500", text: "text-emerald-400" },
  MODERATE: { bar: "bg-sky-500", text: "text-sky-400" },
  LOW: { bar: "bg-zinc-500", text: "text-muted-foreground" },
  MINIMAL: { bar: "bg-zinc-600", text: "text-muted-foreground" },
  UNASSESSED: { bar: "bg-amber-500/60", text: "text-amber-400" },
};

const RULE_LABELS: Record<string, string> = {
  messenger_rarity: "Messenger rarity",
  counterpart_potential: "Counterpart potential",
  significance: "Statistical significance",
  signalness: "Astrophysical probability",
  followup_feasibility: "Follow-up feasibility",
  proximity: "Proximity",
  extreme_properties: "Extreme properties",
};

export function ResearchInterestPanel({
  interest,
}: {
  interest?: ResearchInterest | null;
}) {
  const [showRules, setShowRules] = useState(false);
  if (!interest) return null;

  const style = BAND_STYLE[interest.band] ?? BAND_STYLE["LOW"]!;
  const max = interest.maxScore ?? 100;
  const unassessed = interest.band === "UNASSESSED";

  return (
    <Card className="bg-card border-border/50 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Compass className="w-5 h-5 text-primary" />
          Research Interest
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          How scientifically worth studying this event is — a separate question
          from whether its data is trustworthy.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Headline ──────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className={`text-sm font-semibold uppercase tracking-wider ${style.text}`}>
              {unassessed ? "Not assessed" : interest.band}
            </span>
            {!unassessed && (
              <span className="font-mono text-sm text-foreground">
                {interest.score}
                <span className="text-muted-foreground">/{max}</span>
              </span>
            )}
          </div>
          {!unassessed && (
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${style.bar} transition-all`}
                style={{ width: `${Math.max(2, (interest.score / max) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {interest.retracted && (
          <p className="text-xs text-red-400">{interest.note}</p>
        )}

        {/* An unassessed event must never read as an uninteresting one. */}
        {unassessed && !interest.retracted && (
          <p className="text-xs text-amber-500/90 flex gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{interest.note}</span>
          </p>
        )}

        {/* ── Contributions ─────────────────────────────────────────────── */}
        {interest.contributions.length > 0 && (
          <ul className="space-y-2">
            {interest.contributions.map((c, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-foreground/90">
                    {RULE_LABELS[c.rule] ?? c.rule}
                  </span>
                  <span
                    className={`font-mono shrink-0 ${
                      c.points > 0 ? "text-emerald-400" : "text-muted-foreground"
                    }`}
                  >
                    {c.points > 0 ? `+${c.points}` : "0"}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5">{c.reason}</p>
              </li>
            ))}
          </ul>
        )}

        {/* ── What could not be assessed ────────────────────────────────── */}
        {interest.unassessed.length > 0 && !unassessed && (
          <div className="text-xs text-amber-500/80 border-t border-border/40 pt-3">
            <p className="flex gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Not assessed: {interest.unassessed.join(", ")}. {interest.note}
              </span>
            </p>
          </div>
        )}

        {/* ── What this score is not ────────────────────────────────────── */}
        <div className="border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={() => setShowRules((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform ${showRules ? "rotate-90" : ""}`}
            />
            How to read this score
          </button>
          {showRules && (
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              {interest.disclaimer}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
