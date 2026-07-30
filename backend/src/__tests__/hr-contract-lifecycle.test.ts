import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-HR-001 (ADR-012/ADR-014 bounded context), HR implementation PR 2:
 * service-level regression for IF-HR-CreateContract, IF-HR-ListContracts,
 * IF-HR-GetContractStatus.
 *
 * OD-HR-02b (resolved, HR boundary review): createContract MUST read
 * Personalfragebogen data from the persisted employee-management record
 * (EmploymentRecord.personal_data), not a transient Onboarding source. This
 * suite pins that read path and its failure modes (missing record, null
 * personal_data) as the confirmed prerequisite-data check REQ-HR-001
 * describes.
 *
 * getContractStatus's worker-role self-scope check (OD-HR-10/ADR-042,
 * FIND-SEC-HR-03 IDOR guard) is the actual enforcement point — mirrors
 * documents-service.test.ts's identical pattern for the same
 * worker-self-vs-manager-scope shape (routes.ts's scopeWorkerRoute() lets a
 * worker through to this check rather than being denied by checkWorkerScope()).
 */

const mockContractCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockContractFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockContractFindFirst = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockContractUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockDocumentServiceUpload = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockScan = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    contract: {
      create: mockContractCreate,
      findMany: mockContractFindMany,
      findFirst: mockContractFindFirst,
      update: mockContractUpdate,
    },
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    auditLog: { create: mockAuditLogCreate },
  }),
}));

// Isolated from documents/storage.ts's real-vs-stub S3 branch (covered by
// its own test) — createContract only needs a deterministic key back.
jest.mock('../modules/documents/storage.js', () => ({
  generateStorageKey: (workerId: string, category: string, filename: string) =>
    `documents/${workerId}/${category.toLowerCase()}/test-uuid/${filename}`,
}));

jest.mock('../modules/documents/service.js', () => ({
  documentService: { uploadDocument: mockDocumentServiceUpload },
}));

jest.mock('../modules/hr/malware-scan.js', () => ({
  getMalwareScanner: () => ({ scan: mockScan }),
}));

import { HrService } from '../modules/hr/service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';

const NOW = new Date('2026-08-01T00:00:00.000Z');

function makeContractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    worker_id: 'w1',
    template_id: 'tmpl1',
    position: 'Cleaner',
    start_date: new Date('2026-08-01T00:00:00.000Z'),
    end_date: null,
    status: 'PENDING',
    scanned_document_id: null,
    confirmed_by_id: null,
    confirmed_at: null,
    expires_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('HrService contract lifecycle (SPEC-HR-001 PR 2)', () => {
  let service: HrService;

  beforeEach(() => {
    service = new HrService();
    mockContractCreate.mockReset();
    mockContractFindMany.mockReset();
    mockContractFindFirst.mockReset();
    mockContractUpdate.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
    mockAuditLogCreate.mockReset();
    mockDocumentServiceUpload.mockReset();
    mockScan.mockReset();
    mockScan.mockResolvedValue({ clean: true });
  });

  describe('createContract — OD-HR-02b (persisted employee-management read)', () => {
    it('rejects when no employment record exists for the worker', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue(null);

      await expect(
        service.createContract({
          worker_id: 'w1',
          template_id: 'tmpl1',
          position: 'Cleaner',
          start_date: '2026-08-01',
        })
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(mockContractCreate).not.toHaveBeenCalled();
    });

    it('rejects when the employment record has no Personalfragebogen data yet', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({ personal_data: null });

      await expect(
        service.createContract({
          worker_id: 'w1',
          template_id: 'tmpl1',
          position: 'Cleaner',
          start_date: '2026-08-01',
        })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockContractCreate).not.toHaveBeenCalled();
    });

    it('creates a contract reading persisted Personalfragebogen data (not a transient source)', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({
        personal_data: { first_name: 'Ada', last_name: 'Lovelace' },
      });
      mockContractCreate.mockResolvedValue(makeContractRow());

      const result = await service.createContract({
        worker_id: 'w1',
        template_id: 'tmpl1',
        position: 'Cleaner',
        start_date: '2026-08-01',
      });

      expect(mockEmploymentRecordFindUnique).toHaveBeenCalledWith({
        where: { user_id: 'w1' },
        select: { personal_data: true },
      });
      expect(mockContractCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            worker_id: 'w1',
            template_id: 'tmpl1',
            position: 'Cleaner',
            status: 'PENDING',
          }),
        })
      );
      expect(result.id).toBe('c1');
      expect(result.status).toBe('PENDING');
    });

    it('rejects missing required fields before any read (ADR-039 shape — no salary field accepted)', async () => {
      await expect(
        service.createContract({
          worker_id: 'w1',
          template_id: '',
          position: 'Cleaner',
          start_date: '2026-08-01',
        })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('listContracts', () => {
    it('lists contracts filtered by worker_id and status', async () => {
      mockContractFindMany.mockResolvedValue([makeContractRow()]);

      const result = await service.listContracts({ worker_id: 'w1', status: 'PENDING' });

      expect(mockContractFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { worker_id: 'w1', status: 'PENDING' },
        })
      );
      expect(result).toHaveLength(1);
    });

    it('lists all contracts when no filters are supplied', async () => {
      mockContractFindMany.mockResolvedValue([]);
      await service.listContracts();
      expect(mockContractFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  describe('getContractStatus — OD-HR-10/ADR-042 self-scope (FIND-SEC-HR-03 IDOR guard)', () => {
    it('rejects a worker requesting another worker\'s contract status', async () => {
      await expect(service.getContractStatus('w2', 'w1', 'worker')).rejects.toBeInstanceOf(
        ForbiddenError
      );
      expect(mockContractFindFirst).not.toHaveBeenCalled();
    });

    it('allows a worker to read their own contract status', async () => {
      mockContractFindFirst.mockResolvedValue(makeContractRow());
      const result = await service.getContractStatus('w1', 'w1', 'worker');
      expect(result?.worker_id).toBe('w1');
    });

    it('allows a manager/admin to read any worker\'s contract status (route-level scoping already applied)', async () => {
      mockContractFindFirst.mockResolvedValue(makeContractRow());
      const result = await service.getContractStatus('w1', 'm1', 'manager');
      expect(result?.worker_id).toBe('w1');
    });

    it('returns null when no contract exists yet', async () => {
      mockContractFindFirst.mockResolvedValue(null);
      const result = await service.getContractStatus('w1', 'w1', 'worker');
      expect(result).toBeNull();
    });
  });

  describe('uploadSignedContract — RULE-HR-13/ADR-044 (malware-scan hook)', () => {
    it('rejects when no PENDING contract exists for the worker', async () => {
      mockContractFindFirst.mockResolvedValue(null);

      await expect(
        service.uploadSignedContract('w1', Buffer.from('x'), 'scan.pdf', 'application/pdf', 'm1', 'manager')
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(mockScan).not.toHaveBeenCalled();
      expect(mockDocumentServiceUpload).not.toHaveBeenCalled();
    });

    it('rejects and does not upload when the malware scan detects malicious content', async () => {
      mockContractFindFirst.mockResolvedValue(makeContractRow());
      mockScan.mockResolvedValue({ clean: false, reason: 'test-detection' });

      await expect(
        service.uploadSignedContract('w1', Buffer.from('x'), 'scan.pdf', 'application/pdf', 'm1', 'manager')
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockDocumentServiceUpload).not.toHaveBeenCalled();
    });

    it('scans before persisting, then delegates storage to backend-documents and links the scanned document', async () => {
      mockContractFindFirst.mockResolvedValue(makeContractRow());
      mockDocumentServiceUpload.mockResolvedValue({ id: 'doc1' });
      mockContractUpdate.mockResolvedValue(makeContractRow({ scanned_document_id: 'doc1' }));

      const result = await service.uploadSignedContract(
        'w1',
        Buffer.from('x'),
        'scan.pdf',
        'application/pdf',
        'm1',
        'manager',
        '1.2.3.4'
      );

      expect(mockScan).toHaveBeenCalledWith(Buffer.from('x'));
      expect(mockDocumentServiceUpload).toHaveBeenCalledWith(
        expect.objectContaining({ worker_id: 'w1', actor_id: 'm1', category: 'GENERAL' }),
        Buffer.from('x'),
        'manager',
        '1.2.3.4'
      );
      expect(mockContractUpdate).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { scanned_document_id: 'doc1' },
      });
      expect(result.scanned_document_id).toBe('doc1');
    });
  });

  describe('confirmContractSigned — RULE-HR-03/05/15 (audit trail, expiry clock)', () => {
    it('rejects when no PENDING contract exists for the worker', async () => {
      mockContractFindFirst.mockResolvedValue(null);

      await expect(service.confirmContractSigned('w1', 'm1', 'manager')).rejects.toBeInstanceOf(
        NotFoundError
      );
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('rejects confirmation when no scan has been uploaded yet (CRR §9 safeguard)', async () => {
      mockContractFindFirst.mockResolvedValue(makeContractRow({ scanned_document_id: null }));

      await expect(service.confirmContractSigned('w1', 'm1', 'manager')).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(mockContractUpdate).not.toHaveBeenCalled();
      expect(mockAuditLogCreate).not.toHaveBeenCalled();
    });

    it('confirms, starts the 1-year expiry clock, and writes exactly one immutable audit record (REQ-HR-013/RULE-HR-15)', async () => {
      mockContractFindFirst.mockResolvedValue(makeContractRow({ scanned_document_id: 'doc1' }));
      mockContractUpdate.mockResolvedValue(
        makeContractRow({
          scanned_document_id: 'doc1',
          status: 'ACTIVE',
          confirmed_by_id: 'm1',
          confirmed_at: NOW,
          expires_at: new Date('2027-08-01T00:00:00.000Z'),
        })
      );

      const result = await service.confirmContractSigned('w1', 'm1', 'manager', '1.2.3.4');

      expect(mockContractUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ status: 'ACTIVE', confirmed_by_id: 'm1' }),
        })
      );
      // REQ-HR-013: confirming actor id, timestamp (implicit in logAudit's own
      // schema), worker id, contract id, and the evidence-file reference.
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actor_id: 'm1',
            action: 'hr_contract.confirm_signed',
            resource_type: 'Contract',
            resource_id: 'c1',
          }),
        })
      );
      expect(result.status).toBe('ACTIVE');
    });
  });
});
