import { useState, useEffect } from "react";
import { Brain, ChevronRight, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type Confidence = "HIGH" | "MODERATE" | "LOW" | "SPECULATIVE";

interface CorrelationAnalysis {
  confidence: Confidence;
  scientific_assessment: string;
  followup_recommendation: string;
  reasoning: string | string[];
  cached: boolean;
  generated_at: string;
  model: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const CONFIDENCE_STYLES: Record<Confidence, { label: string; className: string }> = {
  HIGH:        { label: "HIGH",        className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  MODERATE:    { label: "MODERATE",    className: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  LOW:         { label: "LOW",         className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  SPECULATIVE: { label: "SPECULATIVE", className: "bg-muted/40 text-muted-foreground border-border" },
};

function ConfidenceBadge({ level }: { level: Confidence }) {
  const { label, className } = CONFIDENCE_STYLES[level];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold tracking-widest border font-mono ${className}`}
    >
      {label}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <Loader2 className="w-6 h-6 text-primary animate-spin" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Generating AI Assessment</p>
        <p className="text-xs text-muted-foreground">
          Analyzing multi-messenger correlations with {" "}
          <span className="font-mono">gemini-2.5-flash</span>…
        </p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const isConfig = message.toLowerCase().includes("gemini_api_key") ||
                   message.toLowerCase().includes("not configured");

  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center px-4">
      <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Unable to generate AI analysis.</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isConfig
            ? "Add GEMINI_API_KEY to your server environment to enable AI assessments."
            : message}
        </p>
      </div>
      {!isConfig && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors underline underline-offset-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center px-4">
      <Brain className="w-5 h-5 text-muted-foreground/40" />
      <p className="text-xs text-muted-foreground">
        No correlation analysis available.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  eventId: string;
  hasCorrelations: boolean;
}

export function CorrelationAnalysisPanel({ eventId, hasCorrelations }: Props) {
  const { token } = useAuth();
  const [analysis, setAnalysis] = useState<CorrelationAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!eventId) return;

    setLoading(true);
    setError(null);
    setAnalysis(null);

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`/api/events/${eventId}/correlations/analysis`, { headers })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<CorrelationAnalysis>;
      })
      .then(setAnalysis)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [eventId, token, retryCount]); // hasCorrelations intentionally omitted — only eventId change should re-trigger

  function handleRetry() {
    setRetryCount((n) => n + 1);
  }

  return (
    <Card className="bg-card border-border/50 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="w-5 h-5 text-primary" />
          AI Scientific Assessment
          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono font-normal text-muted-foreground tracking-wider border border-border/60 rounded px-1.5 py-0.5">
            <Sparkles className="w-2.5 h-2.5" />
            Gemini
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {loading && <LoadingState />}

        {!loading && error && <ErrorState message={error} onRetry={handleRetry} />}

        {!loading && !error && !analysis && !hasCorrelations && <EmptyState />}

        {!loading && !error && analysis && (
          <div className="space-y-4">
            {/* Header row: confidence + cache indicator */}
            <div className="flex items-center justify-between">
              <ConfidenceBadge level={analysis.confidence} />
              {analysis.cached && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  cached · {new Date(analysis.generated_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Scientific assessment */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Scientific Assessment
              </p>
              <p className="text-sm leading-relaxed text-foreground">
                {analysis.scientific_assessment}
              </p>
            </div>

            {/* Follow-up recommendation */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/70">
                Follow-up Recommendation
              </p>
              <p className="text-sm leading-relaxed text-foreground">
                {analysis.followup_recommendation}
              </p>
            </div>

            {/* Collapsible reasoning chain */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center justify-between text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              <span>Reasoning chain ({Array.isArray(analysis.reasoning) ? analysis.reasoning.length : 1} steps)</span>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </button>

            {expanded && (
              <ol className="space-y-2 list-none pl-0">
                {(Array.isArray(analysis.reasoning)
                  ? analysis.reasoning
                  : [analysis.reasoning]
                ).map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-xs text-muted-foreground leading-relaxed">
                    <span className="shrink-0 font-mono text-primary/60 w-4 text-right">
                      {i + 1}.
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            )}

            {/* Footer: model attribution */}
            <p className="text-[10px] font-mono text-muted-foreground/50 pt-1 border-t border-border/30">
              {analysis.model} · {new Date(analysis.generated_at).toISOString().replace("T", " ").slice(0, 19)} UTC
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
