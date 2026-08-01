import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN): service-level regression for
 * PR 2/4's scope -- IF-RETENTION-RegisterCategory, IF-RETENTION-TagRecord,
 * IF-RETENTION-GetDeletionAuditLog.
 */

const mockRetentionCategoryFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockRetentionCategoryCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockRetentionLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockRetentionAuditEntryFindMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockRetentionAuditEntryCount = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

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
    retentionCategory: {
      findUnique: mockRetentionCategoryFindUnique,
      create: mockRetentionCategoryCreate,
    },
    retentionLog: {
      create: mockRetentionLogCreate,
    },
    retentionAuditEntry: {
      findMany: mockRetentionAuditEntryFindMany,
      count: mockRetentionAuditEntryCount,
    },
  }),
}));

import { RetentionService } from '../modules/retention/service.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';

const NOW = new Date('2026-08-01T12:00:00.000Z');

function makeCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat1',
    module_id: 'attendance',
    category_id: 'shift_coordinate',
    tier: 'TIER_1',
    created_at: NOW,
    ...overrides,
  };
}

function makeLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log1',
    category_id: 'cat1',
    record_ref: 'attendance-record-42',
    tagged_at: NOW,
    deleted_at: null,
    created_at: NOW,
    ...overrides,
  };
}

function makeAuditEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit1',
    module_id: 'attendance',
    category_id: 'shift_coordinate',
    tier: 'TIER_1',
    deleted_at: NOW,
    created_at: NOW,
    ...overrides,
  };
}

