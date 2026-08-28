/**
 * What a checker may do with the inspection they have just filled in.
 *
 * The rating screen used to end in one button, "Submit rating", which wrote a
 * Rating and nothing else. That recorded a score without ever recording a
 * decision: whether the room was acceptable, or had to be redone. The two
 * outcomes are now the two buttons, which is how a checker actually thinks
 * about the end of an inspection.
 *
 * **The score does not gate the decision** (owner decision, 2026-08-29).
 * An earlier revision of this file only offered "assign rework" below the
 * server's passing threshold, because `assignRework` refused a PASSED
 * verification. That made the action a function of the number typed a moment
 * earlier: a checker who scored a room 75 and then saw something that had to
 * be redone could not say so. The score is a summary; the person standing in
 * the room is the authority. The server gate is gone, so this one is too.
 *
 * What remains is the one requirement the action genuinely has: rework notes.
 *
 * Pure and separate from the screen so it is testable: this project's jest
 * config collects logic from `.test.ts`, so a rule left inside a component is
 * untested by construction.
 */

export type InspectionOutcome = 'complete' | 'rework';

export type ReworkBlockedReason =
  /** Rework notes are what the worker is actually sent; an empty one is useless. */
  'NO_COMMENT';

export interface OutcomeAvailability {
  reworkAllowed: boolean;
  /** Why not, so the screen can say it rather than just greying a button out. */
  reworkBlockedReason: ReworkBlockedReason | null;
}

/**
 * @param comment the comment field, which doubles as the rework notes
 *
 * The comment is deliberately reused rather than asking for rework notes in a
 * second box. `assignRework` requires non-empty notes and sends them to the
 * worker as the push body and the notification message -- which is exactly
 * what "anything the worker should know" already asks for. Two fields would
 * ask the same question twice and leave the checker guessing which one the
 * worker actually reads.
 *
 * Note there is deliberately no `score` parameter. Adding one back is the
 * shape the removed gate had, so its absence is the guard.
 */
export function resolveOutcomeAvailability(comment: string): OutcomeAvailability {
  if (comment.trim() === '') {
    return { reworkAllowed: false, reworkBlockedReason: 'NO_COMMENT' };
  }
  return { reworkAllowed: true, reworkBlockedReason: null };
}
