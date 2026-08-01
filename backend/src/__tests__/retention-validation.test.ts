import { describe, it, expect } from '@jest/globals';
import {
  RegisterCategorySchema,
  TagRecordSchema,
  RETENTION_TIERS,
  RETENTION_TIER_WINDOWS,
} from '../modules/retention/types.js';
import { RetentionTier } from '@prisma/client';

describe('RegisterCategorySchema', () => {
  it('accepts a valid registration', () => {
    const result = RegisterCategorySchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      tier: 'TIER_1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing module_id', () => {
    const result = RegisterCategorySchema.safeParse({
      category_id: 'shift_coordinate',
      tier: 'TIER_1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty module_id', () => {
    const result = RegisterCategorySchema.safeParse({
      module_id: '',
      category_id: 'shift_coordinate',
      tier: 'TIER_1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing category_id', () => {
    const result = RegisterCategorySchema.safeParse({
      module_id: 'attendance',
      tier: 'TIER_1',
    });
    expect(result.success).toBe(false);
  });

  it('RULE-RETENTION-01: rejects a tier value outside the closed TIER_1/2/3 set', () => {
    const result = RegisterCategorySchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      tier: 'TIER_4',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing tier', () => {
    const result = RegisterCategorySchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a lowercase tier value (exact enum match required, no case-folding)', () => {
    const result = RegisterCategorySchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      tier: 'tier_1',
    });
    expect(result.success).toBe(false);
  });
});

describe('TagRecordSchema', () => {
  it('accepts a valid tag with an ISO timestamp', () => {
    const result = TagRecordSchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      record_ref: 'attendance-record-42',
      tagged_at: '2026-08-01T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Date instance directly', () => {
    const result = TagRecordSchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      record_ref: 'attendance-record-42',
      tagged_at: new Date('2026-08-01T12:00:00.000Z'),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing record_ref', () => {
    const result = TagRecordSchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      tagged_at: '2026-08-01T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty record_ref', () => {
    const result = TagRecordSchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      record_ref: '',
      tagged_at: '2026-08-01T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing tagged_at', () => {
    const result = TagRecordSchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      record_ref: 'attendance-record-42',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unparseable tagged_at value', () => {
    const result = TagRecordSchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      record_ref: 'attendance-record-42',
      tagged_at: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

describe('RETENTION_TIERS / RETENTION_TIER_WINDOWS — RULE-RETENTION-01', () => {
  it('is exactly the three CRR §25-confirmed tiers, no more, no fewer', () => {
    expect(RETENTION_TIERS).toEqual([
      RetentionTier.TIER_1,
      RetentionTier.TIER_2,
      RetentionTier.TIER_3,
    ]);
  });

  it('maps TIER_1 to a 6-month window', () => {
    expect(RETENTION_TIER_WINDOWS[RetentionTier.TIER_1]).toEqual({ unit: 'months', amount: 6 });
  });

  it('maps TIER_2 to a 5-year window', () => {
    expect(RETENTION_TIER_WINDOWS[RetentionTier.TIER_2]).toEqual({ unit: 'years', amount: 5 });
  });

  it('maps TIER_3 to a 6-year window', () => {
    expect(RETENTION_TIER_WINDOWS[RetentionTier.TIER_3]).toEqual({ unit: 'years', amount: 6 });
  });

  it('has exactly one window entry per tier -- no fourth tier accidentally introduced', () => {
    expect(Object.keys(RETENTION_TIER_WINDOWS)).toHaveLength(3);
  });
});
