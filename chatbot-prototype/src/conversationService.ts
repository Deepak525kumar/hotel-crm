// Core orchestration — implements IF-CHATBOT-StartConversation,
// IF-CHATBOT-ExchangeMessage, and IF-CHATBOT-GetConversationOutcome
// (both modes) against SPEC-CHATBOT-001's Interfaces and Contracts table.
import { randomUUID } from "node:crypto";
import { store } from "./store.js";
import { budgetGuard } from "./budgetGuard.js";
import { auditLog } from "./auditLog.js";
import { applyInputGuardrails } from "./guardrails.js";
import { resolveTool, validateToolInput, type ToolDefinition } from "./toolRegistry.js";
import { checkRateLimit } from "./rateLimiter.js";
import { runTurn, ProviderUnavailableError } from "./claudeClient.js";
import { withConversationLock } from "./conversationLock.js";
import { config } from "./config.js";
import type {
  ChatbotConversation,
  ConversationOutcome,
  StartConversationInput,
  RequiredDocument,
} from "./types.js";

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}
export class RateLimitError extends Error {}
export class NotImplementedError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

function isComplete(purpose: string, requiredDocuments: RequiredDocument[]): boolean {
  if (purpose !== "onboarding-document-collection") return false;
  // Vacuously complete when nothing is outstanding. Requiring length > 0 here
  // stranded a worker who owed no documents in `in-progress` forever, burning
  // a turn per message until the turn ceiling produced a false fallback.
  return requiredDocuments.every((doc) => doc.present);
}

function triggerFallback(
  conversation: ChatbotConversation,
  reason: NonNullable<ChatbotConversation["fallbackReason"]>,
): void {
  conversation.status = "fallback-triggered";
  conversation.fallbackReason = reason;
  conversation.updatedAt = nowIso();
  auditLog.record({
    event: "fallback-triggered",
    conversationId: conversation.id,
    workerId: conversation.workerId,
    purpose: conversation.purpose,
    outcome: reason,
    timestamp: conversation.updatedAt,
  });
}

/**
 * IF-CHATBOT-StartConversation (in-process). Per REQ-CHAT-009, `workerId` and
 * `context` MUST already be derived server-side by the trusted caller
 * (Onboarding/Compliance) — this function does not itself authenticate
 * anything, mirroring the notification-service in-process trust model.
 */
