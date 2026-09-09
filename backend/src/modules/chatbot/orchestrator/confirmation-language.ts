/**
 * WHAT A PERSON TYPES INSTEAD OF TAPPING.
 *
 * The confirmation flow was reachable only by `confirmToken` -- the value the
 * UI's Confirm button sends. That is correct and stays correct, but it was the
 * ONLY way, and three ordinary things a person does had no handling at all:
 *
 *   "yes"              -> fell through to the model, which saw the word "yes"
 *                         with no antecedent and answered with confusion. The
 *                         approved write never ran.
 *   "no" / "cancel"    -> the same, AND the proposed write stayed parked in
 *                         session_state indefinitely.
 *   anything else      -> the proposal stayed parked too, so a Confirm tapped
 *                         much later could still execute a stale call the
 *                         person had long since moved on from.
 *
 * Typing rather than tapping is not an edge case here: these users are on
 * phones, mid-shift, often dictating.
 *
 * THIS IS NOT A WEAKENING OF THE CONFIRMATION GATE, and the distinction is
 * worth stating precisely because it looks like one. `ADR-053` item 5 requires
 * a human to approve the exact call; it does not require any particular
 * transport for that approval. The token's job is to stop a CLIENT tampering
 * with a value it holds -- and on this path the client holds nothing at all.
 * The call still comes from `session_state`, never from the request; the
 * actor still comes from `req.auth`; the same idempotency guard, the same
 * audit row, and the same execution path all run unchanged. A typed "yes"
 * approves exactly what was displayed, for the same reason a tapped Confirm
 * does.
 *
 * WHOLE-MESSAGE MATCHING, WHICH IS THE LOAD-BEARING PART. "yes" approves.
 * "yes but make it Friday" MUST NOT: it is a correction, and treating its
 * first word as consent would execute the call the person was in the middle
 * of changing. So a message counts as approval only when the ENTIRE message,
 * once punctuation is stripped, is an affirmative. Anything else is treated
 * as the person moving on, which clears the proposal rather than leaving it
 * armed.
 */

/** Lowercase, strip accents and punctuation, collapse spaces. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * German and English, because both are spoken on this platform every day.
 * Kept deliberately small: every entry here is a phrase that can mean nothing
 * except consent on its own, and a word that could begin a sentence with
 * another meaning does not belong in it.
 */
const APPROVE = new Set([
  'yes', 'y', 'yeah', 'yep', 'yup', 'yes please', 'ok', 'okay', 'k', 'sure',
  'confirm', 'confirmed', 'do it', 'go ahead', 'please do', 'thats right',
  'correct', 'right', 'proceed',
  // German
  'ja', 'ja bitte', 'jawohl', 'jo', 'passt', 'mach das', 'machen', 'bestatigen',
  'bestatigt', 'genau', 'richtig', 'weiter',
]);

const DECLINE = new Set([
  'no', 'n', 'nope', 'nah', 'no thanks', 'cancel', 'stop', 'dont', 'do not',
  'abort', 'forget it', 'never mind', 'nevermind', 'wrong',
  // German
  'nein', 'nee', 'ne', 'abbrechen', 'stopp', 'halt', 'lass es', 'falsch',
  'nicht',
]);

export type ConfirmationReply = 'approve' | 'decline' | 'unrelated';

/**
 * Classify a typed message while a confirmation is waiting.
 *
 * `unrelated` is the safe default and covers everything from a correction
 * ("yes but Friday") to a completely new question. The caller clears the
 * pending proposal on it: a person who has moved on has not approved
 * anything, and an armed proposal that outlives the exchange it belongs to is
 * exactly what makes a later stray tap dangerous.
 */
export function classifyConfirmationReply(text: string): ConfirmationReply {
  const normalized = normalize(text);
  if (normalized.length === 0) return 'unrelated';
  if (APPROVE.has(normalized)) return 'approve';
  if (DECLINE.has(normalized)) return 'decline';
  return 'unrelated';
}
