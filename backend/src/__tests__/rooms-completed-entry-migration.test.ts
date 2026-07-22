import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ADR-028 (2026-07-22, OQ-ANALYTICS-03): "rooms completed per worker" is retained
// as a basic-analytics metric but redefined without a room-level task layer — a
// manager-entered daily count, 1-to-1 with the worker's full-day WorkerAssignment,
// captured by the new RoomsCompletedEntry model/migration. These tests assert the
// migration SQL's shape (new table, expected columns/constraints, no touch to any
// pre-existing table) without requiring a live DB, mirroring this module's other
// migration-shape coverage (rating-score-rescale-migration.test.ts).

const migrationPath = join(
  __dirname,
  '../../prisma/migrations/20260723000000_add_rooms_completed_entry/migration.sql'
);
const schemaPath = join(__dirname, '../../prisma/schema.prisma');

describe('RoomsCompletedEntry migration (ADR-028, OQ-ANALYTICS-03)', () => {
  it('creates a new table, touching no existing table (additive only)', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE TABLE "RoomsCompletedEntry"/);
    expect(sql).not.toMatch(/ALTER TABLE "Rating"/);
    expect(sql).not.toMatch(/ALTER TABLE "WorkerAssignment"/);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });

  it('declares the expected columns', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    for (const column of [
      '"assignment_id"',
      '"hotel_id"',
      '"worker_id"',
      '"entered_by_id"',
      '"rooms_completed"',
      '"notes"',
      '"created_at"',
      '"updated_at"',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('enforces a 1-to-1 relationship with WorkerAssignment via a unique index on assignment_id', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "RoomsCompletedEntry_assignment_id_key" ON "RoomsCompletedEntry"\("assignment_id"\)/
    );
  });

  it('enforces rooms_completed >= 0 via a CHECK constraint', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CHECK \("rooms_completed" >= 0\)/);
  });

  it('cascades on assignment/hotel/worker deletion but restricts on entered_by (manager) deletion', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/"RoomsCompletedEntry_assignment_id_fkey".*ON DELETE CASCADE/s);
    expect(sql).toMatch(/"RoomsCompletedEntry_hotel_id_fkey".*ON DELETE CASCADE/s);
    expect(sql).toMatch(/"RoomsCompletedEntry_worker_id_fkey".*ON DELETE CASCADE/s);
    expect(sql).toMatch(/"RoomsCompletedEntry_entered_by_id_fkey".*ON DELETE RESTRICT/s);
  });

  it('the Prisma schema declares RoomsCompletedEntry with no room-level fields (no room_id/room_number/task_id)', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const modelMatch = schema.match(/model RoomsCompletedEntry \{[\s\S]*?\n\}/);
    expect(modelMatch).not.toBeNull();
    const modelBody = modelMatch![0];
    expect(modelBody).toMatch(/assignment_id\s+String\s+@unique/);
    expect(modelBody).toMatch(/rooms_completed\s+Int/);
    expect(modelBody).not.toMatch(/room_id/i);
    expect(modelBody).not.toMatch(/task_id/i);
    expect(modelBody).not.toMatch(/task_start/i);
  });

  it('the schema does NOT add any rooms-completed field to ReceptionData or any Reception-named model', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    // ReceptionData is unbuilt target state (PIVOT §9.3) and out of scope for this
    // model per ADR-028 — it must not appear anywhere in the shipped schema.
    expect(schema).not.toMatch(/model ReceptionData/);
  });
});
