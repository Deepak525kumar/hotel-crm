/**
 * TREQ-004 / TRULE-004 (CONFIRMED §15): "Overall rating is recency-weighted
 * (last 10 jobs weighted most)." The requirement is confirmed; the exact
 * weighting function was the open half of OQ-02/OQ-08 and was decided by the
 * project owner on 2026-08-20 as a 70/30 blend.
 *
 *     overall = 0.7 * mean(last 10 ratings) + 0.3 * mean(all ratings)
 *
 * Why a blend rather than "last 10 only": discarding history entirely lets a
 * worker with fifty poor checks read as ELITE after ten good ones, which is
 * the same class of misinformation as the pre-2026-08-13 leaderboard bug. The
 * lifetime term keeps a long record visible while the recent term lets someone
 * who genuinely improved recover within about ten jobs, which is the point of
 * the requirement.
 *
 * Why not exponential decay: it has no cliff at the 10th job and is arguably
 * the nicer curve, but it needs every rating the worker has ever received on
 * every write -- the uncapped O(n) growth FIND-PERF-002 explicitly asks the
 * implementer of this function to avoid.
 *
 * This does NOT change the scale. `average_score` was already 0-100 (ADR-026
 * rescaled Rating.score), and stays 0-100. OQ-02 recorded this redefinition as
 * BREAKING because `work-applications` persisted a 1-5 `worker_rating_snapshot`
 * that would have to be migrated -- that module no longer exists (retired in
 * the pivot; verified absent from backend/src/modules on 2026-08-20). Every
 * surviving consumer -- analytics, the leaderboard, both mobile apps, the web
 * dashboard -- reads a 0-100 number and continues to.
 */

/** The "last 10 jobs" of TREQ-004. Also the LIMIT used to read them. */
export const RECENCY_WINDOW = 10;

/** Confirmed 2026-08-20. Must sum to 1. */
export const RECENT_WEIGHT = 0.7;
export const LIFETIME_WEIGHT = 0.3;

function mean(scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

/**
 * @param recentScores the most recent `RECENCY_WINDOW` scores, newest first
 *                     (order is irrelevant to the mean; the LIMIT is what matters)
 * @param lifetimeAverage Prisma's `_avg.score`, which is null when there are no ratings
 * @param totalRatings   Prisma's `_count`
 *
 * With fewer than `RECENCY_WINDOW` ratings the two means are computed over the
 * same set, so the blend collapses to that mean exactly -- no special case is
 * needed, and a worker's score does not jump when their 10th rating lands.
 */
export function blendRecencyWeightedScore(
  recentScores: number[],
  lifetimeAverage: number | null | undefined,
  totalRatings: number
): number {
  if (totalRatings <= 0 || lifetimeAverage == null) return 0;

  // Defensive: if the recent-window read was unavailable, fall back to the
  // lifetime average rather than silently reporting 0.7 * 0 and halving every
  // worker's rating. Returning a slightly stale-in-spirit number beats
  // fabricating a bad one.
  if (recentScores.length === 0) return lifetimeAverage;

  return RECENT_WEIGHT * mean(recentScores) + LIFETIME_WEIGHT * lifetimeAverage;
}
