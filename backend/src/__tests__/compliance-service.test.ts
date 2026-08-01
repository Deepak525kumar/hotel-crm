import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-COMPLIANCE-001@0.1.0 REVIEW (NOT FROZEN): PR 2/3 -- IF-COMPLIANCE-
 * GetAuditTrail (REQ-COMPLIANCE-010, RULE-COMPLIANCE-01) and IF-COMPLIANCE-
 * FulfilSubjectRightsRequest (REQ-COMPLIANCE-011, RULE-COMPLIANCE-02).
 * ComplianceService owns no Prisma model of its own -- it extends
 * BaseService only to reach the shared logAudit() write path (ADR-016);
 * every read is a direct in-process call into authService/consentService/
 * documentService, never a direct prisma.* query on another module's table.
 */

const mockGetAuditTrail = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockGetAuditHistory = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockExportWorkerDocuments = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/auth/service.js', () => ({
  authService: { getAuditTrail: mockGetAuditTrail },
}));

jest.mock('../modules/consent/service.js', () => ({
  consentService: { getAuditHistory: mockGetAuditHistory },
}));

jest.mock('../modules/documents/service.js', () => ({
  documentService: { exportWorkerDocuments: mockExportWorkerDocuments },
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    auditLog: { create: mockAuditLogCreate },
  }),
}));

import { ComplianceService } from '../modules/compliance/service.js';

const NOW = new Date('2026-08-02T12:00:00.000Z');

function makeAuditEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit1',
    actor_id: 'user1',
    actor_role: 'ADMIN',
    action: 'LOGIN',
    resource_type: 'USER',
    resource_id: 'user1',
    old_values: null,
    new_values: null,
    details: null,
    ip_address: '127.0.0.1',
    timestamp: NOW.toISOString(),
    ...overrides,
  };
}

describe('ComplianceService.getAuditTrail — IF-COMPLIANCE-GetAuditTrail', () => {
  let service: ComplianceService;

  beforeEach(() => {
    service = new ComplianceService();
    mockGetAuditTrail.mockReset();
    mockGetAuditHistory.mockReset();
    mockExportWorkerDocuments.mockReset();
    mockAuditLogCreate.mockReset().mockResolvedValue({});
  });

  it('delegates to authService.getAuditTrail with the query unchanged', async () => {
    mockGetAuditTrail.mockResolvedValue({ data: [], total: 0 });

    const query = { actor_id: 'user1', page: 1, per_page: 20 };
    await service.getAuditTrail(query);

    expect(mockGetAuditTrail).toHaveBeenCalledWith(query);
    expect(mockGetAuditTrail).toHaveBeenCalledTimes(1);
  });

  it('returns authService.getAuditTrail\'s result unchanged -- no reshaping into a Compliance-specific DTO', async () => {
    const upstream = { data: [makeAuditEntry()], total: 1 };
    mockGetAuditTrail.mockResolvedValue(upstream);

    const result = await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(result).toBe(upstream);
  });

  it('propagates an empty result, not an error, when authService finds nothing', async () => {
    mockGetAuditTrail.mockResolvedValue({ data: [], total: 0 });

    const result = await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(result).toEqual({ data: [], total: 0 });
  });

  it('propagates an authService.getAuditTrail rejection unchanged, never swallowing or translating it', async () => {
    const upstreamError = new Error('auth service unavailable');
    mockGetAuditTrail.mockRejectedValue(upstreamError);

    await expect(service.getAuditTrail({ page: 1, per_page: 20 })).rejects.toBe(upstreamError);
  });
});

