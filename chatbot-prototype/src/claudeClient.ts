// REQ-CHAT-001/003 — Claude API integration, defaulting to Claude Haiku.
// MIG-GAP-CHAT-002: no Anthropic SDK dependency exists in the real backend
// yet; this prototype adds it only here, isolated.
//
// Mock mode: when no ANTHROPIC_API_KEY is set (config.mockMode), a canned
// responder stands in so the full conversation loop, budget guard, and tool
// registry are all exercisable without a key. Paste a real key into .env to
// switch to the live Claude API automatically — no code change needed.
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { listToolsForClaude } from "./toolRegistry.js";
import { SYSTEM_PROMPT_PREFIX, sanitizeForSystemPrompt } from "./guardrails.js";
import type { ConversationMessage, RequiredDocument } from "./types.js";

export interface TurnResult {
  reply: string;
  toolUse: { name: string; input: unknown } | null;
  usage: { promptTokens: number; completionTokens: number };
}

/** Thrown when the provider call itself fails — mapped to a graceful fallback, not a 500. */
export class ProviderUnavailableError extends Error {}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

function buildSystemPrompt(requiredDocuments: RequiredDocument[]): string {
  // Document names are admin/template-configured, not worker-supplied — but
  // that is still a lower-trust source than a system prompt, so every
  // interpolated value is whitespace-collapsed and length-capped so it cannot
  // open what looks like a new instruction line.
  const outstanding = requiredDocuments
    .filter((doc) => !doc.present)
    .map((doc) => sanitizeForSystemPrompt(doc.name))
    .filter((name) => name.length > 0);
  const documentLine =
    outstanding.length === 0
      ? "All required documents are already present — confirm completion with the worker."
      : `Outstanding required documents: ${outstanding.join(", ")}. Ask for each until the worker confirms all are submitted.`;
  return `${SYSTEM_PROMPT_PREFIX}\n\n${documentLine}`;
}

/**
 * The Messages API requires a non-empty `messages` array whose FIRST entry is
 * `user`-role. Neither holds naturally here: `startConversation` runs a turn
 * with no history at all, and every later turn's history begins with the
 * agent's own opening line. Both would be rejected by the live API, and mock
 * mode cannot surface that — so the shape is normalized here explicitly.
 */
function buildApiMessages(
  history: ConversationMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const mapped = history
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: (m.role === "worker" ? "user" : "assistant") as "user" | "assistant", content: m.content }));

  // Drop any leading assistant turns so the array starts with a user message.
  const firstUserIndex = mapped.findIndex((m) => m.role === "user");
  const trimmed = firstUserIndex === -1 ? [] : mapped.slice(firstUserIndex);

  if (trimmed.length === 0) {
    // Conversation opener: the consumer, not the worker, initiated this.
    return [{ role: "user", content: "Please begin: tell me which documents you still need from me." }];
  }
  return trimmed;
}

export async function runTurn(
  requiredDocuments: RequiredDocument[],
  history: ConversationMessage[],
): Promise<TurnResult> {
  if (config.mockMode) return runMockTurn(requiredDocuments, history);

  const anthropic = getClient();
  let response;
  try {
    response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 512,
      system: buildSystemPrompt(requiredDocuments),
      tools: listToolsForClaude(),
      messages: buildApiMessages(history),
    });
  } catch (err) {
    // Log redacted — a raw SDK error object carries the request context,
    // which is how conversation content ends up in log storage.
    const redacted = {
      name: (err as Error)?.name,
      status: (err as { status?: number })?.status,
      message: (err as Error)?.message,
    };
    // eslint-disable-next-line no-console
    console.error("[provider] Claude API call failed", JSON.stringify(redacted));
    throw new ProviderUnavailableError("Claude API call failed");
  }

  const textBlock = response.content.find((block) => block.type === "text");
  const toolBlock = response.content.find((block) => block.type === "tool_use");

  return {
    reply: textBlock && textBlock.type === "text" ? textBlock.text : "",
    toolUse: toolBlock && toolBlock.type === "tool_use" ? { name: toolBlock.name, input: toolBlock.input } : null,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    },
  };
}

// Deterministic, dependency-free stand-in for the live model — enough to
// drive RULE-CHAT-02's ask/re-ask loop and REQ-CHAT-002's completion check
// for tests and local exploration before a key is available.
//
// It CAN emit tool calls: a worker message containing an explicit trigger
// phrase makes the mock request the corresponding tool. Without this, the
// entire tool path (allow-list refusal, schema rejection, confirmation gate,
// confirm-resume) is unreachable in the only mode that runs without a key —
// which is exactly how a broken confirmation gate survived a green suite.
function runMockTurn(requiredDocuments: RequiredDocument[], history: ConversationMessage[]): TurnResult {
  const outstanding = requiredDocuments.filter((doc) => !doc.present);
  const lastWorkerMessage = [...history].reverse().find((m) => m.role === "worker")?.content ?? "";
  const approxTokens = Math.max(20, Math.ceil(lastWorkerMessage.length / 4) + 40);
  const usage = { promptTokens: approxTokens, completionTokens: 20 };

  const lower = lastWorkerMessage.toLowerCase();
  if (lower.includes("check status of")) {
    const documentName = lastWorkerMessage.slice(lower.indexOf("check status of") + 15).trim() || "Passport";
    return { reply: "", toolUse: { name: "get_document_status", input: { documentName } }, usage };
  }
  if (lower.includes("speak to a human")) {
    return {
      reply: "",
      toolUse: { name: "flag_for_manual_review", input: { reason: "worker requested human handover" } },
      usage,
    };
  }
  if (lower.includes("trigger unknown tool")) {
    return { reply: "", toolUse: { name: "definitely_not_registered", input: {} }, usage };
  }
  if (lower.includes("trigger bad tool input")) {
    return { reply: "", toolUse: { name: "get_document_status", input: { wrongField: 1 } }, usage };
  }

  const reply =
    outstanding.length === 0
      ? "Thanks — all required documents are on file. You're done here."
      : `Please provide the following: ${outstanding.map((doc) => doc.name).join(", ")}.`;

  return { reply, toolUse: null, usage: { ...usage, completionTokens: Math.max(15, Math.ceil(reply.length / 4)) } };
}
