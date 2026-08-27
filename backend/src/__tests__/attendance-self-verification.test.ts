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
 * Nobody verifies their own attendance.
 *
 * `update()` puts a checker on the management branch
 * (`checkerIsSelfScoped: false`), which may set is_verified, status,
 * minutes_late and check_in_at. That was unreachable for one's own record
 * while POST /attendance was worker-only — a checker had no attendance row at
 * all. Admitting 'checker' to check-in created the row, and with it the
 * ability to mark oneself present and verified.
 *
 * Observed against a live database before the fix: a checker 644 minutes late
 * PATCHed their own row to PRESENT, minutes_late 0, is_verified true, with
 * verified_by_id equal to worker_id.
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

  it("leaves a checker's authority over ANOTHER worker's attendance intact", async () => {
    // The regression risk of the fix: over-restricting and breaking the
    // verification queue, which is the checker's actual job.
    findUnique.mockResolvedValue({ ...own, id: 'att-worker', worker_id: 'worker-9' });
    update.mockResolvedValue({
      ...own, id: 'att-worker', worker_id: 'worker-9', is_verified: true,
      created_at: new Date(), updated_at: new Date(), verified_at: new Date(),
      verified_by_id: CHECKER, minutes_worked: null, notes: null, expected_end: null,
    });

    await service.update('att-worker', { is_verified: true } as any, CHECKER, 'checker', null);

    expect(update).toHaveBeenCalled();
    expect(update.mock.calls[0][0].data.is_verified).toBe(true);
  });
});
