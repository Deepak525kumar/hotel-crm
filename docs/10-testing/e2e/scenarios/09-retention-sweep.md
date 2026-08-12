# Scenario 09 — Retention Sweep Job

## Objective
Verify that `retention/sweep-job.ts` correctly processes hard-deletions of eligible data across modules without orphaned records, logs immutable audit entries accurately in a single transaction, correctly pages through large datasets, and avoids phantom deletions during concurrent sweep executions.

## Prerequisites
- Feature flag `FEATURE_RETENTION_SWEEP=true` must be set in `.env`.
- Access to the `hotelcrm` database to manually inspect `RetentionLog` and `RetentionAuditEntry` tables.
- Node.js script to simulate the cron trigger for `retention-sweep-job`.

## Test Cases

### 9.1 Basic Data Retention Purge
**Context:** A record exceeds its retention window and is eligible for deletion.
**Steps:**
1. Seed `RetentionLog` with an entry mapped to a dummy `WorkerDocument` where `tagged_at` is older than its `RetentionTier` (e.g., 36 months for `EMPLOYMENT_RECORDS`).
2. Run the `retention-sweep-job.ts`.
3. Verify the `WorkerDocument` is hard-deleted from the database.
4. Verify the `RetentionLog` row is deleted.
5. Verify exactly one `RetentionAuditEntry` is created with the correct `category_id`, `tier`, and `deleted_at`, but containing zero personal data from the deleted record.

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
