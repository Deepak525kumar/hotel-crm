import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * RULE B — "nobody may perform another user's onboarding" (project-owner
 * decision, 2026-08-12).
 *
 * Document upload and submit-for-review are SELF-SERVICE ONLY. Every role,
 * ADMIN INCLUDED, is denied when acting on another user's onboarding
 * artifacts. This suite asserts both surfaces at the ROUTE level — through the
 * real express router and its real middleware chain — because the enforcement
 * that matters is the one a live HTTP request meets, not a service method a
 * test can call directly.
 *
 * The complementary service-layer assertions live in `documents-service.test.ts`
 * (upload) and `employee-management.test.ts` (submit). Both layers are asserted
 * deliberately: the route check and the service check are independent, and this
 * project has twice shipped a hidden UI control in front of a live route.
 *
 * SCOPE — approve/assign/reject/deactivate/reactivate/rehire are NOT
 * self-service and must KEEP the hierarchy above the applicant (a Manager's
 * application is still approved by an RM or Admin). The final describe block
 * asserts that explicitly, so a future over-application of RULE B to the whole
 * lifecycle fails here.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => true,
  isRmRoleEnabled: () => true,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    hotel: { findUnique: mockHotelFindUnique },
  }),
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

const ok = (_req: Request, res: Response) => res.status(200).json({ ok: true });
const created = (_req: Request, res: Response) => res.status(201).json({ ok: true });

// Controllers are stubbed to succeed: any non-2xx therefore comes from the
// middleware chain under test, and a 2xx proves the request reached the
// handler rather than being denied for an unrelated reason.
jest.mock('../modules/documents/controller.js', () => ({
  documentController: {
    uploadDocument: created,
    listWorkerDocuments: ok,
    getDocument: ok,
    getDocumentCompleteness: ok,
    exportWorkerDocuments: ok,
  },
}));

import express from 'express';
import request from 'supertest';
import documentsRouter from '../modules/documents/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/documents', documentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

const ALL_ROLES = ['admin', 'regional_manager', 'manager', 'checker', 'worker'] as const;

