# E2E Run — 2026-08-12 — ADR-065 Phase 1-3 verification (initial baseline)

- **Commit under test:** `6bd4b17` (final), starting from `06510ff`
- **Environment:** local dev (Docker Postgres/Redis, backend :3001, frontend :3000, real AWS S3 `eu-central-1`)
- **Executed by:** Claude (agent session), driven by the project owner
- **Stack:** Next.js 16.3.0 (Turbopack), Prisma 5.22.0, Postgres 15-alpine, Playwright 1.62.1 (Chromium)

This is the **baseline run** — the one that produced this suite. It was exploratory rather than
scenario-driven (the scenarios were written *from* it), so results are grouped by area.

## Results

| Area | Result | Notes |
|---|---|---|
| Phase 1 governance docs | PASS | ADR-065 ratified; 6 module-spec/register files verified consistent |
| Phase 2 backend (API-level) | PASS after fixes | 12 defects found and fixed across several rounds |
| Migration integrity (fresh DB) | PASS after revert | `No difference detected`; one over-cleanup caught and reverted |
| Document upload → S3 → retrieval | PASS | Real bucket; object verified in S3; presigned GET byte-identical |
| Race conditions (request pairs) | PASS after fix | `version` column added; history no longer corrupts |
| Edge cases / lifecycle | PASS after fixes | deactivate-vacates, reassignment, RM flag fallback |
| Frontend UI (Playwright) | PASS after fix | 1 crash fixed; 2 gaps + 1 cosmetic issue left open |
| Backend test suite | PASS | 108 suites / 2,687 tests |
| Frontend `tsc` + `eslint` | PASS | clean |

## Defects found this run

All 16 are listed in `scenarios/08-known-gaps-and-next.md` §6 (fixed) and §1 (open). Headlines:

**Fixed (16):** Manager blocked from creating records; Review Queue permanently empty; 4/7
document categories un-uploadable; `assign` not writing the Hotel/HotelGroup FK; `password_hash`
leaked **three separate times**; `assign` reassignment causing silent multi-hotel corruption; a
read-then-write race corrupting the append-only status history; `deactivate` leaving a
deactivated manager with full hotel authority (**live authorization hole**); `FEATURE_RM_ROLE`
never consulted; `assign {}` silent no-op; migration over-cleanup; malware seam absent
(`ADR-066` Option A ratified and implemented); `/onboarding` crash; deleted activation gates
restored; `rehire` contract-gate bypass.

**Still open (6):** see §1 of scenario 08 — worker can't submit their own onboarding (needs a
product decision), no assign UI, stale active-worker copy, `consent` atomicity,
audit-outside-transaction sites, possible orphaned S3 objects.

## Could not test

1. **Real HR contract flow** — every scenario seeded `Contract` rows directly; the
   `contract-scan` → `contract-confirm` path was never exercised.
2. **`retention/sweep-job.ts`** — never reviewed or run by anyone.
3. **Sustained concurrency** — only request *pairs* were raced, not real load.
4. **Mobile apps** — untouched.
5. **`FEATURE_RM_ROLE` in the ON state** for the full RM-approves-Manager path — the flag was off
   for this run (its default); the off-path fallback was verified instead.

## Notable process lessons (worth keeping)

- **Unit tests, `tsc`, and lint all passed while `/onboarding` was completely broken.** Browser
  testing is not redundant with API testing.
- **A `200 success` response repeatedly meant nothing had been written.** Verify at the data layer.
- **The same `password_hash` leak recurred three times** in the same file, each time introduced by
  a fix for something else. It was only stopped by adding a structural backstop in
  `toGeneralProfile`, not by fixing occurrences.
- **"Cleaning up" a Prisma migration removed statements a fresh database needed.** The only
  reliable check is `migrate deploy` + `migrate diff` against a virgin DB.
- **Reported summaries were sometimes wrong** (fabricated category lists, claimed-but-absent
  governance records, "all tests pass" while 2 failed, work described as committed that wasn't).
  Verify claims against the repo, not the report.

## Scenario files created this run

All of them — this run established the suite:
`README.md`, `scenarios/00`–`08`, and this run log.
