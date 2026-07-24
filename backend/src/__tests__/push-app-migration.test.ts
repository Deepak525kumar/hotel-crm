import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Epic 7 PR 7.8: multi-app APNs topic support. Migration-shape coverage
// without requiring a live DB, mirroring push-token-migration.test.ts. Live
// forward/rollback/recovery is verified separately against a throwaway local
// PostgreSQL instance (migrate-harness.sh verify), not part of this suite.

const migrationPath = join(__dirname, '../../prisma/migrations/20260724220000_add_push_app/migration.sql');
const downPath = join(__dirname, '../../prisma/migrations/20260724220000_add_push_app/down.sql');
const schemaPath = join(__dirname, '../../prisma/schema.prisma');

describe('PushApp migration (Epic 7 PR 7.8)', () => {
  it('adds a new enum + column, touching no other existing table (additive only)', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE TYPE "PushApp" AS ENUM \('WORKER', 'CHECKER'\)/);
    expect(sql).toMatch(/ALTER TABLE "PushToken" ADD COLUMN "app" "PushApp" NOT NULL/);
    expect(sql).not.toMatch(/ALTER TABLE "User"/);
    expect(sql).not.toMatch(/ALTER TABLE "Notification"/);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });

  it('the new column is NOT NULL with no default (safe only because PushToken is empty in every environment)', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/"app" "PushApp" NOT NULL/);
    expect(sql).not.toMatch(/"app"[^,]*DEFAULT/i);
  });

  it('ships a paired down.sql that drops the column and the enum', () => {
    const sql = readFileSync(downPath, 'utf8');
    expect(sql).toMatch(/ALTER TABLE "PushToken" DROP COLUMN "app"/);
    expect(sql).toMatch(/DROP TYPE "PushApp"/);
  });

  it('the Prisma schema declares PushApp and PushToken.app as NOT NULL (no ?)', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toMatch(/enum PushApp \{\s*WORKER\s*CHECKER\s*\}/);

    const modelMatch = schema.match(/model PushToken \{[\s\S]*?\n\}/);
    expect(modelMatch).not.toBeNull();
    const modelBody = modelMatch![0];
    // Field type is exactly `PushApp`, never `PushApp?` — non-nullable per the
    // approved design (the table is empty everywhere, so there is no
    // impossible-null state to accommodate).
    expect(modelBody).toMatch(/app\s+PushApp(?!\?)/);
  });
});
