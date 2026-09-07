import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../lib/errors.js';

/**
 * STRUCTURED TOOL FAILURES.
 *
 * A tool that fails must tell the caller three separate things, because they
 * lead to three different next moves:
 *
 *   WHAT went wrong        -> `code`
 *   WHETHER to try again   -> `retryable`
 *   WHAT TO DO INSTEAD     -> `nextAction`
 *
 * Returning `{}` or a bare string collapses all three into "something broke",
 * and the predictable result is a model that retries an invalid input forever
 * or gives up on a transient blip. The failure TYPE is the useful signal, not
 * the failure itself.
 *
 * WHY `nextAction` IS A SEPARATE FIELD FROM `retryable`. They are not the same
 * question and conflating them loses information. A permission failure is not
 * retryable AND there is nothing to fix -- the answer is to stop and say so. A
 * missing resource is not retryable either, but the right move is to ASK for a
 * different identifier. Both are `retryable: false`; they need opposite
 * behaviour.
 *
 * THE MODEL IS TOLD, NOT TRUSTED. `nextAction` is guidance rendered into the
 * reply, and nothing enforces that the model honours it -- if it retries an
 * invalid input anyway, the executor's own gate rejects the call again, the
 * turn budget bounds the loop, and the tool-call log records every attempt.
 * This is a usability contract, never a security one; the security controls
 * are elsewhere and do not depend on the model reading this.
 */

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'TEMPORARY'
  | 'INTERNAL';

/**
 * What the caller should do next. Deliberately a closed set: an open-ended
 * hint would be prose, and prose is what this exists to replace.
 */
export type ToolNextAction =
  /** The arguments were wrong. Correct them; do NOT resend the same call. */
  | 'fix_input'
  /** Transient. The same call may succeed shortly. */
  | 'retry'
  /** Only a person can resolve this -- a fuller name, a different day. */
  | 'ask_user'
  /** Nothing to fix and nothing to retry. Report it and stop. */
  | 'stop'
  /** Something is broken beyond this conversation. Report it and stop. */
  | 'escalate';

export interface ToolError {
  code: ToolErrorCode;
  /** Safe to show a person. Never carries ids, stack traces or SQL. */
  message: string;
  retryable: boolean;
  nextAction: ToolNextAction;
}

/** The rule table, kept as data so the mapping is inspectable and testable. */
const SEMANTICS: Record<ToolErrorCode, { retryable: boolean; nextAction: ToolNextAction }> = {
  // The arguments themselves are wrong. Resending them changes nothing, and a
  // model that retries an invalid call is the single most expensive failure
  // mode available -- it burns the turn budget producing the same rejection.
  INVALID_INPUT: { retryable: false, nextAction: 'fix_input' },

  // The thing asked for is not there. Not a retry: the platform is working and
  // the answer will be the same next second. A person can supply another name.
  NOT_FOUND: { retryable: false, nextAction: 'ask_user' },

  // Several things matched. Guessing would act on the wrong person, so this is
  // always a question back, never a choice made here.
  AMBIGUOUS: { retryable: false, nextAction: 'ask_user' },

  // Authorization. Retrying is pointless and asking the user to rephrase is
  // worse -- it invites them to try to talk their way around a control that
  // exists on purpose. Report plainly and stop.
  FORBIDDEN: { retryable: false, nextAction: 'stop' },

  // A business rule refused it: already checked in, absence already marked, a
  // shift already finished. The state is what it is; the person decides.
  CONFLICT: { retryable: false, nextAction: 'stop' },

  // Genuinely transient -- a provider timeout, a throttle, a dropped
  // connection. The ONLY code where trying again is the right instinct.
  TEMPORARY: { retryable: true, nextAction: 'retry' },

  // Unrecognised. Fails to the SAFE side: not retryable, and escalated rather
  // than presented as something the user can fix. An unknown fault treated as
  // retryable is how a bug becomes a retry storm against a broken dependency.
  INTERNAL: { retryable: false, nextAction: 'escalate' },
};

export function toolError(code: ToolErrorCode, message: string): ToolError {
  return { code, message, ...SEMANTICS[code] };
}

/**
 * Classifies a thrown error into the structured shape.
 *
 * Uses the platform's own error CLASSES rather than matching on message text.
 * Message strings are written for humans, get rewritten, get translated, and
 * matching on them produces a classifier that silently degrades to INTERNAL
 * the first time somebody improves the wording.
 *
 * The MESSAGE is passed through only for the classes whose text is
 * deliberately user-facing (a validation complaint, a not-found, a business
 * conflict). Anything unrecognised gets a generic message instead: an
 * unclassified error can carry a stack trace, a connection string or a raw
 * driver fault, and none of that may reach a conversation.
 */
export function classifyToolError(error: unknown): ToolError {
  if (error instanceof ValidationError) {
    return toolError('INVALID_INPUT', error.message);
  }
  if (error instanceof NotFoundError) {
    return toolError('NOT_FOUND', error.message);
  }
  if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
    // Message passed through: these are written to be read by the person who
    // hit them ("Can only check in to your own assignment").
    return toolError('FORBIDDEN', error.message);
  }
  if (error instanceof ConflictError) {
    return toolError('CONFLICT', error.message);
  }

  // Transient faults arrive as ordinary Errors from clients we do not own, so
  // these are matched by NAME and code, not by prose.
  const name = error instanceof Error ? error.name : '';
  const code = (error as { code?: string } | null)?.code ?? '';
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE)$/.test(code)
  ) {
    return toolError('TEMPORARY', 'The service did not respond in time. Please try again.');
  }

  return toolError('INTERNAL', 'Something went wrong on our side.');
}

/**
 * One line of guidance for the reply, derived from the code.
 *
 * Written for the person, not the model: they are the one who has to do
 * something. "Please try again in a moment" is actionable; "TEMPORARY /
 * retryable: true" is not.
 */
export function describeToolError(error: ToolError): string {
  switch (error.nextAction) {
    case 'retry':
      return `${error.message} Please try again in a moment.`;
    case 'ask_user':
      return error.message;
    case 'fix_input':
      return `${error.message} Please rephrase with the correct details.`;
    case 'escalate':
      return `${error.message} Please tell an administrator if it keeps happening.`;
    case 'stop':
    default:
      return error.message;
  }
}
