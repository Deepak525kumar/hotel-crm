import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * RULE A — "create is 1-level-down only" (project-owner decision, 2026-08-12),
 * asserted at the SERVICE layer on BOTH creation surfaces:
 *
 *   1. `users/service.ts#createUser`                — account creation
 *   2. `employee-management/service.ts#createEmployee` — employment-record creation
 *
 * `role-hierarchy.test.ts` pins the decision TABLE. This suite pins that each
 * surface actually CONSULTS it, for every (actor_role, target_role) pair, and —
 * critically — that a denial writes NOTHING. A 403 that still created the row
 * has happened in this codebase before; asserting only the thrown error would
 * not catch it, so every denial case also asserts `create` was never called.
 *
 * Service layer rather than route layer for the target-role half because the
 * target role is not knowable from the route: for `createEmployee` it must be
 * read from the DB (`User.role` for the given `user_id`), and for `createUser`
 * it arrives in the request body. `requireRole()` cannot express either. The
 * ROUTE gates are separately asserted by `capability-policy.test.ts` (which
 * pins the two deliberate C-10 divergences this change introduces).
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => true,
  isRmRoleEnabled: () => true,
}));

const mockUserFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockUserCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

const prismaStub = {
  user: { findUnique: mockUserFindUnique, create: mockUserCreate },
  employmentRecord: { findUnique: mockEmploymentFindUnique, create: mockEmploymentCreate },
  hotel: { findUnique: mockHotelFindUnique },
  auditLog: { create: mockAuditCreate },
  $transaction: async (fn: any) => fn(prismaStub),
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => prismaStub,
}));

import { PLATFORM_ROLES, type PlatformRole } from '../lib/role-hierarchy.js';
import { UserService } from '../modules/users/service.js';
import { EmployeeManagementService } from '../modules/employee-management/service.js';

/** The ratified table, transcribed independently of the implementation. */
const RATIFIED: Record<PlatformRole, readonly PlatformRole[]> = {
  admin: ['regional_manager'],
  regional_manager: ['manager'],
  manager: ['worker', 'checker'],
  worker: [],
  checker: [],
};

/**
 * A scope claim that makes the per-role TARGETING checks in createEmployee
 * succeed, so a denial can only ever come from RULE A itself and never from an
 * incidental "you have no group/hotel" failure.
 */
function scopeFor(role: PlatformRole) {
  if (role === 'regional_manager') return { type: 'hotel_group' as const, hotel_group_id: 'g1' };
  if (role === 'manager') return { type: 'hotel' as const, hotel_id: 'h1' };
  if (role === 'admin') return { type: 'global' as const };
  return null;
}

function actorFor(role: PlatformRole) {
  return {
    userId: `actor_${role}`,
    role,
    permissions: ['users:write', 'employees:write', 'employees:read'],
    scope: scopeFor(role),
  } as any;
}

