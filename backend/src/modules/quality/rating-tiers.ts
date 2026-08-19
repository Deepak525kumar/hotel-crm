/**
 * TREQ-003 / TRULE-003 (CONFIRMED §15): a worker's 0-100 overall rating is
 * presented with a tier label. The five names are confirmed; the thresholds
 * were the open half of OQ-08 and were decided by the project owner on
 * 2026-08-20.
 *
 * The cuts are NOT new numbers. Each one already existed in this codebase as
 * a behavioural threshold, and reusing them is the point -- a tier that
 * disagreed with the system's own verdicts would be worse than no tier at all:
 *
 *   70  RULE-004's PASSED boundary, and #498's first warning
 *   50  #498's severe warning
 *   40  RULE-004's FAILED boundary
 *
 * So "High" means "passing inspections", "Probation" means "failing them",
 * and a worker can never be told they are Standard while every check they get
 * comes back FAILED. If RULE-004's thresholds are ever changed, change these
 * with them -- the shared constants below are the seam for that.
 */

export const TIER_THRESHOLD_ELITE = 90;
export const TIER_THRESHOLD_HIGH = 70;
export const TIER_THRESHOLD_STANDARD = 50;
export const TIER_THRESHOLD_LOW = 40;

export const RATING_TIERS = ['ELITE', 'HIGH', 'STANDARD', 'LOW', 'PROBATION'] as const;
export type RatingTier = (typeof RATING_TIERS)[number];

/**
 * Derived on read, never stored.
 *
 * A `rating_tier` column would be a second copy of information already fully
 * determined by `average_score`, with its own way to go stale -- which is
 * exactly the dual-writer hazard (OQ-04) that migration
 * 20260727020000_drop_rating_overall_trigger was created to remove. Deriving
 * costs four comparisons and cannot disagree with the score it came from.
 *
 * Callers must not pass a score for a worker with zero ratings: `average_score`
 * is 0 in that case, which would label an unrated worker PROBATION. Use
 * `deriveRatingTier(score, total_ratings)` and let it return null.
 */
export function deriveRatingTier(
  average_score: number,
  total_ratings: number
): RatingTier | null {
  // Unrated is not a tier. A brand-new worker has average_score 0, and
  // labelling them "Probation" would be a fabricated accusation on their first
  // day -- the leaderboard and the mobile profile both render this directly.
  if (total_ratings <= 0) return null;

  if (average_score >= TIER_THRESHOLD_ELITE) return 'ELITE';
  if (average_score >= TIER_THRESHOLD_HIGH) return 'HIGH';
  if (average_score >= TIER_THRESHOLD_STANDARD) return 'STANDARD';
  if (average_score >= TIER_THRESHOLD_LOW) return 'LOW';
  return 'PROBATION';
}
