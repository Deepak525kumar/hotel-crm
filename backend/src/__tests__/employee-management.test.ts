import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { DeactivationReason, EmploymentStatus, SkillTag } from '@prisma/client';

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
      { category: 'GENERAL' },
      { category: 'IDENTITY' },
      { category: 'WORK_PERMIT' }
    ]),
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

  describe('createEmployee', () => {
    it('creates a record starting Inactive (REQ-EMP-001)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
      const created = fakeRecord({ status: EmploymentStatus.PENDING });
      mockPrisma.employmentRecord.create.mockResolvedValue(created);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createEmployee(admin as any, {
        user_id: 'user_1',
        employee_id: 'E-001',
        job_title: 'Cleaner',
        start_date: new Date('2026-01-01'),
      });

      expect(result.status).toBe(EmploymentStatus.PENDING);
      expect(mockPrisma.employmentRecord.create).toHaveBeenCalledTimes(1);
      const createCall = mockPrisma.employmentRecord.create.mock.calls[0][0] as { data: { status: string } };
      expect(createCall.data.status).toBe(EmploymentStatus.PENDING);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects non-admin actors (OD-EMP-08 conservative restriction)', async () => {
      await expect(
        service.createEmployee({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, {
          user_id: 'user_1',
          employee_id: 'E-001',
          job_title: 'Cleaner',
          start_date: new Date('2026-01-01'),
        })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.employmentRecord.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate user_id or employee_id with ConflictError', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValueOnce(fakeRecord()).mockResolvedValueOnce(null);

      await expect(
        service.createEmployee(admin as any, {
          user_id: 'user_1',
          employee_id: 'E-002',
          job_title: 'Cleaner',
          start_date: new Date('2026-01-01'),
        })
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockPrisma.employmentRecord.create).not.toHaveBeenCalled();
    });

    it('rejects a skill tag outside the fixed set (REQ-EMP-003 / RULE-EMP-04)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.createEmployee(admin as any, {
          user_id: 'user_1',
          employee_id: 'E-001',
          job_title: 'Cleaner',
          start_date: new Date('2026-01-01'),
          skills: ['SUPERVISOR'] as unknown as SkillTag[],
        })
      ).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.employmentRecord.create).not.toHaveBeenCalled();
    });

    it('excludes konfession and disability_status from the general profile (REQ-EMP-007 / FIND-002)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
      const created = fakeRecord({ konfession: 'catholic', disability_status: 'none' });
      mockPrisma.employmentRecord.create.mockResolvedValue(created);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createEmployee(admin as any, {
        user_id: 'user_1',
        employee_id: 'E-001',
        job_title: 'Cleaner',
        start_date: new Date('2026-01-01'),
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
    it('isolates a failing row from succeeding rows', async () => {
      mockPrisma.employmentRecord.findUnique
        .mockResolvedValueOnce(null) // row 0: user_id check
        .mockResolvedValueOnce(null) // row 0: employee_id check
        .mockResolvedValueOnce(fakeRecord()) // row 1: user_id check -> duplicate
        .mockResolvedValueOnce(null);
      mockPrisma.employmentRecord.create.mockResolvedValue(fakeRecord({ employee_id: 'E-001' }));
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.bulkImport(admin as any, [
        { user_id: 'user_1', employee_id: 'E-001', job_title: 'Cleaner', start_date: new Date('2026-01-01') },
        { user_id: 'user_2', employee_id: 'E-002', job_title: 'Waiter', start_date: new Date('2026-01-01') },
      ]);

      expect(result.created).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.index).toBe(1);
    });

    it('rejects a non-admin actor (OD-EMP-08 conservative restriction)', async () => {
      await expect(
        service.bulkImport({ userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any, [
          { user_id: 'user_1', employee_id: 'E-001', job_title: 'Cleaner', start_date: new Date('2026-01-01') },
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
    it('submitForReview denies a role that is neither admin nor a scoped manager/RM', async () => {
      await expect(
        service.submitForReview(
          { userId: 'w_1', role: 'worker', permissions: [], scope: null } as any,
          'E-001'
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('submitForReview sets submitted_for_review_at, stays PENDING', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, submitted_for_review_at: new Date() })
      );
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.submitForReview(admin as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.PENDING);
      expect(result.submitted_for_review_at).not.toBeNull();
    });

    it('approve moves PENDING -> ACTIVE and sets hotel_group_id from the approving manager group (ADR-023 §4)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, hotel_group_id: null, submitted_for_review_at: new Date() })
      );
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'g1' });
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.ACTIVE, hotel_group_id: 'g1' })
      );
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.approve(admin as any, 'E-001');

      expect(result.status).toBe(EmploymentStatus.ACTIVE);
      const updateArg = mockPrisma.employmentRecord.update.mock.calls[0][0] as { data: { hotel_group?: { connect: { id: string } } } };
      expect(updateArg.data.hotel_group?.connect.id).toBe('g1');
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
      mockPrisma.employmentStatusHistory.create.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.rehire(admin as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.ACTIVE);
      expect(result.employment_cycle).toBe(1);
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
});
