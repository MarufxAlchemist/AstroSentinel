/**
 * windows.ts — Multi-Messenger Correlation Engine (Phase 5.4)
 * ------------------------------------------------------------
 * Configurable coincidence windows for temporal and spatial matching.
 *
 * All values are read from environment variables.
 * No magic numbers — every threshold has a scientific justification comment.
 *
 * Phase 5.4 — AstroSentinel
 */

// ---------------------------------------------------------------------------
// Window types
// ---------------------------------------------------------------------------

export interface CoincidenceWindows {
  // ── Temporal windows [seconds] ────────────────────────────────────────────

  /**
   * GW → GRB: ±5 s
   * Gravitational wave merger → prompt gamma-ray emission.
   * GW170817/GRB 170817A had ΔT = +1.74 s.
   */
  gwGrbSec: number;

  /**
   * GW → NU: ±500 s
   * Extended window to capture neutrino precursor and extended emission.
   */
  gwNuSec: number;

  /**
   * GW → FRB: ±1 s
   * Proposed compact merger → coherent radio burst models.
   * Very tight window given FRB ms-precision timing.
   */
  gwFrbSec: number;

  /**
   * GRB → NU: ±500 s
   * Collapsar / long GRB → neutrino burst (prompt + extended).
   */
  grbNuSec: number;

  /**
   * GRB → FRB: ±1 s
   * Speculative: short GRB remnant → FRB-like emission.
   */
  grbFrbSec: number;

  /**
   * Default catch-all window for any other pair.
   * ±60 s — conservative coincidence for unmodelled scenarios.
   */
  defaultSec: number;

  // ── Spatial coincidence factor ────────────────────────────────────────────

  /**
   * Spatial coincidence factor (N-sigma).
   * A pair matches spatially when:
   *   angularSeparation ≤ spatialFactor × (errorRadius_A + errorRadius_B)
   * Default: 3.0 (3-sigma combined error)
   */
  spatialFactor: number;

  // ── Confidence score boundaries ───────────────────────────────────────────

  /** Minimum score for HIGH confidence. Default: 70 */
  scoreHigh:   number;
  /** Minimum score for MEDIUM confidence. Default: 40 */
  scoreMedium: number;
  /** Minimum score for LOW confidence. Default: 15 */
  scoreLow:    number;

  // ── DB query window ───────────────────────────────────────────────────────

  /**
   * How far back (in minutes) to look for candidate events in the database.
   * Should be ≥ (max temporal window / 60) + buffer.
   * Default: 15 minutes.
   */
  dbLookbackMinutes: number;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function envFloat(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultValue;
  const n = parseFloat(raw);
  return isFinite(n) ? n : defaultValue;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Read all coincidence windows from environment variables.
 * Called once per correlation run — no global mutable state.
 */
export function getCoincidenceWindows(): CoincidenceWindows {
  return {
    gwGrbSec:          envFloat("CORR_WINDOW_GW_GRB_SEC",   5),
    gwNuSec:           envFloat("CORR_WINDOW_GW_NU_SEC",    500),
    gwFrbSec:          envFloat("CORR_WINDOW_GW_FRB_SEC",   1),
    grbNuSec:          envFloat("CORR_WINDOW_GRB_NU_SEC",   500),
    grbFrbSec:         envFloat("CORR_WINDOW_GRB_FRB_SEC",  1),
    defaultSec:        envFloat("CORR_WINDOW_DEFAULT_SEC",  60),
    spatialFactor:     envFloat("CORR_SPATIAL_FACTOR",      3.0),
    scoreHigh:         envFloat("CORR_SCORE_HIGH",          70),
    scoreMedium:       envFloat("CORR_SCORE_MEDIUM",        40),
    scoreLow:          envFloat("CORR_SCORE_LOW",           15),
    dbLookbackMinutes: envFloat("CORR_DB_LOOKBACK_MINUTES", 15),
  };
}
