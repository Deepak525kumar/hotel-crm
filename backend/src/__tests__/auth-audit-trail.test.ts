import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * ADR-016: backend-auth is the authoritative writer of AuditLog and owns
 * any read interface over it. getAuditTrail() is intentionally generic --
 * no field, filter, or DTO shape here is specific to any one caller (e.g.
 * backend-compliance). Mirrors RetentionService.getDeletionAuditLog's and
 * ConsentService.getAuditHistory's own test coverage for their equivalent
 * bounded/paginated audit-read interfaces.
 */

const mockAuditLogFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockAuditLogCount = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    auditLog: {
      findMany: mockAuditLogFindMany,
      count: mockAuditLogCount,
    },
  }),
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-x',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { AuthService } from '../modules/auth/service.js';

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
    timestamp: NOW,
    ...overrides,
  };
}

describe('AuthService.getAuditTrail (ADR-016)', () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
    mockAuditLogFindMany.mockReset();
    mockAuditLogCount.mockReset();
  });

  it('returns audit entries and a total count', async () => {
    mockAuditLogFindMany.mockResolvedValue([makeEntry()]);
    mockAuditLogCount.mockResolvedValue(1);

    const result = await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('audit1');
  });

  it('returns an empty result, not an error, when no entries match', async () => {
    mockAuditLogFindMany.mockResolvedValue([]);
    mockAuditLogCount.mockResolvedValue(0);

    const result = await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(result).toEqual({ data: [], total: 0 });
  });

  it('bounds the query with pagination (skip/take), never an unbounded scan', async () => {
    mockAuditLogFindMany.mockResolvedValue([]);
    mockAuditLogCount.mockResolvedValue(0);

    await service.getAuditTrail({ page: 3, per_page: 10 });

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it('defaults to page 1 / per_page 20 when omitted', async () => {
    mockAuditLogFindMany.mockResolvedValue([]);
    mockAuditLogCount.mockResolvedValue(0);

    await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    );
  });

  it('applies no filter when none is supplied', async () => {
    mockAuditLogFindMany.mockResolvedValue([]);
    mockAuditLogCount.mockResolvedValue(0);

    await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it('filters by actor_id, action, resource_type, and resource_id together when all are supplied', async () => {
    mockAuditLogFindMany.mockResolvedValue([]);
    mockAuditLogCount.mockResolvedValue(0);

    await service.getAuditTrail({
      actor_id: 'user1',
      action: 'LOGIN',
      resource_type: 'USER',
      resource_id: 'user1',
      page: 1,
      per_page: 20,
    });

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          actor_id: 'user1',
          action: 'LOGIN',
          resource_type: 'USER',
          resource_id: 'user1',
        },
      })
    );
  });

  it('normalizes a lowercase actor_role filter to the stored uppercase enum value', async () => {
    mockAuditLogFindMany.mockResolvedValue([]);
    mockAuditLogCount.mockResolvedValue(0);

    await service.getAuditTrail({ actor_role: 'admin', page: 1, per_page: 20 });

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { actor_role: 'ADMIN' } })
    );
  });

  it('bounds by date range when from/to are supplied', async () => {
    mockAuditLogFindMany.mockResolvedValue([]);
    mockAuditLogCount.mockResolvedValue(0);

    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-06-01T00:00:00.000Z');
    await service.getAuditTrail({ from, to, page: 1, per_page: 20 });

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { timestamp: { gte: from, lte: to } } })
    );
  });

  it('orders results newest-first', async () => {
    mockAuditLogFindMany.mockResolvedValue([]);
    mockAuditLogCount.mockResolvedValue(0);

    await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { timestamp: 'desc' } })
    );
  });

  it('serializes timestamp as an ISO string in the returned DTO', async () => {
    mockAuditLogFindMany.mockResolvedValue([makeEntry({ timestamp: NOW })]);
    mockAuditLogCount.mockResolvedValue(1);

    const result = await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(result.data[0].timestamp).toBe(NOW.toISOString());
  });

  it('maps every AuditLog field into the DTO without reshaping it for any particular caller', async () => {
    mockAuditLogFindMany.mockResolvedValue([makeEntry()]);
    mockAuditLogCount.mockResolvedValue(1);

    const result = await service.getAuditTrail({ page: 1, per_page: 20 });

    expect(Object.keys(result.data[0]).sort()).toEqual(
      [
        'action',
        'actor_id',
        'actor_role',
        'details',
        'id',
        'ip_address',
        'new_values',
        'old_values',
        'resource_id',
        'resource_type',
        'timestamp',
      ].sort()
    );
  });
});
