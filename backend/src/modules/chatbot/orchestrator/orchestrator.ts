import { ChatbotConversationStatus } from '@prisma/client';
import { getEnv } from '../../../config/env.js';
import { getPrisma } from '../../../lib/db.js';
import { logger } from '../../../lib/logger.js';
import type { ActorContext } from '../tools/actor.js';
import { executeTool } from '../tools/executor.js';
import { findPriorCall, recordToolCall } from '../tools/tool-call-log.js';
import { describeToolError } from '../tools/tool-errors.js';
import { resolveTool } from '../tools/registry.js';
import { checkBudget, recordSpend } from '../guardrails/budget.js';
import {
  ConfirmTokenError,
  issueConfirmToken,
  verifyConfirmToken,
} from '../guardrails/confirm-token.js';
import { recordInjectionAttempt } from '../guardrails/injection-tripwire.js';
import { recordTurn, replayableHistory } from '../memory/transcript.js';
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
  renderConfirmationRequest,
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
  /**
   * Set when a high-risk write is proposed and awaiting the user's approval
   * (ADR-053 item 5). The client renders `summary` and, if the user accepts,
   * sends `token` straight back as the next turn's only input.
   *
   * NOTHING HAS BEEN WRITTEN at this point -- the tool has not run.
   */
  pendingConfirmation?: {
    token: string;
    /** Exactly what will happen, rendered from the same args the token hashes. */
    summary: string;
    toolName: string;
  };
  toolInvoked?: string;
  fallbackReason?: string;
}

/**
 * One turn, with its transcript recorded.
 *
 * WRAPS the turn rather than calling `recordTurn` at each return point.
 * `executeTurn` has many exits -- L0, L1, confirmation, denial, failure,
 * fallback -- and a call placed at each one is a list that the next branch
 * forgets to join. Recording here means a path cannot be added that silently
 * skips the transcript.
 *
 * The reply is recorded on the SUCCESS path only. A turn that threw produced
 * no reply to store, and the user's own message is still written, so a failed
 * turn leaves the half that exists rather than nothing.
 */
export async function runTurn(params: {
  conversationId: string;
  actor: ActorContext;
  text?: string;
  commandId?: string;
  confirmToken?: string;
  requestId?: string;
}): Promise<TurnResult> {
  // Read BEFORE the turn: executeTurn increments turn_count, so reading after
  // would file the message under the following turn and break replay order.
  const turnIndex = await currentTurnIndex(params.conversationId);

  try {
    const result = await executeTurn(params);
    await recordTurn({
      conversationId: params.conversationId,
      turnIndex,
      userText: params.text,
      assistantText: result.reply,
    });
    return result;
  } catch (error) {
    await recordTurn({
      conversationId: params.conversationId,
      turnIndex,
      userText: params.text,
    });
    throw error;
  }
}

/** The conversation's current turn count, or 0 if it cannot be read. */
async function currentTurnIndex(conversationId: string): Promise<number> {
  const row = await getPrisma().chatbotConversation.findUnique({
    where: { id: conversationId },
    select: { turn_count: true },
  });
  return row?.turn_count ?? 0;
}

