import { getPrisma } from '../../../lib/db.js';
import { logger } from '../../../lib/logger.js';
import type { ExecutionOutcome } from './executor.js';
import { argsHash, idempotencyKey } from './executor.js';

/**
 * `ChatbotToolCall` persistence — the durable record of every tool the agent
 * ran, and the mechanism that makes writes idempotent.
 *
 * What is stored and what is NOT:
 *   - the tool name, tier, outcome, and a HASH of the arguments
 *   - never the argument VALUES, and never the result
 *
 * Arguments and results routinely carry personal data. Storing them here
 * would create a second copy of worker PII under different retention rules
 * from the owning module's own records — a GDPR problem invented for
 * debugging convenience. The hash plus the owning service's own AuditLog row
 * is enough to reconstruct "what was requested, by whom, when" in a dispute
 * (ADR-053 item 3 keeps domain auditing with the owning module).
 */

export interface RecordedToolCall {
  id: string;
  /** True when a prior identical call already ran and this one did not re-execute. */
  skippedAsDuplicate: boolean;
}

/**
 * Idempotency check, run BEFORE execution.
 *
 * The key binds conversation + turn + tool + canonical args, so a retried
 * request or a double-tapped confirmation cannot execute a write twice. A
 * read-only tool re-running is harmless, so this is only consulted for
 * writes — but the row is recorded for every tier, because the audit value
 * applies to reads too.
 */
export async function findPriorCall(params: {
  conversationId: string;
  turnIndex: number;
  toolName: string;
  args: unknown;
}): Promise<{ id: string; status: string } | null> {
  const prisma = getPrisma();
  const key = idempotencyKey(
    params.conversationId,
    params.turnIndex,
    params.toolName,
    params.args
  );
  const existing = await prisma.chatbotToolCall.findUnique({
    where: { idempotency_key: key },
    select: { id: true, status: true },
  });
  return existing ?? null;
}

export async function recordToolCall(params: {
  conversationId: string;
  turnIndex: number;
  toolName: string;
  tier: string;
  args: unknown;
  confirmed: boolean;
  outcome: ExecutionOutcome;
}): Promise<RecordedToolCall | null> {
  const prisma = getPrisma();
  const key = idempotencyKey(
    params.conversationId,
    params.turnIndex,
    params.toolName,
    params.args
  );

  // The column already documents four states (SUCCESS | DENIED | FAILED |
  // SKIPPED_IDEMPOTENT); until FAILED became a real ExecutionOutcome this
  // code could only ever produce two of them.
  //
  // Collapsing FAILED into DENIED loses the distinction the audit log exists
  // to preserve: DENIED means the executor's own gate stopped the call before
  // anything ran, FAILED means it ran and the owning service refused or a
  // dependency broke. Reading "denied" for a database outage would send an
  // investigation looking at permissions.
  const status =
    params.outcome.status === 'SUCCESS'
      ? 'SUCCESS'
      : params.outcome.status === 'FAILED'
        ? 'FAILED'
        : 'DENIED';

  try {
    const row = await prisma.chatbotToolCall.create({
      data: {
        conversation_id: params.conversationId,
        turn_index: params.turnIndex,
        tool_name: params.toolName,
        tier: params.tier,
        idempotency_key: key,
        args_hash: argsHash(params.args),
        confirmed: params.confirmed,
        status,
        // For a FAILED call this carries the structured error CODE
        // (CONFLICT, TEMPORARY, FORBIDDEN...), which is the fact an
        // investigation actually needs. Recording null here -- the behaviour
        // before FAILED was handled -- produced an audit row saying a call
        // was denied and refusing to say why.
        denial_reason:
          params.outcome.status === 'DENIED'
            ? params.outcome.denialCode
            : params.outcome.status === 'FAILED'
              ? params.outcome.error.code
              : null,
        // Kept for FAILED too: how long a call took before breaking is
        // exactly what distinguishes a timeout from an instant rejection.
        duration_ms:
          params.outcome.status === 'SUCCESS' || params.outcome.status === 'FAILED'
            ? params.outcome.durationMs
            : null,
      },
      select: { id: true },
    });
    return { id: row.id, skippedAsDuplicate: false };
  } catch (error) {
    // A unique-constraint collision on idempotency_key means a concurrent
    // request for the identical call already recorded it. That is the
    // mechanism working, not a failure — the caller should treat it as a
    // duplicate rather than surfacing an error to the worker.
    if (isUniqueViolation(error)) {
      logger.info('Chatbot tool call already recorded (idempotent)', {
        tool: params.toolName,
        conversationId: params.conversationId,
      });
      return { id: key, skippedAsDuplicate: true };
    }
    // The tool has already run at this point. Losing its log row must not
    // turn a successful action into an error for the worker, so this is
    // logged loudly rather than rethrown.
    logger.error('Failed to record chatbot tool call', {
      tool: params.toolName,
      conversationId: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}
