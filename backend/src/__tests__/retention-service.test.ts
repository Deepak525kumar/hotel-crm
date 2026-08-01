import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN): service-level regression for
 * PR 2's scope -- IF-RETENTION-RegisterCategory, IF-RETENTION-TagRecord.
 */

const mockRetentionCategoryFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockRetentionCategoryCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockRetentionLogCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

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

describe('RetentionService (SPEC-RETENTION-001, PR 2)', () => {
  let service: RetentionService;

  beforeEach(() => {
    service = new RetentionService();
    mockRetentionCategoryFindUnique.mockReset();
    mockRetentionCategoryCreate.mockReset();
    mockRetentionLogCreate.mockReset();
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
});
