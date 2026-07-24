import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Epic 7 PR 7.5 (ADR-029 §4, Consequences: "a PushToken model for PUSH").
// Migration-shape coverage without requiring a live DB, mirroring
// rooms-completed-entry-migration.test.ts / rating-score-rescale-migration.test.ts.
// Live forward/rollback/recovery is verified separately against a throwaway
// local PostgreSQL instance (migrate-harness.sh verify), not part of this suite.

const migrationPath = join(__dirname, '../../prisma/migrations/20260724120000_add_push_token/migration.sql');
const downPath = join(__dirname, '../../prisma/migrations/20260724120000_add_push_token/down.sql');
const schemaPath = join(__dirname, '../../prisma/schema.prisma');

describe('PushToken migration (Epic 7 PR 7.5, ADR-029)', () => {
  it('creates a new table + enum, touching no existing table (additive only)', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE TYPE "PushPlatform" AS ENUM \('IOS', 'ANDROID'\)/);
    expect(sql).toMatch(/CREATE TABLE "PushToken"/);
    expect(sql).not.toMatch(/ALTER TABLE "User"/);
    expect(sql).not.toMatch(/ALTER TABLE "Notification"/);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });

  it('declares the expected columns', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    for (const column of ['"token"', '"platform"', '"user_id"', '"created_at"', '"updated_at"']) {
      expect(sql).toContain(column);
    }
  });

  it('enforces token uniqueness (not user_id+token) — a device token is device-specific, reassignable across users', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"\("token"\)/);
  });

  it('indexes user_id for the delivery-fan-out lookup', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE INDEX "PushToken_user_id_idx" ON "PushToken"\("user_id"\)/);
  });

  it('cascades on User deletion', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/"PushToken_user_id_fkey".*ON DELETE CASCADE/s);
  });

  it('ships a paired down.sql that drops the table and the enum', () => {
    const sql = readFileSync(downPath, 'utf8');
    expect(sql).toMatch(/DROP TABLE "PushToken"/);
    expect(sql).toMatch(/DROP TYPE "PushPlatform"/);
  });

  it('the Prisma schema declares PushToken with the User back-relation', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const modelMatch = schema.match(/model PushToken \{[\s\S]*?\n\}/);
    expect(modelMatch).not.toBeNull();
    const modelBody = modelMatch![0];
    expect(modelBody).toMatch(/token\s+String\s+@unique/);
    expect(modelBody).toMatch(/platform\s+PushPlatform/);
    expect(schema).toMatch(/push_tokens\s+PushToken\[\]/);
  });
});
