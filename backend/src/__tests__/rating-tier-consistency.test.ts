import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Review regressions for TREQ-003/004, found by inspection rather than by a
 * failing test. Both are the kind of defect a passing suite hides.
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockWorkerOverallRating = {
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({ workerOverallRating: mockWorkerOverallRating }),
}));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { AnalyticsService } from '../modules/analytics/service.js';
import { TIER_THRESHOLD_ELITE, TIER_THRESHOLD_HIGH } from '../modules/quality/rating-tiers.js';

function row(average_score: number, total_ratings = 12) {
  return {
    worker_id: 'w1',
    average_score,
    total_ratings,
    total_assignments: 10,
    completion_rate: 1,
    worker: { first_name: 'A', last_name: 'B' },
  };
}

describe('leaderboard tier never contradicts the score shown beside it', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService();
  });

  // The response rounds average_score to 2dp for display but used to derive
  // the tier from the RAW value, so a single payload could read
  // `average_rating: 90, rating_tier: "HIGH"` -- the badge looking broken to
  // anyone reading the row. Every boundary has this 0.005-wide window.
  it.each([
    [TIER_THRESHOLD_ELITE - 0.0045, 'ELITE'],
    [TIER_THRESHOLD_HIGH - 0.0045, 'HIGH'],
  ])('score %p rounds up across a boundary and the tier follows it', async (raw, expected) => {
    mockWorkerOverallRating.findMany.mockResolvedValue([row(raw)]);
    const [entry] = await service.getLeaderboard();

    // The invariant, stated directly: the tier must be the tier of the number
    // actually returned. Asserting the pair rather than either half is what
    // makes this robust to the rounding precision changing.
    expect(entry.rating_tier).toBe(expected);
    expect(entry.average_rating).toBe(
      expected === 'ELITE' ? TIER_THRESHOLD_ELITE : TIER_THRESHOLD_HIGH
    );
  });

  it('does not round a score UP into a tier it has not reached', async () => {
    // 89.99 rounds to 89.99, still below 90 -- must stay HIGH. Guards against
    // "fixing" the above by rounding to zero decimals.
    mockWorkerOverallRating.findMany.mockResolvedValue([row(89.99)]);
    const [entry] = await service.getLeaderboard();
    expect(entry.average_rating).toBe(89.99);
    expect(entry.rating_tier).toBe('HIGH');
  });

  it('leaves an unrated worker without a tier even at score 0', async () => {
    mockWorkerOverallRating.findMany.mockResolvedValue([row(0, 0)]);
    const [entry] = await service.getLeaderboard();
    expect(entry.rating_tier).toBeNull();
  });
});

describe('recency window has an index that makes it bounded', () => {
  it('declares the compound (worker_id, created_at) index on QualityVerification', () => {
    // refreshWorkerOverallRating() runs
    //   WHERE worker_id = ? ORDER BY created_at DESC LIMIT 10
    // inside a transaction holding FOR UPDATE on the worker's User row.
    //
    // The separate worker_id and created_at indexes are not enough: for a
    // worker whose ratings are not the newest rows, the planner scans
    // created_at backwards and filters, walking the whole table. Measured on
    // 210k rows: 27.3ms vs 0.063ms. The planner's cost estimate does not
    // reflect it, so it will not self-correct as data grows.
    //
    // Asserted against the schema text because there is no cheaper way to
    // catch the index being dropped -- and dropping it degrades silently,
    // with every test still green.
    const schema = readFileSync(
      join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
      'utf8'
    );
    // Sliced on a line that is exactly `}` rather than the next `}`
    // character: the model carries field comments containing literal braces,
    // which silently truncated an earlier version of this assertion to a
    // fragment that excluded the indexes -- a test that failed for the wrong
    // reason and would equally have PASSED for the wrong reason.
    //
    // Reads QualityVerification since the Rating merge (2026-08-29). The index
    // was carried across with the worker_id column in that migration, for the
    // identical query on the identical hot path.
    const lines = schema.split('\n');
    const start = lines.findIndex((l) => l.trim() === 'model QualityVerification {');
    expect(start).toBeGreaterThan(-1);
    const end = lines.findIndex((l, i) => i > start && l.trim() === '}');
    const model = lines.slice(start, end).join('\n');
    expect(model).toContain('@@index([worker_id, created_at])');
  });
});
