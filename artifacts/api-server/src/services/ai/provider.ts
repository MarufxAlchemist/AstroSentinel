/**
 * LLM provider abstraction for AstroSentinel's AI service layer.
 *
 * Design: depend on LLMProvider, not on a concrete class. Swap implementations
 * by injecting a different provider — no call-site changes required.
 *
 * Current implementations:
 *   GeminiProvider   — real-time correlation analysis (Phase 1)
 *
 * Planned implementations (Phase 2):
 *   DeepSeekProvider — full scientific narrative reports
 */

export interface LLMProvider {
  /** Human-readable name used in logs and cache metadata. */
  readonly name: string;

  /**
   * Send a prompt to the model and return the raw text response.
   * Implementations are responsible for retry logic and timeouts.
   * The caller is responsible for JSON parsing and validation.
   */
  generate(prompt: string, systemPrompt?: string): Promise<string>;
}

export interface LLMProviderConfig {
  apiKey: string;
  /** Override the default model for this provider. */
  model?: string;
  /** Hard deadline per request in milliseconds. Default: 30_000. */
  timeoutMs?: number;
  /** Maximum retry attempts on transient errors. Default: 3. */
  maxRetries?: number;
}

/**
 * Returns the default provider configured from environment variables.
 * Extend this factory when adding new providers — no other file needs changing.
 */
export function createDefaultProvider(): LLMProvider {
  // Dynamic import deferred to call site to avoid loading SDKs at startup
  // when the AI route is not being exercised.
  const { GeminiProvider } = require("./gemini.js") as typeof import("./gemini.js");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your .env file to enable AI analysis."
    );
  }

  return new GeminiProvider({
    apiKey,
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    timeoutMs: process.env.GEMINI_TIMEOUT_MS
      ? Number(process.env.GEMINI_TIMEOUT_MS)
      : 45_000,
    maxRetries: 3,
  });
}

/**
 * Phase 2 extension point.
 *
 * When DeepSeekProvider is ready, register it here and expose it via an
 * endpoint or a flag (e.g. ?provider=deepseek) without touching any other file.
 *
 * Usage pattern:
 *   const provider = useDeepSeek
 *     ? createDeepSeekProvider()
 *     : createDefaultProvider();
 *   const agent = new CorrelationAgent(provider);
 */
export function createDeepSeekProvider(_config?: LLMProviderConfig): LLMProvider {
  throw new Error(
    "DeepSeekProvider is not yet implemented. " +
      "Implement artifacts/api-server/src/services/ai/deepseek.ts and wire it up here."
  );
}
