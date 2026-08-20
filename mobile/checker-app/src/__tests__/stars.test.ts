import { starsFromScore, starString, MAX_STARS } from '@/lib/stars';

/**
 * Regression for a display bug that shipped when ADR-026 rescaled
 * Rating.score from 1-5 to 0-100: the leaderboard rendered
 * `'★'.repeat(Math.round(average_score))`, so a worker on 87 got 87 stars.
 */
describe('starsFromScore (0-100 -> 0-5)', () => {
  it('never returns more than five stars, at any score in range', () => {
    // The actual bug, stated as an invariant rather than as one example.
    for (let score = 0; score <= 100; score++) {
      const n = starsFromScore(score);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(MAX_STARS);
    }
  });

  it('maps the boundaries and midpoint as expected', () => {
    expect(starsFromScore(0)).toBe(0);
    expect(starsFromScore(50)).toBe(3); // 2.5 rounds up
    expect(starsFromScore(100)).toBe(5);
  });

  it('clamps out-of-range input instead of rendering an unbounded string', () => {
    // Not hypothetical: completion_rate and on_time_rate have both exceeded
    // 100% in this system's real data. The bound belongs at the point of use.
    expect(starsFromScore(150)).toBe(MAX_STARS);
    expect(starsFromScore(-10)).toBe(0);
  });

  it('renders zero stars for non-finite input rather than crashing the row', () => {
    expect(starsFromScore(NaN)).toBe(0);
    expect(starsFromScore(undefined as unknown as number)).toBe(0);
  });

  it('always renders exactly five glyphs', () => {
    // The old code produced a variable-length string; the column is fixed
    // width, which is how 87 stars wrecked the layout.
    for (const score of [0, 1, 37, 50, 87, 99, 100, 150, -5, NaN]) {
      expect([...starString(score)]).toHaveLength(MAX_STARS);
    }
  });

  it('87 renders four stars, not eighty-seven', () => {
    expect(starString(87)).toBe('★★★★☆');
  });
});
