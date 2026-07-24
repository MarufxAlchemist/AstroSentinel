import { z } from "zod";
import type { LLMProvider } from "./provider.js";
import {
  CORRELATION_SYSTEM_PROMPT,
  buildCorrelationPrompt,
} from "./prompts/correlation.js";
import { logger } from "../../lib/logger.js";

// ─── Input types ─────────────────────────────────────────────────────────────

export interface PrimaryEvent {
  id: string;
  eventId: string;
  eventType: string;
  observatory: string;
  detectionTime: string;
  ra: number;
  dec: number;
  errorRadius: number;
  snr: number;
  far: number;
  galLat: number;
  galLon: number;
  sunDistance: number;
  moonDistance: number;
  fluence?: number | null;
  dm?: number | null;
  t90?: number | null;
  chirpMass?: number | null;
  luminosityDistance?: number | null;
  lifecycle: string;
}

export interface CorrelationCandidate {
  id: string;
  eventId: string;
  eventType: string;
  observatory: string;
  detectionTime?: string;
  ra?: number;
  dec?: number;
  errorRadius?: number;
  snr?: number;
  far?: number;
}

export interface CorrelationScore {
  overall_score: number;
  temporal_score: number;
  spatial_score: number;
  angular_separation_deg: number;
  delta_t_seconds: number;
  event_pair_type: string;
  /** Distinguishes multi-messenger associations from cross-instrument detections. */
  correlation_type: "multi_messenger" | "cross_detection" | "speculative";
}

export interface CorrelationAgentInput {
  primary_event: PrimaryEvent;
  candidate_events: CorrelationCandidate[];
  correlation_scores: Record<string, CorrelationScore>;
}

// ─── Output schema (Zod) ─────────────────────────────────────────────────────

export const CorrelationAnalysisSchema = z.object({
  confidence: z.enum(["HIGH", "MODERATE", "LOW", "SPECULATIVE"]),
  scientific_assessment: z.string().min(10).max(2000),
  followup_recommendation: z.string().min(10).max(1000),
  reasoning: z.array(z.string().min(5)).min(1).max(20),
});

export type CorrelationAnalysisResult = z.infer<typeof CorrelationAnalysisSchema>;

// ─── Agent ───────────────────────────────────────────────────────────────────

export class CorrelationAgent {
  constructor(private readonly provider: LLMProvider) {}

  async analyze(input: CorrelationAgentInput): Promise<CorrelationAnalysisResult> {
    const prompt = buildCorrelationPrompt(input);

    logger.info(
      {
        provider: this.provider.name,
        primaryEvent: input.primary_event.eventId,
        candidateCount: input.candidate_events.length,
      },
      "CorrelationAgent: starting analysis"
    );

    const raw = await this.provider.generate(prompt, CORRELATION_SYSTEM_PROMPT);

    return this.parseAndValidate(raw, input, prompt);
  }

  private parseAndValidate(
    raw: string,
    input: CorrelationAgentInput,
    originalPrompt: string
  ): CorrelationAnalysisResult {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // Some models occasionally wrap JSON in markdown fences despite instructions.
      // Strip them and retry the parse once before giving up.
      const stripped = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();

      try {
        parsed = JSON.parse(stripped);
      } catch {
        logger.error(
          { raw: raw.slice(0, 500), provider: this.provider.name },
          "CorrelationAgent: LLM returned non-JSON"
        );
        throw new Error(
          `AI provider returned a non-JSON response. ` +
            `Raw (first 200 chars): ${raw.slice(0, 200)}`
        );
      }
    }

    const result = CorrelationAnalysisSchema.safeParse(parsed);

    if (!result.success) {
      logger.error(
        {
          issues: result.error.issues,
          parsed,
          provider: this.provider.name,
        },
        "CorrelationAgent: response failed schema validation"
      );
      throw new Error(
        `AI response did not match expected schema: ${result.error.message}`
      );
    }

    logger.info(
      {
        confidence: result.data.confidence,
        provider: this.provider.name,
        primaryEvent: input.primary_event.eventId,
      },
      "CorrelationAgent: analysis complete"
    );

    return result.data;
  }
}
