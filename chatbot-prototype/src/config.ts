// Config surface for MIG-GAP-CHAT-004 (no CHATBOT_*/CLAUDE_*/TOKEN_* keys exist
// in the real backend yet). Values are read straight from process.env — this
// prototype has no dependency on the real backend's src/config/env.ts.
import { randomBytes } from "node:crypto";

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/**
 * Fail fast on a non-numeric cap. `Number("2_000_000")` is NaN, and every
 * budget guard is a `>=` comparison — and every comparison with NaN is false,
 * so a single typo silently disables ALL cost control with no error and no log
 * line. The caps are the platform's only defense against unbounded LLM spend,
 * so they must fail closed at boot rather than open at runtime.
 */
function readPositiveInt(name: string, fallback: string): number {
  const raw = readEnv(name, fallback);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer; got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function randomToken(): string {
  return randomBytes(24).toString("hex");
}

const GENERATED_TOKEN = randomToken();

/**
 * RULE-CHAT-01: Haiku is the confirmed model and "no other/larger model is
 * confirmed anywhere". An override is allowed (this is a prototype) but a
 * non-Haiku choice is a cost decision that should never happen silently.
 */
function readModel(): string {
  const model = readEnv("CHATBOT_MODEL", "claude-haiku-4-5-20251001");
  if (!model.includes("haiku")) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] CHATBOT_MODEL="${model}" is not a Haiku variant. RULE-CHAT-01 confirms Haiku as the adopted model; ` +
        `a larger model changes the cost profile the token caps were sized against.`,
    );
  }
  return model;
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  mockMode: !process.env.ANTHROPIC_API_KEY,
  model: readModel(),
  monthlyTokenCap: readPositiveInt("CHATBOT_MONTHLY_TOKEN_CAP", "2000000"),
  perConversationTokenCap: readPositiveInt("CHATBOT_PER_CONVERSATION_TOKEN_CAP", "20000"),
  // Defense-in-depth ceiling independent of the token cap: bounds a
  // pathological loop of very short messages that individually cost little
  // but never trip the per-conversation token limit.
  maxTurnsPerConversation: readPositiveInt("CHATBOT_MAX_TURNS_PER_CONVERSATION", "40"),
  port: readPositiveInt("PORT", "4310"),
  // Simulates "the calling module has already authenticated the request" for
  // the in-process StartConversation/GetConversationOutcome(b) surface, which
  // this standalone prototype has to expose over HTTP since no real Onboarding
  // caller exists to invoke it in-process. Not a substitute for real
  // service-to-service auth — documented as prototype-only in server.ts.
  // Routed through readEnv so an empty-string env var falls back rather than
  // silently locking every internal call out.
  internalCallerToken: readEnv("INTERNAL_CALLER_TOKEN", GENERATED_TOKEN),
  internalCallerTokenWasGenerated: !process.env.INTERNAL_CALLER_TOKEN,
};
