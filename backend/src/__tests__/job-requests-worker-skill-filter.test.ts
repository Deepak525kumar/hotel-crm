import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * list() skill scoping for workers (2026-08-13).
 *
 * list() scoped a worker by hotel but never by SKILL, while acceptBroadcast()
 * hard-rejects a worker who does not hold the slot's skill (ForbiddenError,
 * "Cannot accept this broadcast"). A CLEANER browsing the board therefore saw
 * WAITER-only broadcasts and could only discover they were unacceptable by
 * tapping accept and getting a 403 -- the two methods disagreed about who can
 * take what.
 *
 * The filter must apply ONLY to broadcasts. A marketplace request carries no
 * skill slots and skill is not part of its acceptance path, so a bare `some`
 * filter would have hidden every marketplace request from every worker. That
 * regression is the main thing these tests pin down.
 *
 * Asserts the WHERE clause handed to Prisma rather than a filtered result set:
 * the filtering itself happens in the database, so the clause is the behaviour.
 */

const mockJobRequest = {
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  jobRequest: mockJobRequest,
  employmentRecord: mockEmploymentRecord,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../lib/roster-scope.js', () => ({
  listEligibleHotelIds: async () => ['h1'],
  listEligibleWorkerIds: async () => [],
  isWorkerEligibleForHotel: async () => true,
}));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { JobRequestService } from '../modules/job-requests/service.js';

const WORKER = { userId: 'w1', role: 'worker' };
const QUERY = { page: 1, per_page: 20 } as never;

const whereUsed = () => mockJobRequest.findMany.mock.calls[0][0].where;

describe('JobRequestService.list — worker skill scoping', () => {
  let service: JobRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockJobRequest.findMany.mockResolvedValue([]);
    mockJobRequest.count.mockResolvedValue(0);
    mockEmploymentRecord.findUnique.mockResolvedValue({ skills: ['CLEANER'] });
    service = new JobRequestService();
  });

  it("restricts a worker's broadcasts to slots matching a skill they hold", async () => {
    await service.list(QUERY, WORKER);
    expect(whereUsed().OR).toEqual(
      expect.arrayContaining([{ skill_slots: { some: { skill: { in: ['CLEANER'] } } } }])
    );
  });

  // The regression this fix could most easily have caused.
  it('still shows marketplace requests, which have no skill slots at all', async () => {
    await service.list(QUERY, WORKER);
    expect(whereUsed().OR).toEqual(
      expect.arrayContaining([{ skill_slots: { none: {} } }])
    );
  });

  // 2026-08-26: a broadcast slot with skill: null ("no specific skill
  // required") must be visible to every worker in scope, unconditionally --
  // not gated on the worker holding any particular skill (or any skill at
  // all). See computeBroadcastEligibility()/acceptBroadcast() for the same
  // null-means-everyone treatment on the read/accept side.
  it('always includes the "no specific skill required" branch, regardless of the worker\'s own skills', async () => {
    await service.list(QUERY, WORKER);
    expect(whereUsed().OR).toEqual(
      expect.arrayContaining([{ skill_slots: { some: { skill: null } } }])
    );
  });

  it('shows a worker with NO skills the marketplace rows and no-skill-required broadcasts, not every broadcast', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue({ skills: [] });
    await service.list(QUERY, WORKER);
    expect(whereUsed().OR).toEqual([
      { skill_slots: { none: {} } },
      { skill_slots: { some: { skill: null } } },
    ]);
  });

  it('treats a worker with no employment record the same as one with no skills', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(null);
    await service.list(QUERY, WORKER);
    expect(whereUsed().OR).toEqual([
      { skill_slots: { none: {} } },
      { skill_slots: { some: { skill: null } } },
    ]);
  });

  it('still applies the existing roster hotel scoping alongside the skill filter', async () => {
    await service.list(QUERY, WORKER);
    expect(whereUsed().hotel_id).toEqual({ in: ['h1'] });
  });

  // A checker is self-scoped too but does not accept broadcasts, so its
  // EmploymentRecord skills must not silently filter its board.
  it('does not skill-filter a checker', async () => {
    await service.list(QUERY, { userId: 'c1', role: 'checker' });
    expect(whereUsed().OR).toBeUndefined();
    expect(mockEmploymentRecord.findUnique).not.toHaveBeenCalled();
  });

  it('does not skill-filter an admin', async () => {
    await service.list(QUERY, { userId: 'a1', role: 'admin', scope: { type: 'global' } } as never);
    expect(whereUsed().OR).toBeUndefined();
  });
});
