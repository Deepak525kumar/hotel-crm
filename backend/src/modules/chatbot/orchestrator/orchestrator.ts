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
import { getProvider, ProviderUnavailableError } from '../provider/llm-provider.js';
import { matchL0, resolveCommandId } from './router-l0.js';
import { buildMessages, buildSystemPrompt, toolSpec, visibleTools } from './router-l1.js';
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
 *   L1  free text              → 1 LLM call, tools filtered to the actor
 *   L2  tool execution         → 0 LLM calls, via the executor's five-step gate
 *   L3  complex/multi-step     → not implemented
 *
 * With no provider configured, L0 still works completely and free text
 * degrades to the confirmed fallback (RULE-CHAT-03 / REQ-CHAT-007) rather
 * than erroring -- a tapped chip answers correctly with zero spend, and that
 * remains true whether or not a provider is wired.
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

  // ---- L1: one model call -------------------------------------------------
  //
  // The model is shown ONLY the tools this actor could already use by hand
  // (visibleTools). That is not the authorization control -- the executor
  // re-derives everything below and would refuse anything wrongly admitted --
  // but it keeps an injected or confused model from naming a capability the
  // user does not have, and it keeps a Worker from paying for an Admin's
  // tool schemas on every turn.
  const tools = visibleTools(params.actor);
  const turnIndex = conversation.turn_count;

  let completion;
  try {
    completion = await provider.completeWithTools({
      system: buildSystemPrompt(params.actor, tools),
      messages: buildMessages(params.text ?? ''),
      tools: tools.map(toolSpec),
      // Reads and chat run on the fast model. The planning tier is reserved
      // for the write path, which does not exist yet.
      tier: 'fast',
    });
  } catch (error) {
    // Provider failure is a fallback, never a 500 (RULE-CHAT-03). Recorded
    // with a distinct reason from budget exhaustion so OD-CHAT-012 stays an
    // open decision rather than being foreclosed by a shared code path.
    if (error instanceof ProviderUnavailableError) {
      return closeWithFallback(params.conversationId, 'provider-unavailable', 'none');
    }
    throw error;
  }

  // Spend is recorded BEFORE the tool runs and regardless of what happens
  // next. The tokens were spent the moment the provider answered; charging
  // them only on success would let a loop of failing turns run free against
  // a cap whose whole purpose is to bound spend.
  await recordSpend({
    promptTokens: completion.usage.promptTokens,
    completionTokens: completion.usage.completionTokens,
  });

  // ---- No tool: the model answered in prose -------------------------------
  if (!completion.toolUse) {
    await prisma.chatbotConversation.update({
      where: { id: params.conversationId },
      data: {
        turn_count: { increment: 1 },
        tokens_input: { increment: completion.usage.promptTokens },
        tokens_output: { increment: completion.usage.completionTokens },
      },
    });
    return {
      reply: completion.text || renderUnrecognized(),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'L1',
    };
  }

  // ---- L2: the model asked for a tool -------------------------------------
  //
  // `completion.toolUse.input` is raw model output and is treated as hostile:
  // it goes to the executor as `rawArgs`, which parses it with the tool's own
  // strict Zod schema and rejects forbidden keys. Nothing here inspects or
  // repairs it first -- a "helpful" fixup in this file would be a second,
  // weaker validator sitting in front of the real one.
  const outcome = await executeTool({
    toolName: completion.toolUse.name,
    rawArgs: completion.toolUse.input,
    actor: params.actor,
    requestId: params.requestId,
  });

  const registered = resolveTool(completion.toolUse.name);
  await recordToolCall({
    conversationId: params.conversationId,
    turnIndex,
    toolName: completion.toolUse.name,
    tier: registered?.tier ?? 'READ_ONLY',
    args: (completion.toolUse.input ?? {}) as Record<string, unknown>,
    confirmed: false,
    outcome,
  });

  await prisma.chatbotConversation.update({
    where: { id: params.conversationId },
    data: {
      turn_count: { increment: 1 },
      tokens_input: { increment: completion.usage.promptTokens },
      tokens_output: { increment: completion.usage.completionTokens },
    },
  });

  if (outcome.status === 'DENIED') {
    // The denial reason is deliberately NOT echoed to the user. It names
    // internal tokens and scope rules, and a refusal that explains exactly
    // which permission was missing is a probing oracle.
    logger.info('chatbot_l1_tool_denied', {
      tool: completion.toolUse.name,
      denial_code: outcome.denialCode,
      requestId: params.requestId,
    });
    return {
      reply: renderDenied(),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'L1',
      toolInvoked: completion.toolUse.name,
    };
  }

  // Rendered deterministically from the tool's own compressed result -- there
  // is no second model call to phrase it. Redaction runs first, so
  // special-category values become presence booleans and never reach the
  // reply. A second model call here would also be the point where tool data
  // could re-enter a prompt as instructions.
  const safe = redact(outcome.result);
  return {
    reply: renderToolResult(safe),
    status: ChatbotConversationStatus.IN_PROGRESS,
    route: 'L1',
    toolInvoked: completion.toolUse.name,
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
