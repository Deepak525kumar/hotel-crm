import { ChatbotConversationStatus } from '@prisma/client';
import { getEnv } from '../../../config/env.js';
import { getPrisma } from '../../../lib/db.js';
import { logger } from '../../../lib/logger.js';
import type { ActorContext } from '../tools/actor.js';
import { actorHasPermission, executeTool } from '../tools/executor.js';
import { findPriorCall, recordToolCall } from '../tools/tool-call-log.js';
import { asRefusal, describeToolError } from '../tools/tool-errors.js';
import { resolveTool, type CompactResult } from '../tools/registry.js';
import {
  actorHotelNames,
  actorLanguage,
  actorWorkerNames,
  precheckReferences,
} from './reference-precheck.js';
import { classifyConfirmationReply } from './confirmation-language.js';
import { buildObservation } from './observation.js';
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
  renderConversationClosed,
  renderDenied,
  renderIncompleteRequest,
  isUnbackedActionClaim,
  renderUnbackedClaim,
  renderProviderUnavailable,
  renderToolResult,
  renderUnrecognized,
  redactToolNames,
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

  // A FINISHED CONVERSATION IS NOT AN AUTHORIZATION FAILURE.
  //
  // Reported from production 2026-09-12, and the transcript is the whole
  // argument:
  //
  //     hello        -> You do not have access to that.
  //     hello        -> You do not have access to that.
  //     how are you  -> You do not have access to that.
  //
  // This branch used to return renderDenied(). Once a conversation closes --
  // a budget cap, the turn ceiling, closeWithFallback() -- EVERY later
  // message in it came back as an access refusal, for a greeting, forever.
  // The person is told they lack permission to say hello, which is both
  // false and unactionable: nothing they can do to their permissions will
  // change it, and the one thing that would fix it (start a new
  // conversation) is the one thing the message does not mention.
  //
  // The clients compound it -- they hold the conversation id until something
  // clears it, so every subsequent message goes back to the same dead
  // conversation. They now watch `status` and start a fresh one, but a
  // client that does not must still be told something TRUE here, because
  // this message is the only signal it gets.
  if (conversation.status !== ChatbotConversationStatus.IN_PROGRESS) {
    return { reply: renderConversationClosed(), status: conversation.status, route: 'none' };
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
  //
  // A TYPED reply reaches the same place, deterministically and without the
  // model: people on phones type "yes" instead of tapping Confirm, and until
  // 2026-09-10 that did nothing while leaving the write parked. See
  // confirmation-language.ts for why this does not weaken ADR-053 item 5 --
  // the call still comes from session_state, never the request.
  const waiting = readPendingConfirmation(conversation.session_state);
  const typedReply =
    waiting && !params.confirmToken && params.text
      ? classifyConfirmationReply(params.text)
      : 'unrelated';

  if (waiting && !params.confirmToken && typedReply === 'decline') {
    await clearPendingConfirmation(params.conversationId);
    return {
      reply: 'Cancelled. Nothing has been changed.',
      status: conversation.status,
      route: 'none',
    };
  }

  if (waiting && !params.confirmToken && typedReply === 'unrelated') {
    // They moved on -- a correction, or a new question entirely. Disarm the
    // proposal rather than leaving it to be confirmed by a stray tap later,
    // then let the message route normally.
    await clearPendingConfirmation(params.conversationId);
    logger.info('chatbot_pending_confirmation_abandoned', {
      tool: waiting.toolName,
      requestId: params.requestId,
    });
  }

  if (params.confirmToken || (waiting && typedReply === 'approve')) {
    const pending = readPendingConfirmation(conversation.session_state);
    if (!pending) {
      return {
        reply: 'There is nothing waiting to be confirmed.',
        status: conversation.status,
        route: 'none',
      };
    }

    try {
      // Only a token needs verifying. A typed approval carries no client-held
      // value to forge: the actor comes from req.auth and the call from
      // session_state, both re-derived server-side on this very request.
      if (params.confirmToken) {
        verifyConfirmToken(params.confirmToken, {
        actorId: params.actor.userId,
        conversationId: params.conversationId,
          turnIndex: pending.turnIndex,
          toolName: pending.toolName,
          args: pending.args,
        });
      }
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
  // A TYPED match is used only when this person may use its tool. Otherwise it
  // falls through to L1, which sees their own manifest: a worker asking "how
  // much work did we do" must not be answered "You do not have access to that"
  // by a router that never considered who was asking. A tapped chip keeps its
  // behaviour -- the manifest only offers chips the person can use.
  const typed = !params.commandId && params.text ? matchL0(params.text) : undefined;
  const typedTool = typed ? resolveTool(typed.tool) : undefined;
  const command = params.commandId
    ? resolveCommandId(params.commandId)
    : typed &&
        typedTool &&
        (typedTool.permission === null || actorHasPermission(params.actor, typedTool.permission))
      ? typed
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

  // Who this person is and what just happened -- the two things the model
  // was missing when it asked a manager the same question four turns running
  // (router-l1.ts PromptContext).
  // In parallel: three small scoped reads, so the prompt costs one round trip
  // rather than three.
  const [hotels, workers, language] = await Promise.all([
    actorHotelNames(params.actor),
    actorWorkerNames(params.actor),
    actorLanguage(params.actor),
  ]);
  const promptContext = {
    hotels,
    workers,
    language,
    lastAction: readLastAction(conversation.session_state),
  };

  // ---- THE TOOL LOOP -------------------------------------------------------
  //
  // A turn is no longer one model call. The model may read, see what came
  // back, and read again before answering -- so a question needing two
  // lookups ("who can cover Anna's shift tomorrow?") is answerable at all.
  // Before this, the first tool call was also the last, and the first answer
  // was assumed to be the right one.
  //
  // WRITES ARE NOT IN THE LOOP. A tool requiring confirmation still stops the
  // turn at the confirmation gate below and its result is never observed, so
  // no chained step can act on one. Only READ results re-enter, fenced by
  // `observation.ts`, which states what replaces `ADR-074`'s control 8.
  //
  // `messages` is the ONLY thing that grows. The system prompt, the tool
  // manifest and the actor are rebuilt from scratch on every step, so nothing
  // an earlier step produced can widen what a later one may do.
  const messages = buildMessages(params.text ?? '', history);
  const maxSteps = Math.max(1, env.CHATBOT_MAX_TOOL_CALLS_PER_TURN);

  /**
   * Every read already made this turn, by tool and arguments.
   *
   * THE GUARD THAT MAKES THE LOOP SAFE TO SHIP. A model that asks for the
   * same tool again -- because the answer did not contain what it hoped, or
   * simply out of habit -- would otherwise re-run it on every step: five
   * identical queries, five times the latency, for one question. The
   * observation text asks it not to, but asking is not a control.
   *
   * A repeat ENDS the loop and answers with the result already in hand. That
   * is the right outcome as well as the cheap one: a second identical read
   * returns identical data, so there is nothing further to learn from it.
   */
  const alreadyRead = new Map<string, CompactResult>();

  for (let step = 0; step < maxSteps; step += 1) {
  const isLastStep = step + 1 >= maxSteps;
  let completion;
  try {
    completion = await provider.completeWithTools({
      system: buildSystemPrompt(params.actor, tools, promptContext),
      messages,
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
    // Redacted before it leaves: the manifest is internal, and the model
    // has already been observed reciting it to a user (templates.ts).
    const spoken = redactToolNames(
      completion.text,
      tools.map((t) => t.name)
    );

    // No write ran in this turn (writes end the turn with their own summary),
    // so prose announcing a completed change is unbacked -- unless the
    // previous turn genuinely completed one. See templates.ts.
    if (spoken && !promptContext.lastAction?.ok && isUnbackedActionClaim(spoken)) {
      logger.warn('chatbot_unbacked_action_claim', {
        requestId: params.requestId,
        conversationId: params.conversationId,
      });
      return {
        reply: renderUnbackedClaim(),
        status: ChatbotConversationStatus.IN_PROGRESS,
        route: 'L1',
      };
    }

    return {
      reply: spoken || renderUnrecognized(),
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
      // SAY WHAT IS MISSING, not "did not catch that".
      //
      // Production, 2026-09-15: "cancel shift for parveen kumar 16 September"
      // came back "Sorry, I did not catch that." The request had been
      // understood perfectly well -- the model chose a write and filled in
      // most of it -- and the one thing wrong was an argument. Telling the
      // person they were not understood makes them rephrase the whole
      // sentence, when one word would have done. The labels are the same ones
      // the confirmation screen uses; the model's own values are not echoed.
      await prisma.chatbotConversation.update({
        where: { id: params.conversationId },
        data: {
          turn_count: { increment: 1 },
          tokens_input: { increment: completion.usage.promptTokens },
          tokens_output: { increment: completion.usage.completionTokens },
        },
      });
      return {
        reply: renderIncompleteRequest(
          proposed.name,
          parsedArgs.error.issues.map((issue) => String(issue.path[0] ?? ''))
        ),
        status: ChatbotConversationStatus.IN_PROGRESS,
        route: 'L1',
      };
    }

    // AND THE REFERENCES ARE RESOLVED SECOND.
    //
    // The parse above proves the arguments are well FORMED; it does not
    // prove the things they NAME exist. "hotel 1" is a valid string and was
    // shown to a manager for approval in production before anyone discovered
    // no such hotel was in their scope (reference-precheck.ts). A
    // confirmation has to state what will actually happen, so the lookup
    // belongs on this side of it.
    const references = await precheckReferences(
      proposed.args,
      parsedArgs.data as Record<string, unknown>,
      params.actor
    );

    if (references.status === 'REFUSED') {
      logger.info('chatbot_confirmation_reference_unresolved', {
        tool: proposed.name,
        requestId: params.requestId,
      });
      await prisma.chatbotConversation.update({
        where: { id: params.conversationId },
        data: {
          turn_count: { increment: 1 },
          tokens_input: { increment: completion.usage.promptTokens },
          tokens_output: { increment: completion.usage.completionTokens },
        },
      });
      // No pending confirmation is written: there is nothing to confirm, and
      // parking an impossible call would let a later "yes" resurrect it.
      return {
        reply: references.message,
        status: ChatbotConversationStatus.IN_PROGRESS,
        route: 'L1',
      };
    }

    // Canonical names from here on, so what the person reads is what runs.
    const confirmedArgs = references.args;

    // AND THE THING IT ACTS ON MUST EXIST. See `ToolRegistration.precheck`:
    // a real worker and a real day can still have no shift to cancel, and a
    // confirmation for that is the same fiction the reference check closed.
    //
    // A precheck that THROWS does not block: it is an early warning, and the
    // tool repeats every check at execution. Failing the turn over it would
    // trade a slightly later refusal for no answer at all.
    if (proposed.precheck) {
      let blocked: ReturnType<typeof asRefusal> = null;
      try {
        const reparsed = proposed.args.safeParse(confirmedArgs);
        if (reparsed.success) {
          blocked = asRefusal(await proposed.precheck(reparsed.data, params.actor));
        }
      } catch (error) {
        logger.warn('chatbot_tool_precheck_failed', {
          tool: proposed.name,
          requestId: params.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (blocked) {
        await prisma.chatbotConversation.update({
          where: { id: params.conversationId },
          data: {
            turn_count: { increment: 1 },
            tokens_input: { increment: completion.usage.promptTokens },
            tokens_output: { increment: completion.usage.completionTokens },
          },
        });
        return {
          reply: blocked.message,
          status: ChatbotConversationStatus.IN_PROGRESS,
          route: 'L1',
        };
      }
    }

    await writePendingConfirmation(params.conversationId, {
      toolName: proposed.name,
      args: confirmedArgs,
      turnIndex,
    });

    const token = issueConfirmToken({
      actorId: params.actor.userId,
      conversationId: params.conversationId,
      turnIndex,
      toolName: proposed.name,
      args: confirmedArgs,
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
      reply: renderConfirmationRequest(proposed.name, confirmedArgs),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'L1',
      pendingConfirmation: {
        token,
        summary: renderConfirmationRequest(proposed.name, confirmedArgs),
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

  // A read this turn has already made returns what it returned. See
  // `alreadyRead`: re-running it costs a query and cannot change the answer.
  const callKey = `${completion.toolUse.name}:${JSON.stringify(completion.toolUse.input ?? {})}`;
  const repeated = alreadyRead.get(callKey);
  if (repeated) {
    logger.info('chatbot_tool_loop_repeat_stopped', {
      tool: completion.toolUse.name,
      step,
      requestId: params.requestId,
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
      reply: renderToolResult(repeated),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'L1',
      toolInvoked: completion.toolUse.name,
    };
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

    // BAD ARGUMENTS ARE NOT A PERMISSION PROBLEM.
    //
    // Live end-to-end run, 2026-09-15: a manager typed "I want make id more
    // next employe", the model chose the new-account tool without a name, the
    // executor rejected the arguments -- and the manager, who holds every
    // permission that tool needs, was told "You do not have access to that."
    // Nothing about their access was wrong; one detail was missing. The same
    // correction the confirmation path received applies here: name what is
    // still needed. Only argument LABELS are named, never a value, and no
    // other denial code is softened -- those stay one uniform message.
    if (outcome.denialCode === 'INVALID_ARGS' && l1Tool) {
      const parsed = l1Tool.args.safeParse(completion.toolUse.input ?? {});
      const missing = parsed.success ? [] : parsed.error.issues.map((issue) => String(issue.path[0] ?? ''));
      return {
        reply: renderIncompleteRequest(completion.toolUse.name, missing),
        status: ChatbotConversationStatus.IN_PROGRESS,
        route: 'L1',
        toolInvoked: completion.toolUse.name,
      };
    }

    return {
      reply: renderDenied(),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'L1',
      toolInvoked: completion.toolUse.name,
    };
  }

  // Rendered deterministically from the tool's own compressed result. The
  // SUMMARY is never phrased by a model -- what a person reads is still built
  // in code from the tool's own output. What changed on 2026-09-10 is that
  // the structured DATA may go back to the model for a further READ, fenced
  // by observation.ts; the sentence the user sees does not come from there.
  if (outcome.status === 'FAILED') {
    // The tool ran and the owning service refused or a dependency failed.
    // The person is told what happened and what to do about it; the CODE
    // decided which of those two it is (tool-errors.ts).
    await writeLastAction(params.conversationId, { tool: completion.toolUse.name, ok: false });
    return {
    reply: describeToolError(outcome.error),
    status: ChatbotConversationStatus.IN_PROGRESS,
    route: 'L1',
    toolInvoked: completion.toolUse.name,
    };
  }

  // Recorded so the NEXT turn knows this already happened. Only the label and
  // the outcome -- never the result.
  await writeLastAction(params.conversationId, { tool: completion.toolUse.name, ok: true });

  const safe = redact(outcome.result);

  // THE STEP THAT MAKES THIS A LOOP.
  //
  // A read whose budget still has room goes back to the model as fenced data
  // instead of straight to the user, so it can decide whether that actually
  // answered the question. On the last allowed step the result is the answer:
  // there is no budget left to check it, and a summary the person can read
  // beats an admission that we ran out of steps.
  //
  // Redaction runs BEFORE this, so special-category values are already
  // presence booleans by the time observation.ts sees them -- the fence
  // narrows further, it does not have to catch those.
  alreadyRead.set(callKey, safe);

  // SOME RESULTS ARE THE ANSWER, WORD FOR WORD.
  //
  // Found by the live end-to-end run of 2026-09-15. Two results went back into
  // the loop and the model rewrote them:
  //
  //   - the new-account tool's reply carried the pre-filled form LINK; the
  //     model's rewrite said "The account for Mukesh Kumar has been started"
  //     -- false -- and dropped the link, the one thing the manager needed;
  //   - the work summary's exact counts and ISO dates came back as the model's
  //     own prose, in its own date format.
  //
  // The rule this file's comments already state -- the sentence a person reads
  // is built in code, not phrased by a model -- held only on the LAST step.
  // It now holds wherever it matters:
  //
  //   - a WRITE that ran (only unconfirmed low-risk writes reach here): it has
  //     happened, and its summary is the authoritative record of what; there is
  //     nothing further to look up before telling the person;
  //   - a tool registered with `finalAnswer`: its summary must reach the person
  //     unaltered -- a link, or numbers people act on.
  //
  // Ordinary reads still loop, so "who can cover Anna tomorrow?" can still take
  // two lookups.
  if (l1Tool && (l1Tool.tier !== 'READ_ONLY' || l1Tool.finalAnswer)) {
    return {
      reply: renderToolResult(safe),
      status: ChatbotConversationStatus.IN_PROGRESS,
      route: 'L1',
      toolInvoked: completion.toolUse.name,
    };
  }

  if (!isLastStep) {
    messages.push({ role: 'user', content: buildObservation(completion.toolUse.name, safe) });
    continue;
  }

  logger.info('chatbot_tool_loop_exhausted', {
    steps: maxSteps,
    tool: completion.toolUse.name,
    requestId: params.requestId,
  });

  return {
    reply: renderToolResult(safe),
    status: ChatbotConversationStatus.IN_PROGRESS,
    route: 'L1',
    toolInvoked: completion.toolUse.name,
  };
  }

  // Unreachable: every path inside the loop either returns or continues, and
  // the last iteration always returns. Present because TypeScript cannot see
  // that, and because falling through silently would be worse than saying so.
  return {
    reply: renderUnrecognized(),
    status: ChatbotConversationStatus.IN_PROGRESS,
    route: 'L1',
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
/**
 * What the previous turn ran, read back from structured session state.
 *
 * Deliberately only the tool LABEL and whether it worked. The result is not
 * stored and never reaches a prompt: that is `ADR-074` §5's boundary, and
 * "you already did X" needs none of it to stop the model repeating X.
 */
function readLastAction(sessionState: unknown): { tool: string; ok: boolean } | null {
  const state = sessionState as Record<string, unknown> | null;
  const last = state?.['last_action'] as Record<string, unknown> | undefined;
  if (!last) return null;
  const tool = last['tool'];
  const ok = last['ok'];
  if (typeof tool !== 'string' || typeof ok !== 'boolean') return null;
  return { tool, ok };
}

async function writeLastAction(
  conversationId: string,
  action: { tool: string; ok: boolean }
): Promise<void> {
  try {
    const prisma = getPrisma();
    const fresh = await prisma.chatbotConversation.findUnique({
      where: { id: conversationId },
      select: { session_state: true },
    });
    const state = (fresh?.session_state as Record<string, unknown> | null) ?? {};
    await prisma.chatbotConversation.update({
      where: { id: conversationId },
      data: {
        session_state: { ...state, last_action: { tool: action.tool, ok: action.ok } } as never,
      },
    });
  } catch {
    // Continuity is an enhancement; losing it must not fail a turn that
    // otherwise succeeded.
  }
}

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