describe('RetentionService (SPEC-RETENTION-001, PR 2/4)', () => {
  let service: RetentionService;

  beforeEach(() => {
    service = new RetentionService();
    mockRetentionCategoryFindUnique.mockReset();
    mockRetentionCategoryCreate.mockReset();
    mockRetentionLogCreate.mockReset();
    mockRetentionAuditEntryFindMany.mockReset();
    mockRetentionAuditEntryCount.mockReset();
  });

  describe('registerCategory — REQ-RETENTION-014/RULE-RETENTION-02', () => {
    it('creates a new category when none exists for (module_id, category_id)', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(null);
      mockRetentionCategoryCreate.mockResolvedValue(makeCategory());

      const result = await service.registerCategory({
        module_id: 'attendance',
        category_id: 'shift_coordinate',
        tier: 'TIER_1' as any,
      });

      expect(mockRetentionCategoryCreate).toHaveBeenCalledWith({
        data: { module_id: 'attendance', category_id: 'shift_coordinate', tier: 'TIER_1' },
      });
      expect(result).toEqual({
        id: 'cat1',
        module_id: 'attendance',
        category_id: 'shift_coordinate',
        tier: 'TIER_1',
        window: { unit: 'months', amount: 6 },
      });
    });

    it('returns the tier window derived from the registered tier, not a caller-supplied value', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(null);
      mockRetentionCategoryCreate.mockResolvedValue(makeCategory({ tier: 'TIER_3' }));

      const result = await service.registerCategory({
        module_id: 'hr',
        category_id: 'payroll_iban',
        tier: 'TIER_3' as any,
      });

      expect(result.window).toEqual({ unit: 'years', amount: 6 });
    });

    it('RULE-RETENTION-02: never infers a tier -- passes through exactly the caller-supplied tier', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(null);
      mockRetentionCategoryCreate.mockImplementation((args: any) =>
        Promise.resolve(makeCategory({ tier: args.data.tier }))
      );

      const result = await service.registerCategory({
        module_id: 'documents',
        category_id: 'work_permit',
        tier: 'TIER_2' as any,
      });

      expect(result.tier).toBe('TIER_2');
    });

    it('OD-RETENTION-03 (open; PR default): is idempotent when re-registering the same (module_id, category_id, tier)', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(makeCategory({ tier: 'TIER_1' }));

      const result = await service.registerCategory({
        module_id: 'attendance',
        category_id: 'shift_coordinate',
        tier: 'TIER_1' as any,
      });

      expect(mockRetentionCategoryCreate).not.toHaveBeenCalled();
      expect(result.tier).toBe('TIER_1');
    });

    it('OD-RETENTION-03 (open; PR default): rejects re-registration under a conflicting tier rather than silently overwriting it', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(makeCategory({ tier: 'TIER_1' }));

      await expect(
        service.registerCategory({
          module_id: 'attendance',
          category_id: 'shift_coordinate',
          tier: 'TIER_2' as any,
        })
      ).rejects.toThrow(ConflictError);
      expect(mockRetentionCategoryCreate).not.toHaveBeenCalled();
    });

    it('scopes the uniqueness check to (module_id, category_id) together, not category_id alone', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(null);
      mockRetentionCategoryCreate.mockResolvedValue(makeCategory());

      await service.registerCategory({
        module_id: 'attendance',
        category_id: 'shift_coordinate',
        tier: 'TIER_1' as any,
      });

      expect(mockRetentionCategoryFindUnique).toHaveBeenCalledWith({
        where: {
          module_id_category_id: { module_id: 'attendance', category_id: 'shift_coordinate' },
        },
      });
    });
  });

  describe('tagRecord — REQ-RETENTION-015/RULE-RETENTION-03/07', () => {
    it('creates a RetentionLog row scoped to the resolved category id', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(makeCategory());
      mockRetentionLogCreate.mockResolvedValue(makeLog());

      const result = await service.tagRecord({
        module_id: 'attendance',
        category_id: 'shift_coordinate',
        record_ref: 'attendance-record-42',
        tagged_at: NOW,
      });

      expect(mockRetentionLogCreate).toHaveBeenCalledWith({
        data: { category_id: 'cat1', record_ref: 'attendance-record-42', tagged_at: NOW },
      });
      expect(result.id).toBe('log1');
      expect(result.deleted_at).toBeNull();
    });

    it('RULE-RETENTION-07: throws NotFoundError when the category was never registered', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(null);

      await expect(
        service.tagRecord({
          module_id: 'attendance',
          category_id: 'unregistered_category',
          record_ref: 'attendance-record-1',
          tagged_at: NOW,
        })
      ).rejects.toThrow(NotFoundError);
      expect(mockRetentionLogCreate).not.toHaveBeenCalled();
    });

    it('serializes tagged_at/deleted_at as ISO strings in the returned DTO', async () => {
      mockRetentionCategoryFindUnique.mockResolvedValue(makeCategory());
      mockRetentionLogCreate.mockResolvedValue(makeLog({ deleted_at: NOW }));

      const result = await service.tagRecord({
        module_id: 'attendance',
        category_id: 'shift_coordinate',
        record_ref: 'attendance-record-42',
        tagged_at: NOW,
      });

      expect(result.tagged_at).toBe(NOW.toISOString());
      expect(result.deleted_at).toBe(NOW.toISOString());
    });
  });

  describe('getDeletionAuditLog — IF-RETENTION-GetDeletionAuditLog, RULE-RETENTION-06/FIND-SEC-003', () => {
    it('returns audit entries and a total count', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([makeAuditEntry()]);
      mockRetentionAuditEntryCount.mockResolvedValue(1);

      const result = await service.getDeletionAuditLog({ page: 1, per_page: 20 });

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('audit1');
    });

    it('returns an empty result, not an error, when no history exists', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([]);
      mockRetentionAuditEntryCount.mockResolvedValue(0);

      const result = await service.getDeletionAuditLog({ page: 1, per_page: 20 });

      expect(result).toEqual({ data: [], total: 0 });
    });

    it('bounds the query with pagination (skip/take), never an unbounded scan', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([]);
      mockRetentionAuditEntryCount.mockResolvedValue(0);

      await service.getDeletionAuditLog({ page: 2, per_page: 10 });

      expect(mockRetentionAuditEntryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });

    it('filters by module_id and category_id together when both are supplied', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([]);
      mockRetentionAuditEntryCount.mockResolvedValue(0);

      await service.getDeletionAuditLog({
        module_id: 'attendance',
        category_id: 'shift_coordinate',
        page: 1,
        per_page: 20,
      });

      expect(mockRetentionAuditEntryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { module_id: 'attendance', category_id: 'shift_coordinate' },
        })
      );
    });

    it('applies no module_id/category_id filter when neither is supplied', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([]);
      mockRetentionAuditEntryCount.mockResolvedValue(0);

      await service.getDeletionAuditLog({ page: 1, per_page: 20 });

      expect(mockRetentionAuditEntryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} })
      );
    });

    it('bounds by date range when from/to are supplied', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([]);
      mockRetentionAuditEntryCount.mockResolvedValue(0);

      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date('2026-06-01T00:00:00.000Z');
      await service.getDeletionAuditLog({ from, to, page: 1, per_page: 20 });

      expect(mockRetentionAuditEntryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: { gte: from, lte: to } },
        })
      );
    });

    it('orders results newest-deletion-first', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([]);
      mockRetentionAuditEntryCount.mockResolvedValue(0);

      await service.getDeletionAuditLog({ page: 1, per_page: 20 });

      expect(mockRetentionAuditEntryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { deleted_at: 'desc' } })
      );
    });

    it('FIND-SEC-003: the returned DTO carries only category_id/tier/deleted_at (plus id/module_id) -- never record_ref or any other field', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([makeAuditEntry({ tier: 'TIER_3' })]);
      mockRetentionAuditEntryCount.mockResolvedValue(1);

      const result = await service.getDeletionAuditLog({ page: 1, per_page: 20 });

      expect(Object.keys(result.data[0]).sort()).toEqual(
        ['category_id', 'deleted_at', 'id', 'module_id', 'tier'].sort()
      );
    });

    it('FIND-SEC-003 (defense in depth): the mapper strips an unexpected field even if the raw row somehow carried one', async () => {
      // Proves the allow-list is enforced by toAuditEntryDto()'s explicit
      // field-by-field mapping, not merely absent because the fixture
      // never included it -- guards against a future schema-drift
      // regression where a new column is added to RetentionAuditEntry and
      // accidentally spread into the DTO instead of explicitly mapped.
      mockRetentionAuditEntryFindMany.mockResolvedValue([
        { ...makeAuditEntry(), record_ref: 'attendance-record-42', created_at: NOW },
      ]);
      mockRetentionAuditEntryCount.mockResolvedValue(1);

      const result = await service.getDeletionAuditLog({ page: 1, per_page: 20 });

      expect(result.data[0]).not.toHaveProperty('record_ref');
      expect(result.data[0]).not.toHaveProperty('created_at');
      expect(Object.keys(result.data[0]).sort()).toEqual(
        ['category_id', 'deleted_at', 'id', 'module_id', 'tier'].sort()
      );
    });

    it('serializes deleted_at as an ISO string in the returned DTO', async () => {
      mockRetentionAuditEntryFindMany.mockResolvedValue([makeAuditEntry({ deleted_at: NOW })]);
      mockRetentionAuditEntryCount.mockResolvedValue(1);

      const result = await service.getDeletionAuditLog({ page: 1, per_page: 20 });

      expect(result.data[0].deleted_at).toBe(NOW.toISOString());
    });
  });
});
