# E2E Run — 2026-08-20 — checker photo evidence and rework loop (PR #495)

- **Commit under test:** `87c565c` (merge of PR #495). The live verification below was
  performed during development on the branch head; it was **not** re-executed against
  `87c565c` after the merge. The merge itself was verified statically only — see
  "Could not test".
- **Environment:** local dev, Docker Compose (Postgres 15)
- **Executed by:** AI agent (Claude), Lead Architect contract
- **Stack versions:** backend `feat/quality-rework-loop`, Postgres 15-alpine

This log is being written **after** PR #495 merged, which is itself a process defect: the
suite rule is to update it in the same pass. The four defects in the list below were found by
live HTTP testing and would otherwise exist only in a merged diff and a session transcript.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00 Environment | PASS | Docker stack, migrations applied |
| 12 Rework loop | PASS | New scenario, added this run — all steps executed live over HTTP |
| 11 Consent gate | PASS | Enforcement, escape hatches, day rollover re-verified |
| 01–10 | NOT RUN | See "Could not test" |

Specific live confirmations, all read back at the data layer:

- ADR-069 index change: a rework insert is accepted alongside an existing active same-day
  assignment, **and** an ordinary double-booking is still rejected (both halves checked).
- Full rework loop over HTTP: no-photo completion refused → completion sets
  `rework_completed_at`, `photo_urls` 1 → 2, assignment `COMPLETED`, checker notified →
  duplicate completion `409` with `photo_urls` still 2.
- `{ push: [...] }` inside `updateMany` behaves as expected against real Postgres.
- Migration drift gate: `prisma migrate diff` reports `No difference detected`.

## New defects found

1. **Multipart `score` rejected** — `backend/src/modules/quality/types.ts` — HIGH — fixed in
   #495 (`z.coerce.number()`). `z.number()` received the string `"45"`; every photo-bearing
   rating failed validation. Unit tests passed because they post JSON. **Only reproducible
   over real multipart HTTP.**
2. **IDOR on photo evidence** — `getVerificationPhotos`, `backend/src/modules/quality/service.ts`
   — HIGH — fixed in #495. Workers hold `quality:read` (ADR-067), so manager-scoped
   authorization let any worker read any other worker's evidence. Now deny-by-default.
3. **`completion_rate` / `on_time_rate` could exceed 100%** — `analytics/service.ts`
   `getWorkerStats` and `refreshWorkerOverallRating` — MEDIUM — fixed in #495. Numerator
   counted rework rows, denominator did not. Proven against real Postgres (2/1 → 1/1).
   Note this class recurred *twice* in one PR: fixing `on_time_rate` reintroduced it in the
   sibling `completion_rate`. Assert the ratio ≤ 1.0, not the counts.
4. **Escalation race** — `rework-escalation-job.ts` — MEDIUM — fixed in #495. The
   compare-and-swap claim did not re-check `rework_completed_at`, so a worker completing
   between the job's SELECT and CLAIM was still reported overdue to their Manager and Checker.

## Could not test

1. **Scenarios 01–10 were not re-run this pass.** This run was scoped to the rework loop and
   the consent gate. A full-suite pass is still owed before the next production deploy.
2. **The merged tree (`87c565c`) was verified statically, not live.** After merging `main`
   (which brought PR #498's `SELECT … FOR UPDATE` on `User` inside
   `refreshWorkerOverallRating`, now taken inside `completeRework`'s transaction), the
   evidence is: lock-order review across all six callsites, `prisma validate`, and green
   suites (backend 2976, frontend 104, worker-app 158, checker-app 107). **No live
   concurrent-transaction test was run against the merged code**, so the deadlock argument
   rests on code reading, not observation. Worth an actual concurrent run.
3. **Presigned-URL expiry** — the 15-minute TTL is never allowed to elapse.
4. **Mobile capture path** — steps use `curl`; `usePhotoPicker` on Expo is not driven.

## Scenario files updated this run

- **Added** `scenarios/12-checker-photo-evidence-and-rework.md` — the nine steps above, each
  annotated with the defect it encodes and, where relevant, why a naive version of the test
  would pass anyway (JSON instead of multipart; sequential instead of concurrent; checking
  counts instead of the ratio; asserting only the three allowed readers and not the denied one).
- **Updated** `README.md` — scenario index and run order.
