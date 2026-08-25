// RULE-CHAT-03 / REQ-CHAT-004 / REQ-CHAT-005 — hard monthly cap + per-conversation
// limit, graceful fallback instead of hard failure.
//
// OD-CHAT-011 leaves the execution model open: an inline synchronous per-turn
// check (candidate i) vs. a separate interval poller (candidate ii, needs a job
// runtime that doesn't exist anywhere in the codebase, MIG-GAP-CHAT-005). This
// prototype implements candidate (i) — the cheapest option that needs no new
// infrastructure — and documents that choice here rather than silently picking
// it. Swapping to a poller later only means calling `recordSpend` from a cron
// job instead of inline.
import { config } from "./config.js";
import type { TokenSpend, FallbackReason } from "./types.js";

let monthlySpend = 0;

export const budgetGuard = {
  monthlySpend(): number {
    return monthlySpend;
  },
  monthlyBudgetExhausted(): boolean {
    return monthlySpend >= config.monthlyTokenCap;
  },
  perConversationExceeded(spend: TokenSpend): boolean {
    return spend.total >= config.perConversationTokenCap;
  },
  recordSpend(spend: { promptTokens: number; completionTokens: number }): void {
    monthlySpend += spend.promptTokens + spend.completionTokens;
  },
  checkBeforeTurn(conversationSpend: TokenSpend): FallbackReason | null {
    if (budgetGuard.monthlyBudgetExhausted()) return "monthly-budget-exhausted";
    if (budgetGuard.perConversationExceeded(conversationSpend)) return "conversation-limit-exceeded";
    return null;
  },
  // Test-only: JOB-CHATBOT-BudgetGuard has no real durable state to reset in
  // production (cap resets are calendar-driven); exposed so tests can start clean.
  __resetForTests(): void {
    monthlySpend = 0;
  },
};
