import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-DOCUMENTS-001 @0.1.4 FROZEN, GD-16 Decided 2026-07-27: service-level
 * regression for the self-scope enforcement that routes.ts's scopeWorkerRoute()
 * deliberately does NOT perform for the 'worker' role (checkWorkerScope() has
 * no worker branch — see routes.ts comment). DocumentService is the actual
 * enforcement point for RULE-DOC-08 / GD-16's "worker may only act on their
 * own document set" requirement.
 */

const mockWorkerDocumentCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockWorkerDocumentFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockWorkerDocumentFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
// IDOR fix (2026-08-08): getDocument()'s manager/RM branch resolves scope
// via isWorkerInGroupScope (lib/scope.ts), which reads these two.
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockWorkerDocumentDelete = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerDocument: {
      create: mockWorkerDocumentCreate,
      findMany: mockWorkerDocumentFindMany,
      findUnique: mockWorkerDocumentFindUnique,
      delete: mockWorkerDocumentDelete,
    },
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    hotel: { findUnique: mockHotelFindUnique },
    auditLog: { create: mockAuditLogCreate },
    $transaction: jest.fn(async (cb: any) => cb({
      workerDocument: { create: mockWorkerDocumentCreate, delete: mockWorkerDocumentDelete },
      auditLog: { create: mockAuditLogCreate }
    })) as jest.MockedFunction<(...args: any[]) => any>,
  }),
}));

// Isolates the service test from env.S3_BUCKET (set in local .env for real
// dev use) — storage.ts's real-vs-stub branch is exercised by its own test,
// not this one.
jest.mock('../modules/documents/storage.js', () => ({
  generateStorageKey: (workerId: string, category: string, filename: string) =>
    `documents/${workerId}/${category.toLowerCase()}/test-uuid/${filename}`,
  getStorageClient: async () => ({
    upload: jest.fn(),
    getPresignedUrl: async () => null,
    delete: jest.fn(),
  }),
}));

import { DocumentService } from '../modules/documents/service.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';

