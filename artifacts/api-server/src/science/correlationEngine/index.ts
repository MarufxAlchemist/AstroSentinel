/**
 * index.ts — Multi-Messenger Correlation Engine (Phase 6.0A)
 * -----------------------------------------------------------
 * Public re-exports for the correlation engine module.
 */

// Core engine
export { correlate }              from "./engine.js";

// Configuration
export { getCoincidenceWindows }  from "./windows.js";
export type { CoincidenceWindows } from "./windows.js";

// Scoring utilities
export { angularSeparationDeg, scorePair } from "./scorer.js";

// Pairing rules
export { getPairingRule, isPhysicallyMotivatedPair, getAllPairingRules } from "./pairingRules.js";
export type { PairingRule }       from "./pairingRules.js";

// Database repository
export {
  saveCorrelation,
  getCorrelationsForEvent,
  getRecentHighConfidence,
  getCorrelationPair,
} from "./repository.js";

// Types (re-export everything)
export type {
  CorrelationConfidence,
  CorrelationType,
  CorrelationEvent,
  CorrelationMatch,
  CorrelationResult,
  CorrelationInput,
  StoredCorrelation,
} from "./types.js";
