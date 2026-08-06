/**
 * pairingRules.ts — Multi-Messenger Correlation Engine (Phase 5.4)
 * -----------------------------------------------------------------
 * Defines which event type pairs are physically meaningful and
 * assigns a pairing score based on the strength of the scientific basis.
 *
 * Each rule is a pure record — no logic, easy to extend.
 *
 * Scientific basis references
 * ───────────────────────────
 *   GW + GRB : GW170817 + GRB 170817A confirmed NS-NS merger. Score: 40.
 *   GW + NU  : SN 1987A precedent (core collapse). Less firm for compact mergers. Score: 30.
 *   GW + FRB : Several theoretical models (Totani 2013, Lyutikov 2013). Unconfirmed. Score: 20.
 *   GRB + NU : Long GRB / collapsar models (IceCube limits exist). Score: 25.
 *   GRB + FRB: Speculative coincident emission. Score: 10.
 *   NU  + FRB: Speculative. Score: 8.
 *
 * Phase 5.4 — AstroSentinel
 */

export interface PairingRule {
  /** Scientific explanation of why this pair may be physically correlated */
  physicalBasis: string;
  /** Score bonus for this event type pairing [0–40] */
  score: number;
}

/** Canonical key format: sorted alphabetically, joined with "+" */
function pairKey(a: string, b: string): string {
  return [a.toUpperCase(), b.toUpperCase()].sort().join("+");
}

/**
 * All known physically motivated event type pairings.
 * Key: canonical pair key (e.g. "GRB+GW")
 */
const PAIRING_RULES: Record<string, PairingRule> = {
  [pairKey("GW",  "GRB")]: {
    score: 40,
    physicalBasis:
      "Confirmed multi-messenger counterpart type (GW170817 + GRB 170817A). " +
      "NS-NS or NS-BH merger produces both gravitational wave emission and short GRB prompt emission.",
  },
  [pairKey("GW",  "NU")]: {
    score: 30,
    physicalBasis:
      "Core-collapse supernovae emit both gravitational waves and a neutrino burst (SN 1987A). " +
      "Compact binary mergers may also produce detectable neutrino emission.",
  },
  [pairKey("GW",  "FRB")]: {
    score: 20,
    physicalBasis:
      "Several theoretical models predict coherent radio emission coincident with compact binary mergers. " +
      "No confirmed detection yet; association remains speculative.",
  },
  [pairKey("GRB", "NU")]: {
    score: 25,
    physicalBasis:
      "Long GRBs produced by collapsars are expected to emit high-energy neutrinos via " +
      "internal shock proton acceleration. IceCube upper limits exist for several GRBs.",
  },
  [pairKey("GRB", "FRB")]: {
    score: 10,
    physicalBasis:
      "Proposed coherent radio emission associated with GRB remnant magnetars or engine activity. " +
      "Speculative; no confirmed association.",
  },
  [pairKey("NU",  "FRB")]: {
    score: 8,
    physicalBasis:
      "Speculative coincident emission from energetic transients. No established physical model.",
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the pairing rule for two event types.
 * Returns null if no physically motivated pairing exists.
 *
 * @param typeA - First event type (e.g. "GW")
 * @param typeB - Second event type (e.g. "GRB")
 */
export function getPairingRule(typeA: string, typeB: string): PairingRule | null {
  const key = pairKey(typeA, typeB);
  return PAIRING_RULES[key] ?? null;
}

/**
 * Check if two event types have a physically motivated pairing.
 */
export function isPhysicallyMotivatedPair(typeA: string, typeB: string): boolean {
  return getPairingRule(typeA, typeB) !== null;
}
