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
const mockPayslipRequestUpdate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelGroupFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockDocumentServiceUpload = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockScan = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockNotificationEnqueue = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockResolveNonAdminScopeFilter = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockIsWorkerInGroupScope = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockDeactivateForContractLapse = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

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
    findFirst: mockContractFindFirst,
    update: mockContractUpdate,
  },
  payslipRequest: {
    create: mockPayslipRequestCreate,
    findMany: mockPayslipRequestFindMany,
    findUnique: mockPayslipRequestFindUnique,
    update: mockPayslipRequestUpdate,
  },
  employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
  hotelGroup: { findUnique: mockHotelGroupFindUnique },
  auditLog: { create: mockAuditLogCreate },
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
    mockPayslipRequestUpdate.mockReset();
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

    it('notifies the worker\'s Regional Manager on request (best-effort, OD-CAL-06 posture)', async () => {
      mockPayslipRequestCreate.mockResolvedValue(makePayslipRequestRow());
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });

      await service.requestPayslip({ worker_id: 'w1', period_start: '2026-07-01', period_end: '2026-07-31' });

      expect(mockNotificationEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'rm1', type: 'HR_PAYSLIP_REQUESTED' })
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
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });

      await service.createPayroll({
        worker_id: 'w1',
        period_start: '2026-07-01',
        period_end: '2026-07-31',
      });

      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
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
      expect(result).toHaveLength(1);
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
      expect(mockPayslipRequestUpdate).not.toHaveBeenCalled();
    });

    it('allows admin unconditionally, bypassing the scope check', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(makePayslipRequestRow());
      mockPayslipRequestUpdate.mockResolvedValue(
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
      expect(mockPayslipRequestUpdate).not.toHaveBeenCalled();
    });

    it('allows a manager fulfilling a request for a worker in their own hotel group', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(makePayslipRequestRow({ worker_id: 'w1' }));
      mockIsWorkerInGroupScope.mockResolvedValue(true);
      mockPayslipRequestUpdate.mockResolvedValue(
        makePayslipRequestRow({ status: 'FULFILLED', fulfilled_by_id: 'm1', fulfilled_at: NOW })
      );

      const result = await service.fulfilPayslipRequest('p1', 'm1', 'manager', {
        type: 'hotel_group',
        hotel_group_id: 'g1',
      });

      expect(result.status).toBe('FULFILLED');
    });

    it('marks the request fulfilled and notifies the requesting worker', async () => {
      mockPayslipRequestFindUnique.mockResolvedValue(makePayslipRequestRow());
      mockIsWorkerInGroupScope.mockResolvedValue(true);
      mockPayslipRequestUpdate.mockResolvedValue(
        makePayslipRequestRow({ status: 'FULFILLED', fulfilled_by_id: 'm1', fulfilled_at: NOW })
      );

      const result = await service.fulfilPayslipRequest('p1', 'm1', 'manager', {
        type: 'hotel_group',
        hotel_group_id: 'g1',
      });

      expect(mockPayslipRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
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

      expect(mockPayslipRequestUpdate).not.toHaveBeenCalled();
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

    it('review fix: does NOT mark reminder_1yr_sent_at if the transaction fails after enqueueing (no duplicate reminder on retry)', async () => {
      mockContractFindMany.mockResolvedValue([
        makeContractRow({ status: 'ACTIVE', reminder_1yr_sent_at: null }),
      ]);
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelGroupFindUnique.mockResolvedValue({ regional_manager_user_id: 'rm1' });
      // Simulate: enqueue() (inside the tx) succeeds, but the subsequent
      // tx.contract.update() throws -- the whole transaction must roll back
      // so the notification is NOT left committed without its de-dup marker.
      mockContractUpdate.mockRejectedValueOnce(new Error('db write failed'));

      await expect(service.sendExpiryReminders(86400000, 100)).rejects.toThrow('db write failed');

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockNotificationEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'rm1', type: 'HR_CONTRACT_EXPIRY_REMINDER' }),
        expect.anything()
      );
      // both enqueue() and contract.update() ran inside the SAME
      // this.prisma.$transaction() call -- a real Prisma transaction would
      // roll back enqueue()'s writes too once contract.update() throws.
    });
  });
});
