import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015/ADR-037): these tests assert the
// migration SQL's shape (new table/enum, no touch to any pre-existing table)
// without requiring a live DB, mirroring rooms-completed-entry-migration.test.ts.

const recordMigrationPath = join(
  __dirname,
  '../../prisma/migrations/20260731000000_add_consent_record/migration.sql'
);
const recordDownPath = join(
  __dirname,
  '../../prisma/migrations/20260731000000_add_consent_record/down.sql'
);
const notifTypeMigrationPath = join(
  __dirname,
  '../../prisma/migrations/20260731010000_add_consent_notification_type/migration.sql'
);
const notifTypeDownPath = join(
  __dirname,
  '../../prisma/migrations/20260731010000_add_consent_notification_type/down.sql'
);

describe('ConsentRecord migration (SPEC-CONSENT-001, ADR-015)', () => {
  it('creates a new table and enum, touching no existing table (additive only)', () => {
    const sql = readFileSync(recordMigrationPath, 'utf8');
    expect(sql).toMatch(/CREATE TABLE "ConsentRecord"/);
    expect(sql).toMatch(/CREATE TYPE "ConsentDecision" AS ENUM/);
    expect(sql).not.toMatch(/ALTER TABLE "User"/);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });

  it('declares the expected columns', () => {
    const sql = readFileSync(recordMigrationPath, 'utf8');
    for (const column of [
      '"worker_id"',
      '"consent_instance"',
      '"notice_version"',
      '"decision"',
      '"decided_at"',
      '"created_at"',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('the ConsentDecision enum matches RULE-CONSENT-05/OD-CONSENT-001 (ADR-037): GRANTED/DECLINED/WITHDRAWN/RENEWED', () => {
    const sql = readFileSync(recordMigrationPath, 'utf8');
    expect(sql).toMatch(/'GRANTED', 'DECLINED', 'WITHDRAWN', 'RENEWED'/);
  });

  it('indexes worker_id+consent_instance and decided_at (the two query paths checkStatus/getAuditHistory use)', () => {
    const sql = readFileSync(recordMigrationPath, 'utf8');
    expect(sql).toMatch(
      /CREATE INDEX "ConsentRecord_worker_id_consent_instance_idx" ON "ConsentRecord"\("worker_id", "consent_instance"\)/
    );
    expect(sql).toMatch(/CREATE INDEX "ConsentRecord_decided_at_idx" ON "ConsentRecord"\("decided_at"\)/);
  });

  it('foreign-keys worker_id to User with CASCADE delete', () => {
    const sql = readFileSync(recordMigrationPath, 'utf8');
    expect(sql).toMatch(
      /FOREIGN KEY \("worker_id"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/
    );
  });

  it('down.sql reverses the table and enum, in FK-safe order', () => {
    const sql = readFileSync(recordDownPath, 'utf8');
    const tableIdx = sql.indexOf('DROP TABLE IF EXISTS "ConsentRecord"');
    const typeIdx = sql.indexOf('DROP TYPE IF EXISTS "ConsentDecision"');
    expect(tableIdx).toBeGreaterThanOrEqual(0);
    expect(typeIdx).toBeGreaterThan(tableIdx);
  });
});

describe('Consent notification-type migration (REQ-CONSENT-003/RULE-CONSENT-03)', () => {
  it('adds CONSENT_DECLINED to NotificationType and CONSENT to OutboxSourceModule, nothing else', () => {
    const sql = readFileSync(notifTypeMigrationPath, 'utf8');
    expect(sql).toMatch(/ALTER TYPE "NotificationType" ADD VALUE 'CONSENT_DECLINED'/);
    expect(sql).toMatch(/ALTER TYPE "OutboxSourceModule" ADD VALUE 'CONSENT'/);
    expect(sql).not.toMatch(/CREATE TABLE/);
    expect(sql).not.toMatch(/DROP/);
  });

  it('down.sql recreates both enums via the rename-recreate-swap pattern, wrapped in one transaction', () => {
    const sql = readFileSync(notifTypeDownPath, 'utf8');
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
    expect(sql).toMatch(/ALTER TYPE "NotificationType" RENAME TO "NotificationType_old"/);
    expect(sql).toMatch(/ALTER TYPE "OutboxSourceModule" RENAME TO "OutboxSourceModule_old"/);
    // The recreated NotificationType enum body itself must not carry the
    // value this migration is reverting -- excluding the header comment,
    // which legitimately names it as an instructional pre-check.
    const recreatedEnumBody = sql.match(/CREATE TYPE "NotificationType" AS ENUM \(([\s\S]*?)\);/)?.[1];
    expect(recreatedEnumBody).toBeDefined();
    expect(recreatedEnumBody).not.toMatch(/'CONSENT_DECLINED'/);
  });
});
