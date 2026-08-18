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
const mockPayslipRequestCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockPayslipRequestFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockPayslipRequestFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockPayslipRequestFindUniqueOrThrow = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockPayslipRequestUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockPayslipRequestUpdateMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelGroupFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockDocumentServiceUpload = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockScan = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockNotificationEnqueue = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockResolveNonAdminScopeFilter = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockIsWorkerInGroupScope = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockDeactivateForContractLapse = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
// 2026-08-13: confirmContractSigned/getContractStatus now also resolve the
// APPLICANT-uploaded signed scan (a CONTRACT_SCAN WorkerDocument), because the
// manager-upload path is not the one applicants actually use. Defaults to "no
// such document", so every pre-existing expectation in this file keeps its
// original meaning (scanned_document_id remains the only signal).
const mockWorkerDocumentFindFirst = jest.fn(() => Promise.resolve(null)) as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

// sendExpiryReminders() wraps notifyResponsibleManagerOfExpiry()+contract.update()
// in one this.prisma.$transaction() (review fix). The mocked tx client reuses
// the SAME mock fns as the outer client so existing assertions (e.g.
// mockContractUpdate, mockEmploymentRecordFindUnique) keep working unchanged
// whether a given code path is inside or outside the transaction.
const txClient = {
  contract: {
    create: mockContractCreate,
    findMany: mockContractFindMany,
    count: jest.fn(() => Promise.resolve(0)),
    findFirst: mockContractFindFirst,
    update: mockContractUpdate,
  },
  payslipRequest: {
    create: mockPayslipRequestCreate,
    findMany: mockPayslipRequestFindMany,
    count: jest.fn(() => Promise.resolve(0)),
    findUnique: mockPayslipRequestFindUnique,
    findUniqueOrThrow: mockPayslipRequestFindUniqueOrThrow,
    update: mockPayslipRequestUpdate,
    updateMany: mockPayslipRequestUpdateMany,
  },
  employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
  hotelGroup: { findUnique: mockHotelGroupFindUnique },
  auditLog: { create: mockAuditLogCreate },
  workerDocument: { findFirst: mockWorkerDocumentFindFirst },
};
const mockTransaction = jest.fn((callback: (tx: typeof txClient) => Promise<unknown>) =>
  callback(txClient)
) as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    ...txClient,
    $transaction: mockTransaction,
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

jest.mock('../modules/notifications/service.js', () => ({
  notificationService: { enqueue: mockNotificationEnqueue },
}));

jest.mock('../lib/scope.js', () => ({
  resolveNonAdminScopeFilter: mockResolveNonAdminScopeFilter,
  isWorkerInGroupScope: mockIsWorkerInGroupScope,
}));

