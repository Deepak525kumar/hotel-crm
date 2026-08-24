import { ChatbotConversationStatus } from '@prisma/client';
import { getEnv } from '../../../config/env.js';
import { getPrisma } from '../../../lib/db.js';
import { logger } from '../../../lib/logger.js';
import type { ActorContext } from '../tools/actor.js';
import { executeTool } from '../tools/executor.js';
import { findPriorCall, recordToolCall } from '../tools/tool-call-log.js';
import { resolveTool } from '../tools/registry.js';
import { checkBudget, recordSpend } from '../guardrails/budget.js';
import { redact } from '../guardrails/redaction.js';
import { getProvider } from '../provider/llm-provider.js';
import { matchL0, resolveCommandId } from './router-l0.js';
import {
  renderBudgetFallback,
  renderDenied,
  renderProviderUnavailable,
  renderToolResult,
  renderUnrecognized,
} from './templates.js';

/**
 * The turn loop.
 *
 * Routing ladder, cheapest first:
 *   L0  deterministic command  → 0 LLM calls
 *   L1  free text              → 1 LLM call (NOT WIRED — no provider yet)
 *   L2  tool execution         → 0 LLM calls, via the executor's five-step gate
 *   L3  complex/multi-step     → not implemented
 *
 * With no provider configured, L0 works completely and free text degrades to
 * the confirmed fallback (RULE-CHAT-03 / REQ-CHAT-007) rather than erroring.
 * That is a real, useful capability today, not a placeholder: a tapped chip
 * answers correctly with zero spend.
 */

export interface TurnResult {
  reply: string;
  status: ChatbotConversationStatus;
  /** Which rung answered — for the L0-hit-rate metric that drives cost. */
  route: 'L0' | 'L1' | 'L3' | 'none';
  toolInvoked?: string;
  fallbackReason?: string;
}

export async function runTurn(params: {
  conversationId: string;
  actor: ActorContext;
  /** Free text from the worker. Untrusted. */
  text?: string;
  /** Chip tap / slash command — resolved by id, no text parsing. */
  commandId?: string;
  requestId?: string;
}): Promise<TurnResult> {
  const prisma = getPrisma();
  const env = getEnv();

  const conversation = await prisma.chatbotConversation.findUnique({
    where: { id: params.conversationId },
  });
  if (!conversation) {
    throw new Error('conversation not found');
  }

  // RULE-CHAT-09 self-scoping: a conversation is bound to the worker who
  // started it. Re-checked here as well as at the route, because this
  // function is also reachable in-process.
  if (conversation.worker_id !== params.actor.userId) {
    return { reply: renderDenied(), status: conversation.status, route: 'none' };
  }

  if (conversation.status !== ChatbotConversationStatus.IN_PROGRESS) {
    return { reply: renderDenied(), status: conversation.status, route: 'none' };
  }

  // Turn ceiling: bounds a loop of cheap turns that never individually trip
  // a token cap. Distinct from the budget check below, deliberately.
  if (conversation.turn_count >= env.CHATBOT_MAX_TOOL_CALLS_PER_TURN * 10) {
    return closeWithFallback(params.conversationId, 'turn-limit', 'none');
  }

  // ---- L0: deterministic, zero-cost ---------------------------------------
  const command = params.commandId
    ? resolveCommandId(params.commandId)
    : params.text
      ? matchL0(params.text)
      : undefined;

  if (command) {
    const registered = resolveTool(command.tool);
    const tier = registered?.tier ?? 'READ_ONLY';
    const turnIndex = conversation.turn_count;

    // Idempotency applies to writes only. Re-running a read is harmless, and
    // making reads idempotent would mean a worker who asks for their shifts
    // twice in one turn gets a stale cached answer instead of current data.
    if (tier !== 'READ_ONLY') {
      const prior = await findPriorCall({
        conversationId: params.conversationId,
        turnIndex,
        toolName: command.tool,
        args: command.args,
      });
      if (prior) {
        logger.info('Chatbot tool call skipped as duplicate', {
          tool: command.tool,
          conversationId: params.conversationId,
        });
        return {
          reply: 'That is already done.',
          status: ChatbotConversationStatus.IN_PROGRESS,
          route: 'L0',
          toolInvoked: command.tool,
        };
      }
    }

    // No budget check: L0 spends nothing with the provider. Charging a
    // worker's cap for a zero-cost path would be wrong, and would make the
    // cheapest route artificially scarce.
    const outcome = await executeTool({
      toolName: command.tool,
      rawArgs: command.args,
      actor: params.actor,
      requestId: params.requestId,
    });

    // Recorded for every tier and both outcomes — the audit value of "this
    // was denied" is at least as high as "this succeeded".
    await recordToolCall({
      conversationId: params.conversationId,
      turnIndex,
      toolName: command.tool,
      tier,
      args: command.args,
      confirmed: false,
      outcome,
    });

    await prisma.chatbotConversation.update({
      where: { id: params.conversationId },
      data: { turn_count: { increment: 1 } },
    });

    if (outcome.status === 'DENIED') {
      logger.warn('Chatbot L0 command denied', {
        command: command.id,
        userId: params.actor.userId,
        requestId: params.requestId,
      });
      return {
        reply: renderDenied(),
        status: ChatbotConversationStatus.IN_PROGRESS,
        route: 'L0',
      };
    }

    // Redaction applies even on the L0 path: the result is going to a client,
    // and a tool's compress() is about size, not sensitivity.
    const safe = redact(outcome.result);
    return {
      reply: renderToolResult(safe),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'L0',
      toolInvoked: command.tool,
    };
  }

  // ---- L1: free text ------------------------------------------------------
  const provider = getProvider();
  if (!provider) {
    // Not an error state. No provider is configured yet, so free text has no
    // route — the worker keeps the working command set.
    return {
      reply: renderProviderUnavailable(),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'none',
    };
  }

  // Budget is checked only on the paid path.
  const budget = await checkBudget({
    workerId: params.actor.userId,
    conversationTokensSpent: conversation.tokens_input + conversation.tokens_output,
  });
  if (!budget.allowed) {
    return closeWithFallback(params.conversationId, budget.reason ?? 'budget', 'none');
  }

  // The L1 router itself is the next piece of work (Step 5). The provider
  // seam, budget gate, redaction and executor it needs are all in place and
  // proven, so this is a single file rather than a layer.
  //
  // Deliberately NOT stubbed with a fake call: a plausible-looking
  // implementation nobody has run against the real Messages API is exactly
  // how an API-shape defect ships unnoticed.
  logger.info('Chatbot L1 route reached but router not implemented', {
    requestId: params.requestId,
  });
  return {
    reply: renderUnrecognized(),
    status: ChatbotConversationStatus.IN_PROGRESS,
    route: 'none',
  };
}

async function closeWithFallback(
  conversationId: string,
  reason: string,
  route: TurnResult['route']
): Promise<TurnResult> {
  const prisma = getPrisma();
  await prisma.chatbotConversation.update({
    where: { id: conversationId },
    data: {
      status: ChatbotConversationStatus.FALLBACK_TRIGGERED,
      closed_at: new Date(),
    },
  });
  return {
    reply: renderBudgetFallback(reason),
    status: ChatbotConversationStatus.FALLBACK_TRIGGERED,
    route,
    fallbackReason: reason,
  };
}

export { recordSpend };