describe('DocumentService (SPEC-DOCUMENTS-001, GD-16)', () => {
  let service: DocumentService;

  beforeEach(() => {
    service = new DocumentService();
    mockWorkerDocumentCreate.mockReset();
    mockWorkerDocumentFindMany.mockReset();
    mockWorkerDocumentFindUnique.mockReset();
    mockAuditLogCreate.mockReset();
  });

  describe('uploadDocument — RULE-DOC-08 self-scope for worker role', () => {
    it('rejects a worker uploading to another worker\'s document set', async () => {
      await expect(
        service.uploadDocument(
          {
            worker_id: 'w2',
            actor_id: 'w1',
            category: 'ID_CARD',
            original_filename: 'id.pdf',
            mime_type: 'application/pdf',
            file_size_bytes: 100,
          },
          Buffer.from('x'),
          'worker'
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
    });

    it('allows a worker uploading to their own document set', async () => {
      mockWorkerDocumentCreate.mockResolvedValue({
        id: 'd1',
        worker_id: 'w1',
        uploaded_by_id: 'w1',
        category: 'ID_CARD',
        s3_key: 'documents/w1/general/uuid/id.pdf',
        original_filename: 'id.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1,
        expires_at: null,
        is_work_permit: false,
        created_at: new Date('2026-07-27T00:00:00.000Z'),
        updated_at: new Date('2026-07-27T00:00:00.000Z'),
      });

      const result = await service.uploadDocument(
        {
          worker_id: 'w1',
          actor_id: 'w1',
          category: 'ID_CARD',
          original_filename: 'id.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 1,
        },
        Buffer.from('x'),
        'worker'
      );

      expect(result.worker_id).toBe('w1');
      // s3_key must never appear in the client-facing DTO (OD-DOC-017).
      expect(result).not.toHaveProperty('s3_key');
      expect(mockAuditLogCreate).toHaveBeenCalled();
    });

    // RULE B (project-owner decision, 2026-08-12): "nobody may perform another
    // user's onboarding." Upload is now SELF-ONLY for EVERY role, so this case
    // is inverted — GD-16's "manager-upload (actor 2)" allowance was
    // deliberately withdrawn by the owner, not accidentally broken.
    it('denies a manager uploading for another worker (RULE B: self-only, reverses GD-16 actor 2)', async () => {
      await expect(
        service.uploadDocument(
          {
            worker_id: 'w1',
            actor_id: 'm1',
            category: 'WORK_PERMIT',
            original_filename: 'permit.pdf',
            mime_type: 'application/pdf',
            file_size_bytes: 1,
            is_work_permit: true,
          },
          Buffer.from('x'),
          'manager'
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
    });

    it('denies an ADMIN uploading for another worker (RULE B applies to every role)', async () => {
      await expect(
        service.uploadDocument(
          {
            worker_id: 'w1',
            actor_id: 'adm_1',
            category: 'WORK_PERMIT',
            original_filename: 'permit.pdf',
            mime_type: 'application/pdf',
            file_size_bytes: 1,
            is_work_permit: true,
          },
          Buffer.from('x'),
          'admin'
        )
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockWorkerDocumentCreate).not.toHaveBeenCalled();
    });

    // The `systemGenerated` escape hatch, asserted so its existence is visible
    // and its blast radius pinned: it is the ONLY way a non-self upload can
    // succeed, it is unreachable from any HTTP route (no controller sets it),
    // and it exists for the HR contract-scan and rendered-template-PDF paths.
    // See documents/service.ts#uploadDocument's note.
    it('allows a non-self upload ONLY when the caller declares systemGenerated (HR contract scan / rendered PDF)', async () => {
      mockWorkerDocumentCreate.mockResolvedValue({
        id: 'd2',
        worker_id: 'w1',
        uploaded_by_id: 'm1',
        category: 'WORK_PERMIT',
        s3_key: 'documents/w1/work_permit/uuid/permit.pdf',
        original_filename: 'permit.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1,
        expires_at: null,
        is_work_permit: true,
        created_at: new Date('2026-07-27T00:00:00.000Z'),
        updated_at: new Date('2026-07-27T00:00:00.000Z'),
      });

      const result = await service.uploadDocument(
        {
          worker_id: 'w1',
          actor_id: 'm1',
          category: 'WORK_PERMIT',
          original_filename: 'permit.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 1,
          is_work_permit: true,
        },
        Buffer.from('x'),
        'manager',
        undefined,
        { systemGenerated: true }
      );

      expect(result.uploaded_by_id).toBe('m1');
    });
  });

  describe('listWorkerDocuments — self-scope', () => {
    it('rejects a worker listing another worker\'s documents', async () => {
      await expect(
        service.listWorkerDocuments('w2', 'w1', 'worker')
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockWorkerDocumentFindMany).not.toHaveBeenCalled();
    });
  });

  describe('getDocument — FIND-SEC-DOC-01 ownership binding', () => {
    it('throws NotFoundError when the document does not exist', async () => {
      mockWorkerDocumentFindUnique.mockResolvedValue(null);
      await expect(service.getDocument('missing', 'w1', 'worker')).rejects.toBeInstanceOf(
        NotFoundError
      );
    });

    it('rejects a worker fetching a document that is not their own', async () => {
      mockWorkerDocumentFindUnique.mockResolvedValue({
        id: 'd1',
        worker_id: 'w2',
        s3_key: 'k',
      });
      await expect(service.getDocument('d1', 'w1', 'worker')).rejects.toBeInstanceOf(
        ForbiddenError
      );
    });

    // IDOR fix (2026-08-08): routes.ts has no checkHotelAccess()/
    // checkWorkerScope() on GET /documents/:document_id at all, and
    // getDocument() previously only checked ownership for actorRole ===
    // 'worker' -- a manager/RM fell through both checks entirely and could
    // download any document platform-wide by id.
    describe('manager/regional_manager scope (IDOR fix, 2026-08-08)', () => {
      it("allows a manager to fetch a document for a worker in their hotel's group", async () => {
        mockWorkerDocumentFindUnique.mockResolvedValue({
          id: 'd1',
          worker_id: 'w2',
          s3_key: 'k',
          created_at: new Date(),
          updated_at: new Date(),
        });
        mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        const result = await service.getDocument('d1', 'mgr1', 'manager', { type: 'hotel', hotel_id: 'h1' });
        expect(result.id).toBe('d1');
      });

      it('denies a manager fetching a document for a worker outside their scope', async () => {
        mockWorkerDocumentFindUnique.mockResolvedValue({ id: 'd1', worker_id: 'w2', s3_key: 'k' });
        mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g_other' });
        mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        await expect(
          service.getDocument('d1', 'mgr1', 'manager', { type: 'hotel', hotel_id: 'h1' })
        ).rejects.toBeInstanceOf(ForbiddenError);
      });

      it('denies a regional_manager with no scope claim (deny-by-default)', async () => {
        mockWorkerDocumentFindUnique.mockResolvedValue({ id: 'd1', worker_id: 'w2', s3_key: 'k' });
        await expect(
          service.getDocument('d1', 'rm1', 'regional_manager', null)
        ).rejects.toBeInstanceOf(ForbiddenError);
      });

      it('allows an admin to fetch any document (unconditional bypass)', async () => {
        mockWorkerDocumentFindUnique.mockResolvedValue({
          id: 'd1',
          worker_id: 'w2',
          s3_key: 'k',
          created_at: new Date(),
          updated_at: new Date(),
        });
        const result = await service.getDocument('d1', 'adm1', 'admin', { type: 'global' });
        expect(result.id).toBe('d1');
      });
    });
  });

  describe('getDocumentCompleteness — REQ-DOC-002/005', () => {
    it('is incomplete when mandatory documents are missing', async () => {
      mockWorkerDocumentFindMany.mockResolvedValue([]);
      const result = await service.getDocumentCompleteness('w1', false);
      expect(result.is_complete).toBe(false);
      expect(result.missing_categories).toEqual([
        'TAX_NUMBER',
        'SOCIAL_SECURITY_NUMBER',
        'HEALTH_INSURANCE',
        'ID_CARD',
        'PASSPORT',
        'ADDRESS'
      ]);
    });

    it('requires WORK_PERMIT only when work_permit_required is true', async () => {
      mockWorkerDocumentFindMany.mockResolvedValue([
        { category: 'TAX_NUMBER' },
        { category: 'SOCIAL_SECURITY_NUMBER' },
        { category: 'HEALTH_INSURANCE' },
        { category: 'ID_CARD' },
        { category: 'PASSPORT' },
        { category: 'ADDRESS' },
      ]);
      const notRequired = await service.getDocumentCompleteness('w1', false);
      expect(notRequired.is_complete).toBe(true);

      const required = await service.getDocumentCompleteness('w1', true);
      expect(required.is_complete).toBe(false);
      expect(required.missing_categories).toEqual(['WORK_PERMIT']);
    });
  });

  // 2026-08-13 onboarding audit, finding #1 (critical). A worker could submit
  // a COMPLETE application and then delete mandatory documents while it sat in
  // the reviewer's queue, leaving the reviewer approving an application that
  // was silently missing legally required files. Reproduced end-to-end before
  // the fix; pinned here so it cannot regress silently.
  describe('deleteDocument — review lock', () => {
    const doc = {
      id: 'd1',
      worker_id: 'w1',
      category: 'PASSPORT',
      s3_key: 'k',
      original_filename: 'p.pdf',
      hr_contract_scan: null,
    };

    beforeEach(() => {
      mockWorkerDocumentFindUnique.mockReset();
      mockWorkerDocumentDelete.mockReset();
      mockEmploymentRecordFindUnique.mockReset();
      mockAuditLogCreate.mockReset();
      mockAuditLogCreate.mockResolvedValue({});
      mockWorkerDocumentDelete.mockResolvedValue({});
    });

    it('refuses deletion while the application is awaiting review', async () => {
      mockWorkerDocumentFindUnique.mockResolvedValue(doc);
      mockEmploymentRecordFindUnique.mockResolvedValue({
        status: 'PENDING',
        submitted_for_review_at: new Date(),
      });

      await expect(service.deleteDocument('d1', 'w1', 'worker')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
      // The denial must be a NON-WRITE: a 403 that still deleted the row
      // would be worse than no check at all.
      expect(mockWorkerDocumentDelete).not.toHaveBeenCalled();
    });

    it('allows deletion before submission (the applicant is still editing)', async () => {
      mockWorkerDocumentFindUnique.mockResolvedValue(doc);
      mockEmploymentRecordFindUnique.mockResolvedValue({
        status: 'PENDING',
        submitted_for_review_at: null,
      });

      await service.deleteDocument('d1', 'w1', 'worker');
      expect(mockWorkerDocumentDelete).toHaveBeenCalledTimes(1);
    });

    // Compliance: an employed worker must not be able to destroy records the
    // company is legally required to retain. The first version of this lock
    // only covered PENDING applications and disengaged the moment someone was
    // hired, which is the wider hole.
    it('refuses deletion once the worker is ACTIVE (compliance records)', async () => {
      mockWorkerDocumentFindUnique.mockResolvedValue(doc);
      mockEmploymentRecordFindUnique.mockResolvedValue({
        status: 'ACTIVE',
        submitted_for_review_at: new Date(),
      });

      await expect(service.deleteDocument('d1', 'w1', 'worker')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
      expect(mockWorkerDocumentDelete).not.toHaveBeenCalled();
    });

    it('refuses deletion for a DEACTIVATED worker (still employed, just paused)', async () => {
      mockWorkerDocumentFindUnique.mockResolvedValue(doc);
      mockEmploymentRecordFindUnique.mockResolvedValue({
        status: 'DEACTIVATED',
        submitted_for_review_at: new Date(),
      });

      await expect(service.deleteDocument('d1', 'w1', 'worker')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
      expect(mockWorkerDocumentDelete).not.toHaveBeenCalled();
    });

    it('allows deletion after a rejection, so the wrong document can be replaced', async () => {
      mockWorkerDocumentFindUnique.mockResolvedValue(doc);
      mockEmploymentRecordFindUnique.mockResolvedValue({
        status: 'REJECTED',
        submitted_for_review_at: new Date(),
      });

      await service.deleteDocument('d1', 'w1', 'worker');
      expect(mockWorkerDocumentDelete).toHaveBeenCalledTimes(1);
    });
  });
});
