import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * BaseService.logAudit() actor_role normalization (2026-08-13).
 *
 * logAudit() blind-uppercased whatever role string it was handed and asserted
 * the result into UserRole. Two callers pass 'system' for a scheduled job
 * rather than a person: JobRequestService.closeExpiredBroadcasts() and
 * EmployeeManagementService's contract-lapse deactivation sweep. 'SYSTEM' is
 * not a UserRole member, so Prisma rejected the write with "Invalid value for
 * argument `actor_role`. Expected UserRole."
 *
 * Both callers log INSIDE a $transaction, so that throw rolled the whole
 * transaction back -- closeExpiredBroadcasts() never closed a single
 * broadcast (they stayed OPEN indefinitely, surfacing as the reported "work
 * request still says pending" long after its shift completed), and the
 * contract-lapse sweep never deactivated anyone.
 *
 * Reproduced against a real Postgres before the fix; every existing suite
 * missed it because they mock auditLog.create, which accepts any string. This
 * test therefore asserts the VALUE HANDED TO PRISMA, not just that the call
 * happened -- an assertion a mock can still make honestly.
 */

const mockAuditLog = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = { auditLog: mockAuditLog };

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

import { BaseService } from '../lib/base-service.js';

class ProbeService extends BaseService {}

const roleWritten = () => mockAuditLog.create.mock.calls[0][0].data.actor_role;

describe('BaseService.logAudit — actor_role normalization', () => {
  let service: ProbeService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditLog.create.mockResolvedValue({ id: 'audit1' });
    service = new ProbeService();
  });

  it("writes null for the 'system' pseudo-actor rather than an invalid SYSTEM enum", async () => {
    await service.logAudit(null, 'system', 'AUTO_CLOSE', 'WORK_REQUEST', 'wr1');
    expect(roleWritten()).toBeNull();
  });

  it('writes null for any other non-UserRole string', async () => {
    await service.logAudit(null, 'cron', 'SWEEP', 'WORK_REQUEST', 'wr1');
    expect(roleWritten()).toBeNull();
  });

  it('still writes null when no role is supplied at all', async () => {
    await service.logAudit(null, null, 'AUTO_CLOSE', 'WORK_REQUEST', 'wr1');
    expect(roleWritten()).toBeNull();
  });

  // The normalization must not become "null unless already uppercase" -- every
  // human-actor caller in the codebase passes a lower-cased role from the JWT.
  it.each([
    ['admin', 'ADMIN'],
    ['manager', 'MANAGER'],
    ['regional_manager', 'REGIONAL_MANAGER'],
    ['worker', 'WORKER'],
    ['checker', 'CHECKER'],
  ])('still upper-cases the real role %s -> %s', async (input, expected) => {
    await service.logAudit('u1', input, 'UPDATE', 'USER', 'u1');
    expect(roleWritten()).toBe(expected);
  });

  it('accepts an already-upper-cased real role unchanged', async () => {
    await service.logAudit('u1', 'ADMIN', 'UPDATE', 'USER', 'u1');
    expect(roleWritten()).toBe('ADMIN');
  });
});
