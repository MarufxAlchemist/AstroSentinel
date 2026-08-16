/**
 * revisionRecorder.ts — Revision intelligence (Phase 6, spec sections 27-28)
 * ---------------------------------------------------------------------------
 * Records every notice received for an event into the append-only
 * `core.event_revisions` history, together with the scientific delta against
 * its predecessor.
 *
 * WHY THIS EXISTS
 * ---------------
 * Revisions were applied by an UPSERT that overwrote `core.events` in place.
 * The previous scientific state was destroyed: if a localization moved 40
 * degrees between the preliminary and updated notice, nothing recorded that it
 * had moved, and a researcher who had already acted on the first position had
 * no way to find out.
 *
 * WHERE THE SCIENCE LIVES
 * -----------------------
 * Not here. The delta rules live in `backend/app/science/revisions.py` and are
 * reached over HTTP. This module moves data and owns none of the judgement —
 * reimplementing the comparison in TypeScript is exactly how the correlation
 * scorer drifted into two divergent implementations in Phase 2.
 *
 * FAILURE POLICY
 * --------------
 * Every failure mode here degrades to "delta unknown", never to "no changes",
 * and never to a dropped alert. A revision whose delta could not be computed is
 * stored with the reason attached, so it is visibly pending rather than
 * silently uneventful.
 */

import { db, eventRevisions } from "@workspace/db";
import { logger } from "./logger.js";

/** Fields forming the scientific snapshot — mirrors TRACKED_MEASUREMENTS. */
const SNAPSHOT_FIELDS = [
  "ra", "dec", "errorRadius", "errorRadiusContainment",
  "area50Deg2", "area90Deg2",
  "snr", "far", "signalness", "fluence", "t90", "dm",
  "chirpMass", "luminosityDistance", "redshift", "epeak",
  "eventType", "classificationTier", "lifecycle",
  "alertType", "isRetraction", "observatory",
  "validationStatus", "qualityScore",
] as const;

/**
 * Base URL of the Python science backend. Derived from PYTHON_BACKEND_URL,
 * which is a WebSocket URL, so the scheme and path are rewritten.
 */
function scienceBaseUrl(): string {
  const ws = process.env["PYTHON_BACKEND_URL"] ?? "ws://localhost:8001/api/ws";
  return ws.replace(/^ws/, "http").replace(/\/api\/ws\/?$/, "");
}

/** Milliseconds to wait for the delta before recording it as unknown. */
const DELTA_TIMEOUT_MS = 2500;

export interface RevisionDelta {
  significance: string | null;
  report: Record<string, unknown> | null;
}

/** Project a row or normalized event into the snapshot shape. */
export function toSnapshot(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SNAPSHOT_FIELDS) {
    const v = source[f];
    // Absent stays absent: a missing key means UNKNOWN, matching the
    // semantics used everywhere else in the pipeline. It is never zeroed.
    if (v !== null && v !== undefined) out[f] = v;
  }
  return out;
}

/**
 * Ask the Python science layer what changed between two notices.
 *
 * Returns a null report when the delta cannot be computed — which is a
 * different and honest outcome from an empty list of changes.
 */
export async function computeDelta(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): Promise<RevisionDelta> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELTA_TIMEOUT_MS);
  try {
    const res = await fetch(`${scienceBaseUrl()}/api/science/revision-delta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous, current }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return unknownDelta(`science backend returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      ok?: boolean; report?: Record<string, unknown>; error?: string;
    };
    if (!body.ok || !body.report) {
      return unknownDelta(body.error ?? "science backend reported no result");
    }
    return {
      significance: String(body.report["significance"] ?? "NONE"),
      report: body.report,
    };
  } catch (err) {
    return unknownDelta(
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A delta that could not be computed.
 *
 * `significance` stays null rather than becoming "NONE": claiming a revision
 * carried no scientific change when the comparison never ran would be a
 * fabricated result, and it is precisely the kind of quiet false negative this
 * layer exists to prevent.
 */
function unknownDelta(reason: string): RevisionDelta {
  return {
    significance: null,
    report: {
      significance: null,
      deltas: [],
      error: reason,
      note:
        "The scientific delta for this revision could not be computed, so the " +
        "changes it carried are UNKNOWN. This is not a statement that nothing " +
        "changed.",
    },
  };
}

/**
 * Append one revision to the history.
 *
 * `previousRow` is the event row as it stood BEFORE this notice was applied,
 * or null when this is the first notice. Nothing here can throw into the
 * ingestion path.
 */
export async function recordRevision(params: {
  eventPk: bigint | number;
  eventId: string;
  revisionIndex: number;
  alertType: string | null;
  lifecycle: string | null;
  isRetraction: boolean;
  previousRow: Record<string, unknown> | null;
  currentEvent: Record<string, unknown>;
}): Promise<RevisionDelta | null> {
  try {
    const snapshot = toSnapshot(params.currentEvent);

    let delta: RevisionDelta | null = null;
    if (params.previousRow) {
      delta = await computeDelta(toSnapshot(params.previousRow), snapshot);
    }

    await db
      .insert(eventRevisions)
      .values({
        eventPk: BigInt(params.eventPk),
        eventId: params.eventId,
        revisionIndex: params.revisionIndex,
        alertType: params.alertType,
        lifecycle: params.lifecycle,
        isRetraction: params.isRetraction,
        snapshot,
        delta: delta?.report ?? null,
        significance: delta?.significance ?? null,
      })
      // Re-processing the same notice must not duplicate history. The unique
      // index on (event_pk, revision_index) makes this idempotent.
      .onConflictDoNothing();

    if (delta?.significance === "CRITICAL" || delta?.significance === "NOTABLE") {
      logger.warn(
        {
          eventId: params.eventId,
          revisionIndex: params.revisionIndex,
          significance: delta.significance,
          codes: (delta.report?.["deltas"] as { code: string }[] | undefined)
            ?.map((d) => d.code),
        },
        "[revisions] scientifically material revision received",
      );
    }

    return delta;
  } catch (err) {
    // History is an observability feature. Losing a history row is bad;
    // losing the alert would be worse.
    logger.error(
      { err, eventId: params.eventId },
      "[revisions] failed to record revision history",
    );
    return null;
  }
}
