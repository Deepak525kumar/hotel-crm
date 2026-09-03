/**
 * The provider seam.
 *
 * ONE interface with one real implementation to come — not a multi-provider
 * abstraction framework. SPEC-CHATBOT-001 is explicit that provider
 * swappability is ADR-013's boundary language with zero CRR/PDD requirement
 * behind it; a pluggable provider framework would be speculative generality.
 * The interface exists for two concrete reasons: a fake in tests, and a
 * single file to change when Bedrock-vs-Anthropic-direct is decided.
 *
 * No implementation is wired yet. `getProvider()` returns null until one is
 * configured, and the orchestrator degrades to the confirmed fallback
 * (RULE-CHAT-03) rather than erroring.
 */

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResponse {
  text: string;
  toolUse: { name: string; input: unknown } | null;
  usage: LlmUsage;
}

/**
 * Which model answers this turn (owner decision, 2026-09-04).
 *
 * `fast` handles chat, routing and reads. `planning` is reserved for
 * multi-step reasoning and writes -- turning a week of dictated prose into
 * forty assignments. Optional, defaulting to `fast`, so the cheap path is
 * what a caller gets by forgetting to choose rather than the expensive one.
 */
export type LlmTier = 'fast' | 'planning';

export interface LlmProvider {
  /** Identifies the model actually used, recorded on the conversation. */
  readonly modelId: string;
  completeWithTools(params: {
    system: string;
    messages: LlmMessage[];
    tools: LlmToolSpec[];
    tier?: LlmTier;
  }): Promise<LlmResponse>;
}

/**
 * Thrown when the provider itself fails. Mapped by the orchestrator to a
 * `fallback-triggered` outcome, never to a 500 — REQ-CHAT-007's graceful
 * degradation must cover provider outage, not only budget exhaustion.
 *
 * (OD-CHAT-012 leaves open whether outage and budget exhaustion should be
 * distinguishable to the consumer. They are recorded with distinct reasons
 * here so that decision stays open rather than being foreclosed.)
 */
export class ProviderUnavailableError extends Error {
  constructor(message = 'LLM provider unavailable') {
    super(message);
    this.name = 'ProviderUnavailableError';
    Object.setPrototypeOf(this, ProviderUnavailableError.prototype);
  }
}

let configuredProvider: LlmProvider | null = null;

/**
 * Null until a provider is wired. Deliberately not a throwing getter: "no
 * provider" is a supported runtime state today (L0 commands work without
 * one), not an error.
 */
export function getProvider(): LlmProvider | null {
  return configuredProvider;
}

/** Used by the future Bedrock wiring, and by tests to install a fake. */
export function setProvider(provider: LlmProvider | null): void {
  configuredProvider = provider;
}