async function executeTurn(params: {
  conversationId: string;
  actor: ActorContext;
  /** Free text from the worker. Untrusted. */
  text?: string;
  /** Chip tap / slash command — resolved by id, no text parsing. */
  commandId?: string;
  /** The user approving a previously-proposed high-risk write. */
  confirmToken?: string;
  requestId?: string;
}): Promise<TurnResult> {
  const prisma = getPrisma();
  const env = getEnv();

  // OBSERVE ONLY. Records that an injection attempt was made; changes nothing
  // about what happens next, by design (ADR-074, ratified 2026-09-08). The
  // containment guarantees are what stop an attack -- this exists because
  // those guarantees were SILENT: a hundred probes produced no signal
  // anywhere, so nobody could tell the assistant was under attack.
  //
  // Placed before every branch so a probe is seen whether it lands on L0, L1
  // or a confirmation. Deliberately NOT awaited into a decision, and the
  // function returns void so "block on this" cannot be written without
  // changing its signature.
  if (params.text) {
    recordInjectionAttempt({
      text: params.text,
      actorId: params.actor.userId,
      actorRole: params.actor.role,
      conversationId: params.conversationId,
    });
  }

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

  // ---- Confirmation: the user approving a previously-proposed write --------
  //
  // The call being confirmed is read from session_state, NEVER from the
  // request. A client sends only the token, so there are no arguments to
  // tamper with on the way back -- the token then proves this actor, in this
  // conversation, on this turn, approved this exact call.
  if (params.confirmToken) {
    const pending = readPendingConfirmation(conversation.session_state);
    if (!pending) {
      return {
        reply: 'There is nothing waiting to be confirmed.',
        status: conversation.status,
        route: 'none',
      };
    }

    try {
      verifyConfirmToken(params.confirmToken, {
        actorId: params.actor.userId,
        conversationId: params.conversationId,
        turnIndex: pending.turnIndex,
        toolName: pending.toolName,
        args: pending.args,
      });
    } catch (error) {
      // The reason is logged, never shown. "Expired" is safe to say and
      // useful; the rest would tell someone probing exactly which claim
      // failed.
      const code = error instanceof ConfirmTokenError ? error.code : 'unknown';
      logger.warn('chatbot_confirmation_rejected', {
        code,
        tool: pending.toolName,
        requestId: params.requestId,
      });
      await clearPendingConfirmation(params.conversationId);
      return {
        reply:
          code === 'EXPIRED'
            ? 'That confirmation has expired. Please ask again.'
            : 'That confirmation could not be verified, so nothing was done.',
        status: conversation.status,
        route: 'none',
      };
    }

    // Cleared BEFORE executing: a token must not survive to be replayed if
    // the write itself throws partway through.
    await clearPendingConfirmation(params.conversationId);

    // Idempotency, the same guard L0 applies to its non-READ_ONLY calls.
    // Clearing the pending row above closes the ordinary double-tap, but it
    // is a read-then-write and two truly concurrent confirmations can both
    // pass it. `idempotencyKey` exists precisely so "a retry or double-tap
    // cannot execute a write twice"; without this the unique constraint only
    // stops the second LOG row, after the second write has already happened.
    // (Full concurrency safety for simultaneous turns is OD-CHAT-016, still
    // open. This narrows the window rather than closing it, and must not be
    // read as having closed it.)
    const alreadyRun = await findPriorCall({
      conversationId: params.conversationId,
      turnIndex: pending.turnIndex,
      toolName: pending.toolName,
      args: pending.args,
    });
    if (alreadyRun) {
      logger.info('chatbot_confirmed_tool_skipped_as_duplicate', {
        tool: pending.toolName,
        conversationId: params.conversationId,
        requestId: params.requestId,
      });
      return {
        reply: 'That is already done.',
        status: conversation.status,
        route: 'L1',
        toolInvoked: pending.toolName,
      };
    }

    // Wrapped HERE rather than inside executeTool, whose contract is that
    // invoke() errors propagate unchanged so a service's own ForbiddenError
    // surfaces as itself -- changing that would alter behaviour for every
    // caller, including the HTTP tool-invoke route.
    //
    // But on a CONFIRMED HIGH-RISK WRITE, an uncaught throw meant
    // recordToolCall was never reached, so a write the user explicitly
    // approved could fail leaving no audit row whatsoever. The attempt is
    // recorded, then the error is re-raised so callers and the HTTP layer
    // still see it -- the record is added, nothing is swallowed.
    let confirmedOutcome;
    try {
      confirmedOutcome = await executeTool({
        toolName: pending.toolName,
        rawArgs: pending.args,
        actor: params.actor,
        requestId: params.requestId,
        confirmed: true,
      });
    } catch (error) {
      logger.error('chatbot_confirmed_write_threw', {
        tool: pending.toolName,
        conversationId: params.conversationId,
        requestId: params.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      await recordToolCall({
        conversationId: params.conversationId,
        turnIndex: pending.turnIndex,
        toolName: pending.toolName,
        tier: resolveTool(pending.toolName)?.tier ?? 'HIGH_RISK_WRITE',
        args: pending.args as Record<string, unknown>,
        confirmed: true,
        outcome: {
          status: 'DENIED',
          reason: error instanceof Error ? error.message : 'tool execution failed',
          denialCode: 'EXECUTION_FAILED',
        },
      });
      throw error;
    }

    const registeredTool = resolveTool(pending.toolName);
    await recordToolCall({
      conversationId: params.conversationId,
      turnIndex: pending.turnIndex,
      toolName: pending.toolName,
      tier: registeredTool?.tier ?? 'HIGH_RISK_WRITE',
      args: pending.args as Record<string, unknown>,
      confirmed: true,
      outcome: confirmedOutcome,
    });

    if (confirmedOutcome.status === 'DENIED') {
      logger.info('chatbot_confirmed_tool_denied', {
        tool: pending.toolName,
        denial_code: confirmedOutcome.denialCode,
        requestId: params.requestId,
      });
      return { reply: renderDenied(), status: conversation.status, route: 'L1', toolInvoked: pending.toolName };
    }

    if (confirmedOutcome.status === 'FAILED') {
      // AUDITED EXACTLY LIKE A THROW. Classifying inside the executor turned
      // this path from an exception into a return value, and the audit row
      // that the catch block below writes was silently skipped as a result --
      // caught by the regression test that exists for precisely this. A
      // confirmed high-risk write that did not succeed must leave a record;
      // "nothing happened" and "we tried and it failed" are different facts,
      // and only one of them is visible without this row.
      await recordToolCall({
        conversationId: params.conversationId,
        turnIndex: pending.turnIndex,
        toolName: pending.toolName,
        tier: resolveTool(pending.toolName)?.tier ?? 'HIGH_RISK_WRITE',
        args: pending.args as Record<string, unknown>,
        confirmed: true,
        outcome: {
          status: 'DENIED',
          reason: confirmedOutcome.error.message,
          denialCode: 'EXECUTION_FAILED',
        },
      });

      return {
        reply: describeToolError(confirmedOutcome.error),
        status: conversation.status,
        route: 'L1',
        toolInvoked: pending.toolName,
      };
    }

    return {
      reply: renderToolResult(redact(confirmedOutcome.result)),
      status: conversation.status,
      route: 'L1',
      toolInvoked: pending.toolName,
    };
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

    if (outcome.status === 'FAILED') {
      // The tool ran and the owning service refused or a dependency failed.
      // The person is told what happened and what to do about it; the CODE
      // decided which of those two it is (tool-errors.ts).
      return {
        reply: describeToolError(outcome.error),
        status: ChatbotConversationStatus.IN_PROGRESS,
        route: 'L0',
        toolInvoked: command.tool,
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

  // The caller's OWN prior messages, for follow-ups like "no, make that
  // Tuesday". Never assistant turns: those carry tool output, which carries
  // other people's data (ADR-074 §5). `replayableHistory` filters on role in
  // the QUERY rather than afterwards, so the boundary cannot be refactored
  // away silently.
  const history = await replayableHistory(params.conversationId, turnIndex);

  let completion;
  try {
    completion = await provider.completeWithTools({
      system: buildSystemPrompt(params.actor, tools),
      messages: buildMessages(params.text ?? '', history),
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

  // ---- Confirmation gate: propose, do not execute --------------------------
  //
  // ADR-053 item 5 makes confirmation MANDATORY for high-risk writes,
  // regardless of what a tool registered as its preference. So this branch
  // sits before execution and cannot be opted out of by a tool definition.
  //
  // Nothing is written here. The call is parked in session_state, the user
  // is shown exactly what would happen, and the turn ends.
  const proposed = resolveTool(completion.toolUse.name);
  if (proposed?.confirm) {
    const proposedArgs = (completion.toolUse.input ?? {}) as Record<string, unknown>;

    // The args are parsed FIRST. Showing a summary built from unvalidated
    // model output would let the model describe a call that could never run,
    // and the user would be approving a fiction.
    const parsedArgs = proposed.args.safeParse(proposedArgs);
    if (!parsedArgs.success) {
      logger.info('chatbot_confirmation_args_invalid', {
        tool: proposed.name,
        requestId: params.requestId,
      });
      return {
        reply: renderUnrecognized(),
        status: ChatbotConversationStatus.IN_PROGRESS,
        route: 'L1',
      };
    }

    await writePendingConfirmation(params.conversationId, {
      toolName: proposed.name,
      args: parsedArgs.data,
      turnIndex,
    });

    const token = issueConfirmToken({
      actorId: params.actor.userId,
      conversationId: params.conversationId,
      turnIndex,
      toolName: proposed.name,
      args: parsedArgs.data,
    });

    await prisma.chatbotConversation.update({
      where: { id: params.conversationId },
      data: {
        turn_count: { increment: 1 },
        tokens_input: { increment: completion.usage.promptTokens },
        tokens_output: { increment: completion.usage.completionTokens },
      },
    });

    return {
      reply: renderConfirmationRequest(proposed.name, parsedArgs.data),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'L1',
      pendingConfirmation: {
        token,
        summary: renderConfirmationRequest(proposed.name, parsedArgs.data),
        toolName: proposed.name,
      },
    };
  }

  // ---- L2: the model asked for a tool -------------------------------------
  //
  // `completion.toolUse.input` is raw model output and is treated as hostile:
  // it goes to the executor as `rawArgs`, which parses it with the tool's own
  // strict Zod schema and rejects forbidden keys. Nothing here inspects or
  // repairs it first -- a "helpful" fixup in this file would be a second,
  // weaker validator sitting in front of the real one.
  // Same idempotency rule L0 applies, for the same reason: re-running a read
  // is harmless and re-running a write is not. A LOW_RISK_WRITE reaching L1
  // without this would execute twice on a retry.
  const l1Tool = resolveTool(completion.toolUse.name);
  if (l1Tool && l1Tool.tier !== 'READ_ONLY') {
    const priorL1 = await findPriorCall({
      conversationId: params.conversationId,
      turnIndex,
      toolName: completion.toolUse.name,
      args: completion.toolUse.input,
    });
    if (priorL1) {
      await prisma.chatbotConversation.update({
        where: { id: params.conversationId },
        data: {
          turn_count: { increment: 1 },
          tokens_input: { increment: completion.usage.promptTokens },
          tokens_output: { increment: completion.usage.completionTokens },
        },
      });
      return {
        reply: 'That is already done.',
        status: ChatbotConversationStatus.IN_PROGRESS,
        route: 'L1',
        toolInvoked: completion.toolUse.name,
      };
    }
  }

  const outcome = await executeTool({
    toolName: completion.toolUse.name,
    rawArgs: completion.toolUse.input,
    actor: params.actor,
    requestId: params.requestId,
  });

  const registered = l1Tool;
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
  if (outcome.status === 'FAILED') {
    // The tool ran and the owning service refused or a dependency failed.
    // The person is told what happened and what to do about it; the CODE
    // decided which of those two it is (tool-errors.ts).
    return {
    reply: describeToolError(outcome.error),
    status: ChatbotConversationStatus.IN_PROGRESS,
    route: 'L1',
    toolInvoked: completion.toolUse.name,
    };
  }

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


interface PendingConfirmation {
  toolName: string;
  args: unknown;
  turnIndex: number;
}

/**
 * Read the pending call from `session_state`.
 *
 * Structured state, never a transcript -- this holds a tool name and its
 * arguments, which is exactly what §12 permits there. Storing it server-side
 * rather than round-tripping it through the client is the point: there is
 * nothing for a client to alter between "here is what I will do" and "do it".
 */
function readPendingConfirmation(sessionState: unknown): PendingConfirmation | null {
  const state = sessionState as Record<string, unknown> | null;
  const pending = state?.['pending_confirmation'] as Record<string, unknown> | undefined;
  if (!pending) return null;
  const toolName = pending['tool_name'];
  const turnIndex = pending['turn_index'];
  if (typeof toolName !== 'string' || typeof turnIndex !== 'number') return null;
  return { toolName, args: pending['args'], turnIndex };
}

async function writePendingConfirmation(
  conversationId: string,
  pending: PendingConfirmation
): Promise<void> {
  // Re-read rather than using the row fetched at the start of the turn.
  // That row is already stale by the time a provider call has completed, and
  // spreading it back would silently revert any other session_state key
  // written meanwhile.
  const prisma = getPrisma();
  const fresh = await prisma.chatbotConversation.findUnique({
    where: { id: conversationId },
    select: { session_state: true },
  });
  const state = (fresh?.session_state as Record<string, unknown> | null) ?? {};
  await prisma.chatbotConversation.update({
    where: { id: conversationId },
    data: {
      session_state: {
        ...state,
        pending_confirmation: {
          tool_name: pending.toolName,
          args: pending.args,
          turn_index: pending.turnIndex,
        },
      } as never,
    },
  });
}

async function clearPendingConfirmation(conversationId: string): Promise<void> {
  const prisma = getPrisma();
  const row = await prisma.chatbotConversation.findUnique({
    where: { id: conversationId },
    select: { session_state: true },
  });
  const state = { ...((row?.session_state as Record<string, unknown> | null) ?? {}) };
  delete state['pending_confirmation'];
  await prisma.chatbotConversation.update({
    where: { id: conversationId },
    data: { session_state: state as never },
  });
}
