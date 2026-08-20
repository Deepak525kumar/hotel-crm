import {
  RECENCY_WINDOW,
  RECENT_WEIGHT,
  LIFETIME_WEIGHT,
  blendRecencyWeightedScore,
} from '../modules/quality/recency-weighting';
import {
  deriveRatingTier,
  TIER_THRESHOLD_ELITE,
  TIER_THRESHOLD_HIGH,
  TIER_THRESHOLD_STANDARD,
  TIER_THRESHOLD_LOW,
} from '../modules/quality/rating-tiers';

describe('recency-weighted overall rating (TREQ-004, OQ-02/OQ-08)', () => {
  it('weights the last 10 at 0.7 and lifetime at 0.3', () => {
    // 20 checks at 40, then 10 at 90. Lifetime mean = 56.67.
    const recent = Array(10).fill(90);
    const lifetime = (20 * 40 + 10 * 90) / 30;
    expect(blendRecencyWeightedScore(recent, lifetime, 30)).toBeCloseTo(
      0.7 * 90 + 0.3 * lifetime,
      6
    );
  });

  it('lets a worker who improved actually recover', () => {
    const lifetime = (20 * 40 + 10 * 90) / 30;
    const plainAverage = lifetime;
    const weighted = blendRecencyWeightedScore(Array(10).fill(90), lifetime, 30);
    // This is the entire point of the requirement: under the old plain
    // average this worker sat at ~57 forever.
    expect(plainAverage).toBeLessThan(60);
    expect(weighted).toBeGreaterThan(75);
  });

  it('drops fast when a good worker starts failing', () => {
    const lifetime = (20 * 90 + 10 * 40) / 30;
    const weighted = blendRecencyWeightedScore(Array(10).fill(40), lifetime, 30);
    expect(weighted).toBeLessThan(lifetime);
    expect(weighted).toBeCloseTo(0.7 * 40 + 0.3 * lifetime, 6);
  });

  it('collapses to the plain mean below the window, so no jump at the 10th rating', () => {
    // With fewer than RECENCY_WINDOW ratings both terms cover the same set,
    // so 0.7x + 0.3x === x. A worker's score must not lurch when their 10th
    // rating lands.
    for (const n of [1, 5, 9, RECENCY_WINDOW]) {
      const scores = Array(n).fill(73);
      expect(blendRecencyWeightedScore(scores, 73, n)).toBeCloseTo(73, 6);
    }
  });

  it('weights sum to 1, so the result can never leave 0-100', () => {
    expect(RECENT_WEIGHT + LIFETIME_WEIGHT).toBeCloseTo(1, 9);
    const max = blendRecencyWeightedScore(Array(10).fill(100), 100, 50);
    const min = blendRecencyWeightedScore(Array(10).fill(0), 0, 50);
    expect(max).toBeLessThanOrEqual(100);
    expect(min).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for an unrated worker rather than dividing by zero', () => {
    expect(blendRecencyWeightedScore([], null, 0)).toBe(0);
    expect(blendRecencyWeightedScore([], undefined, 0)).toBe(0);
  });

  it('falls back to the lifetime average if the window read came back empty', () => {
    // Guards a specific way this could go wrong: 0.7 * mean([]) === 0 would
    // silently cut every worker's rating by 70%, and it would look like a
    // plausible score rather than an obvious failure.
    expect(blendRecencyWeightedScore([], 80, 12)).toBe(80);
  });
});

describe('rating tiers (TREQ-003, OQ-08 thresholds)', () => {
  it('maps each band to its confirmed label', () => {
    expect(deriveRatingTier(100, 5)).toBe('ELITE');
    expect(deriveRatingTier(TIER_THRESHOLD_ELITE, 5)).toBe('ELITE');
    expect(deriveRatingTier(TIER_THRESHOLD_ELITE - 0.01, 5)).toBe('HIGH');
    expect(deriveRatingTier(TIER_THRESHOLD_HIGH, 5)).toBe('HIGH');
    expect(deriveRatingTier(TIER_THRESHOLD_HIGH - 0.01, 5)).toBe('STANDARD');
    expect(deriveRatingTier(TIER_THRESHOLD_STANDARD, 5)).toBe('STANDARD');
    expect(deriveRatingTier(TIER_THRESHOLD_STANDARD - 0.01, 5)).toBe('LOW');
    expect(deriveRatingTier(TIER_THRESHOLD_LOW, 5)).toBe('LOW');
    expect(deriveRatingTier(TIER_THRESHOLD_LOW - 0.01, 5)).toBe('PROBATION');
    expect(deriveRatingTier(0, 5)).toBe('PROBATION');
  });

  it('never labels an unrated worker PROBATION', () => {
    // average_score is 0 for a brand-new worker. Labelling that "Probation"
    // on the leaderboard is a fabricated accusation on their first day.
    expect(deriveRatingTier(0, 0)).toBeNull();
  });

  it('keeps the cuts aligned with the thresholds already in the code', () => {
    // If RULE-004's PASSED/FAILED boundaries or #498's warning levels move,
    // these must move with them -- a worker must never be shown a tier that
    // contradicts the verdicts they are actually receiving.
    expect(TIER_THRESHOLD_HIGH).toBe(70); // RULE-004 PASSED, and warning_70
    expect(TIER_THRESHOLD_STANDARD).toBe(50); // warning_50
    expect(TIER_THRESHOLD_LOW).toBe(40); // RULE-004 FAILED
  });
});

describe('interaction with #498 threshold warnings (volatility)', () => {
  // Not a defect in either feature on its own, but a real consequence of
  // combining them, recorded so it is a known property rather than a surprise.
  //
  // #498 sends QUALITY_RATING_WARNING_70 when the score crosses below 70 and
  // CLEARS the flag once it recovers, so the warning re-arms. Under the old
  // plain lifetime average that crossing was nearly unreachable twice -- the
  // score moved glacially once a worker had any history. Recency weighting
  // makes it genuinely volatile: 70% of the score is the last ten jobs, so
  // one replaced rating moves it by 0.07 x delta.
  it('one swapped rating moves the score ~7% of the delta, so 70 can be recrossed', () => {
    const lifetime = 70;
    const good = Array(10).fill(72);
    const withOneBad = [22, ...Array(9).fill(72)];

    const before = blendRecencyWeightedScore(good, lifetime, 40);
    const after = blendRecencyWeightedScore(withOneBad, lifetime, 40);

    // 0.7 * (50/10) = 3.5 points from a single check.
    expect(before - after).toBeCloseTo(3.5, 6);

    // And that is enough to cross the warning threshold in one step.
    expect(before).toBeGreaterThanOrEqual(70);
    expect(after).toBeLessThan(70);
  });

  it('a worker hovering near the threshold can cross it repeatedly', () => {
    // Sequence: recover above 70, dip below, recover, dip. Each downward
    // crossing re-sends the warning, because #498 clears the flag on recovery.
    // For the <50 band that notification also goes to the Regional Manager.
    const lifetime = 70;
    const scores = [
      blendRecencyWeightedScore(Array(10).fill(75), lifetime, 40),
      blendRecencyWeightedScore([20, ...Array(9).fill(75)], lifetime, 40),
      blendRecencyWeightedScore(Array(10).fill(75), lifetime, 40),
      blendRecencyWeightedScore([20, ...Array(9).fill(75)], lifetime, 40),
    ];

    const crossings = scores.filter(
      (s, i) => i > 0 && scores[i - 1] >= 70 && s < 70
    ).length;

    expect(crossings).toBe(2);
  });
});
