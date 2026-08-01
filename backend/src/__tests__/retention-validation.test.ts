import { describe, it, expect } from '@jest/globals';
import {
  RegisterCategorySchema,
  TagRecordSchema,
  GetDeletionAuditLogQuerySchema,
  CheckEligibilityQuerySchema,
  RETENTION_TIERS,
  RETENTION_TIER_WINDOWS,
  computeDueDate,
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

describe('GetDeletionAuditLogQuerySchema', () => {
  it('accepts an empty query (no filters), defaulting page/per_page', () => {
    const result = GetDeletionAuditLogQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.per_page).toBe(20);
    }
  });

  it('accepts module_id/category_id filters', () => {
    const result = GetDeletionAuditLogQuerySchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a from/to date range', () => {
    const result = GetDeletionAuditLogQuerySchema.safeParse({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-06-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty-string module_id', () => {
    const result = GetDeletionAuditLogQuerySchema.safeParse({ module_id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string category_id', () => {
    const result = GetDeletionAuditLogQuerySchema.safeParse({ category_id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects page below 1', () => {
    const result = GetDeletionAuditLogQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects per_page above 100 (no unbounded full-history scan)', () => {
    const result = GetDeletionAuditLogQuerySchema.safeParse({ per_page: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects an unparseable from/to value', () => {
    const result = GetDeletionAuditLogQuerySchema.safeParse({ from: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});

describe('CheckEligibilityQuerySchema', () => {
  it('accepts module_id + category_id without record_ref', () => {
    const result = CheckEligibilityQuerySchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
    });
    expect(result.success).toBe(true);
  });

  it('accepts module_id + category_id + record_ref', () => {
    const result = CheckEligibilityQuerySchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      record_ref: 'attendance-record-42',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing module_id', () => {
    const result = CheckEligibilityQuerySchema.safeParse({ category_id: 'shift_coordinate' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing category_id', () => {
    const result = CheckEligibilityQuerySchema.safeParse({ module_id: 'attendance' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string module_id', () => {
    const result = CheckEligibilityQuerySchema.safeParse({
      module_id: '',
      category_id: 'shift_coordinate',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string record_ref when supplied', () => {
    const result = CheckEligibilityQuerySchema.safeParse({
      module_id: 'attendance',
      category_id: 'shift_coordinate',
      record_ref: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('computeDueDate — RULE-RETENTION-03', () => {
  it('adds the tier window in calendar months for TIER_1', () => {
    const taggedAt = new Date('2026-01-15T00:00:00.000Z');
    const due = computeDueDate(RetentionTier.TIER_1, taggedAt);
    expect(due.toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });

  it('adds the tier window in calendar years for TIER_2', () => {
    const taggedAt = new Date('2026-01-15T00:00:00.000Z');
    const due = computeDueDate(RetentionTier.TIER_2, taggedAt);
    expect(due.toISOString()).toBe('2031-01-15T00:00:00.000Z');
  });

  it('adds the tier window in calendar years for TIER_3', () => {
    const taggedAt = new Date('2026-01-15T00:00:00.000Z');
    const due = computeDueDate(RetentionTier.TIER_3, taggedAt);
    expect(due.toISOString()).toBe('2032-01-15T00:00:00.000Z');
  });

  it('does not mutate the input Date', () => {
    const taggedAt = new Date('2026-01-15T00:00:00.000Z');
    const original = taggedAt.getTime();
    computeDueDate(RetentionTier.TIER_1, taggedAt);
    expect(taggedAt.getTime()).toBe(original);
  });
});
