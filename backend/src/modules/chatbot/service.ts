import { ChatbotConversationStatus, ChatbotPurpose } from '@prisma/client';
import { BaseService } from '../../lib/base-service.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { runTurn, type TurnResult } from './orchestrator/orchestrator.js';
import type { ActorContext } from './tools/actor.js';
import { actorHasPermission, executeTool, type ExecutionOutcome } from './tools/executor.js';
import { listTools } from './tools/registry.js';
import type { ToolDescriptorDto } from './types.js';

// Registering the tool definitions is a side effect of importing them. Kept
// as one explicit import so the set of registered tools is greppable from
// this file rather than scattered across the module.
import './tools/definitions/self-service.tools.js';
import './tools/definitions/daily-operations.tools.js';
import './tools/definitions/reporting.tools.js';
import './tools/definitions/broadcast.tools.js';

/**
 * SPEC-CHATBOT-001 (ADR-013) — backend-chatbot's service.
 *
 * Scaffold stage: this exposes the tool executor and nothing else. There is
 * no conversation lifecycle, no prompt construction, and no provider call,
 * because no LLM credentials are configured. `IF-CHATBOT-StartConversation`
 * and `IF-CHATBOT-ExchangeMessage` are deliberately absent rather than
 * stubbed — an empty implementation of a specified interface is worse than
 * no implementation, since callers would bind to it.
 */
export class ChatbotService extends BaseService {
  /**
   * Execute one tool as the authenticated actor.
   *
   * Note the actor is an `ActorContext`, which can only be constructed from
   * `req.auth` (tools/actor.ts). There is no overload taking a bare user id:
   * that is the compile-time expression of SPEC-CHATBOT-001's MUST-level
   * precondition (FIND-SEC-R3-01) that a caller derive the worker id from
   * its own authenticated actor.
   */
  async invokeTool(
    toolName: string,
    rawArgs: unknown,
    actor: ActorContext,
    options?: { requestId?: string; ipAddress?: string }
  ): Promise<ExecutionOutcome> {
    const outcome = await executeTool({
      toolName,
      rawArgs,
      actor,
      requestId: options?.requestId,
    });

    // ADR-053 item 3 keeps domain auditing with the owning module — this row
    // is additional, not a replacement: the owning service records what the
    // domain did, this records that an AI-mediated path requested it.
    await this.logAudit(
      actor.userId,
      actor.role,
      'chatbot.tool.execute',
      'CHATBOT_TOOL_CALL',
      toolName,
      {
        tool: toolName,
        outcome: outcome.status,
        ...(outcome.status === 'DENIED' ? { denial_code: outcome.denialCode } : {}),
      },
      options?.ipAddress
    );

    return outcome;
  }

  /**
   * IF-CHATBOT-StartConversation.
   *
   * Takes an ActorContext, not a bare worker id — the compile-time expression
   * of SPEC-CHATBOT-001's MUST-level precondition (FIND-SEC-R3-01) that the
   * calling module derive the worker from its own authenticated actor. A
   * conversation is always for the actor themselves: initiating one *about*
   * another worker is exactly the still-open half of OD-CHAT-005, so it is
   * not expressible here.
   */
  async startConversation(
    actor: ActorContext,
    purpose: ChatbotPurpose = ChatbotPurpose.WORKFORCE_ASSISTANT
  ) {
    const conversation = await this.prisma.chatbotConversation.create({
      data: {
        worker_id: actor.userId,
        purpose,
        status: ChatbotConversationStatus.IN_PROGRESS,
        session_state: { turn_index: 0, actor_role: actor.role },
      },
    });

    await this.logAudit(
      actor.userId,
      actor.role,
      'chatbot.conversation.start',
      'CHATBOT_CONVERSATION',
      conversation.id,
      { purpose }
    );

    return conversation;
  }

  /** IF-CHATBOT-ExchangeMessage. Self-scoped; ownership re-checked in the orchestrator. */
  async exchangeMessage(
    conversationId: string,
    actor: ActorContext,
    input: { text?: string; commandId?: string; confirmToken?: string },
    options?: { requestId?: string }
  ): Promise<TurnResult> {
    return runTurn({
      conversationId,
      actor,
      text: input.text,
      commandId: input.commandId,
      confirmToken: input.confirmToken,
      requestId: options?.requestId,
    });
  }

  /**
   * IF-CHATBOT-GetConversationOutcome, mode (a) — the worker's own poll.
   * Returns the narrowed outcome only: no transcript crosses this boundary,
   * because transcript disclosure is still an open decision (OD-CHAT-008).
   */
  async getConversationOutcome(conversationId: string, actor: ActorContext) {
    const conversation = await this.prisma.chatbotConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, worker_id: true, status: true, purpose: true },
    });
    if (!conversation) throw new NotFoundError('Conversation not found');
    if (conversation.worker_id !== actor.userId) {
      throw new ForbiddenError('Cannot access this conversation');
    }
    return { id: conversation.id, status: conversation.status, purpose: conversation.purpose };
  }

  /**
   * The tools available to the caller. Filtered by the caller's live
   * permissions so the manifest never advertises a capability the actor
   * would be denied — and so a manifest read cannot be used to enumerate
   * capabilities belonging to other roles.
   */
  listAvailableTools(actor: ActorContext): ToolDescriptorDto[] {
    return listTools()
      .filter((tool) => {
        if (tool.permission === null) return true; // no token gates it
        // Delegated to the executor's OWN predicate, not reimplemented.
        // This WAS a third independent copy of that logic -- identical at the
        // time, and silently wrong the moment `anyOf` was added, because a
        // copy treats `{ anyOf: [...] }` as an array and matches nothing.
        // The manifest would then have hidden tools the executor would
        // happily run, which reads as the assistant being broken.
        return actorHasPermission(actor, tool.permission);
      })
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        tier: tool.tier,
        confirm: tool.confirm,
        interfaceRef: tool.interfaceRef,
        approvalRef: tool.approvalRef,
      }));
  }
}

export const chatbotService = new ChatbotService();
export { ForbiddenError };
