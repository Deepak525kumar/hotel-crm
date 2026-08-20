/**
 * Star rendering for a 0-100 quality score.
 *
 * The leaderboard used to do `'★'.repeat(Math.round(average_score))`, which was
 * written when Rating.score was 1-5. ADR-026 rescaled scores to 0-100 and this
 * display was never updated, so a worker on 87 rendered EIGHTY-SEVEN stars into
 * a narrow column, with `'☆'.repeat(Math.max(0, 5 - 87))` contributing none --
 * the Math.max floor is what kept it from throwing, and so from being noticed.
 *
 * Five stars is the intended display, so the score is scaled rather than used
 * as a count.
 */
export const MAX_STARS = 5;
const SCORE_MAX = 100;

/**
 * Filled-star count for a 0-100 score, always within 0..MAX_STARS.
 *
 * Clamped rather than trusted. This codebase has shipped out-of-range
 * aggregates more than once -- completion_rate and on_time_rate both exceeded
 * 100% in production-shaped data -- and the failure mode here is a UI that
 * renders an unbounded string, so the bound belongs at the point of use and
 * not only at the source. Non-finite input (a missing field arriving as
 * undefined, or 0/0 as NaN) renders as zero stars instead of crashing the row.
 */
export function starsFromScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  const scaled = Math.round((score / SCORE_MAX) * MAX_STARS);
  return Math.min(MAX_STARS, Math.max(0, scaled));
}

/** The literal string rendered: filled stars followed by hollow ones. */
export function starString(score: number): string {
  const filled = starsFromScore(score);
  return '★'.repeat(filled) + '☆'.repeat(MAX_STARS - filled);
}
