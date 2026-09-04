import type { CompactResult } from '../tools/registry.js';

/**
 * Deterministic response rendering.
 *
 * For a structured read, a second model call to write prose is strictly worse
 * on all three axes: it doubles tokens and latency, and it adds a surface
 * where the model can describe a shift that is not in the result set. The
 * tool already returned exactly the facts; rendering them is string work.
 *
 * Free-text synthesis is reserved for L3, where the question genuinely needs
 * reasoning over multiple results.
 */

export function renderToolResult(result: CompactResult): string {
  return result.summary;
}

export function renderBudgetFallback(reason: string): string {
  // Deliberately does not blame the worker or expose the cap's value.
  switch (reason) {
    case 'conversation-cap-exhausted':
      return 'This conversation has reached its limit. Please use the checklist to continue.';
    case 'daily-user-cap-exhausted':
      return 'You have reached today’s assistant limit. Please use the checklist to continue.';
    default:
      return 'The assistant is unavailable right now. Please use the checklist to continue.';
  }
}

export function renderProviderUnavailable(): string {
  return 'The assistant cannot answer free-text questions right now. You can still use the quick commands.';
}

export function renderDenied(): string {
  // One message for every denial reason: which specific gate refused is not
  // something the caller should be able to probe for.
  return 'You do not have access to that.';
}

export function renderUnrecognized(): string {
  return 'I did not understand that. Try one of the quick commands.';
}


/**
 * What the user is asked to approve.
 *
 * Rendered DETERMINISTICALLY from the same parsed arguments the confirmation
 * token hashes -- never phrased by a second model call. That equality is
 * what makes the confirmation meaningful: whatever a person reads here is
 * exactly what the token authorises, so an argument cannot change between
 * the sentence they approved and the call that runs.
 *
 * Arguments are listed rather than summarised in prose. A prose summary
 * would have to omit something to stay readable, and the omitted field is
 * precisely where a substituted value would hide.
 */
export function renderConfirmationRequest(toolName: string, args: unknown): string {
  const entries =
    args && typeof args === 'object' && !Array.isArray(args)
      ? Object.entries(args as Record<string, unknown>)
      : [];

  const lines = entries
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

  return [
    `This will run: ${toolName}`,
    ...(lines.length > 0 ? lines : ['  (no arguments)']),
    '',
    'Nothing has been changed yet. Confirm to go ahead, or cancel.',
  ].join('\n');
}
