import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PushApp } from '@prisma/client';

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

  // Invariant, not a migration-shape check: pins PushApp to exactly the known
  // applications. PushTransportHandler.topicFor() switches on PushApp
  // exhaustively (a `default: assertNever(...)` branch), so adding a member
  // here without also wiring its APNs topic and env var is a TypeScript
  // compile error at that switch -- this test exists so the same fact is
  // caught immediately by `npm test` too, not only by a full `tsc` pass, and
  // so a reviewer sees a failing assertion that names exactly what changed
  // rather than a generic type error.
  //
  // Updated 2026-09-22 (two → three) for the manager app. The hypothetical
  // this comment used to describe ("a future kiosk build") actually happened,
  // and both halves of the guard fired exactly as intended: `tsc` failed at
  // topicFor()'s assertNever and this assertion failed here. Widened rather
  // than deleted -- the pin's value is that the NEXT member is caught too.
  it('PushApp has exactly the three known applications, in this order', () => {
    expect(Object.values(PushApp)).toEqual(['WORKER', 'CHECKER', 'MANAGER']);
  });

  // The ADD VALUE migration is separate from 20260724220000_add_push_app's
  // CREATE TYPE, and is asserted separately: a Postgres enum cannot DROP a
  // value, so this one is deliberately not paired with a down.sql that would
  // claim to reverse it.
  it('adds MANAGER by ALTER TYPE ... ADD VALUE, never by rewriting the type', () => {
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/20260922090000_push_app_manager/migration.sql'),
      'utf8'
    );
    expect(sql).toMatch(/ALTER TYPE "PushApp" ADD VALUE IF NOT EXISTS 'MANAGER'/);
    // A type rewrite would rewrite every PushToken row and invalidate the
    // existing values' oids; nothing here may drop or recreate the type.
    expect(sql).not.toMatch(/DROP TYPE/i);
    expect(sql).not.toMatch(/CREATE TYPE/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
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
    // Matched member-by-member rather than as one whitespace-only block: the
    // enum now carries an explanatory comment between its members (2026-09-22),
    // and a regex that only tolerates whitespace would fail on any future
    // comment too -- which is a documentation change, not a schema change.
    const pushAppEnum = schema.match(/enum PushApp \{[\s\S]*?\n\}/);
    expect(pushAppEnum).not.toBeNull();
    expect(pushAppEnum![0]).toMatch(/\bWORKER\b/);
    expect(pushAppEnum![0]).toMatch(/\bCHECKER\b/);
    expect(pushAppEnum![0]).toMatch(/\bMANAGER\b/);

    const modelMatch = schema.match(/model PushToken \{[\s\S]*?\n\}/);
    expect(modelMatch).not.toBeNull();
    const modelBody = modelMatch![0];
    // Field type is exactly `PushApp`, never `PushApp?` — non-nullable per the
    // approved design (the table is empty everywhere, so there is no
    // impossible-null state to accommodate).
    expect(modelBody).toMatch(/app\s+PushApp(?!\?)/);
  });
});
