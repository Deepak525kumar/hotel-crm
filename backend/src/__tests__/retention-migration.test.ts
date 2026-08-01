import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN): these tests assert the
// migration SQL's shape (new tables/enum, no touch to any pre-existing
// table) without requiring a live DB, mirroring consent-migration.test.ts.
// This PR (1 of 5) is schema-only -- no service/controller/route code
// exists yet, so this migration-shape test is the only test for this PR.

const migrationPath = join(
  __dirname,
  '../../prisma/migrations/20260731020000_add_retention_schema/migration.sql'
);
const downPath = join(
  __dirname,
  '../../prisma/migrations/20260731020000_add_retention_schema/down.sql'
);

describe('Retention schema migration (SPEC-RETENTION-001, PR 1 of 5)', () => {
  it('creates new tables and enum, touching no existing table (additive only)', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE TYPE "RetentionTier" AS ENUM/);
    expect(sql).toMatch(/CREATE TABLE "RetentionCategory"/);
    expect(sql).toMatch(/CREATE TABLE "RetentionLog"/);
    expect(sql).toMatch(/CREATE TABLE "RetentionAuditEntry"/);
    expect(sql).not.toMatch(/ALTER TABLE "User"/);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP TYPE/i);
  });

  it('RULE-RETENTION-01: RetentionTier is a closed three-value set', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/'TIER_1', 'TIER_2', 'TIER_3'/);
  });

  it('REQ-RETENTION-014/RULE-RETENTION-02: RetentionCategory has module_id+category_id unique constraint', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    for (const column of ['"module_id"', '"category_id"', '"tier"']) {
      expect(sql).toContain(column);
    }
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "RetentionCategory_module_id_category_id_key" ON "RetentionCategory"\("module_id", "category_id"\)/
    );
  });

  it('RULE-RETENTION-07: RetentionLog is FK-scoped to RetentionCategory (unregistered categories cannot have log rows)', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    for (const column of ['"category_id"', '"record_ref"', '"tagged_at"', '"deleted_at"']) {
      expect(sql).toContain(column);
    }
    expect(sql).toMatch(
      /FOREIGN KEY \("category_id"\) REFERENCES "RetentionCategory"\("id"\) ON DELETE CASCADE/
    );
  });

  it('RULE-RETENTION-06: RetentionAuditEntry carries only category/tier/timestamp fields, never personal data', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const tableMatch = sql.match(/CREATE TABLE "RetentionAuditEntry" \(([\s\S]*?)\);/);
    expect(tableMatch).toBeDefined();
    const body = tableMatch![1];
    for (const column of ['"id"', '"module_id"', '"category_id"', '"tier"', '"deleted_at"', '"created_at"']) {
      expect(body).toContain(column);
    }
  });

  it('down.sql reverses tables and enum in FK-safe order', () => {
    const sql = readFileSync(downPath, 'utf8');
    const logIdx = sql.indexOf('DROP TABLE IF EXISTS "RetentionLog"');
    const categoryIdx = sql.indexOf('DROP TABLE IF EXISTS "RetentionCategory"');
    const typeIdx = sql.indexOf('DROP TYPE IF EXISTS "RetentionTier"');
    expect(logIdx).toBeGreaterThanOrEqual(0);
    expect(categoryIdx).toBeGreaterThan(logIdx);
    expect(typeIdx).toBeGreaterThan(categoryIdx);
  });
});
