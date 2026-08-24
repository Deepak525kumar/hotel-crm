import { getEnv } from '../../../config/env.js';
import { getPrisma } from '../../../lib/db.js';

/**
 * Token budget enforcement — REQ-CHAT-004 (hard monthly cap, config-stored),
 * REQ-CHAT-005 (per-conversation limit), OD-CHAT-010 (per-worker daily cap,
 * the named abuse shape).
 *
 * OD-CHAT-011 left the execution model open between (i) a synchronous
 * per-turn check and (ii) an interval poller. This implements (i), and the
 * choice is deliberate: a poller can overspend by up to one poll interval,
 * which is the wrong failure direction for a cap whose entire purpose is to
 * be hard. A Scheduler job may later ADD warning notifications at 70/90%,
 * but it must not become the enforcement point.
 *
 * Note CRR §2/§3 exclude login rate-limiting platform-wide. That exclusion is
 * about account lockout and does NOT cover this: these are cost controls on a
 * metered endpoint. SPEC-CHATBOT-001 is explicit the two must not be
 * conflated.
 */

export type BudgetDenialReason =
  | 'monthly-cap-exhausted'
  | 'conversation-cap-exhausted'
  | 'daily-user-cap-exhausted';

export interface BudgetDecision {
  allowed: boolean;
  reason?: BudgetDenialReason;
}

/** "2026-08" — the key ChatbotBudgetCounter rows are stored under. */
export function currentYearMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Checked BEFORE a turn spends anything. Returns a decision rather than
 * throwing: a budget breach is a `fallback-triggered` outcome (RULE-CHAT-03),
 * not an error — onboarding must degrade to the static checklist, never hard-fail.
 */
export async function checkBudget(params: {
  workerId: string;
  conversationTokensSpent: number;
  now?: Date;
}): Promise<BudgetDecision> {
  const env = getEnv();
  const prisma = getPrisma();

  if (params.conversationTokensSpent >= env.CHATBOT_CONVERSATION_TOKEN_CAP) {
    return { allowed: false, reason: 'conversation-cap-exhausted' };
  }

  const counter = await prisma.chatbotBudgetCounter.findUnique({
    where: { year_month: currentYearMonth(params.now) },
  });
  if ((counter?.tokens_spent ?? 0) >= env.CHATBOT_MONTHLY_TOKEN_CAP) {
    return { allowed: false, reason: 'monthly-cap-exhausted' };
  }

  // OD-CHAT-010: one worker issuing many conversations, each individually
  // under the per-conversation cap, can still exhaust the SHARED monthly
  // budget and force fallback for everyone else. Summed from the worker's own
  // conversations today rather than a separate counter, so there is one
  // source of truth for spend.
  const since = startOfUtcDay(params.now ?? new Date());
  const todays = await prisma.chatbotConversation.aggregate({
    where: { worker_id: params.workerId, created_at: { gte: since } },
    _sum: { tokens_input: true, tokens_output: true },
  });
  const spentToday =
    (todays._sum.tokens_input ?? 0) + (todays._sum.tokens_output ?? 0);
  if (spentToday >= env.CHATBOT_USER_DAILY_TOKEN_CAP) {
    return { allowed: false, reason: 'daily-user-cap-exhausted' };
  }

  return { allowed: true };
}

/**
 * Recorded AFTER a turn, from the provider's reported usage. Upserts so the
 * first turn of a month creates the row; the increment is atomic so
 * concurrent turns cannot lose an update the way read-modify-write would.
 */
export async function recordSpend(params: {
  promptTokens: number;
  completionTokens: number;
  now?: Date;
}): Promise<void> {
  const prisma = getPrisma();
  const total = params.promptTokens + params.completionTokens;
  if (total <= 0) return;

  const yearMonth = currentYearMonth(params.now);
  await prisma.chatbotBudgetCounter.upsert({
    where: { year_month: yearMonth },
    create: { year_month: yearMonth, tokens_spent: total },
    update: { tokens_spent: { increment: total } },
  });
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
