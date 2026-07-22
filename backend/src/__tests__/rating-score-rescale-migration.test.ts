import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ADR-026 (corrected 2026-07-22, OQ-01): Rating.score is rescaled from 1-5 stars
// to 0-100 to match CONFIRMED_REQUIREMENTS_REGISTER.md §15/TRULE-001. These tests
// exercise the linear ×20 rescale in isolation (no live DB required, mirroring
// this module's other unit-level coverage) and assert the migration SQL itself
// carries the expected shape — order of operations (relax CHECK before rescale),
// the ×20 mapping, and the tightened 0-100 bound.

const migrationPath = join(
  __dirname,
  '../../prisma/migrations/20260722180000_rescale_rating_score_to_0_100/migration.sql'
);

function rescale(oldScore: number): number {
  // Mirrors the migration's `UPDATE "Rating" SET "score" = "score" * 20 WHERE "score" <= 5`.
  return oldScore <= 5 ? oldScore * 20 : oldScore;
}

describe('Rating.score rescale (ADR-026, OQ-01)', () => {
  it('maps every 1-5 star value to its 0-100 equivalent (×20)', () => {
    expect(rescale(1)).toBe(20);
    expect(rescale(2)).toBe(40);
    expect(rescale(3)).toBe(60);
    expect(rescale(4)).toBe(80);
    expect(rescale(5)).toBe(100);
  });

  it('is idempotent — values already above the old 1-5 domain are left untouched', () => {
    // Guards against double-application of the migration corrupting already-rescaled data.
    expect(rescale(80)).toBe(80);
    expect(rescale(20)).toBe(20);
    expect(rescale(6)).toBe(6);
  });

  it('every rescaled value lands within the new 0-100 bound', () => {
    for (let star = 1; star <= 5; star++) {
      const rescaled = rescale(star);
      expect(rescaled).toBeGreaterThanOrEqual(0);
      expect(rescaled).toBeLessThanOrEqual(100);
    }
  });

  it('the migration relaxes the CHECK constraint before rescaling rows, then rescales with the documented ×20/<=5 predicate', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    const dropIdx = sql.indexOf('DROP CONSTRAINT "Rating_score_range"');
    const addIdx = sql.indexOf('ADD CONSTRAINT "Rating_score_range"');
    const checkIdx = sql.indexOf('CHECK ("score" >= 0 AND "score" <= 100)');
    const updateIdx = sql.indexOf('UPDATE "Rating" SET "score" = "score" * 20 WHERE "score" <= 5');

    expect(dropIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);

    // CHECK relaxed to [0,100] before the UPDATE rescales any row — otherwise the
    // interim ×20 values (up to 100) would violate the still-active [1,5] bound.
    expect(dropIdx).toBeLessThan(updateIdx);
    expect(checkIdx).toBeLessThan(updateIdx);
  });

  it('the migration documents WorkerOverallRating.average_score requiring no separate trigger fix', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/Rating_refresh_overall_rating/);
    expect(sql).toMatch(/no hardcoded 1-5 assumption/);
  });
});