jest.mock('../modules/employee-management/service.js', () => ({
  employeeManagementService: { deactivateForContractLapse: mockDeactivateForContractLapse },
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
    employment_type: 'FULL_TIME',
    scanned_document_id: null,
    confirmed_by_id: null,
    confirmed_at: null,
    expires_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makePayslipRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    worker_id: 'w1',
    period_start: new Date('2026-07-01T00:00:00.000Z'),
    period_end: new Date('2026-07-31T00:00:00.000Z'),
    status: 'REQUESTED',
    fulfilled_by_id: null,
    fulfilled_at: null,
    escalated_at: null,
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
    mockPayslipRequestCreate.mockReset();
    mockPayslipRequestFindMany.mockReset();
    mockPayslipRequestFindUnique.mockReset();
    mockPayslipRequestFindUniqueOrThrow.mockReset();
    mockPayslipRequestUpdate.mockReset();
    mockPayslipRequestUpdateMany.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
    mockHotelGroupFindUnique.mockReset();
    mockAuditLogCreate.mockReset();
    mockDocumentServiceUpload.mockReset();
    mockScan.mockReset();
    mockScan.mockResolvedValue({ clean: true });
    mockNotificationEnqueue.mockReset();
    mockResolveNonAdminScopeFilter.mockReset();
    mockIsWorkerInGroupScope.mockReset();
    mockDeactivateForContractLapse.mockReset();
    mockTransaction.mockClear();
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
        employment_type: 'FULL_TIME',
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
        select: { personal_data: true, employment_type: true },
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
      expect(result.data).toHaveLength(1);
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
      // RULE B (2026-08-12) made worker-document upload self-only. A contract
      // SCAN is the counterparty's record of an already-signed contract, not
      // the applicant's own onboarding upload, so this delegation declares
      // `systemGenerated`. Asserted explicitly so dropping the flag (breaking
      // contract scanning) or widening it fails here.
      expect(mockDocumentServiceUpload).toHaveBeenCalledWith(
        expect.objectContaining({ worker_id: 'w1', actor_id: 'm1', category: 'CONTRACT_SCAN' }),
        Buffer.from('x'),
        'manager',
        '1.2.3.4',
        { systemGenerated: true }
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
            action: 'hr_contract.confirm_signed',
            actor_id: 'm1',
            resource_type: 'Contract',
            resource_id: 'c1',
          }),
        }),
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('rolls back the contract update if logAudit fails', async () => {
      mockContractFindFirst.mockResolvedValue(
        makeContractRow({ status: 'PENDING', scanned_document_id: 'doc1' })
      );
      mockAuditLogCreate.mockRejectedValueOnce(new Error('audit failed'));

      await expect(service.confirmContractSigned('w1', 'm1', 'manager', '1.2.3.4')).rejects.toThrow('audit failed');

      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestPayslip — RULE-HR-09/ADR-042, EVT-HR-PayslipRequested', () => {
    it('rejects missing required fields', async () => {
      await expect(
        service.requestPayslip({ worker_id: 'w1', period_start: '', period_end: '2026-07-31' })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockPayslipRequestCreate).not.toHaveBeenCalled();
    });

    it('creates the request with ADR-039 shape (no gross-salary/computation field)', async () => {
      mockPayslipRequestCreate.mockResolvedValue(makePayslipRequestRow());
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });

      const result = await service.requestPayslip({
        worker_id: 'w1',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
      });

      expect(mockPayslipRequestCreate).toHaveBeenCalledWith({
        data: {
          worker_id: 'w1',
          period_start: new Date('2026-07-01T00:00:00.000Z'),
          period_end: new Date('2026-07-31T00:00:00.000Z'),
          status: 'REQUESTED',
        },
      });
      expect(result.id).toBe('p1');
    });

    it('rolls back the payslip request creation if notifyResponsibleManager (notification enqueue) fails', async () => {
      mockPayslipRequestCreate.mockResolvedValue(makePayslipRequestRow());
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });
      mockNotificationEnqueue.mockRejectedValueOnce(new Error('notification failed'));

      await expect(service.requestPayslip({ worker_id: 'w1', period_start: '2026-07-01', period_end: '2026-07-31' })).rejects.toThrow('notification failed');
      
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('notifies the worker\'s Regional Manager on request (best-effort, OD-CAL-06 posture)', async () => {
      mockPayslipRequestCreate.mockResolvedValue(makePayslipRequestRow());
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });

      await service.requestPayslip({ worker_id: 'w1', period_start: '2026-07-01', period_end: '2026-07-31' });

      expect(mockNotificationEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'rm1', type: 'HR_PAYSLIP_REQUESTED' }),
        expect.anything()
      );
    });

    it('sends no notification for an unassigned/inactive worker (best-effort, no fallback)', async () => {
      mockPayslipRequestCreate.mockResolvedValue(makePayslipRequestRow());
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'INACTIVE', hotel_group_id: null });

      await service.requestPayslip({ worker_id: 'w1', period_start: '2026-07-01', period_end: '2026-07-31' });

      expect(mockNotificationEnqueue).not.toHaveBeenCalled();
    });

  });

  describe('createPayroll — IF-HR-CreatePayroll (Manager/Admin-initiated, no notification)', () => {
    it('rejects missing required fields', async () => {
      await expect(
        service.createPayroll({ worker_id: 'w1', period_start: '', period_end: '2026-07-31' })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockPayslipRequestCreate).not.toHaveBeenCalled();
    });

    it('creates the request record with the same ADR-039 shape as requestPayslip', async () => {
      mockPayslipRequestCreate.mockResolvedValue(makePayslipRequestRow());
      mockEmploymentRecordFindUnique.mockResolvedValue({ start_date: new Date('2026-06-01T00:00:00.000Z') });

      const result = await service.createPayroll({
        worker_id: 'w1',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
      });

      expect(mockPayslipRequestCreate).toHaveBeenCalledWith({
        data: {
          worker_id: 'w1',
          period_start: new Date('2026-07-01T00:00:00.000Z'),
          period_end: new Date('2026-07-31T00:00:00.000Z'),
          status: 'REQUESTED',
        },
      });
      expect(result.id).toBe('p1');
    });

    it('does NOT notify the responsible manager — EVT-HR-PayslipRequested triggers on worker submission only (RULE-HR-09)', async () => {
      mockPayslipRequestCreate.mockResolvedValue(makePayslipRequestRow());
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1', start_date: new Date('2026-06-01T00:00:00.000Z') });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });

      await service.createPayroll({
        worker_id: 'w1',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
      });

      expect(mockEmploymentRecordFindUnique).toHaveBeenCalledTimes(1); // Only the validation check, not the notification check
      expect(mockEmploymentRecordFindUnique).toHaveBeenCalledWith({ where: { user_id: 'w1' }, select: { start_date: true } });
      expect(mockNotificationEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('listPayroll — ADR-039/ADR-043 (request records, Manager group-scoped)', () => {
    it('lists all requests for admin (unscoped)', async () => {
      mockPayslipRequestFindMany.mockResolvedValue([makePayslipRequestRow()]);
      const result = await service.listPayroll({}, { role: 'admin', scope: null });
      expect(mockPayslipRequestFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} })
      );
      expect(result.data).toHaveLength(1);
    });

    it('scopes results to the manager\'s own hotel_group_id (ADR-043)', async () => {
      mockResolveNonAdminScopeFilter.mockResolvedValue({ kind: 'group', hotelGroupId: 'g1' });
      mockPayslipRequestFindMany.mockResolvedValue([]);

      await service.listPayroll({}, { role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } });

      expect(mockPayslipRequestFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { worker: { employment_record: { hotel_group_id: 'g1' } } },
        })
      );
    });

    it('denies (zero rows) when the manager\'s scope resolves to deny', async () => {
      mockResolveNonAdminScopeFilter.mockResolvedValue({ kind: 'deny' });
      mockPayslipRequestFindMany.mockResolvedValue([]);

      await service.listPayroll({}, { role: 'manager', scope: null });

      expect(mockPayslipRequestFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { worker_id: '__none__' } })
      );
    });
  });

  describe('fulfilPayslipRequest — RULE-HR-09, EVT-HR-PayslipFulfilled, OD-HR-13 (manager scope)', () => {
    it('rejects when the request does not exist', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(null);
      await expect(service.fulfilPayslipRequest('p1', 'm1', 'manager')).rejects.toBeInstanceOf(
        NotFoundError
      );
      expect(mockPayslipRequestUpdateMany).not.toHaveBeenCalled();
    });

    it('allows admin unconditionally, bypassing the scope check', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(makePayslipRequestRow());
      mockPayslipRequestUpdateMany.mockResolvedValue({ count: 1 });
      mockPayslipRequestFindUniqueOrThrow.mockResolvedValue(
        makePayslipRequestRow({ status: 'FULFILLED', fulfilled_by_id: 'a1', fulfilled_at: NOW })
      );

      const result = await service.fulfilPayslipRequest('p1', 'a1', 'admin');

      expect(mockIsWorkerInGroupScope).not.toHaveBeenCalled();
      expect(result.status).toBe('FULFILLED');
    });

    it('denies a manager fulfilling a request for a worker outside their hotel group (OD-HR-13)', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(makePayslipRequestRow({ worker_id: 'w1' }));
      mockIsWorkerInGroupScope.mockResolvedValue(false);

      await expect(
        service.fulfilPayslipRequest('p1', 'm1', 'manager', { type: 'hotel_group', hotel_group_id: 'g1' })
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(mockIsWorkerInGroupScope).toHaveBeenCalledWith(
        { type: 'hotel_group', hotel_group_id: 'g1' },
        'w1'
      );
      expect(mockPayslipRequestUpdateMany).not.toHaveBeenCalled();
    });

    it('allows a manager fulfilling a request for a worker in their own hotel group', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(makePayslipRequestRow({ worker_id: 'w1' }));
      mockIsWorkerInGroupScope.mockResolvedValue(true);
      mockPayslipRequestUpdateMany.mockResolvedValue({ count: 1 });
      mockPayslipRequestFindUniqueOrThrow.mockResolvedValue(
        makePayslipRequestRow({ status: 'FULFILLED', fulfilled_by_id: 'm1', fulfilled_at: NOW })
      );

      const result = await service.fulfilPayslipRequest('p1', 'm1', 'manager', {
        type: 'hotel_group',
        hotel_group_id: 'g1',
      });

      expect(result.status).toBe('FULFILLED');
    });

    it('marks the request fulfilled via an atomic compare-and-swap and notifies the requesting worker', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(makePayslipRequestRow());
      mockIsWorkerInGroupScope.mockResolvedValue(true);
      mockPayslipRequestUpdateMany.mockResolvedValue({ count: 1 });
      mockPayslipRequestFindUniqueOrThrow.mockResolvedValue(
        makePayslipRequestRow({ status: 'FULFILLED', fulfilled_by_id: 'm1', fulfilled_at: NOW })
      );

      const result = await service.fulfilPayslipRequest('p1', 'm1', 'manager', {
        type: 'hotel_group',
        hotel_group_id: 'g1',
      });

      // The WHERE clause conditions on status: REQUESTED -- this is the
      // compare-and-swap that makes the transition atomic under concurrency,
      // not just the earlier findUnique+status-check fast path.
      expect(mockPayslipRequestUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1', status: 'REQUESTED' },
          data: expect.objectContaining({ status: 'FULFILLED', fulfilled_by_id: 'm1' }),
        })
      );
      expect(mockNotificationEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'w1', type: 'HR_PAYSLIP_FULFILLED' })
      );
      expect(result.status).toBe('FULFILLED');
    });

    it('rejects re-fulfilling an already-FULFILLED request (no duplicate fulfilment, no re-notification)', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(
        makePayslipRequestRow({ status: 'FULFILLED', fulfilled_by_id: 'm1', fulfilled_at: NOW })
      );

      await expect(service.fulfilPayslipRequest('p1', 'a1', 'admin')).rejects.toBeInstanceOf(
        ValidationError
      );

      expect(mockPayslipRequestUpdateMany).not.toHaveBeenCalled();
      expect(mockNotificationEnqueue).not.toHaveBeenCalled();
    });

    it('review fix (concurrency): rejects when a concurrent caller already flipped the row between the read and the compare-and-swap', async () => {
      // Simulates the TOCTOU race this fix closes: the initial findUnique()
      // still sees REQUESTED (a concurrent caller's write hasn't landed
      // there yet), so the fast-path check passes -- but by the time this
      // caller's updateMany() WHERE clause is evaluated, the row has
      // already been flipped to FULFILLED by the other caller, so
      // updateMany() matches zero rows.
      mockPayslipRequestFindUnique.mockResolvedValue(makePayslipRequestRow({ status: 'REQUESTED' }));
      mockIsWorkerInGroupScope.mockResolvedValue(true);
      mockPayslipRequestUpdateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.fulfilPayslipRequest('p1', 'm1', 'manager', { type: 'hotel_group', hotel_group_id: 'g1' })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mockPayslipRequestUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', status: 'REQUESTED' } })
      );
      expect(mockPayslipRequestFindUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockNotificationEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('extendContract — RULE-HR-06/07, ADR-040 (manager-only, no worker veto)', () => {
    it('rejects when no active/extended contract exists', async () => {
      mockContractFindFirst.mockResolvedValue(null);
      await expect(service.extendContract('w1', 'm1', 'manager')).rejects.toBeInstanceOf(NotFoundError);
      expect(mockContractUpdate).not.toHaveBeenCalled();
    });

    it('extends ACTIVE -> EXTENDED, advancing expires_at by one year', async () => {
      mockContractFindFirst.mockResolvedValue(
        makeContractRow({ status: 'ACTIVE', expires_at: new Date('2027-08-01T00:00:00.000Z') })
      );
      mockContractUpdate.mockResolvedValue(makeContractRow({ status: 'EXTENDED' }));

      const result = await service.extendContract('w1', 'm1', 'manager');

      expect(mockContractUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({
            status: 'EXTENDED',
            expires_at: new Date('2028-08-01T00:00:00.000Z'),
          }),
        })
      );
      expect(result.status).toBe('EXTENDED');
    });

    it('makes EXTENDED -> PERMANENT, clearing expires_at (no further reminders)', async () => {
      mockContractFindFirst.mockResolvedValue(makeContractRow({ status: 'EXTENDED' }));
      mockContractUpdate.mockResolvedValue(makeContractRow({ status: 'PERMANENT', expires_at: null }));

      const result = await service.extendContract('w1', 'm1', 'manager');

      expect(mockContractUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ status: 'PERMANENT', expires_at: null }),
        })
      );
      expect(result.status).toBe('PERMANENT');
    });
  });

  describe('manualLapseContract — ADR-040 PATH (a), ADR-045 deactivation integration', () => {
    it('rejects when no lapsable contract exists', async () => {
      mockContractFindFirst.mockResolvedValue(null);
      await expect(service.manualLapseContract('w1', 'm1', 'manager')).rejects.toBeInstanceOf(
        NotFoundError
      );
      expect(mockDeactivateForContractLapse).not.toHaveBeenCalled();
    });

    it('calls employeeManagementService.deactivateForContractLapse and notifies the worker', async () => {
      mockContractFindFirst.mockResolvedValue(makeContractRow({ status: 'ACTIVE' }));

      const result = await service.manualLapseContract('w1', 'm1', 'manager');

      expect(mockDeactivateForContractLapse).toHaveBeenCalledWith('w1', 'contract_lapse_manual');
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'hr_contract.lapse', actor_id: 'm1' }),
        })
      );
      expect(mockNotificationEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'w1', type: 'HR_CONTRACT_LAPSED' })
      );
      expect(result.id).toBe('c1');
    });

    it('documents the accepted non-idempotency gap (disclosed in-code, not fixed by design): a second call against the same still-ACTIVE contract re-runs every side effect', async () => {
      // This test asserts what the code CURRENTLY does, not what it SHOULD
      // do -- it is a pin on present behavior, not an endorsement of it. The
      // duplicate audit entry and duplicate worker notification this proves
      // are a known, disclosed gap (see this method's own header comment),
      // deferred pending a future business-concept decision (e.g. a real
      // "lapsed" contract state), not accepted as correct or desirable.
      // The Contract row is never mutated to a "lapsed" state (RULE-HR-06/
      // REQ-HR-006 has no fourth state), so findFirst() matches the same
      // contract on both calls. Per the commissioning human's explicit
      // direction, no lapsed_at column or EmploymentRecord-status pre-check
      // is being added here -- if this test starts failing because a future
      // change makes this idempotent, that is the deliberate, desired
      // outcome: update this test to match the new (better) contract rather
      // than treating the failure as a regression to revert.
      mockContractFindFirst.mockResolvedValue(makeContractRow({ status: 'ACTIVE' }));

      await service.manualLapseContract('w1', 'm1', 'manager');
      await service.manualLapseContract('w1', 'm1', 'manager');

      expect(mockDeactivateForContractLapse).toHaveBeenCalledTimes(2);
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(2);
      expect(mockNotificationEnqueue).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendExpiryReminders — IF-HR-ContractExpiryReminder (scheduled job)', () => {
    it('sends a 1yr-mark reminder for an ACTIVE contract and records reminder_1yr_sent_at', async () => {
      mockContractFindMany.mockResolvedValue([
        makeContractRow({ status: 'ACTIVE', reminder_1yr_sent_at: null }),
      ]);
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });

      const sent = await service.sendExpiryReminders(86400000, 100);

      expect(sent).toBe(1);
      expect(mockNotificationEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'rm1', type: 'HR_CONTRACT_EXPIRY_REMINDER' }),
        expect.anything()
      );
      expect(mockContractUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { reminder_1yr_sent_at: expect.any(Date) } })
      );
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('sends a 2yr-mark reminder for an EXTENDED contract and records reminder_2yr_sent_at', async () => {
      mockContractFindMany.mockResolvedValue([
        makeContractRow({ status: 'EXTENDED', reminder_2yr_sent_at: null }),
      ]);
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });

      const sent = await service.sendExpiryReminders(86400000, 100);

      expect(sent).toBe(1);
      expect(mockContractUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { reminder_2yr_sent_at: expect.any(Date) } })
      );
    });

    it('skips a contract whose mark has already been reminded (de-duplication guard)', async () => {
      mockContractFindMany.mockResolvedValue([
        makeContractRow({ status: 'ACTIVE', reminder_1yr_sent_at: NOW }),
      ]);

      const sent = await service.sendExpiryReminders(86400000, 100);

      expect(sent).toBe(0);
      expect(mockNotificationEnqueue).not.toHaveBeenCalled();
    });

    it('sends no notification and does not crash for an unassigned/inactive worker (best-effort)', async () => {
      mockContractFindMany.mockResolvedValue([
        makeContractRow({ status: 'ACTIVE', reminder_1yr_sent_at: null }),
      ]);
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'INACTIVE', hotel_group_id: null });

      const sent = await service.sendExpiryReminders(86400000, 100);

      expect(sent).toBe(1); // still counted/marked sent -- de-dup guard fires regardless of delivery
      expect(mockNotificationEnqueue).not.toHaveBeenCalled();
    });

    it('review fix: enqueue() and contract.update() run inside the same $transaction() call', async () => {
      mockContractFindMany.mockResolvedValue([
        makeContractRow({ status: 'ACTIVE', reminder_1yr_sent_at: null }),
      ]);
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });
      // Simulate tx.contract.update() throwing after enqueue() already ran.
      // This mock can only prove BOTH calls happen inside the same
      // this.prisma.$transaction() callback -- it cannot simulate actual
      // database rollback (there's no real DB here). Both operations
      // executing inside one transaction is what lets Prisma provide
      // rollback semantics if either operation fails; that guarantee itself
      // is Prisma's, not something this mock can verify.
      mockContractUpdate.mockRejectedValueOnce(new Error('db write failed'));

      await expect(service.sendExpiryReminders(86400000, 100)).rejects.toThrow('db write failed');

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockNotificationEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'rm1', type: 'HR_CONTRACT_EXPIRY_REMINDER' }),
        expect.anything()
      );
    });
  });
});

