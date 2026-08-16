/**
 * aiGuard.ts — AI input/output guardrails (Phase 7, spec sections 40-43)
 * ---------------------------------------------------------------------------
 * The language model is an analytical assistant, never a source of truth. This
 * module enforces that from both ends by delegating to the Python science
 * layer, which owns the rules.
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * The summary path built the model's context like this:
 *
 *     snr:         Number(event["snr"]         ?? 0),
 *     far:         Number(event["far"]         ?? 0),
 *     ra:          Number(event["ra"]          ?? 0),
 *     dec:         Number(event["dec"]         ?? 0),
 *     errorRadius: Number(event["errorRadius"] ?? 0),
 *
 * while the prompt beside it insisted "NO HALLUCINATION — you MUST NOT invent
 * physics that are not explicitly present in the provided metadata". The
 * metadata was doing the inventing. 279 of 304 archive events have no reported
 * position and would have been described to the model as sitting at RA = 0,
 * Dec = 0; 294 have no false-alarm rate and would have been presented as
 * FAR = 0 Hz, which does not mean "unknown" but "no false alarms ever" —
 * infinite significance. A perfectly obedient model would still have written
 * that these events were extraordinarily significant and precisely located.
 *
 * FAILURE POLICY
 * --------------
 * If the context cannot be built, the summary is SKIPPED rather than generated
 * from the old fabricating shape. The email path already falls back to
 * rendering the raw data, which is honest. Producing a confident AI paragraph
 * from invented inputs is not an acceptable degraded mode.
 */

import { logger } from "../lib/logger.js";

function scienceBaseUrl(): string {
  const ws = process.env["PYTHON_BACKEND_URL"] ?? "ws://localhost:8001/api/ws";
  return ws.replace(/^ws/, "http").replace(/\/api\/ws\/?$/, "");
}

const TIMEOUT_MS = 3000;

async function postScience<T>(path: string, body: unknown): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${scienceBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean } & Record<string, unknown>;
    return json.ok ? (json as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface AiVerification {
  checked: boolean;
  unsupportedCount: number;
  unsupported: { value: number; text: string; message: string }[];
  trusted: boolean;
  note: string;
}

/**
 * Build the model's context from measured values only, with every unknown
 * stated as unknown. Returns null when it cannot be built — the caller must
 * then skip AI generation rather than fall back to a fabricating shape.
 */
export async function buildAiContext(
  event: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const res = await postScience<{ context: Record<string, unknown> }>(
    "/api/science/ai-context",
    { event },
  );
  if (!res) {
    logger.warn(
      { eventId: event["eventId"] },
      "[ai-guard] context could not be built; AI summary will be skipped " +
        "rather than generated from unvalidated input",
    );
    return null;
  }
  return res.context;
}

/**
 * Screen generated text for numeric claims that were never supplied.
 *
 * A null return means the screen could not run — which is NOT the same as
 * passing it, and callers must label the output as unverified rather than
 * trusted.
 */
export async function verifyAiOutput(
  context: Record<string, unknown>,
  text: unknown,
): Promise<AiVerification | null> {
  const res = await postScience<{ verification: AiVerification }>(
    "/api/science/verify-ai-output",
    { context, text },
  );
  return res?.verification ?? null;
}

/** Research interest score (spec section 44). Null when unavailable. */
export async function scoreInterest(
  event: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const res = await postScience<{ interest: Record<string, unknown> }>(
    "/api/science/interest",
    { event },
  );
  return res?.interest ?? null;
}