describe('ComplianceService.fulfilSubjectRightsRequest — IF-COMPLIANCE-FulfilSubjectRightsRequest', () => {
  let service: ComplianceService;

  beforeEach(() => {
    service = new ComplianceService();
    mockGetAuditTrail.mockReset();
    mockGetAuditHistory.mockReset();
    mockExportWorkerDocuments.mockReset();
    mockAuditLogCreate.mockReset().mockResolvedValue({});
  });

  it('assembles a bundle from all three sources when each succeeds', async () => {
    mockExportWorkerDocuments.mockResolvedValue([{ id: 'doc1' }]);
    mockGetAuditHistory.mockResolvedValue({ data: [{ id: 'consent1' }], total: 1 });
    mockGetAuditTrail.mockResolvedValue({ data: [makeAuditEntry()], total: 1 });

    const result = await service.fulfilSubjectRightsRequest('worker1');

    expect(result.worker_id).toBe('worker1');
    expect(result.documents).toEqual({ status: 'ok', data: [{ id: 'doc1' }] });
    expect(result.consent_history).toEqual({ status: 'ok', data: { data: [{ id: 'consent1' }], total: 1 } });
    expect(result.audit_trail).toEqual({ status: 'ok', data: { data: [makeAuditEntry()], total: 1 } });
    expect(result.generated_at).toBeTruthy();
  });

  it('self-scopes every source call to the requesting worker, self-role, and worker_id', async () => {
    mockExportWorkerDocuments.mockResolvedValue([]);
    mockGetAuditHistory.mockResolvedValue({ data: [], total: 0 });
    mockGetAuditTrail.mockResolvedValue({ data: [], total: 0 });

    await service.fulfilSubjectRightsRequest('worker1');

    expect(mockExportWorkerDocuments).toHaveBeenCalledWith('worker1', 'worker1', 'worker');
    expect(mockGetAuditHistory).toHaveBeenCalledWith(
      { worker_id: 'worker1', page: 1, per_page: 100 },
      { userId: 'worker1', role: 'worker' }
    );
    expect(mockGetAuditTrail).toHaveBeenCalledWith({ actor_id: 'worker1', page: 1, per_page: 100 });
  });

  it('OD-COMPLIANCE-005: reports one source as unavailable, not the whole request failing, when documents fails', async () => {
    mockExportWorkerDocuments.mockRejectedValue(new Error('documents unavailable'));
    mockGetAuditHistory.mockResolvedValue({ data: [], total: 0 });
    mockGetAuditTrail.mockResolvedValue({ data: [], total: 0 });

    const result = await service.fulfilSubjectRightsRequest('worker1');

    expect(result.documents).toEqual({ status: 'unavailable', data: null });
    expect(result.consent_history.status).toBe('ok');
    expect(result.audit_trail.status).toBe('ok');
  });

  it('OD-COMPLIANCE-005: reports each source independently unavailable when all three fail', async () => {
    mockExportWorkerDocuments.mockRejectedValue(new Error('down'));
    mockGetAuditHistory.mockRejectedValue(new Error('down'));
    mockGetAuditTrail.mockRejectedValue(new Error('down'));

    const result = await service.fulfilSubjectRightsRequest('worker1');

    expect(result.documents).toEqual({ status: 'unavailable', data: null });
    expect(result.consent_history).toEqual({ status: 'unavailable', data: null });
    expect(result.audit_trail).toEqual({ status: 'unavailable', data: null });
  });

  it('OD-COMPLIANCE-008: writes its own AuditLog entry for the fulfilment action', async () => {
    mockExportWorkerDocuments.mockResolvedValue([]);
    mockGetAuditHistory.mockResolvedValue({ data: [], total: 0 });
    mockGetAuditTrail.mockResolvedValue({ data: [], total: 0 });

    await service.fulfilSubjectRightsRequest('worker1');

    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    const call = mockAuditLogCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({
      actor_id: 'worker1',
      action: 'EXPORT',
      resource_type: 'SUBJECT_RIGHTS_REQUEST',
      resource_id: 'worker1',
    });
  });

  it('does not duplicate any source module\'s data -- returns each source\'s own DTO shape unchanged', async () => {
    const docs = [{ id: 'doc1', worker_id: 'worker1' }];
    mockExportWorkerDocuments.mockResolvedValue(docs);
    mockGetAuditHistory.mockResolvedValue({ data: [], total: 0 });
    mockGetAuditTrail.mockResolvedValue({ data: [], total: 0 });

    const result = await service.fulfilSubjectRightsRequest('worker1');

    expect(result.documents.data).toBe(docs);
  });
});
