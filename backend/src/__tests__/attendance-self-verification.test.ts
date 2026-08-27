import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } as any,
}));

const findUnique = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const update = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

const prismaStub: any = {
  attendance: { findUnique, update },
  user: { findUnique: async () => null },
  hotel: { findUnique: async () => null },
  auditLog: { create: async () => ({}) },
  notification: { create: async () => ({ id: 'n1' }) },
  outboxEvent: { create: async () => ({ id: 'o1' }) },
  // The service wraps the write in a transaction; hand the callback a client
  // backed by the same mocks so the assertions see the real call.
  $transaction: async (fn: any) => fn(prismaStub),
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => prismaStub }));

import { AttendanceService } from '../modules/attendance/service.js';

/**
 * Nobody verifies their own attendance, and a checker does not verify anyone
 * else's either (2026-08-27: checkers do not verify attendance; the
 * cross-hotel management-branch access this module used to grant a checker
 * over OTHER workers' records was removed with the verification-queue
 * feature it existed to serve). isSelfScopedRole() now runs with no
 * override, so a checker lands on the self branch exactly like a worker.
 *
 * The original hole this file guards against, still true: before the first
 * fix here, a checker 644 minutes late PATCHed their OWN row to PRESENT,
 * minutes_late 0, is_verified true, with verified_by_id equal to worker_id.
 */
describe('attendance update: ownership beats role', () => {
  const service = new AttendanceService();
  const CHECKER = 'checker-1';

  const own = {
    id: 'att-own',
    assignment_id: 'asg-1',
    worker_id: CHECKER,
    hotel_id: 'h1',
    status: 'LATE',
    check_in_at: new Date('2026-08-27T16:00:00Z'),
    check_out_at: null,
    expected_start: new Date('2026-08-27T06:00:00Z'),
    minutes_late: 644,
    is_verified: false,
  };

  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    findUnique.mockResolvedValue(own);
  });

  it.each([
    ['is_verified', { is_verified: true }],
    ['status', { status: 'PRESENT' }],
    ['minutes_late', { minutes_late: 0 }],
    ['check_in_at', { check_in_at: '2026-08-27T06:00:00.000Z' }],
  ])('refuses a checker setting %s on their OWN record', async (_field, input) => {
    await expect(
      service.update('att-own', input as any, CHECKER, 'checker', null)
    ).rejects.toMatchObject({ message: expect.stringContaining('may only set') });
    expect(update).not.toHaveBeenCalled();
  });

  it("denies a checker acting on ANOTHER worker's attendance (self-scoped, not management)", async () => {
    findUnique.mockResolvedValue({ ...own, id: 'att-worker', worker_id: 'worker-9' });

    await expect(
      service.update('att-worker', { is_verified: true } as any, CHECKER, 'checker', null)
    ).rejects.toMatchObject({ message: expect.stringContaining("another worker's attendance") });
    expect(update).not.toHaveBeenCalled();
  });
});