describe('RULE A — create is 1-level-down only, enforced on both creation surfaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuditCreate.mockResolvedValue({});
    mockHotelFindUnique.mockResolvedValue({ id: 'h1', hotel_group_id: 'g1' });
    // No pre-existing employment record / no duplicate email, so the only
    // thing that can reject a create is authorization.
    mockEmploymentFindUnique.mockResolvedValue(null);
    mockEmploymentCreate.mockImplementation(async (args: any) => ({
      id: 'emp_new',
      employee_id: args.data.employee_id,
      user_id: args.data.user_id,
      job_title: args.data.job_title,
      start_date: args.data.start_date,
      status: 'PENDING',
      hotel_group_id: null,
      skills: [],
      personal_data: null,
      konfession: null,
      disability_status: null,
      marked_suitable: false,
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    }));
  });

  // =====================================================================
  // Surface 1 — POST /users (account creation), users/service.ts#createUser
  // =====================================================================
  describe('createUser (account creation)', () => {
    const service = new UserService();

    for (const actor of PLATFORM_ROLES) {
      for (const target of PLATFORM_ROLES) {
        const allowed = RATIFIED[actor].includes(target);

        it(`${actor} creating a ${target} account = ${allowed ? 'ALLOW' : 'DENY'}`, async () => {
          // findUnique here is the duplicate-email check: null = not taken.
          mockUserFindUnique.mockResolvedValue(null);
          mockUserCreate.mockResolvedValue({
            id: 'u_new',
            email: 'new@test.com',
            first_name: 'New',
            last_name: 'User',
            phone: null,
            role: target.toUpperCase(),
            is_active: true,
            created_at: new Date(),
          });

          const call = service.createUser(
            {
              email: 'new@test.com',
              password: 'pw12345678',
              first_name: 'New',
              last_name: 'User',
              role: target,
            } as any,
            `actor_${actor}`,
            actor
          );

          if (allowed) {
            await expect(call).resolves.toMatchObject({ role: target });
            expect(mockUserCreate).toHaveBeenCalledTimes(1);
          } else {
            await expect(call).rejects.toMatchObject({ name: 'ForbiddenError' });
            // The denial must be a NON-WRITE. A 403 that still inserted the
            // row would be a worse bug than no check at all.
            expect(mockUserCreate).not.toHaveBeenCalled();
          }
        });
      }
    }

    it('denies an unrecognized actor role (deny-by-default on an untrusted JWT claim)', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      await expect(
        service.createUser(
          { email: 'x@test.com', password: 'pw12345678', first_name: 'X', last_name: 'Y', role: 'worker' } as any,
          'actor_x',
          'superadmin'
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockUserCreate).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // Surface 2 — POST /employees, employee-management/service.ts#createEmployee
  // =====================================================================
  describe('createEmployee (employment-record creation)', () => {
    const service = new EmployeeManagementService();

    for (const actor of PLATFORM_ROLES) {
      for (const target of PLATFORM_ROLES) {
        const allowed = RATIFIED[actor].includes(target);

        it(`${actor} creating an employment record for a ${target} = ${allowed ? 'ALLOW' : 'DENY'}`, async () => {
          // The target user's role is read from the DB, not from the request —
          // this is the value RULE A is checked against.
          mockUserFindUnique.mockResolvedValue({ id: 'user_t', role: target.toUpperCase() });

          const call = service.createEmployee(actorFor(actor), {
            user_id: 'user_t',
            employee_id: 'E-NEW',
            job_title: 'Cleaner',
            start_date: new Date('2026-01-01'),
            // Supplied so an admin->manager attempt cannot be denied by the
            // unrelated "admin must provide target_hotel_group_id" ConflictError
            // instead of by RULE A. (It is denied by RULE A anyway; this makes
            // that unambiguous.)
            target_hotel_group_id: 'g1',
          } as any);

          if (allowed) {
            await expect(call).resolves.toMatchObject({ employee_id: 'E-NEW' });
            expect(mockEmploymentCreate).toHaveBeenCalledTimes(1);
          } else {
            await expect(call).rejects.toMatchObject({ name: 'ForbiddenError' });
            expect(mockEmploymentCreate).not.toHaveBeenCalled();
          }
        });
      }
    }

    it('denies an unrecognized actor role (deny-by-default)', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'user_t', role: 'WORKER' });
      await expect(
        service.createEmployee({ userId: 'x', role: 'superadmin', permissions: [], scope: null } as any, {
          user_id: 'user_t',
          employee_id: 'E-NEW',
          job_title: 'Cleaner',
          start_date: new Date('2026-01-01'),
        } as any)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockEmploymentCreate).not.toHaveBeenCalled();
    });

    // Named regressions of the specific hole this rule closed: the route
    // admitted admin/manager/RM and NOTHING checked the target role, so an
    // admin could open an employment record for another admin, and a manager
    // for a manager.
    it('denies admin creating an employment record for another ADMIN (the pre-RULE-A hole)', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'user_t', role: 'ADMIN' });
      await expect(
        service.createEmployee(actorFor('admin'), {
          user_id: 'user_t',
          employee_id: 'E-NEW',
          job_title: 'Boss',
          start_date: new Date('2026-01-01'),
        } as any)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockEmploymentCreate).not.toHaveBeenCalled();
    });

    it('denies a manager creating an employment record for another MANAGER (no peer creation)', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'user_t', role: 'MANAGER' });
      await expect(
        service.createEmployee(actorFor('manager'), {
          user_id: 'user_t',
          employee_id: 'E-NEW',
          job_title: 'Manager',
          start_date: new Date('2026-01-01'),
        } as any)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockEmploymentCreate).not.toHaveBeenCalled();
    });

    it('denies admin creating an employment record for a WORKER (more than one level down)', async () => {
      mockUserFindUnique.mockResolvedValue({ id: 'user_t', role: 'WORKER' });
      await expect(
        service.createEmployee(actorFor('admin'), {
          user_id: 'user_t',
          employee_id: 'E-NEW',
          job_title: 'Cleaner',
          start_date: new Date('2026-01-01'),
        } as any)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockEmploymentCreate).not.toHaveBeenCalled();
    });
  });
});
