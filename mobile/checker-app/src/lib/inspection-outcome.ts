/**
 * What a checker may do with the inspection they have just filled in.
 *
 * The rating screen used to end in one button, "Submit rating", which wrote a
 * Rating and nothing else. That recorded a score without ever recording a
 * decision: whether the room was acceptable, or had to be redone. The two
 * outcomes are now the two buttons, which is how a checker actually thinks
 * about the end of an inspection.
 *
 * The constraint that makes this non-trivial is the server's, not this
 * screen's. `QualityVerification.status` is DERIVED from the score
 * (backend/src/modules/quality/service.ts createVerification) — a client
 * cannot choose it — and `assignRework` rejects a PASSED verification with
 * `Cannot assign rework for a passed inspection`. So "assign rework" is only
 * possible below the passing threshold, and offering it above that would be a
 * button whose only possible outcome is a 400 after the checker has filled in
 * the entire form.
 *
 * Pure and separate from the screen so it is testable: this project's jest
 * config collects logic from `.test.ts`, so a rule left inside a component is
 * untested by construction.
 */

/**
 * Mirrors the server's threshold in
 * `backend/src/modules/quality/service.ts` (`numScore >= 70 -> PASSED`).
 * Pinned by inspection-outcome-match-server.test.ts, which reads that file —
 * the same guard the checklist keys already carry, and for the same reason:
 * a silently drifted constant here produces a 400 naming a rule the checker
 * cannot see.
 */
export const PASSING_SCORE = 70;

export type InspectionOutcome = 'complete' | 'rework';

export type ReworkBlockedReason =
  /** No valid overall score yet — nothing to decide about. */
  | 'NO_SCORE'
  /** The score passes, so by definition there is nothing to redo. */
  | 'PASSING_SCORE'
  /** Rework notes are what the worker is actually sent; an empty one is useless. */
  | 'NO_COMMENT';

export interface OutcomeAvailability {
  reworkAllowed: boolean;
  /** Why not, so the screen can say it rather than just greying a button out. */
  reworkBlockedReason: ReworkBlockedReason | null;
}

/**
 * @param overall the overall score as entered, or null when absent/unparsed
 * @param comment the comment field, which doubles as the rework notes
 *
 * The comment is deliberately reused rather than asking for rework notes in a
 * second box. `assignRework` requires non-empty notes and sends them to the
 * worker as the push body and the notification message — which is exactly
 * what "anything the worker should know" already asks for. Two fields would
 * ask the same question twice and leave the checker guessing which one the
 * worker actually reads.
 */
export function resolveOutcomeAvailability(
  overall: number | null,
  comment: string
): OutcomeAvailability {
  if (overall === null || !Number.isInteger(overall) || overall < 0 || overall > 100) {
    return { reworkAllowed: false, reworkBlockedReason: 'NO_SCORE' };
  }
  if (overall >= PASSING_SCORE) {
    return { reworkAllowed: false, reworkBlockedReason: 'PASSING_SCORE' };
  }
  if (comment.trim() === '') {
    return { reworkAllowed: false, reworkBlockedReason: 'NO_COMMENT' };
  }
  return { reworkAllowed: true, reworkBlockedReason: null };
}
