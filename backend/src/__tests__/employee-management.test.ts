import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { DeactivationReason, EmploymentStatus, SkillTag, UserRole } from '@prisma/client';

/**
 * Service-level regression suite for Epic 5 PR 5.6 (SPEC-EMP-001 v0.2.0).
 *
 * Covers: record creation starting Inactive (REQ-EMP-001), the confirmed
 * lifecycle transition table including negative cases and the "no Suspended
 * state" invariant (REQ-EMP-002 / RULE-EMP-02, 03, 12), skill-tag validation
 * and assessment basis (REQ-EMP-003 / RULE-EMP-04), blocklist reason
 * enforcement (REQ-EMP-005 / RULE-EMP-07), retention-tier classification
 * (REQ-EMP-008 / RULE-EMP-11), and the general-profile serializer's exclusion
 * of special-category fields (REQ-EMP-007 / RULE-EMP-09).
 */

const mockPrisma: any = {
  employmentRecord: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  // Every lifecycle transition writes exactly one row here in the same
  // transaction as the status change (applyTransition(), service.ts).
  employmentStatusHistory: {
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  // deactivate()/delete() cancel future assignments via
  // cancelFutureAssignments() -- default to an empty result so tests that
  // don't care about the assignment-cancellation cascade aren't forced to
  // mock it explicitly.
  workerAssignment: {
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
  },
  user: {
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  employeeBlocklistEntry: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    delete: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  workerDocument: {
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([
      { category: 'TAX_NUMBER' },
      { category: 'SOCIAL_SECURITY_NUMBER' },
      { category: 'HEALTH_INSURANCE' },
      { category: 'ID_CARD' },
      { category: 'PASSPORT' },
      { category: 'ADDRESS' },
      { category: 'WORK_PERMIT' }
    ]),
    // approve()/rehire() now confirm an already-signed contract (the
    // applicant's own CONTRACT_SCAN upload) as part of the review act.
    // Defaults to "no scan on file", so the pre-existing approve/rehire
    // expectations here still exercise the contract gate they were written
    // for -- the auto-confirm is a no-op under this mock.
    findFirst: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  },
  contract: {
    findFirst: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({
      id: 'mock_contract_1',
      status: 'ACTIVE'
    }),
  },
  hotel: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotelGroup: {
    // findUnique, not findFirst — see auth.test.ts's identical note.
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  attendance: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  rating: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  // applyTransition() and delete()/restore()/deactivateForContractLapse()
  // run inside $transaction(tx => ...); the mock just invokes the callback
  // with itself, so every tx.X call hits the same mocked collections above.
  $transaction: jest.fn((cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
// Review routing consults the RM cutover flag (a manager application only
// routes to a Regional Manager while the role is live). Stubbed rather than
// loading the whole env: the flag's default is the platform default (off).
// Toggleable so the RM-enabled path can be exercised too; defaults to the
// platform default (off), so every test that does not opt in behaves exactly
// as before.
let rmRoleEnabled = false;
jest.mock('../config/feature-flags.js', () => ({
  isRmRoleEnabled: () => rmRoleEnabled,
  isEmploymentRecordEnabled: () => true,
  isGd02MatrixEnabled: () => false,
}));
jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

import { EmployeeManagementService, toGeneralProfile } from '../modules/employee-management/service.js';
import { assertTransition, ASSESSMENT_BASIS, RETENTION_TIERS } from '../modules/employee-management/constants.js';

const admin = { userId: 'admin_1', email: 'admin@x.com', role: 'admin', permissions: ['employees:write', 'employees:read'], scope: null };

function fakeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'emp_1',
    user_id: 'user_1',
    employee_id: 'E-001',
    job_title: 'Cleaner',
    start_date: new Date('2026-01-01'),
    status: EmploymentStatus.PENDING,
    marked_suitable: false,
    hotel_group_id: null,
    skills: [] as SkillTag[],
    personal_data: null,
    konfession: null,
    disability_status: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('EmployeeManagementService', () => {
  let service: EmployeeManagementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmployeeManagementService();
  });

  // RULE A (project-owner decision, 2026-08-12): create is 1-level-down ONLY,
  // so the `admin` actor these cases use may now create a REGIONAL_MANAGER and
  // nothing else — the target user's role was WORKER here purely as an
  // arbitrary stand-in, not because worker was the subject under test. Changed
  // to REGIONAL_MANAGER so each case still exercises what it was written to
  // exercise (starting status, duplicate detection, skill validation,
  // special-category exclusion) rather than tripping the new hierarchy check
  // first. RULE A itself is covered exhaustively, for every
  // (actor_role, target_role) pair, in `role-hierarchy.test.ts` and
  // `create-hierarchy-authz.test.ts`.
  describe('createEmployee', () => {
    it('creates a record starting Inactive (REQ-EMP-001)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'REGIONAL_MANAGER' });
      const created = fakeRecord({ status: EmploymentStatus.PENDING });
      mockPrisma.employmentRecord.create.mockResolvedValue(created);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createEmployee(admin as any, {
        user_id: 'user_1',
        employee_id: 'E-001',
        job_title: 'Cleaner',
        start_date: new Date('2026-01-01'),
        employment_type: 'FULL_TIME',
      });

      expect(result.status).toBe(EmploymentStatus.PENDING);
      expect(mockPrisma.employmentRecord.create).toHaveBeenCalledTimes(1);
      const createCall = mockPrisma.employmentRecord.create.mock.calls[0][0] as { data: { status: string } };
      expect(createCall.data.status).toBe(EmploymentStatus.PENDING);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects non-admin actors (OD-EMP-08 conservative restriction)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'REGIONAL_MANAGER' });
      await expect(
        service.createEmployee({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, {
          user_id: 'user_1',
          employee_id: 'E-001',
          job_title: 'Cleaner',
          start_date: new Date('2026-01-01'),
          employment_type: 'FULL_TIME',
        })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.employmentRecord.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate user_id or employee_id with ConflictError', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'REGIONAL_MANAGER' });
      mockPrisma.employmentRecord.findUnique.mockResolvedValueOnce(fakeRecord()).mockResolvedValueOnce(null);

      await expect(
        service.createEmployee(admin as any, {
          user_id: 'user_1',
          employee_id: 'E-002',
          job_title: 'Cleaner',
          start_date: new Date('2026-01-01'),
          employment_type: 'FULL_TIME',
        })
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockPrisma.employmentRecord.create).not.toHaveBeenCalled();
    });

    it('rejects a skill tag outside the fixed set (REQ-EMP-003 / RULE-EMP-04)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'REGIONAL_MANAGER' });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.createEmployee(admin as any, {
          user_id: 'user_1',
          employee_id: 'E-001',
          job_title: 'Cleaner',
          start_date: new Date('2026-01-01'),
          employment_type: 'FULL_TIME',
          skills: ['SUPERVISOR'] as unknown as SkillTag[],
        })
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.employmentRecord.create).not.toHaveBeenCalled();
    });

    it('excludes konfession and disability_status from the general profile (REQ-EMP-007 / FIND-002)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'REGIONAL_MANAGER' });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
      const created = fakeRecord({ status: EmploymentStatus.PENDING, konfession: 'catholic', disability_status: 'none' });
      mockPrisma.employmentRecord.create.mockResolvedValue(created);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createEmployee(admin as any, {
        user_id: 'user_1',
        employee_id: 'E-001',
        job_title: 'Cleaner',
        start_date: new Date('2026-01-01'),
        employment_type: 'FULL_TIME',
      });

      expect(result).not.toHaveProperty('konfession');
      expect(result).not.toHaveProperty('disability_status');
    });
  });

  describe('toGeneralProfile serializer', () => {
    it('always omits special-category fields regardless of caller', () => {
      const record = fakeRecord({ konfession: 'catholic', disability_status: 'none' }) as any;
      const profile = toGeneralProfile(record);
      expect(profile).not.toHaveProperty('konfession');
      expect(profile).not.toHaveProperty('disability_status');
      expect(profile.employee_id).toBe('E-001');
    });

    it('defensively deletes nested user.password_hash if accidentally included in the query', () => {
      const record = fakeRecord({ konfession: 'catholic' }) as any;
      record.user = {
        id: 'user_1',
        first_name: 'John',
        password_hash: 'super-secret-hash-that-should-never-leak',
      };
      const profile = toGeneralProfile(record) as any;
      expect(profile.user).toBeDefined();
      expect(profile.user).not.toHaveProperty('password_hash');
      // Other fields should remain
      expect(profile.user?.first_name).toBe('John');
    });
  });

  describe('lifecycle transitions (REQ-EMP-002 rework, 2026-08-06: permanent, non-terminal lifecycle)', () => {
    // Every state can return to ACTIVE (or, for DELETED, to PENDING en route
    // to ACTIVE) -- see constants.ts's ALLOWED_TRANSITIONS. No state is
    // terminal, which is the entire point of the rework: rehire never
    // requires a duplicate User.
    it.each([
      [EmploymentStatus.PENDING, EmploymentStatus.ACTIVE],
      [EmploymentStatus.PENDING, EmploymentStatus.REJECTED],
      [EmploymentStatus.ACTIVE, EmploymentStatus.DEACTIVATED],
      [EmploymentStatus.ACTIVE, EmploymentStatus.DELETED],
      [EmploymentStatus.DEACTIVATED, EmploymentStatus.ACTIVE],
      [EmploymentStatus.DEACTIVATED, EmploymentStatus.DELETED],
      [EmploymentStatus.REJECTED, EmploymentStatus.ACTIVE],
      [EmploymentStatus.REJECTED, EmploymentStatus.DELETED],
      [EmploymentStatus.DELETED, EmploymentStatus.PENDING],
    ])('allows %s -> %s', (from, to) => {
      expect(() => assertTransition(from, to)).not.toThrow();
    });

    it.each([
      [EmploymentStatus.PENDING, EmploymentStatus.PENDING],
      [EmploymentStatus.PENDING, EmploymentStatus.DEACTIVATED],
      [EmploymentStatus.PENDING, EmploymentStatus.DELETED],
      [EmploymentStatus.ACTIVE, EmploymentStatus.PENDING],
      [EmploymentStatus.ACTIVE, EmploymentStatus.REJECTED],
      [EmploymentStatus.DEACTIVATED, EmploymentStatus.PENDING],
      [EmploymentStatus.DEACTIVATED, EmploymentStatus.REJECTED],
      [EmploymentStatus.REJECTED, EmploymentStatus.PENDING],
      [EmploymentStatus.REJECTED, EmploymentStatus.REJECTED],
      [EmploymentStatus.DELETED, EmploymentStatus.ACTIVE],
      [EmploymentStatus.DELETED, EmploymentStatus.DEACTIVATED],
      [EmploymentStatus.DELETED, EmploymentStatus.REJECTED],
    ])('rejects illegal transition %s -> %s', (from, to) => {
      expect(() => assertTransition(from, to)).toThrow();
    });

    it('has no Suspended state anywhere in the enum or transition table', () => {
      const allStates = Object.values(EmploymentStatus);
      expect(allStates).not.toContain('SUSPENDED');
    });

    it('deactivate() requires a DeactivationReason and rejects PENDING (only ACTIVE -> DEACTIVATED is legal)', async () => {
      const record = fakeRecord({ status: EmploymentStatus.PENDING });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(record);

      await expect(service.deactivate(admin as any, 'E-001', DeactivationReason.TEMPORARY_LEAVE)).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('deactivate() succeeds from Active, does not set deleted_at (temporary pause, not a departure)', async () => {
      const record = fakeRecord({ status: EmploymentStatus.ACTIVE, employment_cycle: 1 });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(record);
      mockPrisma.employmentRecord.update.mockResolvedValue({
        ...record,
        status: EmploymentStatus.DEACTIVATED,
        deactivation_reason: DeactivationReason.TEMPORARY_LEAVE,
        deleted_at: null,
      });
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.deactivate(admin as any, 'E-001', DeactivationReason.TEMPORARY_LEAVE);
      expect(result.status).toBe(EmploymentStatus.DEACTIVATED);
      expect(result.deleted_at).toBeNull();
    });

    // Session-invalidation gap found 2026-08-07. DELETED and DELETED ->
    // PENDING both bumped token_generation; DEACTIVATED did not, so a paused
    // employee kept a valid access token until it expired naturally
    // (JWT_ACCESS_EXPIRY, 15m default). middleware/auth.ts reads only
    // User.is_active / deleted_at / token_generation and never consults
    // EmploymentRecord.status, and deactivate() intentionally touches neither
    // User column -- so nothing else in the pipeline caught it. Scheduling
    // failed closed via roster-scope.ts's ACTIVE gate, but documents/hr/
    // consent/notifications have no employment check at all.
    it('bumps token_generation so the paused employee\'s current session ends immediately', async () => {
      const record = fakeRecord({ status: EmploymentStatus.ACTIVE, employment_cycle: 1 });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(record);
      mockPrisma.employmentRecord.update.mockResolvedValue({
        ...record,
        status: EmploymentStatus.DEACTIVATED,
        deactivation_reason: DeactivationReason.TEMPORARY_LEAVE,
        deleted_at: null,
      });
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.deactivate(admin as any, 'E-001', DeactivationReason.TEMPORARY_LEAVE);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: record.user_id },
          data: expect.objectContaining({ token_generation: { increment: 1 } }),
        })
      );
    });

    // The bump must NOT escalate into an account revocation: a pause leaves
    // the person an employee who can log back in, unlike DELETED.
    it('does not deactivate or soft-delete the User account (a pause is not a revocation)', async () => {
      const record = fakeRecord({ status: EmploymentStatus.ACTIVE, employment_cycle: 1 });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(record);
      mockPrisma.employmentRecord.update.mockResolvedValue({
        ...record,
        status: EmploymentStatus.DEACTIVATED,
        deactivation_reason: DeactivationReason.SEASONAL,
        deleted_at: null,
      });
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.deactivate(admin as any, 'E-001', DeactivationReason.SEASONAL);

      for (const call of (mockPrisma.user.update as jest.Mock).mock.calls) {
        const data = (call[0] as { data: Record<string, unknown> }).data;
        expect(data).not.toHaveProperty('is_active');
        expect(data).not.toHaveProperty('deleted_at');
      }
    });
  });

  describe('getSkills (REQ-EMP-003)', () => {
    it('returns each skill tag with its correct assessment basis', async () => {
      const record = fakeRecord({ skills: [SkillTag.CLEANER, SkillTag.WAITER, SkillTag.KITCHEN_DISHWASHER, SkillTag.PUBLIC_SERVICE] });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(record);

      const result = await service.getSkills(admin as any, 'E-001');

      expect(result.skills).toEqual([
        { tag: SkillTag.CLEANER, assessment_basis: 'rooms_cleaned' },
        { tag: SkillTag.WAITER, assessment_basis: 'hours_worked' },
        { tag: SkillTag.KITCHEN_DISHWASHER, assessment_basis: 'hours_worked' },
        { tag: SkillTag.PUBLIC_SERVICE, assessment_basis: 'hours_worked' },
      ]);
      expect(ASSESSMENT_BASIS[SkillTag.CLEANER]).toBe('rooms_cleaned');
      expect(ASSESSMENT_BASIS[SkillTag.WAITER]).toBe('hours_worked');
      expect(ASSESSMENT_BASIS[SkillTag.KITCHEN_DISHWASHER]).toBe('hours_worked');
      expect(ASSESSMENT_BASIS[SkillTag.PUBLIC_SERVICE]).toBe('hours_worked');
    });
  });

  describe('setBlocklist (REQ-EMP-005 / RULE-EMP-07)', () => {
    it('rejects a missing reason with ValidationError', async () => {
      await expect(
        service.setBlocklist(admin as any, { hotelId: 'h1', employeeId: 'E-001', reason: undefined as unknown as string })
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.employeeBlocklistEntry.create).not.toHaveBeenCalled();
    });

    it('rejects a blank (whitespace-only) reason with ValidationError', async () => {
      await expect(
        service.setBlocklist(admin as any, { hotelId: 'h1', employeeId: 'E-001', reason: '   ' })
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.employeeBlocklistEntry.create).not.toHaveBeenCalled();
    });

    it('creates and audits a blocklist entry when a reason is provided', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord());
      mockPrisma.employeeBlocklistEntry.create.mockResolvedValue({ id: 'bl_1', hotel_id: 'h1', employment_record_id: 'emp_1', reason: 'No-show repeatedly', created_by_id: 'admin_1', created_at: new Date() });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.setBlocklist(admin as any, { hotelId: 'h1', employeeId: 'E-001', reason: 'No-show repeatedly' });

      expect(result.reason).toBe('No-show repeatedly');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });
  });

  // IF-EMP-RemoveBlocklist (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06):
  // blocklist entries previously had no removal path at all.
  describe('removeBlocklist (REQ-EMP-005 / RULE-EMP-07 rework)', () => {
    it('throws NotFoundError for an unknown entry id', async () => {
      mockPrisma.employeeBlocklistEntry.findUnique.mockResolvedValue(null);
      await expect(service.removeBlocklist(admin as any, 'h1', 'bl_missing')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
      expect(mockPrisma.employeeBlocklistEntry.delete).not.toHaveBeenCalled();
    });

    // IDOR regression (found by adversarial review, 2026-08-06): the route's
    // checkHotelAccess() only ever validates the PATH's hotel_id -- it has
    // no way to know which hotel the target entry actually belongs to. If
    // the service doesn't independently re-check entry.hotel_id against the
    // path's hotelId, a caller scoped to h1 could delete an h2 entry just by
    // knowing/guessing its id, silently bypassing the route-level scope
    // check entirely. This must 404, not delete.
    it('throws NotFoundError (not a silent delete) when the entry belongs to a DIFFERENT hotel than the one requested', async () => {
      mockPrisma.employeeBlocklistEntry.findUnique.mockResolvedValue({
        id: 'bl_h2',
        hotel_id: 'h2',
        employment_record_id: 'emp_1',
        reason: 'No-show repeatedly',
        created_by_id: 'admin_1',
        created_at: new Date(),
      });
      await expect(service.removeBlocklist(admin as any, 'h1', 'bl_h2')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
      expect(mockPrisma.employeeBlocklistEntry.delete).not.toHaveBeenCalled();
    });

    it('deletes the entry and audits the removal, citing the hotel and employment record', async () => {
      mockPrisma.employeeBlocklistEntry.findUnique.mockResolvedValue({
        id: 'bl_1',
        hotel_id: 'h1',
        employment_record_id: 'emp_1',
        reason: 'No-show repeatedly',
        created_by_id: 'admin_1',
        created_at: new Date(),
      });
      mockPrisma.employeeBlocklistEntry.delete.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.removeBlocklist(admin as any, 'h1', 'bl_1');

      expect(mockPrisma.employeeBlocklistEntry.delete).toHaveBeenCalledWith({ where: { id: 'bl_1' } });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'employee.blocklist.remove',
            resource_id: 'bl_1',
            details: expect.objectContaining({ hotel_id: 'h1', employment_record_id: 'emp_1' }),
          }),
        })
      );
    });
  });

  describe('retention-tier classification (REQ-EMP-008 / RULE-EMP-11)', () => {
    it('classifies shift/attendance coordinates as Tier 1 (6 months)', () => {
      expect(RETENTION_TIERS['shift_coordinates']).toBe('TIER1_6MONTHS');
      expect(RETENTION_TIERS['attendance_coordinates']).toBe('TIER1_6MONTHS');
    });

    it('classifies general personal/profile data as Tier 2 (5 years)', () => {
      expect(RETENTION_TIERS['job_title']).toBe('TIER2_5YEARS');
      expect(RETENTION_TIERS['personal_data']).toBe('TIER2_5YEARS');
      expect(RETENTION_TIERS['konfession']).toBe('TIER2_5YEARS');
      expect(RETENTION_TIERS['disability_status']).toBe('TIER2_5YEARS');
      expect(RETENTION_TIERS['skills']).toBe('TIER2_5YEARS');
      expect(RETENTION_TIERS['start_date']).toBe('TIER2_5YEARS');
    });

    it('classifies payroll/tax-adjacent fields as Tier 3 (6 years)', () => {
      expect(RETENTION_TIERS['iban']).toBe('TIER3_6YEARS');
      expect(RETENTION_TIERS['tax_id']).toBe('TIER3_6YEARS');
      expect(RETENTION_TIERS['payslip_records']).toBe('TIER3_6YEARS');
      expect(RETENTION_TIERS['wage_records']).toBe('TIER3_6YEARS');
    });
  });

  describe('bulkImport (REQ-EMP-006 / RULE-EMP-10)', () => {
    // RULE A (2026-08-12): bulkImport is admin-only and routes every row
    // through createEmployee, so an admin's importable target role is now
    // REGIONAL_MANAGER only (see the createEmployee describe block's note, and
    // the RULE A consequence recorded in role-hierarchy.ts). The target role
    // is incidental to what this case tests (per-row failure isolation).
    it('isolates a failing row from succeeding rows', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'REGIONAL_MANAGER' });
      mockPrisma.employmentRecord.findUnique
        .mockResolvedValueOnce(null) // row 0: user_id check
        .mockResolvedValueOnce(null) // row 0: employee_id check
        .mockResolvedValueOnce(fakeRecord()) // row 1: user_id check -> duplicate
        .mockResolvedValueOnce(null);
      mockPrisma.employmentRecord.create.mockResolvedValue(fakeRecord({ employee_id: 'E-001' }));
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.bulkImport(admin as any, [
        { user_id: 'user_1', employee_id: 'E-001', job_title: 'Cleaner', start_date: new Date('2026-01-01'), employment_type: 'FULL_TIME' },
        { user_id: 'user_2', employee_id: 'E-002', job_title: 'Waiter', start_date: new Date('2026-01-01'), employment_type: 'FULL_TIME' },
      ]);

      expect(result.created).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.index).toBe(1);
    });

    it('rejects a non-admin actor (OD-EMP-08 conservative restriction)', async () => {
      await expect(
        service.bulkImport({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, [
          { user_id: 'user_1', employee_id: 'E-001', job_title: 'Cleaner', start_date: new Date('2026-01-01'), employment_type: 'FULL_TIME' },
        ])
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.employmentRecord.create).not.toHaveBeenCalled();
    });
  });

  // Lifecycle actions (REQ-EMP-002 rework, 2026-08-06). Authorization +
  // the full action->status transition path, exercised through the service
  // (not only the assertTransition unit). submitForReview/approve/reject
  // now admit admin OR a scoped manager/regional_manager (assertLifecycleAuthority()) --
  // no longer the pre-rework admin-only "internal transport" gate.
  describe('lifecycle actions (submitForReview / approve / reject)', () => {
    // RULE B (project-owner decision, 2026-08-12): submit-for-review is
    // SELF-SERVICE ONLY. `w_1` is not `fakeRecord().user_id` ('user_1'), so
    // this remains a denial — but now for the self-check reason, not the
    // "neither admin nor scoped manager" reason the old title gave. Retitled
    // rather than deleted; the record is fetched before the authority check,
    // so the mock is needed for the assertion to reach it.
    it('submitForReview denies an actor who is not the applicant (RULE B self-only)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      await expect(
        service.submitForReview(
          { userId: 'w_1', role: 'worker', permissions: [], scope: null } as any,
          'E-001'
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    // RULE B: an ADMIN may no longer submit on an applicant's behalf. This is
    // the bypass the owner closed — previously assertLifecycleAuthority
    // returned early for admin before the self-check was reached.
    it('submitForReview denies an ADMIN acting on another user\'s record (RULE B)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      await expect(service.submitForReview(admin as any, 'E-001')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    // The actor IS the applicant (userId === fakeRecord().user_id), which is
    // now the only way this transition can happen at all.
    it('submitForReview sets submitted_for_review_at, stays PENDING (self-submission)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, submitted_for_review_at: new Date() })
      );

      const applicant = { userId: 'user_1', role: 'worker', permissions: ['employees:read'], scope: null };
      const result = await service.submitForReview(applicant as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.PENDING);
      expect(result.submitted_for_review_at).not.toBeNull();
    });

    it('approve leaves hotel_group_id null (PROVISIONAL) when no scope resolves', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, submitted_for_review_at: new Date() })
      );
      // The approving actor is a MANAGER, so assertLifecycleAuthority resolves
      // the TARGET user's role to decide whether this manager may act on it.
      // Stated explicitly rather than inherited from whatever a previous test
      // left on the shared `user.findUnique` mock: a WORKER target is the case
      // this test means, and a stale REGIONAL_MANAGER target would deny it for
      // an unrelated reason (only Admin manages RM applications).
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'WORKER' });
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'g1' }); // own group
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.ACTIVE })
      );
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.approve({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, 'E-001');

      expect(result.status).toBe(EmploymentStatus.ACTIVE);
      const updateArg = mockPrisma.employmentRecord.update.mock.calls[0][0] as { data: { hotel_group?: { connect: { id: string } } } };
      expect(updateArg.data.hotel_group).toBeUndefined();
    });

    /**
     * Approve used to be status-only, which left an approved employee ACTIVE
     * with hotel_group_id null. listUsers() scopes every non-admin to
     * `employment_record: { hotel_group_id, status: ACTIVE }`, so that person
     * was invisible in the Users tab to every manager and RM -- including the
     * one who created and approved them. Observed on production: both
     * UI-onboarded employees were ACTIVE with a null group and only
     * target_hotel_group_id set.
     */
    async function approveWith(record: Partial<Record<string, unknown>>, actorScope: unknown = null) {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, submitted_for_review_at: new Date(), ...record } as never)
      );
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'WORKER' });
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'g1' });
      mockPrisma.employmentRecord.update.mockResolvedValue(fakeRecord({ status: EmploymentStatus.ACTIVE }));
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      // Admin actor: assertLifecycleAuthority returns early for admin, which
      // isolates these tests to the GROUP RESOLUTION under test. The
      // non-admin authority path (an approver may only approve into their own
      // group) is covered by its own tests above and is unchanged here.
      mockPrisma.hotel.findUnique.mockResolvedValue(null);
      await service.approve(
        { userId: 'admin_1', role: 'admin', permissions: [], scope: actorScope } as never,
        'E-001'
      );
      return mockPrisma.employmentRecord.update.mock.calls[0][0] as {
        data: { hotel_group?: { connect: { id: string } }; status: string };
      };
    }

    it('promotes target_hotel_group_id to hotel_group_id on approval', async () => {
      const arg = await approveWith({ target_hotel_group_id: 'grp_target' });
      expect(arg.data.hotel_group).toEqual({ connect: { id: 'grp_target' } });
    });

    it('commits the group in the SAME update as the status, so it cannot half-apply', async () => {
      const arg = await approveWith({ target_hotel_group_id: 'grp_target' });
      expect(arg.data.status).toBe(EmploymentStatus.ACTIVE);
      expect(arg.data.hotel_group).toEqual({ connect: { id: 'grp_target' } });
      expect(mockPrisma.employmentRecord.update).toHaveBeenCalledTimes(1);
    });

    // The creator's explicit choice outranks the approver's own scope -- an
    // approver from a different group must not silently redirect the hire.
    it("prefers the application target over the approving actor's own group", async () => {
      const arg = await approveWith(
        { target_hotel_group_id: 'grp_target' },
        { type: 'hotel_group', hotel_group_id: 'grp_actor' }
      );
      expect(arg.data.hotel_group).toEqual({ connect: { id: 'grp_target' } });
    });

    it("falls back to the approving actor's group when the application has no target", async () => {
      const arg = await approveWith({}, { type: 'hotel_group', hotel_group_id: 'grp_actor' });
      expect(arg.data.hotel_group).toEqual({ connect: { id: 'grp_actor' } });
    });

    it('does not overwrite a group the record already has', async () => {
      const arg = await approveWith({ hotel_group_id: 'grp_existing', target_hotel_group_id: null });
      expect(arg.data.hotel_group).toEqual({ connect: { id: 'grp_existing' } });
    });

    /**
     * A Hotel belongs to exactly one HotelGroup, so promoting the target hotel
     * without checking would pin someone to a hotel outside the group just
     * resolved -- an inconsistent record every group-scoped query would then
     * disagree about.
     */
    it('promotes the target primary hotel when it belongs to the resolved group', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({
          status: EmploymentStatus.PENDING,
          submitted_for_review_at: new Date(),
          target_hotel_group_id: 'grp_target',
          target_primary_hotel_id: 'hotel_in_group',
        } as never)
      );
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'WORKER' });
      mockPrisma.hotel.findUnique.mockResolvedValue({ hotel_group_id: 'grp_target' });
      mockPrisma.employmentRecord.update.mockResolvedValue(fakeRecord({ status: EmploymentStatus.ACTIVE }));
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.approve({ userId: 'admin_1', role: 'admin', permissions: [], scope: null } as never, 'E-001');

      const arg = mockPrisma.employmentRecord.update.mock.calls[0][0] as {
        data: { primary_hotel?: { connect: { id: string } } };
      };
      expect(arg.data.primary_hotel).toEqual({ connect: { id: 'hotel_in_group' } });
    });

    it('leaves primary_hotel unset when the target hotel is in a DIFFERENT group', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({
          status: EmploymentStatus.PENDING,
          submitted_for_review_at: new Date(),
          target_hotel_group_id: 'grp_target',
          target_primary_hotel_id: 'hotel_elsewhere',
        } as never)
      );
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'WORKER' });
      mockPrisma.hotel.findUnique.mockResolvedValue({ hotel_group_id: 'some_other_group' });
      mockPrisma.employmentRecord.update.mockResolvedValue(fakeRecord({ status: EmploymentStatus.ACTIVE }));
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.approve({ userId: 'admin_1', role: 'admin', permissions: [], scope: null } as never, 'E-001');

      const arg = mockPrisma.employmentRecord.update.mock.calls[0][0] as {
        data: { primary_hotel?: { connect: { id: string } }; hotel_group?: { connect: { id: string } } };
      };
      expect(arg.data.primary_hotel).toBeUndefined();
      // The group still resolves -- only the inconsistent hotel is skipped.
      expect(arg.data.hotel_group).toEqual({ connect: { id: 'grp_target' } });
    });

    it('approve rejects a PENDING record that was never submitted for review', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, submitted_for_review_at: null })
      );
      await expect(service.approve(admin as any, 'E-001')).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('reject moves PENDING -> REJECTED', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      mockPrisma.employmentRecord.update.mockResolvedValue(fakeRecord({ status: EmploymentStatus.REJECTED }));
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.reject(admin as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.REJECTED);
    });

    it('approve rejects an illegal transition (already ACTIVE) and does not write', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.ACTIVE, submitted_for_review_at: new Date() })
      );
      await expect(service.approve(admin as any, 'E-001')).rejects.toMatchObject({
        name: 'ValidationError',
      });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });
  });

  describe('rehire / reactivate / delete / restore (REQ-EMP-002 rework)', () => {
    it('reactivate moves DEACTIVATED -> ACTIVE directly, no re-approval', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DEACTIVATED, deactivation_reason: DeactivationReason.TEMPORARY_LEAVE })
      );
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.ACTIVE, deactivation_reason: null })
      );
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.reactivate(admin as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.ACTIVE);
    });

    it('rehire moves REJECTED -> ACTIVE directly, employment_cycle unchanged', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.REJECTED, employment_cycle: 1 })
      );
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.ACTIVE, employment_cycle: 1 })
      );
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'mock_contract_1', status: 'ACTIVE' });
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.rehire(admin as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.ACTIVE);
      expect(result.employment_cycle).toBe(1);
    });

    it('rehire rejects without an approved contract', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.REJECTED, employment_cycle: 1 })
      );
      // Two lookups now: the auto-confirm step (nothing pending to confirm)
      // and assertApprovedContract's own gate. Both must see "no contract".
      mockPrisma.contract.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await expect(service.rehire(admin as any, 'E-001')).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('delete requires admin (a scoped manager is denied)', async () => {
      await expect(
        service.delete({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, 'E-001', 'Resigned')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('delete requires a non-blank deleted_reason', async () => {
      await expect(service.delete(admin as any, 'E-001', '   ')).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('delete moves ACTIVE -> DELETED, soft-deletes the User (Decision 1: DELETED == deleteUser())', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.ACTIVE }));
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DELETED, deleted_reason: 'Resigned', deleted_at: new Date() })
      );
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.delete(admin as any, 'E-001', 'Resigned');
      expect(result.status).toBe(EmploymentStatus.DELETED);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user_1' }, data: expect.objectContaining({ is_active: false }) })
      );
    });

    it('restore requires admin', async () => {
      await expect(
        service.restore({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, 'E-001')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('restore moves DELETED -> PENDING, increments employment_cycle, un-deletes the User', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DELETED, employment_cycle: 1, deleted_at: new Date() })
      );
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, employment_cycle: 2, deleted_at: null })
      );
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.restore(admin as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.PENDING);
      expect(result.employment_cycle).toBe(2);
      const historyCall = mockPrisma.employmentStatusHistory.create.mock.calls[0][0] as { data: { employment_cycle: number } };
      expect(historyCall.data.employment_cycle).toBe(2);
    });
  });

  // Authorization coverage for the remaining Admin-only IF-EMP-* methods and
  // the deny-by-default profile/skills visibility (RULE-EMP-08).
  describe('authorization (Admin-only methods + deny-by-default visibility)', () => {
    it('exportEmployeeData rejects a non-admin actor (REQ-EMP-009)', async () => {
      await expect(
        service.exportEmployeeData({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, 'E-001')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('deactivate rejects a manager with no scope claim (deny-by-default, isWorkerInGroupScope)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.ACTIVE }));
      await expect(
        service.deactivate({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, 'E-001', DeactivationReason.TEMPORARY_LEAVE)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('getSkills denies a worker viewing another employee (RULE-EMP-08)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ user_id: 'user_1' }));
      await expect(
        service.getSkills({ userId: 'user_other', role: 'worker', permissions: ['employees:read'], scope: null } as any, 'E-001')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('getSkills allows a worker to view their own record', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ user_id: 'user_1', skills: [SkillTag.CLEANER] }));
      const result = await service.getSkills(
        { userId: 'user_1', role: 'worker', permissions: ['employees:read'], scope: null } as any,
        'E-001'
      );
      expect(result.skills).toEqual([{ tag: SkillTag.CLEANER, assessment_basis: 'rooms_cleaned' }]);
    });
  });

  // *** BEHAVIOR CHANGE (2026-08-06 rework) *** -- this method now produces
  // DELETED, not DEACTIVATED (service.ts's own prominent comment above the
  // method explains why: a lapsed, non-continued contract means the person
  // left, which is the DELETED case, not a temporary pause). It also now
  // soft-deletes the User account and bumps token_generation, since DELETED
  // is unified with deleteUser() (Decision 1) -- neither happened before.
  describe('deactivateForContractLapse (ADR-045, HR implementation PR 5; DELETED since the 2026-08-06 rework)', () => {
    it('is a no-op when no employment record exists for the user (best-effort)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
      await service.deactivateForContractLapse('user_1', 'contract_lapse_manual');
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('is idempotent when the record is already DELETED', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DELETED })
      );
      await service.deactivateForContractLapse('user_1', 'contract_lapse_manual');
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('moves an ACTIVE record to DELETED, soft-deletes the User, no actor.role gate (internal cross-module call)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.ACTIVE })
      );
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DELETED, deleted_reason: 'contract_lapse_manual' })
      );
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      await service.deactivateForContractLapse('user_1', 'contract_lapse_manual');

      expect(mockPrisma.employmentRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp_1' },
          data: expect.objectContaining({ status: EmploymentStatus.DELETED }),
        })
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user_1' }, data: expect.objectContaining({ is_active: false }) })
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'employee.deactivate.contract_lapse' }),
        })
      );
    });

    it('rejects an illegal transition (e.g. from PENDING, matching assertTransition -- PENDING has no direct edge to DELETED)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING })
      );
      await expect(
        service.deactivateForContractLapse('user_1', 'contract_lapse_manual')
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });
  });

  describe('getByUserId (IF-EMP-GetByUserId)', () => {
    it('returns the general profile when a record exists for the user', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ konfession: 'x', disability_status: 'y' })
      );

      const result = await service.getByUserId(admin, 'user_1');

      expect(mockPrisma.employmentRecord.findUnique).toHaveBeenCalledWith({ where: { user_id: 'user_1' } });
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('konfession');
      expect(result).not.toHaveProperty('disability_status');
      expect(result?.employee_id).toBe('E-001');
    });

    it('returns null (not an error) when no record exists for the user', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);

      const result = await service.getByUserId(admin, 'user_no_record');

      expect(result).toBeNull();
    });

    it('returns null for a soft-deleted (DELETED) record instead of resurfacing it', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DELETED, deleted_at: new Date() })
      );

      const result = await service.getByUserId(admin, 'user_1');

      expect(result).toBeNull();
    });

    it('rejects a worker looking up another user\'s record', async () => {
      const worker = { userId: 'user_2', email: 'w@x.com', role: 'worker', permissions: [], scope: null };
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ user_id: 'user_1' }));

      await expect(service.getByUserId(worker, 'user_1')).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows a worker looking up their own record', async () => {
      const worker = { userId: 'user_1', email: 'w@x.com', role: 'worker', permissions: [], scope: null };
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ user_id: 'user_1' }));

      const result = await service.getByUserId(worker, 'user_1');
      expect(result?.employee_id).toBe('E-001');
    });

    it('rejects a manager whose scope does not cover the record\'s hotel group', async () => {
      const manager = {
        userId: 'mgr_1',
        email: 'm@x.com',
        role: 'manager',
        permissions: [],
        scope: { type: 'hotel_group' as const, hotel_group_id: 'group_a' },
      };
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ hotel_group_id: 'group_b' })
      );

      await expect(service.getByUserId(manager, 'user_1')).rejects.toMatchObject({ name: 'ForbiddenError' });
    });
  });
  // ── 2026-08-13 onboarding defect fixes ──────────────────────────────────
  //
  // Each case here pins one reported end-to-end defect. They are behavioural,
  // not structural: if a future refactor reintroduces the old routing or the
  // old contract gate, these fail.
  /**
   * Read/write consistency while the RM role is disabled.
   *
   * resolveScope() grants an RM their hotel_group scope without consulting
   * FEATURE_RM_ROLE, so they sign in and reach the queue normally -- but
   * resolveReviewerRecipients() DOES consult it and returns no RM, so every
   * record routes to Admin and the queue filters down to nothing. An empty
   * queue reads as "no applications waiting", indistinguishable from genuinely
   * having none, while the write path refuses the same actor with an explicit
   * reason. Reported live: a manager application created under an RM never
   * appeared for any RM.
   */
  /**
   * RM review is no longer gated on FEATURE_RM_ROLE (owner decision,
   * 2026-08-14). The flag left the platform half-recognizing Regional
   * Managers: resolveScope() granted them hotel_group scope without consulting
   * it, so they signed in and held scope, but were refused the one workflow
   * the role exists for. These tests pin that the flag no longer affects this
   * path at all -- asserted in BOTH flag states, since a reintroduced gate
   * would otherwise only show up once the flag flipped.
   */
  describe('RM review is not flag-gated', () => {
    const rmActor = {
      userId: 'rm_1',
      role: 'regional_manager',
      permissions: [],
      scope: { type: 'hotel_group', hotel_group_id: 'g1' },
    } as never;

    afterEach(() => {
      rmRoleEnabled = false;
    });

    // Previously threw "Regional Manager role is disabled". An RM now owns
    // records, so locking them out of the queue would hide their own work.
    it.each([false, true])('serves the queue with the flag %s', async (enabled) => {
      rmRoleEnabled = enabled;
      mockPrisma.employmentRecord.findMany.mockResolvedValue([]);

      await expect(service.getReviewQueue(rmActor)).resolves.toEqual([]);
    });

    // Previously threw "only Admin can manage Manager applications while RM
    // role is disabled" -- the refusal that broke the hierarchy at review
    // time, since an RM is exactly who creates a Manager under RULE A.
    it.each([false, true])(
      'lets an RM approve a manager application in their own group with the flag %s',
      async (enabled) => {
        rmRoleEnabled = enabled;
        mockPrisma.employmentRecord.findUnique.mockResolvedValue(
          fakeRecord({
            status: EmploymentStatus.PENDING,
            submitted_for_review_at: new Date(),
            target_hotel_group_id: 'g1',
          })
        );
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'MANAGER' });
        mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'g1' });
        mockPrisma.employmentRecord.update.mockResolvedValue(
          fakeRecord({ status: EmploymentStatus.ACTIVE })
        );
        mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
        mockPrisma.auditLog.create.mockResolvedValue({});
        mockPrisma.hotel.findUnique.mockResolvedValue(null);

        await expect(service.approve(rmActor, 'E-001')).resolves.toBeDefined();
      }
    );

    // Widening WHICH role may review must not widen WHICH records they reach:
    // ADR-065 §6 item 5 still binds an RM to applications targeting their own
    // group.
    it('still refuses an RM a manager application targeting another group', async () => {
      rmRoleEnabled = true;
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({
          status: EmploymentStatus.PENDING,
          submitted_for_review_at: new Date(),
          target_hotel_group_id: 'some_other_group',
        })
      );
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'MANAGER' });
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'g1' });

      await expect(service.approve(rmActor, 'E-001')).rejects.toThrow(/different group/);
    });

    // Unchanged by this widening: only Admin manages an RM application.
    it('still refuses an RM a Regional Manager application', async () => {
      rmRoleEnabled = true;
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, submitted_for_review_at: new Date() })
      );
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user_1', role: 'REGIONAL_MANAGER' });

      await expect(service.approve(rmActor, 'E-001')).rejects.toThrow(
        /only Admin can manage Regional Manager applications/
      );
    });

    // Admin is the reviewer of last resort and must never be blocked by this.
    it('does not affect admin', async () => {
      rmRoleEnabled = false;
      mockPrisma.employmentRecord.findMany.mockResolvedValue([]);

      await expect(
        service.getReviewQueue({ userId: 'a1', role: 'admin', permissions: [], scope: { type: 'global' } } as never)
      ).resolves.toEqual([]);
    });

    it('does not affect a hotel manager', async () => {
      rmRoleEnabled = false;
      mockPrisma.employmentRecord.findMany.mockResolvedValue([]);

      await expect(
        service.getReviewQueue({
          userId: 'm1',
          role: 'manager',
          permissions: [],
          scope: { type: 'hotel', hotel_id: 'h1' },
        } as never)
      ).resolves.toEqual([]);
    });
  });

  /**
   * Creator-reviews-their-own-hire (owner decision, 2026-08-14).
   *
   * Reported: "I created a manager from the regional manager's id and when I
   * submitted the application it didn't show up in the regional manager's
   * profile." Routing went by the applicant's TARGET GROUP, so the person who
   * actually created the account was not the one asked to approve it.
   *
   * This routes BY hierarchy, not around it: RULE A (lib/role-hierarchy.ts)
   * enforces create-is-1-level-down at creation time, so the creator always
   * outranks the applicant by exactly one level. A peer approval is therefore
   * unreachable, and so is routing someone their own application.
   */
  describe('review routing to the creator', () => {
    const recordCreatedBy = (creatorId: string, applicantRole: UserRole) => ({
      ...fakeRecord({
        user_id: 'user_1',
        submitted_for_review_at: new Date(),
        target_hotel_group_id: 'group_1',
        target_primary_hotel_id: 'hotel_1',
        created_by_id: creatorId,
        employment_cycle: 1,
      }),
      user: { id: 'user_1', role: applicantRole },
    });

    beforeEach(() => {
      mockPrisma.contract.findMany = (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]);
      mockPrisma.workerDocument.findMany.mockResolvedValue([]);
      mockPrisma.hotel.findUnique.mockResolvedValue({ manager_user_id: 'other_mgr' });
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ regional_manager_user_id: 'other_rm' });
      mockPrisma.user.findMany = (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([{ id: 'admin_1' }]);
    });

    afterEach(() => {
      rmRoleEnabled = false;
    });

    /** Runs the queue as `actor` and reports whether the record reached them. */
    async function queueReaches(actor: Record<string, unknown>) {
      const queue = await service.getReviewQueue(actor as never);
      return queue.length > 0;
    }

    // The exact reported scenario.
    it('routes an RM-created manager application to that RM, not to admin', async () => {
      rmRoleEnabled = true;
      mockPrisma.employmentRecord.findMany.mockResolvedValue([
        recordCreatedBy('rm_creator', UserRole.MANAGER),
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'rm_creator',
        role: UserRole.REGIONAL_MANAGER,
        is_active: true,
        deleted_at: null,
      });

      await expect(
        queueReaches({ userId: 'rm_creator', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'group_1' } })
      ).resolves.toBe(true);
      // Admin is the reviewer of LAST resort -- it must not also claim it.
      await expect(
        queueReaches({ userId: 'admin_1', role: 'admin', scope: { type: 'global' } })
      ).resolves.toBe(false);
    });

    it('routes a manager-created worker application to that manager, not the target hotel\'s manager', async () => {
      mockPrisma.employmentRecord.findMany.mockResolvedValue([
        recordCreatedBy('mgr_creator', UserRole.WORKER),
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'mgr_creator',
        role: UserRole.MANAGER,
        is_active: true,
        deleted_at: null,
      });

      await expect(
        queueReaches({ userId: 'mgr_creator', role: 'manager', scope: { type: 'hotel', hotel_id: 'h9' } })
      ).resolves.toBe(true);
      await expect(
        queueReaches({ userId: 'other_mgr', role: 'manager', scope: { type: 'hotel', hotel_id: 'hotel_1' } })
      ).resolves.toBe(false);
    });

    // RM review is no longer flag-gated, so the RM creator keeps the record in
    // both flag states. This previously escalated to admin while the flag was
    // off, which is exactly the hierarchy break the owner asked to remove.
    it.each([false, true])(
      'keeps an RM-created manager application with that RM, flag %s',
      async (enabled) => {
        rmRoleEnabled = enabled;
        mockPrisma.employmentRecord.findMany.mockResolvedValue([
          recordCreatedBy('rm_creator', UserRole.MANAGER),
        ]);
        mockPrisma.user.findUnique.mockResolvedValue({
          id: 'rm_creator',
          role: UserRole.REGIONAL_MANAGER,
          is_active: true,
          deleted_at: null,
        });

        await expect(
          queueReaches({ userId: 'rm_creator', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'group_1' } })
        ).resolves.toBe(true);
        await expect(
          queueReaches({ userId: 'admin_1', role: 'admin', scope: { type: 'global' } })
        ).resolves.toBe(false);
      }
    );

    it('falls through when the creator is deactivated', async () => {
      mockPrisma.employmentRecord.findMany.mockResolvedValue([
        recordCreatedBy('mgr_creator', UserRole.WORKER),
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'mgr_creator',
        role: UserRole.MANAGER,
        is_active: false,
        deleted_at: null,
      });

      await expect(
        queueReaches({ userId: 'mgr_creator', role: 'manager', scope: { type: 'hotel', hotel_id: 'h9' } })
      ).resolves.toBe(false);
      await expect(
        queueReaches({ userId: 'other_mgr', role: 'manager', scope: { type: 'hotel', hotel_id: 'hotel_1' } })
      ).resolves.toBe(true);
    });

    // created_by_id is SetNull when the creator's account is deleted.
    it('falls through when the creator is unknown', async () => {
      mockPrisma.employmentRecord.findMany.mockResolvedValue([
        recordCreatedBy(null as never, UserRole.WORKER),
      ]);

      await expect(
        queueReaches({ userId: 'other_mgr', role: 'manager', scope: { type: 'hotel', hotel_id: 'hotel_1' } })
      ).resolves.toBe(true);
    });

    // RULE A is re-checked rather than assumed: a record predating it, or one
    // whose creator has since changed role, must not hand review to someone
    // who no longer outranks the applicant.
    it('falls through when the creator no longer outranks the applicant', async () => {
      mockPrisma.employmentRecord.findMany.mockResolvedValue([
        recordCreatedBy('mgr_creator', UserRole.MANAGER),
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'mgr_creator',
        role: UserRole.MANAGER, // manager cannot create a manager under RULE A
        is_active: true,
        deleted_at: null,
      });

      await expect(
        queueReaches({ userId: 'mgr_creator', role: 'manager', scope: { type: 'hotel', hotel_id: 'h9' } })
      ).resolves.toBe(false);
    });

    it('never routes an applicant their own application', async () => {
      mockPrisma.employmentRecord.findMany.mockResolvedValue([
        recordCreatedBy('user_1', UserRole.WORKER),
      ]);

      await expect(
        queueReaches({ userId: 'user_1', role: 'worker', scope: { type: 'hotel', hotel_id: 'h9' } })
      ).rejects.toThrow(/not authorized/);
    });
  });

  describe('review-queue routing (reported: "why is admin seeing all the review requests")', () => {
    const workerRecord = {
      ...fakeRecord({
        user_id: 'user_1',
        submitted_for_review_at: new Date(),
        target_primary_hotel_id: 'hotel_1',
        target_hotel_group_id: 'group_1',
        created_by_id: 'admin_1',
        employment_cycle: 1,
      }),
      user: { id: 'user_1', role: UserRole.WORKER },
      created_by: { id: 'admin_1', role: UserRole.ADMIN },
    };

    beforeEach(() => {
      mockPrisma.employmentRecord.findMany.mockResolvedValue([workerRecord]);
      mockPrisma.contract.findMany = (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]);
      mockPrisma.workerDocument.findMany.mockResolvedValue([]);
      mockPrisma.hotel.findUnique.mockResolvedValue({ manager_user_id: 'mgr_1' });
      mockPrisma.user.findMany = (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([{ id: 'admin_1' }]);
      // Pinned, not inherited: jest.clearAllMocks() clears calls but NOT
      // implementations, so a mockResolvedValue left on this shared mock by
      // another describe survives into this one -- and creator-based routing
      // reads it. This fixture's creator is the admin, who under RULE A cannot
      // create a WORKER, so the record correctly falls through to the hotel's
      // manager. Leaving it inherited made that outcome depend on test order.
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'admin_1',
        role: UserRole.ADMIN,
        is_active: true,
        deleted_at: null,
      });
    });

    it('routes a worker application to the manager of its target hotel, not to admin', async () => {
      const manager = { userId: 'mgr_1', role: 'manager', scope: { type: 'hotel', hotel_id: 'hotel_1' } };

      const managerQueue = await service.getReviewQueue(manager as any);
      expect(managerQueue.map((r: any) => r.employee_id)).toEqual(['E-001']);

      // Same record, admin actor: admin is the reviewer of LAST RESORT, and a
      // hotel manager exists, so admin must not also see it. Admin claiming
      // every admin-CREATED record is the reported defect -- under ADR-065
      // admin creates almost every account.
      const adminQueue = await service.getReviewQueue(admin as any);
      expect(adminQueue).toEqual([]);
    });

    // The fallback chain is hotel manager -> that group's RM -> admin. The RM
    // tier used to be inert (FEATURE_RM_ROLE gated it out), so this reached
    // admin with only the hotel manager missing. It is live now, so admin is
    // the last resort only when BOTH are absent.
    it('falls back to the group RM when the target hotel has no manager', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ manager_user_id: null });
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ regional_manager_user_id: 'rm_of_group' });

      const rmQueue = await service.getReviewQueue({
        userId: 'rm_of_group',
        role: 'regional_manager',
        scope: { type: 'hotel_group', hotel_group_id: 'group_1' },
      } as any);
      expect(rmQueue.map((r: any) => r.employee_id)).toEqual(['E-001']);

      const adminQueue = await service.getReviewQueue(admin as any);
      expect(adminQueue).toEqual([]);
    });

    it('falls back to admin when neither a hotel manager nor a group RM exists', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ manager_user_id: null });
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ regional_manager_user_id: null });

      const adminQueue = await service.getReviewQueue(admin as any);
      expect(adminQueue.map((r: any) => r.employee_id)).toEqual(['E-001']);
    });
  });

  describe('re-onboarding (owner decision: contract only, documents preserved)', () => {
    const returning = fakeRecord({
      status: EmploymentStatus.PENDING,
      employment_cycle: 2,
      work_permit_required: false,
      employment_type: 'FULL_TIME',
    });

    it('submits for review with no documents on file — only the contract is re-checked', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(returning);
      // Nothing on file at all: the first-time gate would reject this outright.
      mockPrisma.workerDocument.findMany.mockResolvedValue([]);
      // A still-valid contract needs no fresh signature.
      mockPrisma.contract.findFirst.mockResolvedValue({
        id: 'c1',
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 86_400_000),
        created_at: new Date(),
      });
      mockPrisma.employmentRecord.update.mockResolvedValue({ ...returning, submitted_for_review_at: new Date() });
      mockPrisma.user.findMany = (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]);

      const self = { userId: 'user_1', role: 'worker', scope: null };
      await expect(service.submitForReview(self as any, 'E-001')).resolves.toBeDefined();
      expect(mockPrisma.employmentRecord.update).toHaveBeenCalled();
    });
  });
});
