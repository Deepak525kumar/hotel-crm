import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { EmploymentStatus } from '@prisma/client';

/**
 * Privilege-escalation regression pin for `EmployeeManagementService.assign()`.
 *
 * THE DEFECT (found 2026-08-12 by real end-to-end probing, NOT by this suite):
 * `approve()` is deliberately status-only -- ADR-065 §6 item 6, "approve is
 * status-only, does not write scope fields" -- which makes `assign()` the ONLY
 * writer of the scope bindings (`EmploymentRecord.hotel_group_id` /
 * `primary_hotel_id`, and the `Hotel.manager_user_id` /
 * `HotelGroup.regional_manager_user_id` back-references) that become a user's
 * JWT scope claim.
 *
 * `assign()` checked lifecycle *authority* (is the actor allowed to assign?)
 * but never the record's *status*. So this sequence granted real, usable scope
 * to an application that had just been explicitly refused:
 *
 *   POST /employees/:id/approve  -> 409 "not been submitted for review"
 *   POST /employees/:id/assign   -> 200, writes hotel_group_id + back-reference
 *
 * The existing suite could not catch it: `assign()` had ZERO service-level
 * coverage here, and E2E scenario 02 asserts the *ordering* of approve-then-
 * assign without ever asserting that assign REQUIRES approval.
 *
 * WHY THIS FILE EXISTS: the guard is one `if` in a long method, and its
 * absence is invisible -- every test still passed with the hole open. If a
 * future change makes these tests fail, the correct response is to restore the
 * ACTIVE gate, NOT to relax the assertion.
 */

const mockPrisma: any = {
  employmentRecord: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  employmentStatusHistory: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotelGroup: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  user: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn((cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

import { EmployeeManagementService } from '../modules/employee-management/service.js';

const admin = {
  userId: 'admin_1',
  email: 'admin@x.com',
  role: 'admin',
  permissions: ['employees:write', 'employees:read'],
  scope: null,
};

function recordWithStatus(status: EmploymentStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: 'emp_1',
    user_id: 'user_1',
    employee_id: 'E-001',
    status,
    version: 1,
    hotel_group_id: null,
    primary_hotel_id: null,
    submitted_for_review_at: null,
    deleted_at: null,
    user: { id: 'user_1', role: 'MANAGER' },
    ...overrides,
  };
}

describe('assign() requires an APPROVED (ACTIVE) record — privilege-escalation pin', () => {
  let service: EmployeeManagementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmployeeManagementService();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockPrisma));
  });

  // The exact escalation path that was live: a never-submitted, never-approved
  // application being handed a real scope binding.
  it('refuses to assign a PENDING (never approved) record, and writes nothing', async () => {
    mockPrisma.employmentRecord.findUnique.mockResolvedValue(
      recordWithStatus(EmploymentStatus.PENDING)
    );

    await expect(
      service.assign(admin as any, 'emp_1', { hotel_group_id: 'grp_1' })
    ).rejects.toThrow(/has not been approved/i);

    // The whole point: no scope binding may be written. A thrown error that
    // still mutated state would be a worse bug than the original.
    expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.hotelGroup.update).not.toHaveBeenCalled();
    expect(mockPrisma.hotel.update).not.toHaveBeenCalled();
  });

  it('refuses a REJECTED record (the refused-then-assigned sequence)', async () => {
    mockPrisma.employmentRecord.findUnique.mockResolvedValue(
      recordWithStatus(EmploymentStatus.REJECTED)
    );

    await expect(
      service.assign(admin as any, 'emp_1', { hotel_group_id: 'grp_1' })
    ).rejects.toThrow(/has not been approved/i);
    expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
  });

  it('refuses a DEACTIVATED record', async () => {
    mockPrisma.employmentRecord.findUnique.mockResolvedValue(
      recordWithStatus(EmploymentStatus.DEACTIVATED)
    );

    await expect(
      service.assign(admin as any, 'emp_1', { primary_hotel_id: 'htl_1' })
    ).rejects.toThrow(/has not been approved/i);
    expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
  });

  // Guard must not over-reach: the legitimate post-approval path still works.
  it('allows assigning an ACTIVE (approved) record', async () => {
    const active = recordWithStatus(EmploymentStatus.ACTIVE);
    mockPrisma.employmentRecord.findUnique.mockResolvedValue(active);
    mockPrisma.employmentRecord.update.mockResolvedValue({
      ...active,
      hotel_group_id: 'grp_1',
      version: 2,
    });
    mockPrisma.hotelGroup.findUnique.mockResolvedValue({
      id: 'grp_1',
      regional_manager_user_id: null,
    });
    mockPrisma.hotelGroup.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.hotelGroup.update.mockResolvedValue({ id: 'grp_1' });

    await expect(
      service.assign(admin as any, 'emp_1', { hotel_group_id: 'grp_1' })
    ).resolves.toBeDefined();

    expect(mockPrisma.employmentRecord.update).toHaveBeenCalledTimes(1);
  });
});
