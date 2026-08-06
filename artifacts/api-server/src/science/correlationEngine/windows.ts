/**
 * windows.ts — Multi-Messenger Correlation Engine (Phase 6.0A)
 * ------------------------------------------------------------
 * Configurable coincidence windows for temporal and spatial matching.
 *
 * All values are read from environment variables.
 * No magic numbers — every threshold has a scientific justification comment.
 *
 * Phase 6.0A additions
 * ─────────────────────
 *  • Einstein Probe (EP) pairing windows
 *  • dbLookbackMinutes default increased to 1440 (24 h) to support EP delayed emission
 */

// ---------------------------------------------------------------------------
// Window types
// ---------------------------------------------------------------------------

export interface CoincidenceWindows {
  // ── Temporal windows [seconds] ────────────────────────────────────────────

  /**
   * GW → GRB: ±5 s
   * Gravitational wave merger → prompt gamma-ray emission.
   * GW170817/GRB 170817A had ΔT = +1.74 s (compact binary merger).
   */
  gwGrbSec: number;

  /**
   * GW → NU: ±500 s
   * Extended window to capture neutrino precursor and extended emission.
   * SN 1987A neutrinos arrived ~3h before optical peak.
   */
  gwNuSec: number;

  /**
   * GW → FRB: ±1 s
   * Proposed compact merger → coherent radio burst models (Totani 2013, Lyutikov 2013).
   * Very tight window given FRB ms-precision timing.
   */
  gwFrbSec: number;

  /**
   * GRB → NU: ±500 s
   * Collapsar / long GRB → neutrino burst (prompt + extended).
   * IceCube upper limits exist for multiple GRBs.
   */
  grbNuSec: number;

  /**
   * GRB → FRB: ±1 s
   * Speculative: short GRB remnant → FRB-like emission.
   */
  grbFrbSec: number;

  /**
   * EP → GW: ±86400 s (24 h)
   * Einstein Probe X-ray counterparts may be delayed hours after merger
   * (off-axis viewing, kilonova rise time, cocoon emission).
   */
  epGwSec: number;

  /**
   * EP → GRB: ±3600 s (1 h)
   * Prompt X-ray afterglow from the same relativistic jet.
   * EP/Swift XRT joint detections commonly within 1 h.
   */
  epGrbSec: number;

  /**
   * EP → NU: ±86400 s (24 h)
   * Delayed X-ray + neutrino emission from disk winds or extended jet activity.
   */
  epNuSec: number;

  /**
   * NU → FRB: ±3600 s (1 h)
   * Speculative coincident emission from energetic transients.
   * No established physical model; conservative window.
   */
  nuFrbSec: number;

  /**
   * Default catch-all window for any other pair.
   * ±60 s — conservative coincidence for unmodelled scenarios.
   */
  defaultSec: number;

  // ── Spatial coincidence factor ────────────────────────────────────────────

  /**
   * Spatial coincidence N-sigma factor.
   * A pair matches spatially when:
   *   angularSeparation ≤ spatialFactor × √(err_A² + err_B²)
   * Default: 3.0 (3-sigma quadrature error region)
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
   * Default: 1440 minutes (24 h) — needed to capture delayed EP X-ray counterparts.
   * For GW/GRB-only use cases, 15 min is sufficient.
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
    epGwSec:           envFloat("CORR_WINDOW_EP_GW_SEC",    86400),
    epGrbSec:          envFloat("CORR_WINDOW_EP_GRB_SEC",   3600),
    epNuSec:           envFloat("CORR_WINDOW_EP_NU_SEC",    86400),
    nuFrbSec:          envFloat("CORR_WINDOW_NU_FRB_SEC",   3600),
    defaultSec:        envFloat("CORR_WINDOW_DEFAULT_SEC",  60),
    spatialFactor:     envFloat("CORR_SPATIAL_FACTOR",      3.0),
    scoreHigh:         envFloat("CORR_SCORE_HIGH",          70),
    scoreMedium:       envFloat("CORR_SCORE_MEDIUM",        40),
    scoreLow:          envFloat("CORR_SCORE_LOW",           15),
    dbLookbackMinutes: envFloat("CORR_DB_LOOKBACK_MINUTES", 1440),
  };
}
