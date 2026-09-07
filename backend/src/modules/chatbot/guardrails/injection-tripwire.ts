import { logger } from '../../../lib/logger.js';

/**
 * A TRIPWIRE, NOT A GATE.
 *
 * This observes and reports. It never refuses a turn, never alters routing,
 * and nothing downstream reads its verdict to decide anything. That is a
 * deliberate design constraint, not an unfinished state, and it must not be
 * "upgraded" into a filter later without reopening `ADR-074`.
 *
 * WHY IT DOES NOT BLOCK. Every prompt-injection classifier that exists is
 * bypassable -- rephrasing, translation, encoding and indirection all defeat
 * pattern matching -- so a blocking filter buys very little security and
 * charges two real costs for it. It refuses legitimate messages (a worker
 * writing "ignore that, I meant Tuesday" is not an attacker), and, far worse,
 * it becomes the control people believe in. Once a filter is in the request
 * path, the structural guarantees stop being audited, because the filter is
 * assumed to have caught anything dangerous. `ADR-074` names that failure
 * directly and refuses to rely on detection.
 *
 * WHAT IT IS FOR. The containment posture is sound but was, until now,
 * SILENT: a hundred probes against the assistant produced no signal anywhere.
 * Containment tells you an attack could not succeed; it does not tell you one
 * was attempted. This closes that gap and nothing else.
 *
 * WHY THAT IS SAFE TO GET WRONG IN BOTH DIRECTIONS. A false positive costs a
 * log line. A false negative costs a log line that was not written. Neither
 * changes what the platform will do, because what stops an attack is the
 * permission-filtered manifest, the forbidden-argument invariant, identity
 * re-derived from the session, the owning module's own authorization, and
 * confirmation on irreversible writes. This is instrumentation on top of
 * those, never a substitute for one.
 */

export type InjectionSignal =
  | 'instruction_override'
  | 'role_claim'
  | 'system_prompt_probe'
  | 'identifier_injection'
  | 'tool_coercion';

export interface TripwireVerdict {
  /** True when anything matched. Reported only; nothing branches on it. */
  tripped: boolean;
  signals: InjectionSignal[];
}

/**
 * Patterns are matched against FOLDED text (lowercased, umlauts expanded) so
 * German attempts are caught by the same rules as English ones. The live
 * battery includes "Ignoriere alle vorherigen Anweisungen"; catching that in
 * English only would have been a comfortable illusion.
 */
const PATTERNS: Array<{ signal: InjectionSignal; test: RegExp }> = [
  {
    signal: 'instruction_override',
    test: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|all|your)\b[^.]{0,20}\b(instruction|rule|prompt|anweisung|regel)/i,
  },
  { signal: 'instruction_override', test: /\b(ignoriere|vergiss)\b[^.]{0,40}\banweisung/i },
  {
    signal: 'instruction_override',
    test: /\b(developer mode|god mode|jailbreak|unrestricted|dan mode|system override)\b/i,
  },
  // A closing tag for a section the user is not inside is an attempt to break
  // out of the prompt's structure, not something a person types by accident.
  { signal: 'instruction_override', test: /<\/?\s*(system|instructions?|prompt)\s*>/i },

  {
    signal: 'role_claim',
    test: /\b(i am|i'm|my role is|you are now|act as|pretend to be|du bist jetzt|ich bin)\b[^.]{0,30}\b(admin|administrator|manager|cto|ceo|superuser|root|owner)\b/i,
  },
  { signal: 'role_claim', test: /\b(set|change|elevate)\b[^.]{0,20}\b(my|your)\b[^.]{0,15}\b(role|permission|scope)/i },

  { signal: 'system_prompt_probe', test: /\b(repeat|print|show|reveal|output|what is)\b[^.]{0,25}\b(system prompt|your instructions|your rules|initial prompt)/i },

  // An identifier in free text is never something the platform asked for --
  // every tool takes names, and ids are forbidden arguments.
  { signal: 'identifier_injection', test: /\b(worker_?id|user_?id|hotel_?id|actor_?id)\b\s*[:=]?\s*["']?[\w-]{2,}/i },

  { signal: 'tool_coercion', test: /\bcall\b[^.]{0,20}\b[a-z_]+\.[a-z_]+\b/i },
  { signal: 'tool_coercion', test: /\b(if it is not in your list|even if you cannot|bypass|without confirmation)\b/i },
];

/** Same folding the L0 router uses, so one rule covers both languages. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

/** Inspects one user message. Pure: no I/O, no state, no decision. */
export function inspectForInjection(text: string): TripwireVerdict {
  const folded = fold(text);
  const signals = new Set<InjectionSignal>();

  for (const { signal, test } of PATTERNS) {
    if (test.test(folded)) signals.add(signal);
  }

  return { tripped: signals.size > 0, signals: [...signals] };
}

/**
 * Records an attempt, and returns nothing a caller could branch on.
 *
 * THE MESSAGE ITSELF IS NEVER LOGGED. It is user-authored free text that may
 * contain a person's own personal data, and `ADR-033` governs what may be
 * retained; a security log is not a licence to store conversation content.
 * What is recorded is which SIGNALS fired and how long the message was --
 * enough to see a campaign, count probes, and alert, without turning the
 * tripwire into an unretained transcript store.
 *
 * `void` return type is deliberate and load-bearing: it makes "block on this"
 * impossible to write without changing the signature, which is a change a
 * reviewer would notice.
 */
export function recordInjectionAttempt(params: {
  text: string;
  actorId: string;
  actorRole: string;
  conversationId: string;
}): void {
  let verdict: TripwireVerdict;
  try {
    verdict = inspectForInjection(params.text);
  } catch {
    return; // an instrument must never break what it measures
  }
  if (!verdict.tripped) return;

  // SWALLOWED ON PURPOSE. This is observability sitting in the request path of
  // every turn, and it must not be able to fail the turn it is watching -- an
  // assistant that breaks BECAUSE someone attacked it has handed the attacker
  // a denial of service through the monitoring. Found by a test: the logger
  // reads configuration, and in a context where that is not loaded this threw
  // and took the whole turn with it.
  try {
    logger.warn('chatbot_injection_signal', {
      // No message content. See above.
      signals: verdict.signals,
      signal_count: verdict.signals.length,
      message_length: params.text.length,
      actor_id: params.actorId,
      actor_role: params.actorRole,
      conversation_id: params.conversationId,
      // States the posture in the log line itself, so nobody reading an alert
      // at 3am concludes the request was stopped. It was not.
      contained_by: 'permission-filtered manifest, forbidden-argument invariant, session-derived identity, owning-module authorization, confirmation gate',
      action_taken: 'none — observed only (ADR-074)',
    });
  } catch {
    // Nothing to do and nowhere to report it: the reporting channel is what
    // failed. Losing a warning is strictly better than losing the turn.
  }
}
