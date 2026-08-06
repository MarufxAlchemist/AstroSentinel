/**
 * index.ts — Notification Deduplication Engine (Phase 5.5)
 * ---------------------------------------------------------
 * Public API for the deduplication module.
 *
 * Phase 5.5 — AstroSentinel
 */

export type {
  NotificationSnapshot,
  DeduplicationDecision,
  ChangeReason,
} from "./types.js";

export { decide } from "./engine.js";
export type { DecideInput } from "./engine.js";

export { recordDecision } from "./store.js";
