/**
 * index.ts — Multi-Messenger Correlation Engine (Phase 5.4)
 * ----------------------------------------------------------
 * Public re-exports. Consumers import from this file only.
 *
 * Usage:
 *   import { correlate } from "../science/correlationEngine/index.js";
 *   import type { CorrelationResult, CorrelationInput } from "../science/correlationEngine/index.js";
 *
 * Phase 5.4 — AstroSentinel
 */

export { correlate }                from "./engine.js";
export { angularSeparationDeg }     from "./scorer.js";
export { getPairingRule, isPhysicallyMotivatedPair } from "./pairingRules.js";
export { getCoincidenceWindows }    from "./windows.js";

export type {
  CorrelationResult,
  CorrelationInput,
  CorrelationMatch,
  CorrelationEvent,
  CorrelationConfidence,
}                                   from "./types.js";

export type { CoincidenceWindows }  from "./windows.js";
export type { PairingRule }         from "./pairingRules.js";