// ---------------------------------------------------------------------------
// hrService.listPayroll — worker IDOR guard (OD-HR-10, FIND-SEC-HR-03, ADR-042)
// ---------------------------------------------------------------------------
// Service-level tests for the IDOR guard added in PR 1 (backend:
// hr:payslip:read-own). The route-level token check (requirePayslipReadAccess)
// is covered by hr-authz.test.ts; these tests verify that a worker cannot
// circumvent the guard by manipulating the worker_id query param.
describe('HrService.listPayroll — worker IDOR guard (OD-HR-10/FIND-SEC-HR-03)', () => {
  let service: HrService;

  beforeEach(() => {
    service = new HrService();
    mockPayslipRequestFindMany.mockReset();
    mockResolveNonAdminScopeFilter.mockReset();
  });

  it('returns only the worker\'s own requests when worker_id matches their userId', async () => {
    const row = makePayslipRequestRow({ worker_id: 'w1' });
    mockPayslipRequestFindMany.mockResolvedValue([row]);

    const result = await service.listPayroll(
      { worker_id: 'w1' },
      { role: 'worker', userId: 'w1' }
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].worker_id).toBe('w1');
    // resolveNonAdminScopeFilter is never called for a worker-role caller —
    // the IDOR guard short-circuits before that branch.
    expect(mockResolveNonAdminScopeFilter).not.toHaveBeenCalled();
    // Prisma was called with the forced worker_id filter.
    expect(mockPayslipRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ worker_id: 'w1' }) })
    );
  });

  it('throws ForbiddenError when a worker passes another worker\'s worker_id (IDOR denial)', async () => {
    await expect(
      service.listPayroll(
        { worker_id: 'w2' }, // attacker passes a different worker's ID
        { role: 'worker', userId: 'w1' }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The DB must never be reached — the guard fires before any Prisma call.
    expect(mockPayslipRequestFindMany).not.toHaveBeenCalled();
  });

  it('forces worker_id to the caller\'s own userId when the query param is omitted', async () => {
    const row = makePayslipRequestRow({ worker_id: 'w1' });
    mockPayslipRequestFindMany.mockResolvedValue([row]);

    const result = await service.listPayroll(
      {}, // no worker_id supplied
      { role: 'worker', userId: 'w1' }
    );

    expect(result.data).toHaveLength(1);
    // Prisma must have been called with the forced filter, not an open query.
    expect(mockPayslipRequestFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ worker_id: 'w1' }) })
    );
    expect(mockResolveNonAdminScopeFilter).not.toHaveBeenCalled();
  });
});
