import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-COMPLIANCE-001@0.1.0 REVIEW (NOT FROZEN): PR 2 -- IF-COMPLIANCE-
 * GetAuditTrail (REQ-COMPLIANCE-010, RULE-COMPLIANCE-01). ComplianceService
 * owns no Prisma model and never queries AuditLog directly -- this suite
 * asserts it is a pure pass-through to authService.getAuditTrail(), never
 * reshaping the query or the returned DTO into a Compliance-specific shape.
 */

const mockGetAuditTrail = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/auth/service.js', () => ({
  authService: { getAuditTrail: mockGetAuditTrail },
}));

import { ComplianceService } from '../modules/compliance/service.js';

const NOW = new Date('2026-08-02T12:00:00.000Z');

function makeEntry(overrides: Record<string, unknown> = {}) {
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
  });

  it('delegates to authService.getAuditTrail with the query unchanged', async () => {
    mockGetAuditTrail.mockResolvedValue({ data: [], total: 0 });

    const query = { actor_id: 'user1', page: 1, per_page: 20 };
    await service.getAuditTrail(query);

    expect(mockGetAuditTrail).toHaveBeenCalledWith(query);
    expect(mockGetAuditTrail).toHaveBeenCalledTimes(1);
  });

  it('returns authService.getAuditTrail\'s result unchanged -- no reshaping into a Compliance-specific DTO', async () => {
    const upstream = { data: [makeEntry()], total: 1 };
    mockGetAuditTrail.mockResolvedValue(upstream);

    const result = await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(result).toBe(upstream);
  });

  it('propagates an empty result, not an error, when authService finds nothing', async () => {
    mockGetAuditTrail.mockResolvedValue({ data: [], total: 0 });

    const result = await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(result).toEqual({ data: [], total: 0 });
  });

  it('RULE-COMPLIANCE-01: exposes no `prisma` property (BaseService is not extended, no direct table access is possible)', () => {
    // Structural guard: ComplianceService deliberately does NOT extend
    // BaseService (unlike RetentionService/ConsentService, which own a
    // Prisma model and legitimately need `this.prisma`). Its only route to
    // AuditLog is the authService.getAuditTrail() call above -- there is no
    // `this.prisma` property here for a future edit to accidentally misuse.
    expect((service as unknown as { prisma?: unknown }).prisma).toBeUndefined();
  });
});
