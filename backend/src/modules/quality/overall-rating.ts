/**
 * How a worker's headline rating is composed (owner decision, 2026-08-29).
 *
 *     overall = 0.7 x quality + 0.3 x attendance
 *
 * **Do not confuse this 70/30 with the other one.** `recency-weighting.ts`
 * also splits 70/30, but along a completely different axis: recent-10 versus
 * lifetime, *within* the quality figure (TREQ-004). The two compose —
 * recency-weighting produces the quality number, and this module then weighs
 * that number against attendance. Collapsing them, or reusing one module's
 * constants in the other, silently changes the meaning of every worker's
 * score.
 *
 *     recency-weighting:  quality  = 0.7 x mean(last 10 checks) + 0.3 x lifetime
 *     this module:        overall  = 0.7 x quality              + 0.3 x attendance
 */

/** Confirmed 2026-08-29. Must sum to 1. */
export const QUALITY_WEIGHT = 0.7;
export const ATTENDANCE_WEIGHT = 0.3;

/**
 * Attendance as a 0-100 figure: did the worker turn up for the shifts that
 * were actually theirs to turn up for.
 *
 * The denominator is COMPLETED + NO_SHOW and nothing else (owner decision,
 * 2026-08-29: "only completed and no show, nor should sick leave count nor
 * vacations"). Three exclusions, each deliberate:
 *
 *   - CANCELLED, including the rows a sick or vacation mark auto-creates.
 *     Declaring an absence in advance is not a failure to turn up, and
 *     counting it would make using the absence feature lower your score.
 *   - CONFIRMED / IN_PROGRESS, even once their day has passed. Those have no
 *     outcome yet; AssignmentNoShowJob resolves a stale one to NO_SHOW, at
 *     which point it counts. Counting an unresolved row would score a shift
 *     that has not finished.
 *   - Rework rows, which are a second row for work already counted once.
 *
 * Lateness does NOT reduce it (owner decision, 2026-08-29: "turned up"). A
 * worker who arrives late and works the shift scores the same as one who
 * arrives on time; lateness is visible separately as `on_time_rate`.
 *
 * Returns null when nothing is due yet — distinct from 0, which means "was
 * due and did not turn up".
 */
export function attendanceScore(completed: number, dueTotal: number): number | null {
  if (dueTotal <= 0) return null;
  return (completed / dueTotal) * 100;
}

/**
 * The stored headline rating, or null when it cannot honestly be stated.
 *
 * Null when the worker has never been inspected (owner decision, 2026-08-29:
 * blank, not a number). 70% of the formula has no input in that case, and
 * every way of faking it misinforms someone:
 *
 *   - treating quality as 0 caps a spotless new worker at 30, which trips the
 *     below-50 alert and pushes "your rating has dropped" to them and their
 *     regional manager before anyone has looked at their work;
 *   - dropping to attendance-only quietly reports a 100 that means "we have
 *     not checked", on the same scale where 100 elsewhere means "checked, and
 *     excellent".
 *
 * The caller renders null as "—" and skips tier and warning evaluation. That
 * is the convention already in the codebase (`deriveRatingTier` returns null
 * on zero ratings; the web leaderboard prints "—"), not a new one.
 *
 * Attendance being null is NOT the same case: a worker who has been inspected
 * but has no due shifts yet still has a real quality figure, so the rating is
 * that figure alone rather than a blend against nothing.
 */
export function blendQualityAndAttendance(
  quality: number | null,
  attendance: number | null
): number | null {
  if (quality === null) return null;
  if (attendance === null) return quality;
  return QUALITY_WEIGHT * quality + ATTENDANCE_WEIGHT * attendance;
}
