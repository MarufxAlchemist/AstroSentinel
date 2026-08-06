/**
 * types.ts — Multi-Messenger Correlation Engine (Phase 5.4)
 * ----------------------------------------------------------
 * All type definitions. No logic, no I/O.
 *
 * Schema matches docs/correlation.txt:
 *
 *   Input:  { primary_event, candidate_events, correlation_scores }
 *   Output: { confidence, scientific_assessment, followup_recommendation, reasoning }
 *
 * Phase 5.4 — AstroSentinel
 */

// ---------------------------------------------------------------------------
// Confidence scale
// ---------------------------------------------------------------------------

/**
 * Correlation confidence level.
 *
 *   HIGH   — Temporal + spatial coincidence within thresholds, strong type pairing
 *   MEDIUM — Temporal coincidence with plausible spatial overlap
 *   LOW    — Temporal coincidence only; spatial overlap marginal or type pairing weak
 *   NONE   — No significant correlation found
 */
export type CorrelationConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

// ---------------------------------------------------------------------------
// Event representations
// ---------------------------------------------------------------------------

/**
 * Minimal event shape required by the correlator.
 * Maps to the fields available in the broadcast payload.
 */
export interface CorrelationEvent {
  eventId:     string;
  eventType:   string;   // "GW" | "GRB" | "FRB" | "NU"
  observatory: string;
  /** ISO-8601 detection timestamp */
  detectionTime: string;
  /** Right ascension [degrees] */
  ra:          number;
  /** Declination [degrees] */
  dec:         number;
  /** 1-sigma error radius [arcmin] */
  errorRadius: number;
  /** True if this is a retraction */
  isRetraction?: boolean;
}

// ---------------------------------------------------------------------------
// Per-pair scoring breakdown
// ---------------------------------------------------------------------------

/**
 * Result of correlating primary against one candidate.
 */
export interface CorrelationMatch {
  /** The candidate event that was evaluated */
  candidate:          CorrelationEvent;
  /** Time difference [seconds] — signed: positive = candidate is later */
  deltaTimeSec:       number;
  /** Angular separation [degrees] */
  angularSeparationDeg: number;
  /** Combined error radius of both events [degrees] */
  combinedErrorDeg:   number;
  /** Whether temporal coincidence is within window */
  temporalMatch:      boolean;
  /** Whether spatial coincidence is within 3-sigma (configurable) factor */
  spatialMatch:       boolean;
  /** Event type pairing score contribution */
  pairingScore:       number;
  /** Total score for this pair [0–100] */
  score:              number;
  /** Human-readable reasoning for this specific pair */
  reasoning:          string;
}

// ---------------------------------------------------------------------------
// Correlation result — matches docs/correlation.txt output schema
// ---------------------------------------------------------------------------

/**
 * Complete output of the correlation engine for one primary event.
 * This is the exact shape expected by the email template placeholder.
 */
export interface CorrelationResult {
  /** Overall confidence in any correlation finding */
  confidence: CorrelationConfidence;

  /**
   * Scientific narrative.
   * Examples:
   *   "Temporal and spatial coincidence consistent with NS-NS merger counterpart."
   *   "No significant multi-messenger counterpart found within coincidence windows."
   */
  scientific_assessment: string;

  /**
   * Recommended action for the research team.
   * Examples:
   *   "Immediate optical/X-ray follow-up of GW sky region recommended."
   *   "No targeted follow-up warranted by correlation analysis."
   */
  followup_recommendation: string;

  /**
   * Concise technical reasoning string.
   * Example: "ΔT = 1.3 s, angular separation = 0.8°, within 3σ combined error (2.1°)"
   */
  reasoning: string;

  /**
   * All candidate pairs that were evaluated.
   * Sorted by score descending. Empty when no candidates were available.
   */
  matches: CorrelationMatch[];

  /**
   * The best-scoring match, or null if no candidates existed / no match found.
   */
  bestMatch: CorrelationMatch | null;
}

// ---------------------------------------------------------------------------
// Engine input — matches docs/correlation.txt input schema
// ---------------------------------------------------------------------------

export interface CorrelationInput {
  primary_event:      CorrelationEvent;
  candidate_events:   CorrelationEvent[];
  /** Optional pre-computed scores to blend in (for future AI integration) */
  correlation_scores?: Record<string, number>;
}