describe('RULE B — document upload is self-service only (route layer)', () => {
  beforeEach(() => {
    testAuth = null;
    mockEmploymentRecordFindUnique.mockReset();
    mockHotelFindUnique.mockReset();
    // Deliberately configured so that a GROUP-SCOPE check, if one were still
    // in the chain, would PASS. Any denial below is therefore RULE B's
    // self-check and not a scope failure — otherwise these tests could pass
    // for the wrong reason.
    mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockHotelFindUnique.mockResolvedValue({ id: 'h1', hotel_group_id: 'g1' });
  });

  describe('every role is denied uploading for ANOTHER user', () => {
    it.each(ALL_ROLES)('denies %s uploading to another user\'s document set', async (role) => {
      testAuth = {
        userId: `actor_${role}`,
        role,
        permissions: ['employees:write', 'employees:read'],
        // A matching group claim: if scope still governed this route, this
        // would be an ALLOW. It must not be.
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp())
        .post('/documents/workers/someone_else/documents')
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    // The single most important case: admin previously drove the whole
    // onboarding lifecycle for anyone. That is the bypass RULE B closed.
    it('denies ADMIN specifically, with no scope-based bypass', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['admin:*'], scope: { type: 'global' } };
      const res = await request(makeApp()).post('/documents/workers/w_other/documents').send({});
      expect(res.status).toBe(403);
      // A global scope claim must not be consulted, let alone honoured.
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('every role MAY upload for itself (the rule is about whose record, not which role)', () => {
    it.each(ALL_ROLES)('allows %s uploading to its OWN document set', async (role) => {
      testAuth = { userId: 'self_1', role, permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).post('/documents/workers/self_1/documents').send({});
      expect(res.status).toBe(201);
    });
  });

  // Guards against "enforcement" by way of a role gate: if a future change
  // denied upload to admin/manager/RM outright instead of self-scoping it,
  // the self-upload cases above would fail — and if it denied everyone, the
  // block above would fail too. Both directions are pinned.
  it('the denial is identity-based, not role-based (same role, different target, opposite outcomes)', async () => {
    testAuth = { userId: 'a1', role: 'admin', permissions: ['admin:*'], scope: { type: 'global' } };
    const own = await request(makeApp()).post('/documents/workers/a1/documents').send({});
    const other = await request(makeApp()).post('/documents/workers/a2/documents').send({});
    expect(own.status).toBe(201);
    expect(other.status).toBe(403);
  });

  // RULE B covers WRITES. Reads keep their existing group-scoped manager
  // access — narrowing those was not the owner's decision, and silently
  // breaking a manager's ability to REVIEW documents would be a regression.
  describe('reads are unaffected (RULE B covers upload/submit, not visibility)', () => {
    it('still allows a group-scoped manager to LIST another worker\'s documents', async () => {
      testAuth = {
        userId: 'm1',
        role: 'manager',
        permissions: ['employees:read'],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).get('/documents/workers/w1/documents');
      expect(res.status).toBe(200);
    });

    it('still allows an admin to LIST another worker\'s documents', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: ['admin:*'], scope: { type: 'global' } };
      const res = await request(makeApp()).get('/documents/workers/w1/documents');
      expect(res.status).toBe(200);
    });
  });
});

// =======================================================================
// submit-for-review, at the service layer (the route admits all five roles
// by design — assertLifecycleAuthority is the boundary, so that is where
// self-only has to be proven).
// =======================================================================
describe('RULE B — submit-for-review is self-service only, and ONLY submit is', () => {
  const RECORD_OWNER = 'applicant_1';

  const prismaStub: any = {
    employmentRecord: {
      findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
      update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    },
    employmentStatusHistory: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
    user: { findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
    hotelGroup: { findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
    hotel: { findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
    auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
    // submitForReview enforces the document-completeness gate, and the
    // lifecycle writes run inside a transaction. Stubbed so the ALLOW cases
    // exercise authorization rather than dying on an unrelated missing table —
    // the completeness/contract gates have their own dedicated suites.
    workerDocument: { findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
    contract: { findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  };
  prismaStub.$transaction = async (fn: any) => fn(prismaStub);

  let service: any;

  beforeEach(async () => {
    jest.resetModules();
    jest.doMock('../lib/db.js', () => ({ getPrisma: () => prismaStub }));
    const { EmployeeManagementService } = await import('../modules/employee-management/service.js');
    service = new EmployeeManagementService();

    prismaStub.employmentRecord.findUnique.mockReset();
    prismaStub.employmentRecord.update.mockReset();
    prismaStub.employmentRecord.findUnique.mockResolvedValue({
      id: 'emp_1',
      user_id: RECORD_OWNER,
      employee_id: 'E-001',
      status: 'PENDING',
      submitted_for_review_at: null,
      hotel_group_id: 'g1',
      version: 1,
      skills: [],
      personal_data: null,
      konfession: null,
      disability_status: null,
      deleted_at: null,
      job_title: 'Cleaner',
      start_date: new Date('2026-01-01'),
      marked_suitable: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    prismaStub.employmentRecord.update.mockResolvedValue({
      id: 'emp_1',
      user_id: RECORD_OWNER,
      employee_id: 'E-001',
      status: 'PENDING',
      submitted_for_review_at: new Date(),
      hotel_group_id: 'g1',
      skills: [],
      personal_data: null,
      konfession: null,
      disability_status: null,
      deleted_at: null,
      job_title: 'Cleaner',
      start_date: new Date('2026-01-01'),
      marked_suitable: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    prismaStub.user.findUnique.mockResolvedValue({ id: RECORD_OWNER, role: 'WORKER' });
    prismaStub.hotelGroup.findUnique.mockResolvedValue({ id: 'g1' });
    prismaStub.hotel.findFirst.mockResolvedValue({ hotel_group_id: 'g1' });
    prismaStub.auditLog.create.mockResolvedValue({});
    prismaStub.employmentStatusHistory.create.mockResolvedValue({});
    prismaStub.hotel.findUnique.mockResolvedValue({ id: 'h1', hotel_group_id: 'g1' });
    prismaStub.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'ACTIVE' });
    // A COMPLETE document set, so submitForReview's completeness gate passes
    // and the ALLOW cases below test authorization rather than paperwork.
    prismaStub.workerDocument.findMany.mockResolvedValue([
      { category: 'TAX_NUMBER' },
      { category: 'SOCIAL_SECURITY_NUMBER' },
      { category: 'HEALTH_INSURANCE' },
      { category: 'ID_CARD' },
      { category: 'PASSPORT' },
      { category: 'ADDRESS' },
      { category: 'WORK_PERMIT' },
    ]);
  });

  it.each(ALL_ROLES)('denies %s submitting ANOTHER user\'s application', async (role) => {
    await expect(
      service.submitForReview(
        {
          userId: `actor_${role}`,
          role,
          permissions: ['employees:write'],
          // Matching group scope: would be an ALLOW if scope still governed
          // this action. It must not be.
          scope: { type: 'hotel_group', hotel_group_id: 'g1' },
        },
        'E-001'
      )
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(prismaStub.employmentRecord.update).not.toHaveBeenCalled();
  });

  it('allows the applicant to submit their OWN application', async () => {
    const result = await service.submitForReview(
      { userId: RECORD_OWNER, role: 'worker', permissions: ['employees:read'], scope: null },
      'E-001'
    );
    expect(result.submitted_for_review_at).not.toBeNull();
    expect(prismaStub.employmentRecord.update).toHaveBeenCalledTimes(1);
  });

  it('allows a MANAGER applicant to submit their own application (self, despite being privileged)', async () => {
    prismaStub.user.findUnique.mockResolvedValue({ id: RECORD_OWNER, role: 'MANAGER' });
    const result = await service.submitForReview(
      {
        userId: RECORD_OWNER,
        role: 'manager',
        permissions: ['employees:write'],
        scope: { type: 'hotel', hotel_id: 'h1' },
      },
      'E-001'
    );
    expect(result.submitted_for_review_at).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // The explicit NON-scope of RULE B. approve/assign/reject are review
  // decisions BY the hierarchy ABOVE the applicant and must NOT become
  // self-service (that would let an applicant approve themselves) and must
  // NOT be narrowed to 1-level-down (RULE A governs create only).
  // ---------------------------------------------------------------------
  describe('approve/reject remain hierarchy actions, NOT self-service (RULE B does not apply)', () => {
    beforeEach(() => {
      prismaStub.employmentRecord.findUnique.mockResolvedValue({
        id: 'emp_1',
        user_id: RECORD_OWNER,
        employee_id: 'E-001',
        status: 'PENDING',
        submitted_for_review_at: new Date(),
        hotel_group_id: 'g1',
        version: 1,
        skills: [],
        personal_data: null,
        konfession: null,
        disability_status: null,
        deleted_at: null,
        job_title: 'Cleaner',
        start_date: new Date('2026-01-01'),
        marked_suitable: false,
        created_at: new Date(),
        updated_at: new Date(),
      });
      prismaStub.employmentRecord.update.mockResolvedValue({
        id: 'emp_1',
        user_id: RECORD_OWNER,
        employee_id: 'E-001',
        status: 'REJECTED',
        hotel_group_id: 'g1',
        skills: [],
        personal_data: null,
        konfession: null,
        disability_status: null,
        deleted_at: null,
        job_title: 'Cleaner',
        start_date: new Date('2026-01-01'),
        marked_suitable: false,
        submitted_for_review_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    it('a group-scoped MANAGER may still reject another user\'s application', async () => {
      const result = await service.reject(
        {
          userId: 'mgr_1',
          role: 'manager',
          permissions: ['employees:write'],
          scope: { type: 'hotel_group', hotel_group_id: 'g1' },
        },
        'E-001'
      );
      expect(result.status).toBe('REJECTED');
    });

    it('an ADMIN may still reject another user\'s application', async () => {
      const result = await service.reject(
        { userId: 'adm_1', role: 'admin', permissions: ['admin:*'], scope: { type: 'global' } },
        'E-001'
      );
      expect(result.status).toBe('REJECTED');
    });

    it('an applicant may NOT reject their own application (self-service is submit-only)', async () => {
      await expect(
        service.reject(
          { userId: RECORD_OWNER, role: 'worker', permissions: ['employees:read'], scope: null },
          'E-001'
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });
  });
});
