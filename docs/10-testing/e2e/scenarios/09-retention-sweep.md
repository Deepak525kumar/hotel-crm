# Scenario 09 — Retention Sweep Job

## Objective
Verify that `retention/sweep-job.ts` correctly hard-deletes eligible `RetentionLog` rows, logs
immutable audit entries accurately in a single transaction, correctly pages through large
datasets, and avoids phantom deletions during concurrent sweep executions.

**Corrected 2026-09-02, verified against a real Postgres run.** "Across modules" above is
aspirational, not current behavior — `sweep-job.ts`'s own header comment states the scope
boundary explicitly: this job hard-deletes only its **own** module's state (`RetentionLog` +
`RetentionAuditEntry`). Deleting the underlying record in a *consuming* module (e.g. an
actual `WorkerDocument`) requires a cross-module delegated-execution mechanism that does not
exist yet (`OD-RETENTION-10`, explicitly open/deferred) — no consuming module has registered a
real category. 9.1's step 3 ("verify the `WorkerDocument` is hard-deleted") cannot pass today;
delete that assertion until `OD-RETENTION-10` lands. What the job actually does — hard-delete
the `RetentionLog` row and write one audit entry containing no personal data — is real and was
re-verified 2026-09-02 against a live database (see run log
`docs/10-testing/e2e/runs/2026-09-02-post-deploy-onboarding-and-rooms.md`).

## Prerequisites
- **No feature flag gates this job.** `FEATURE_RETENTION_SWEEP` does not exist anywhere in
  `config/env.ts` or `.env` — this was never wired up as a flag. `RetentionSweepJob` is
  registered directly and unconditionally in `worker.ts`'s Scheduler; it runs in every
  environment the Platform Worker runs in.
- Access to the `hotelcrm` database to manually inspect `RetentionLog` and `RetentionAuditEntry` tables.
- To run it directly against a local DB rather than waiting for the Scheduler's interval:
  ```ts
  import { loadEnv } from './src/config/env.js'; loadEnv();
  import { PrismaClient } from '@prisma/client';
  import { RetentionSweepJob } from './src/modules/retention/sweep-job.js';
  const p = new PrismaClient();
  await new RetentionSweepJob(p, { intervalMs: 999999999, batchSize: 50 }).run();
  ```

## Test Cases

### 9.1 Basic Data Retention Purge — **PASS, re-verified 2026-09-02 against real Postgres**
**Context:** A `RetentionLog` row exceeds its category's retention window.
**Steps:**
1. Seed a real `RetentionCategory` (any `module_id`/`category_id`, `tier: TIER_1` = 6 months
   is fastest to test) and a `RetentionLog` row referencing it with `tagged_at` 7+ months in
   the past.
2. Run the job (see Prerequisites for the direct-invocation snippet).
3. ~~Verify the underlying record (e.g. `WorkerDocument`) is hard-deleted~~ — **removed**, see
   the Objective correction above; this job does not reach consuming-module data yet.
4. Verify the `RetentionLog` row is deleted — confirmed: `findUnique` on the seeded id returned
   `null` after the run.
5. Verify exactly one `RetentionAuditEntry` is created with the correct `category_id`, `tier`,
   and `deleted_at` — confirmed, and the model has no field structurally capable of holding
   personal data (schema-verified, not just observed absence in one run).

### 9.2 Batched Deletions for Large Workloads (OD-RETENTION-07)
**Context:** The sweep job is designed to delete records in batches using `findMany.take()` and `deleteMany`.
**Steps:**
1. Seed `RetentionLog` with 105 entries eligible for deletion.
2. Configure the sweep job `batchSize` to 50.
3. Run the sweep job.
4. Verify the job completes 3 iterations (50 + 50 + 5) before stopping.
5. Verify all 105 eligible records and `RetentionLog` rows are hard-deleted.
6. Verify 105 `RetentionAuditEntry` rows are created.

### 9.3 Overlapping Sweep Runs
**Context:** Concurrent sweep runs might attempt to delete the same records.
**Steps:**
1. Seed 50 eligible records.
2. Mock the `deleteMany` transaction in the test environment to pause artificially.
3. Trigger the sweep job simultaneously on two separate worker processes.
4. Verify that only 50 total records are deleted.
5. Verify that only 50 `RetentionAuditEntry` rows are created (no phantom audit rows from a `deleteMany` that affected zero rows due to losing the race).

### 9.4 Atomicity of Deletion and Auditing
**Context:** The data hard-delete and audit entry creation must occur in a single transaction.
**Steps:**
1. Seed an eligible record for deletion.
2. Mock `tx.retentionAuditEntry.createMany` to throw a simulated database error.
3. Run the sweep job.
4. Catch the error.
5. Verify the target data record and the `RetentionLog` entry remain in the database untouched.

## Expected Outcomes
- **Zero orphaned records:** No data leaks beyond their `RetentionTier` boundary.
- **Audit accuracy:** Audits contain tier/category info but absolutely no personal data from the underlying record.
- **Resilience:** The job handles concurrency without double-auditing and recovers cleanly from transaction failures.