export async function startConversation(input: StartConversationInput): Promise<ChatbotConversation> {
  // The subject-rights purpose (REQ-CHAT-008) is a real part of the interface
  // but is NOT built here: it would need its own system prompt, its own
  // request-context schema, its own terminal condition, and its own guardrail
  // review for a more sensitive data class. Accepting it and quietly running
  // the document-collection agent would be purpose confusion plus a guaranteed
  // budget burn (no terminal state exists for it), so it is refused outright.
  if (input.purpose === "gdpr-subject-rights") {
    throw new NotImplementedError(
      "purpose 'gdpr-subject-rights' is deliberately not implemented in this prototype",
    );
  }

  // OD-CHAT-010 defense-in-depth: bound how often one worker can be started
  // into a new conversation, independent of the shared monthly budget cap.
  if (!checkRateLimit("conversationStart", input.workerId)) {
    throw new RateLimitError("too many conversations started for this worker recently");
  }

  const id = randomUUID();
  const requiredDocuments = (input.context.requiredDocuments ?? []).map((doc) => ({ ...doc }));
  const timestamp = nowIso();

  const conversation: ChatbotConversation = {
    id,
    workerId: input.workerId,
    purpose: input.purpose,
    status: "in-progress",
    model: config.model,
    requiredDocuments,
    messages: [],
    toolCallLog: [],
    tokenSpend: { promptTokens: 0, completionTokens: 0, total: 0 },
    turnCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // Recorded before any early return: a conversation record now exists and has
  // been handed to the consumer, so a later fallback entry must not reference a
  // conversation the audit trail never saw begin (RULE-CHAT-10).
  auditLog.record({
    event: "conversation-started",
    conversationId: id,
    workerId: input.workerId,
    purpose: input.purpose,
    timestamp,
  });

  // RULE-CHAT-03: budget already exhausted at start → immediate fallback, no live turn.
  const fallbackReason = budgetGuard.checkBeforeTurn(conversation.tokenSpend);
  if (fallbackReason) {
    triggerFallback(conversation, fallbackReason);
    store.save(conversation);
    return conversation;
  }

  // Nothing outstanding: complete without spending a turn at all.
  if (isComplete(conversation.purpose, requiredDocuments)) {
    conversation.status = "completed";
    auditLog.record({
      event: "conversation-completed",
      conversationId: id,
      workerId: input.workerId,
      purpose: input.purpose,
      outcome: "completed",
      timestamp: nowIso(),
    });
    store.save(conversation);
    return conversation;
  }

  try {
    const turn = await runTurn(requiredDocuments, conversation.messages);
    applyTurn(conversation, "", turn);
  } catch (err) {
    if (!(err instanceof ProviderUnavailableError)) throw err;
    triggerFallback(conversation, "provider-unavailable");
  }

  store.save(conversation);
  return conversation;
}

function applyTurn(
  conversation: ChatbotConversation,
  workerMessage: string,
  turn: Awaited<ReturnType<typeof runTurn>>,
): void {
  const timestamp = nowIso();
  if (workerMessage) {
    conversation.messages.push({ role: "worker", content: workerMessage, timestamp });
  }
  if (turn.reply) {
    conversation.messages.push({ role: "agent", content: turn.reply, timestamp });
  }

  conversation.tokenSpend.promptTokens += turn.usage.promptTokens;
  conversation.tokenSpend.completionTokens += turn.usage.completionTokens;
  conversation.tokenSpend.total = conversation.tokenSpend.promptTokens + conversation.tokenSpend.completionTokens;
  conversation.turnCount += 1;
  budgetGuard.recordSpend(turn.usage);

  conversation.updatedAt = timestamp;
}

function describeInput(input: unknown): string {
  if (input && typeof input === "object") {
    return Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(", ");
  }
  return String(input);
}

function inputFieldNames(input: unknown): string[] {
  return input && typeof input === "object" ? Object.keys(input as Record<string, unknown>) : [];
}

/**
 * Confirmation resume. Requires the worker to reference the specific pending
 * call id — a bare "confirm" is not honoured, so a call parked several turns
 * ago cannot be triggered by an unrelated affirmative. Pending calls also
 * expire, so consent cannot be harvested later.
 */
function resolvePendingConfirmation(conversation: ChatbotConversation, sanitizedMessage: string): boolean {
  const pending = conversation.toolCallLog.find((entry) => !entry.confirmed && !entry.expired);
  if (!pending) return false;

  // A pending confirmation is good for the immediately-next turn only. Any
  // turn that is not the matching confirm — including a bare "confirm", a
  // wrong id, or an unrelated message — expires it. Consent to an irreversible
  // action must be contemporaneous, never harvested from a later affirmative.
  const match = sanitizedMessage.trim().toLowerCase().match(/^confirm\s+([a-z0-9-]+)$/);
  const tool = match && match[1] === pending.id ? resolveTool(pending.tool) : undefined;
  if (!tool) {
    pending.expired = true;
    return false;
  }

  // Re-validate at confirmation time too — never trust a stored blob without re-checking it.
  const validation = validateToolInput(tool, pending.input);
  if (!validation.ok) {
    pending.expired = true;
    return false;
  }

  pending.output = tool.handler(validation.input as never, {
    workerId: conversation.workerId,
    requiredDocuments: conversation.requiredDocuments ?? [],
  });
  pending.confirmed = true;

  auditLog.record({
    event: "tool-confirmed",
    conversationId: conversation.id,
    workerId: conversation.workerId,
    purpose: conversation.purpose,
    tool: pending.tool,
    riskTier: pending.riskTier,
    inputFields: inputFieldNames(pending.input),
    timestamp: nowIso(),
  });
  return true;
}

function handleToolUse(
  conversation: ChatbotConversation,
  tool: ToolDefinition,
  rawInput: unknown,
  naiveInjectionSignal: boolean,
): string | null {
  const validation = validateToolInput(tool, rawInput);
  if (!validation.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[guardrail] tool "${tool.name}" input failed validation: ${validation.error} — refused`);
    return "I couldn't complete that action — let's try again with the details you're providing.";
  }

  // If this turn's own input carried a naive-injection signal, refuse the tool
  // call outright rather than asking the worker to confirm it. Confirmation is
  // a control against the MODEL misfiring; it is worthless against a hostile
  // worker, who would simply confirm their own injected action.
  if (naiveInjectionSignal) {
    auditLog.record({
      event: "tool-refused",
      conversationId: conversation.id,
      workerId: conversation.workerId,
      purpose: conversation.purpose,
      tool: tool.name,
      riskTier: tool.riskTier,
      outcome: "naive-injection-signal",
      inputFields: inputFieldNames(validation.input),
      timestamp: nowIso(),
    });
    return "I can't act on that request. Let's keep going with your documents.";
  }

  const entryId = randomUUID().slice(0, 8);
  const autoExecute = !tool.requiresConfirmation;

  const output = autoExecute
    ? tool.handler(validation.input as never, {
        workerId: conversation.workerId,
        requiredDocuments: conversation.requiredDocuments ?? [],
      })
    : null;

  conversation.toolCallLog.push({
    id: entryId,
    tool: tool.name,
    input: validation.input,
    output,
    riskTier: tool.riskTier,
    confirmed: autoExecute,
    // Pending confirmations survive exactly one further turn.
    pendingUntilTurn: autoExecute ? undefined : conversation.turnCount + 1,
    timestamp: nowIso(),
  });

  auditLog.record({
    event: autoExecute ? "tool-invoked" : "tool-refused",
    conversationId: conversation.id,
    workerId: conversation.workerId,
    purpose: conversation.purpose,
    tool: tool.name,
    riskTier: tool.riskTier,
    outcome: autoExecute ? "executed" : "awaiting-confirmation",
    inputFields: inputFieldNames(validation.input),
    timestamp: nowIso(),
  });

  if (!autoExecute) {
    // Show the concrete arguments — confirming an action whose parameters were
    // never displayed is not explicit confirmation (ADR-053 principle 5).
    return (
      `Before I do that — ${tool.name} with ${describeInput(validation.input)}. ` +
      `Reply "confirm ${entryId}" to proceed.`
    );
  }
  return null;
}

/**
 * IF-CHATBOT-ExchangeMessage — direct end-user access, self-scoped by
 * RULE-CHAT-09. `workerId` here is expected to already be the auth-middleware-
 * verified identity, not a bare client-supplied field (enforced by the caller
 * in server.ts, matching the real module's route-vs-service split).
 *
 * Note there is deliberately NO parameter by which the worker can assert which
 * documents they have submitted — completeness is Documents' authority, never
 * a claim from the party with an incentive to overstate it. See
 * `refreshRequiredDocuments`.
 */
export async function exchangeMessage(
  conversationId: string,
  workerId: string,
  rawMessage: string,
): Promise<ChatbotConversation> {
  // Serialized per conversation: the read-check / await-provider / mutate
  // sequence below is not atomic, and concurrent turns otherwise sail past
  // both token caps and the turn ceiling together.
  return withConversationLock(conversationId, () => exchangeMessageLocked(conversationId, workerId, rawMessage));
}

async function exchangeMessageLocked(
  conversationId: string,
  workerId: string,
  rawMessage: string,
): Promise<ChatbotConversation> {
  const conversation = store.get(conversationId);
  if (!conversation) throw new NotFoundError("conversation not found");
  if (conversation.workerId !== workerId) throw new ForbiddenError("conversation does not belong to this worker");
  if (conversation.status !== "in-progress") throw new ConflictError("conversation already closed");

  // OD-CHAT-010 defense-in-depth: bound turn frequency per worker independent
  // of the shared monthly budget.
  if (!checkRateLimit("exchangeMessage", workerId)) {
    throw new RateLimitError("too many messages sent on this conversation recently");
  }

  // Defense-in-depth ceiling: bounds a loop of very short, cheap turns that
  // never individually trip the per-conversation token cap.
  if (conversation.turnCount >= config.maxTurnsPerConversation) {
    triggerFallback(conversation, "turn-limit-exceeded");
    store.save(conversation);
    return conversation;
  }

  const { sanitized, naiveInjectionSignal } = applyInputGuardrails(rawMessage);
  if (naiveInjectionSignal) {
    // Telemetry only — assume a deliberate attacker evades this detector.
    // eslint-disable-next-line no-console
    console.warn(`[telemetry] naive injection signal on conversation ${conversationId}`);
  }

  // Budget is checked BEFORE the confirmation branch: a confirm turn performs a
  // real write, and a budget-exhausted conversation must not still act.
  const fallbackReason = budgetGuard.checkBeforeTurn(conversation.tokenSpend);
  if (fallbackReason) {
    triggerFallback(conversation, fallbackReason);
    store.save(conversation);
    return conversation;
  }

  if (resolvePendingConfirmation(conversation, sanitized)) {
    const timestamp = nowIso();
    conversation.messages.push({ role: "worker", content: sanitized, timestamp });
    conversation.messages.push({ role: "agent", content: "Confirmed and completed.", timestamp });
    conversation.turnCount += 1;
    conversation.updatedAt = timestamp;
    // A confirm turn spends no tokens (no provider call), but it can still be
    // the point at which the conversation becomes complete.
    if (isComplete(conversation.purpose, conversation.requiredDocuments ?? [])) {
      conversation.status = "completed";
      auditLog.record({
        event: "conversation-completed",
        conversationId,
        workerId,
        purpose: conversation.purpose,
        outcome: "completed",
        timestamp: nowIso(),
      });
    }
    store.save(conversation);
    return conversation;
  }

  let turn;
  try {
    turn = await runTurn(conversation.requiredDocuments ?? [], [
      ...conversation.messages,
      { role: "worker", content: sanitized, timestamp: nowIso() },
    ]);
  } catch (err) {
    if (!(err instanceof ProviderUnavailableError)) throw err;
    triggerFallback(conversation, "provider-unavailable");
    store.save(conversation);
    return conversation;
  }

  if (turn.toolUse) {
    const tool = resolveTool(turn.toolUse.name);
    if (!tool) {
      // Untrusted model output naming a tool outside the allow-list — refused, not executed.
      // eslint-disable-next-line no-console
      console.warn(`[guardrail] model requested unregistered tool "${turn.toolUse.name}" — refused`);
    } else {
      const override = handleToolUse(conversation, tool, turn.toolUse.input, naiveInjectionSignal);
      if (override !== null) turn.reply = override;
    }
  }

  applyTurn(conversation, sanitized, turn);

  if (budgetGuard.perConversationExceeded(conversation.tokenSpend)) {
    triggerFallback(conversation, "conversation-limit-exceeded");
  } else if (isComplete(conversation.purpose, conversation.requiredDocuments ?? [])) {
    conversation.status = "completed";
    auditLog.record({
      event: "conversation-completed",
      conversationId,
      workerId,
      purpose: conversation.purpose,
      outcome: "completed",
      timestamp: nowIso(),
    });
  }

  store.save(conversation);
  return conversation;
}

/**
 * Server-side completeness refresh — the ONLY way a document is marked present.
 * Invoked from the trusted tier (the same tier as startConversation), never
 * from a worker-facing route, because completeness is Documents' authority
 * (ADR-053 principle 3), not a worker's self-attestation.
 *
 * TODO(integration): replace the `presentDocumentNames` parameter with a real
 * call to Documents' own completeness interface. It is a parameter here only
 * because this prototype is isolated and has no Documents module to query.
 */
export function refreshRequiredDocuments(
  conversationId: string,
  presentDocumentNames: string[],
): ChatbotConversation | undefined {
  const conversation = store.get(conversationId);
  if (!conversation?.requiredDocuments) return conversation;

  // Trim on both sides: the stored name was trimmed at ingest, so an untrimmed
  // incoming name would silently fail to match and the document would stay
  // outstanding with no error anywhere.
  const normalized = presentDocumentNames.map((name) => name.trim().toLowerCase());
  for (const doc of conversation.requiredDocuments) {
    if (normalized.includes(doc.name.trim().toLowerCase())) {
      doc.present = true;
    }
  }

  if (conversation.status === "in-progress" && isComplete(conversation.purpose, conversation.requiredDocuments)) {
    conversation.status = "completed";
    auditLog.record({
      event: "conversation-completed",
      conversationId,
      workerId: conversation.workerId,
      purpose: conversation.purpose,
      outcome: "completed",
      timestamp: nowIso(),
    });
  }

  conversation.updatedAt = nowIso();
  store.save(conversation);
  return conversation;
}

/**
 * Narrowed outcome DTO — matches the spec's Output column exactly
 * (`in-progress | completed | fallback-triggered`). Deliberately excludes the
 * transcript and tool-call log: transcript disclosure is still an open
 * decision (OD-CHAT-008) and no consumer needs it to act on an outcome.
 */
function toOutcome(conversation: ChatbotConversation): ConversationOutcome {
  return {
    id: conversation.id,
    status: conversation.status,
    ...(conversation.fallbackReason ? { fallbackReason: conversation.fallbackReason } : {}),
  };
}

/** IF-CHATBOT-GetConversationOutcome, mode (a) — direct, self-scoped worker poll. */
export function getConversationOutcome(conversationId: string, workerId: string): ConversationOutcome {
  const conversation = store.get(conversationId);
  if (!conversation) throw new NotFoundError("conversation not found");
  if (conversation.workerId !== workerId) throw new ForbiddenError("conversation does not belong to this worker");
  return toOutcome(conversation);
}

/**
 * IF-CHATBOT-GetConversationOutcome, mode (b) — in-process call from a
 * trusted caller (Onboarding/Compliance). No auth hop: the caller has
 * already authenticated the underlying worker-facing request itself.
 * Returns the same narrowed outcome, not the conversation aggregate — a
 * consumer has no ownership of, and no need for, the transcript.
 *
 * In the real module this is in-process only. In this prototype it is ALSO
 * reachable at `GET /internal/conversations/:id` (bearer-gated), because there
 * is no in-process caller here to invoke it — see server.ts's header comment.
 */
export function getConversationOutcomeInProcess(conversationId: string): ConversationOutcome | undefined {
  const conversation = store.get(conversationId);
  return conversation ? toOutcome(conversation) : undefined;
}

/** Full record access, in-process only. Named separately so OD-CHAT-005's read-scope decision has an explicit target. */
export function getConversationRecordInProcess(conversationId: string): ChatbotConversation | undefined {
  const conversation = store.get(conversationId);
  return conversation ? structuredClone(conversation) : undefined;
}
