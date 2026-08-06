/**
 * scorer.ts — Multi-Messenger Correlation Engine (Phase 5.4)
 * -----------------------------------------------------------
 * Scores a single (primary, candidate) event pair.
 *
 * Scoring model
 * ─────────────
 *   Temporal score   [0–35] — how tightly the events are coincident in time
 *   Spatial score    [0–25] — whether sky positions overlap within error regions
 *   Pairing score    [0–40] — how physically motivated the event type combination is
 *   ──────────────────────
 *   Total            [0–100]
 *
 * Pure function — no I/O, no side effects.
 *
 * Phase 5.4 — AstroSentinel
 */

import type { CorrelationEvent, CorrelationMatch } from "./types.js";
import type { CoincidenceWindows }                  from "./windows.js";
import { getPairingRule }                           from "./pairingRules.js";

// ---------------------------------------------------------------------------
// Haversine angular separation
// ---------------------------------------------------------------------------

const DEG2RAD = Math.PI / 180;

/**
 * Compute the angular separation between two points on the celestial sphere.
 * Uses the haversine formula for numerical stability at small angles.
 *
 * @returns Separation in degrees.
 */
export function angularSeparationDeg(
  ra1: number, dec1: number,
  ra2: number, dec2: number,
): number {
  const dRa  = (ra2  - ra1)  * DEG2RAD;
  const dDec = (dec2 - dec1) * DEG2RAD;
  const a =
    Math.sin(dDec / 2) ** 2 +
    Math.cos(dec1 * DEG2RAD) * Math.cos(dec2 * DEG2RAD) * Math.sin(dRa / 2) ** 2;
  return (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / DEG2RAD;
}

// ---------------------------------------------------------------------------
// Temporal window lookup
// ---------------------------------------------------------------------------

function getTemporalWindowSec(
  primaryType: string,
  candidateType: string,
  windows: CoincidenceWindows,
): number {
  const a = primaryType.toUpperCase();
  const b = candidateType.toUpperCase();

  if ((a === "GW"  && b === "GRB") || (a === "GRB" && b === "GW"))  return windows.gwGrbSec;
  if ((a === "GW"  && b === "NU")  || (a === "NU"  && b === "GW"))  return windows.gwNuSec;
  if ((a === "GW"  && b === "FRB") || (a === "FRB" && b === "GW"))  return windows.gwFrbSec;
  if ((a === "GRB" && b === "NU")  || (a === "NU"  && b === "GRB")) return windows.grbNuSec;
  if ((a === "GRB" && b === "FRB") || (a === "FRB" && b === "GRB")) return windows.grbFrbSec;
  return windows.defaultSec;
}

// ---------------------------------------------------------------------------
// Temporal score
// ---------------------------------------------------------------------------

/**
 * Score the temporal coincidence of a pair.
 *
 * Returns 35 for ΔT at the window centre, scaling linearly to 0 at the edge.
 * Returns 0 if outside the window entirely.
 */
function temporalScore(deltaTimeSec: number, windowSec: number): number {
  const absdt = Math.abs(deltaTimeSec);
  if (absdt > windowSec) return 0;
  // Linear falloff: full score at centre, 0 at edge
  return Math.round(35 * (1 - absdt / windowSec));
}

// ---------------------------------------------------------------------------
// Spatial score
// ---------------------------------------------------------------------------

/**
 * Score the spatial coincidence of a pair.
 *
 * Combined error radius = errorRadius_A + errorRadius_B (in arcmin → degrees).
 * Match threshold = spatialFactor × combinedError.
 *
 * Returns 25 when separation = 0, scaling to 0 at the threshold boundary.
 */
function spatialScore(
  separation: number,
  combinedErrorDeg: number,
  factor: number,
): { score: number; match: boolean } {
  const threshold = factor * combinedErrorDeg;
  if (threshold <= 0 || separation > threshold) return { score: 0, match: false };
  const score = Math.round(25 * (1 - separation / threshold));
  return { score, match: true };
}

// ---------------------------------------------------------------------------
// Main pair scorer
// ---------------------------------------------------------------------------

/**
 * Score a single (primary, candidate) event pair and return a CorrelationMatch.
 *
 * @param primary   - The primary event triggering the notification.
 * @param candidate - A recent event from the database to compare against.
 * @param windows   - Configurable coincidence windows from environment.
 */
export function scorePair(
  primary:   CorrelationEvent,
  candidate: CorrelationEvent,
  windows:   CoincidenceWindows,
): CorrelationMatch {
  // ── Skip retractions ──────────────────────────────────────────────────────
  if (candidate.isRetraction) {
    return {
      candidate,
      deltaTimeSec:           0,
      angularSeparationDeg:   0,
      combinedErrorDeg:       0,
      temporalMatch:          false,
      spatialMatch:           false,
      pairingScore:           0,
      score:                  0,
      reasoning:              "Candidate is a retraction — excluded from correlation.",
    };
  }

  // ── Temporal ──────────────────────────────────────────────────────────────
  const tPrimary   = new Date(primary.detectionTime).getTime();
  const tCandidate = new Date(candidate.detectionTime).getTime();
  const deltaTimeSec = (tCandidate - tPrimary) / 1000;

  const windowSec    = getTemporalWindowSec(primary.eventType, candidate.eventType, windows);
  const tScore       = temporalScore(deltaTimeSec, windowSec);
  const temporalMatch = Math.abs(deltaTimeSec) <= windowSec;

  // ── Spatial ───────────────────────────────────────────────────────────────
  const separation     = angularSeparationDeg(primary.ra, primary.dec, candidate.ra, candidate.dec);
  // Convert arcmin → degrees; sum both error regions
  const combinedErrorDeg = (primary.errorRadius + candidate.errorRadius) / 60;
  const { score: sScore, match: spatialMatch } = spatialScore(
    separation,
    combinedErrorDeg,
    windows.spatialFactor,
  );

  // ── Event type pairing ────────────────────────────────────────────────────
  const rule        = getPairingRule(primary.eventType, candidate.eventType);
  const pairingScore = rule?.score ?? 0;

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const score = Math.min(100, tScore + sScore + pairingScore);

  // ── Reasoning ─────────────────────────────────────────────────────────────
  const parts: string[] = [];

  parts.push(`ΔT = ${deltaTimeSec >= 0 ? "+" : ""}${deltaTimeSec.toFixed(1)} s (window: ±${windowSec} s)`);
  parts.push(
    `angular separation = ${separation.toFixed(2)}° ` +
    `(${windows.spatialFactor}σ threshold: ${(windows.spatialFactor * combinedErrorDeg).toFixed(2)}°)`,
  );

  if (rule) {
    parts.push(rule.physicalBasis);
  } else {
    parts.push(`No established physical model for ${primary.eventType}+${candidate.eventType} pairing.`);
  }

  if (!temporalMatch) parts.push("Outside temporal coincidence window.");
  if (!spatialMatch)  parts.push("Outside spatial coincidence region.");

  return {
    candidate,
    deltaTimeSec,
    angularSeparationDeg:  separation,
    combinedErrorDeg,
    temporalMatch,
    spatialMatch,
    pairingScore,
    score,
    reasoning: parts.join(" "),
  };
}
