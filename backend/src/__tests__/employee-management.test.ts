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

const mockPrisma = {
  employmentRecord: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  employeeBlocklistEntry: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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

  describe('lifecycle transitions (REQ-EMP-002 / RULE-EMP-02, 03, 12)', () => {
    it.each([
      [EmploymentStatus.PENDING, EmploymentStatus.PENDING],
      [EmploymentStatus.PENDING, EmploymentStatus.ACTIVE],
      [EmploymentStatus.PENDING, EmploymentStatus.REJECTED],
      [EmploymentStatus.ACTIVE, EmploymentStatus.DEACTIVATED],
    ])('allows %s -> %s', (from, to) => {
      expect(() => assertTransition(from, to)).not.toThrow();
    });

    it.each([
      [EmploymentStatus.PENDING, EmploymentStatus.ACTIVE],
      [EmploymentStatus.ACTIVE, EmploymentStatus.PENDING],
      [EmploymentStatus.PENDING, EmploymentStatus.REJECTED],
      [EmploymentStatus.REJECTED, EmploymentStatus.ACTIVE],
      [EmploymentStatus.DEACTIVATED, EmploymentStatus.ACTIVE],
      [EmploymentStatus.DEACTIVATED, EmploymentStatus.PENDING],
    ])('rejects illegal transition %s -> %s', (from, to) => {
      expect(() => assertTransition(from, to)).toThrow();
    });

    it('rejects INACTIVE -> ACTIVE (illegal, must go through UNDER_REVIEW)', () => {
      expect(() => assertTransition(EmploymentStatus.PENDING, EmploymentStatus.ACTIVE)).toThrow();
    });

    it('rejects ACTIVE -> UNDER_REVIEW (illegal)', () => {
      expect(() => assertTransition(EmploymentStatus.ACTIVE, EmploymentStatus.PENDING)).toThrow();
    });

    it('has no Suspended state anywhere in the enum or transition table', () => {
      const allStates = Object.values(EmploymentStatus);
      expect(allStates).not.toContain('SUSPENDED');
    });

    it('deactivate() enforces the transition table via the service', async () => {
      const record = fakeRecord({ status: EmploymentStatus.PENDING });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(record);

      await expect(service.deactivate(admin as any, 'E-001', DeactivationReason.TEMPORARY_LEAVE)).rejects.toMatchObject({ name: 'ValidationError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('deactivate() succeeds from Active', async () => {
      const record = fakeRecord({ status: EmploymentStatus.ACTIVE });
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(record);
      mockPrisma.employmentRecord.update.mockResolvedValue({ ...record, status: EmploymentStatus.DEACTIVATED, deleted_at: new Date() });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.deactivate(admin as any, 'E-001', DeactivationReason.TEMPORARY_LEAVE);
      expect(result.status).toBe(EmploymentStatus.DEACTIVATED);
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

  // IF-EMP-LifecycleSignal (RULE-EMP-03; hotel_group_id assignment per
  // ADR-023 §4). Authorization + the full signal->status transition path,
  // exercised through the service (not only the assertTransition unit).
  describe('lifecycleSignal (IF-EMP-LifecycleSignal / RULE-EMP-03 / ADR-023 §4)', () => {
    it('rejects a non-admin actor (internal-only transport, OD-EMP-09)', async () => {
      await expect(
        service.submitForReview(
          { userId: 'mgr_1', role: 'manager', permissions: [], scope: null } as any,
          'E-001'
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('submitted_for_review moves Inactive -> Under Review', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      mockPrisma.employmentRecord.update.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.submitForReview(admin as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.PENDING);
    });

    it('approved moves Under Review -> Active and sets hotel_group_id from the approving manager group (ADR-023 §4)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.PENDING, hotel_group_id: null })
      );
      mockPrisma.hotelGroup.findUnique.mockResolvedValue({ id: 'g1' });
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.ACTIVE, hotel_group_id: 'g1' })
      );
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.approve(admin as any, 'E-001');

      expect(result.status).toBe(EmploymentStatus.ACTIVE);
      const updateArg = mockPrisma.employmentRecord.update.mock.calls[0][0] as { data: { hotel_group?: { connect: { id: string } } } };
      expect(updateArg.data.hotel_group?.connect.id).toBe('g1');
    });

    it('rejected moves Under Review -> Rejected', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      mockPrisma.employmentRecord.update.mockResolvedValue(fakeRecord({ status: EmploymentStatus.REJECTED }));
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.reject(admin as any, 'E-001');
      expect(result.status).toBe(EmploymentStatus.REJECTED);
    });

    it('rejects an illegal signal transition (approved from Inactive) and does not write', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(fakeRecord({ status: EmploymentStatus.PENDING }));
      await expect(service.approve(admin as any, 'E-001')).rejects.toMatchObject({
        name: 'ValidationError',
      });
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
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

    it('deactivate rejects a non-admin actor', async () => {
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

  describe('deactivateForContractLapse (ADR-045, HR implementation PR 5)', () => {
    it('is a no-op when no employment record exists for the user (best-effort)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(null);
      await service.deactivateForContractLapse('user_1', 'contract_lapse_manual');
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('is idempotent when the record is already DEACTIVATED', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DEACTIVATED })
      );
      await service.deactivateForContractLapse('user_1', 'contract_lapse_manual');
      expect(mockPrisma.employmentRecord.update).not.toHaveBeenCalled();
    });

    it('deactivates an ACTIVE record with no actor.role gate (internal cross-module call)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.ACTIVE })
      );
      mockPrisma.employmentRecord.update.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DEACTIVATED })
      );

      await service.deactivateForContractLapse('user_1', 'contract_lapse_manual');

      expect(mockPrisma.employmentRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp_1' },
          data: expect.objectContaining({ status: EmploymentStatus.DEACTIVATED }),
        })
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'employee.deactivate.contract_lapse' }),
        })
      );
    });

    it('rejects an illegal transition (e.g. from REJECTED, matching assertTransition)', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.REJECTED })
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

    it('returns null for a soft-deleted record instead of resurfacing deactivated history', async () => {
      mockPrisma.employmentRecord.findUnique.mockResolvedValue(
        fakeRecord({ status: EmploymentStatus.DEACTIVATED, deleted_at: new Date() })
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
