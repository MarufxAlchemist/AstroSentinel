/**
 * index.ts — AI Scientific Summary Engine (Phase 5.6)
 * ----------------------------------------------------
 * Generates and caches concise, zero-hallucination scientific summaries
 * using the configured LLM provider.
 */

import crypto from "node:crypto";
import { db, aiScientificSummaries } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { createDefaultProvider } from "../../services/ai/provider.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

export interface ScientificSummary {
  significance: string;
  origin: string;
  followUp: string;
  characteristics: string;
  confidence: string;
}

/**
 * Computes a deterministic SHA-256 hash of the input data to use as a cache key.
 */
function computeHash(payload: Record<string, unknown>): string {
  const str = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * Validates that the parsed JSON contains all required fields and they are strings.
 */
function validateSummary(data: unknown): data is ScientificSummary {
  if (typeof data !== "object" || data === null) return false;
  
  const obj = data as Record<string, unknown>;
  const requiredFields = ["significance", "origin", "followUp", "characteristics", "confidence"];
  
  for (const field of requiredFields) {
    if (typeof obj[field] !== "string" || obj[field] === "") {
      return false;
    }
  }
  return true;
}

/**
 * Generate a scientific summary for the given event metadata.
 * Uses DB caching to never regenerate for identical inputs.
 * Gracefully falls back to returning null if the AI fails or times out.
 * 
 * @param dbEventId - The internal bigserial PK (events.id) for caching
 * @param eventMetadata - The clean event data payload
 * @param correlationData - Optional Phase 5.4 correlation results
 */
export async function generateSummary(
  dbEventId: string | number,
  eventMetadata: Record<string, unknown>,
  correlationData?: Record<string, unknown>
): Promise<ScientificSummary | null> {
  const payloadToHash = {
    event: eventMetadata,
    correlation: correlationData || null,
  };
  const hash = computeHash(payloadToHash);

  // 1. Check Cache
  try {
    const cached = await db
      .select({ summaryJson: aiScientificSummaries.summaryJson })
      .from(aiScientificSummaries)
      .where(
        and(
          eq(aiScientificSummaries.eventId, BigInt(dbEventId)),
          eq(aiScientificSummaries.metadataHash, hash)
        )
      )
      .limit(1);

    if (cached.length > 0) {
      logger.debug({ eventId: dbEventId, hash }, "[summaryEngine] Cache hit");
      return cached[0].summaryJson as unknown as ScientificSummary;
    }
  } catch (err) {
    logger.warn({ err, eventId: dbEventId }, "[summaryEngine] Cache read failed; proceeding to generation");
  }

  // 2. Generate via LLM
  logger.info({ eventId: dbEventId }, "[summaryEngine] Generating new AI summary");
  let provider;
  try {
    // Override default timeout for the summary engine (15 seconds max)
    process.env.GEMINI_TIMEOUT_MS = "15000";
    provider = createDefaultProvider();
  } catch (err) {
    logger.error({ err }, "[summaryEngine] Failed to create LLM provider");
    return null;
  }

  const prompt = buildUserPrompt(eventMetadata, correlationData);
  let rawResponse = "";

  try {
    rawResponse = await provider.generate(prompt, SYSTEM_PROMPT);
  } catch (err) {
    logger.error({ err, eventId: dbEventId }, "[summaryEngine] LLM generation failed or timed out");
    return null;
  }

  // 3. Parse and Validate
  let parsed: unknown;
  try {
    // Attempt to clean markdown JSON fences if the model ignored responseMimeType
    const cleanJson = rawResponse.replace(/^```json/m, "").replace(/^```/m, "").trim();
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    logger.error({ err, rawResponse, eventId: dbEventId }, "[summaryEngine] Failed to parse LLM response as JSON");
    return null;
  }

  if (!validateSummary(parsed)) {
    logger.error({ parsed, eventId: dbEventId }, "[summaryEngine] LLM response failed schema validation");
    return null;
  }

  const summary = parsed as ScientificSummary;

  // 4. Write to Cache
  try {
    await db.insert(aiScientificSummaries).values({
      eventId: BigInt(dbEventId),
      metadataHash: hash,
      modelName: provider.name,
      summaryJson: summary as unknown as Record<string, unknown>,
    });
  } catch (err) {
    logger.warn({ err, eventId: dbEventId }, "[summaryEngine] Failed to cache summary (non-fatal)");
  }

  return summary;
}
