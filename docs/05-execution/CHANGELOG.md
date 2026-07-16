# Execution Changelog

| Field | Value |
|---|---|
| Purpose | Chronological record of execution-layer state changes (phase/epic status transitions, sprint closes, blocker resolutions) |
| Scope | `docs/05-execution/` only — does not record changes to specifications, ADRs, or `docs/04-implementation/` planning artifacts |

Entries are newest-first. Each entry cites what changed, in which execution document, and why
(with a repository reference where applicable). This is not a duplicate of git history — it is
the human-readable narrative of execution progress.

## 2026-07-16 — S0-2 Prisma migration + rollback harness (EPIC-PLATFORM) → DONE

Implemented the second Sprint 0 backlog item (S0-2) via the Implementation Workflow, closing the
EPIC-PLATFORM deliverable "Prisma migration + rollback harness; production-shaped snapshot for
dry-runs (ADR-004/005)" and its acceptance criterion "a no-op migration proves forward + rollback
end-to-end."

- **Verified current strategy first:** forward migrations are applied by `prisma migrate deploy`
  in `ci.yml` and both deploy workflows (ADR-004); the deploy workflows already gate on
  `prisma migrate status` for failed/drift detection. The gap: Prisma Migrate has **no native
  down/rollback**, and `deploy-production.yml`'s rollback is explicitly *code-only* and assumes
  backward-compatible migrations. S0-2 adds a deterministic rollback path on top — it does not
  replace `migrate deploy`.
- **What changed (all additive; no runtime dependency introduced):**
  - **Paired-down convention** — added [`down.sql`](../../backend/prisma/migrations/) to both
    existing migrations (`20260613120000_v2_marketplace_init`, `20260710000000_add_password_reset_token`),
    each idempotent (`DROP ... IF EXISTS ... CASCADE`) and reversing exactly what its `migration.sql`
    creates.
  - **Harness** — [`backend/scripts/migrate-harness.sh`](../../backend/scripts/migrate-harness.sh):
    `check-pairs` (enforces every migration has a `down.sql`), `forward`, `down [N]` (runs `down.sql`
    in a transaction, then removes the `_prisma_migrations` history row so `migrate deploy` re-applies
    it — recovery), `snapshot` (data-free production-shaped schema export), and `verify` (the
    end-to-end proof).
  - **No-op probe** — [`backend/prisma/harness/noop_probe/`](../../backend/prisma/harness/) — a
    schema-neutral migration used only by the harness self-test, kept **outside** `prisma/migrations/`
    so `migrate deploy` never applies it to a real environment. Proves forward → rollback → recovery
    independently of any real schema change (the literal S0-2 acceptance criterion).
  - **CI** — [`.github/workflows/migration-harness.yml`](../../.github/workflows/migration-harness.yml):
    runs `check-pairs` then `verify` against a Postgres 15 service (same image `ci.yml` uses) on any
    push/PR touching the migration chain, harness, `schema.prisma`, or the workflow; uploads the
    production-shaped snapshot as an artifact. Reuses existing CI infrastructure — no new service.
  - **Runbook** —
    [`docs/11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md`](../11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md);
    `deploy-production.yml`'s rollback-model comment now points at it for the manual
    destructive-migration recovery path (one-line, non-behavioral).
- **Production-shaped snapshot for dry-runs:** the harness runs the committed migration chain on an
  empty database, whose schema is the exact production shape with no developer drift; `verify` dry-runs
  against precisely that, and `snapshot` exports it for offline dry-runs (CI artifact
  `production-shape-schema`).
- **Verification:** `bash -n` clean; `check-pairs` passes against the real repo; the `verify`
  control flow (forward → full teardown-to-empty → recovery with schema identity → single-step
  rollback + recovery → no-op probe round-trip) was exercised end-to-end via psql/pg_dump/prisma
  stubs (no live Postgres in the authoring sandbox); the executable proof against real Postgres is
  the `migration-harness` CI job. Two workflow YAMLs validated.
- **Independent reviews (gate evidence):**
  - *Consistency Review* — one Major finding (CONS-001) fixed before commit: the marketplace-init
    forward migration also creates two PL/pgSQL functions (`refresh_worker_overall_rating`,
    `trg_rating_refresh_overall`) and the `Rating_refresh_overall_rating` trigger; the trigger drops
    with `Rating` via CASCADE, but the two standalone functions were leaking. Added explicit
    `DROP TRIGGER`/`DROP FUNCTION` to the init `down.sql`, and broadened the harness teardown
    assertion (`count_app_relations`) to count **any** `CREATE ` object (not just tables/types) so
    the "returns to empty" proof catches such leaks. All other consistency checks (links, numbers,
    ci.yml-convention parity, password-reset down, no-op probe) passed.
  - *Security Review* — PASS, no blocking findings. Two Low findings addressed defensively: migration
    directory names are now validated (`[A-Za-z0-9_]`) before being embedded in a SQL literal
    (`assert_safe_migration_name`), and destructive commands (`verify`/`down`) require an explicit
    `MIGRATE_HARNESS_YES=1` interlock (set by the CI job against its ephemeral DB). Informational
    action-tag-pinning finding accepted as consistent with the `ci.yml` baseline.
  - *Repository Integrity Validation* — 0 new blocking findings (pre-existing baselined/warn items only).
- **Tracker updates:** `CURRENT_SPRINT.md` S0-2 → `DONE` (owner: Infrastructure Engineer);
  `PROGRESS.md` Sprint 0 → 2/7 (29%). No blocker changed (`BLOCKERS.md` unchanged). Phase 0 remains
  `IN_PROGRESS` — EPIC-PLATFORM still has S0-3/S0-4 open, and EPIC-SECREM/EPIC-OWNERSHIP remain.

## 2026-07-16 — S0-1 CI blocking checks, per workspace (EPIC-PLATFORM) → DONE

Implemented the first Sprint 0 backlog item (S0-1) via the Implementation Workflow, closing the
in-repo per-workspace gate gaps in the EPIC-PLATFORM "CI pipeline running type-check, build, test
as blocking checks, per workspace (backend/frontend/mobile)" deliverable. Two acceptance dimensions
are satisfied by documented exception rather than a new gate step (see **Residual / caveats** below);
they do not require further code here.

- **What changed:** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) only.
  - Added a `Build` step (`npm run build`) to the backend `ci` job — the harness previously ran
    typecheck + lint + test but not the build gate.
  - Added a new `frontend` job covering the `frontend` workspace, which had **no** CI gate at all:
    root `npm ci` (the frontend workspace has no standalone lockfile; deps resolve through the root
    workspaces `package-lock.json`), then `type-check`, `lint`, and `build` via `--workspace frontend`.
  - Mobile jobs (`worker-app`, `checker-app`) already run typecheck + test and are unchanged; native
    binary build is an out-of-band EAS cloud build, not a PR-blocking check, so it is intentionally
    excluded from the gate harness.
  - Added a top-level `permissions: contents: read` least-privilege token scope (independent security
    review, finding SEC-001) — behavior-neutral hardening; CI only needs to read the repository.
- **Lineage:** `ci.yml` was introduced by PR #106 (`c47df39`) with the backend (`ci`) and mobile
  jobs; PR #153 (`9ac2291`) later added only the `repository-integrity` job. S0-1 was never formally
  closed against the backlog. This change adds the previously-missing backend `Build` step and the
  entire `frontend` job, and moves S0-1 to `DONE`.
- **Residual / caveats (satisfied by documented exception, not a gate step):**
  - *Frontend `test` gate:* the deliverable lists `npm test` per workspace, but `frontend/package.json`
    defines no `test` script and the frontend workspace has no test suite yet — there is nothing to
    gate. No frontend test step is wired; when a suite is added, a `test` step should join this job.
    (Mirrors the mobile-build exception: a gate is omitted only where the underlying task does not
    exist in that workspace.)
  - *"a failing check blocks merge":* the workflow produces the required status checks on every PR to
    `develop`/`main`, but marking them **required** (branch protection) is a repository-admin setting
    outside the repository tree and cannot be encoded here. S0-1 is recorded `DONE` for its in-repo
    deliverable; enabling branch protection to enforce the checks is a one-time admin action tracked
    as a follow-up note, not additional code.
- **Verification (local, pre-merge):** `type-check`, `lint`, and `build` all exit 0 for the frontend
  workspace; backend `build` (tsc) exits 0. YAML validated. The workflow triggers on `pull_request`
  to `develop`/`main`, so every PR runs the full gate harness (branch-protection enforcement noted
  under **Residual / caveats**).
- **Tracker updates:** `CURRENT_SPRINT.md` S0-1 → `DONE` (owner: Infrastructure Engineer);
  `PROGRESS.md` Sprint 0 → 1/7 (14%). No blocker changed (no new impediment; `BLOCKERS.md`
  unchanged). Phase 0 remains `IN_PROGRESS` — its exit gate still requires the remaining
  EPIC-PLATFORM/SECREM/OWNERSHIP items.

## 2026-07-16 — Execution Documentation Refinement

Refined the execution layer per the Execution Documentation Refinement Workflow. No status
changed (Sprint 0 remains open, all items `NOT_STARTED`, all 10 blockers still `OPEN`); this pass
corrected structure and links only.

- **Link audit:** `BLOCKERS.md` linked to `governance/SPECIFICATION_ISSUES_REGISTER.md`, which
  does not exist — the register lives at `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`.
  Fixed in both occurrences. Separately, four `IMPLEMENTATION_BACKLOG.md` heading anchors
  (`EPIC-AUTH`, `EPIC-CALENDAR`, `EPIC-CONSENT`, `EPIC-CHATBOT`) were missing a hyphen — the source
  headings have a double space before their trailing `*(...)*` annotation, which GitHub's
  slugifier renders as a double hyphen, not the single hyphen originally used in `BLOCKERS.md`.
  Corrected all four; recomputed every other anchor against the current heading text and confirmed
  no further drift. Confirmed `docs/04-implementation/*.md` file paths themselves are unaffected by
  the repository's prior `docs/09-decisions/` → `docs/14-governance/` restructuring (that move did
  not touch `docs/04-implementation/`).
- **Blocker validity:** re-verified all 10 open blockers against current repository state —
  `backend-hotel-workers` still has no spec (BLK-002), `SPEC-CALENDAR-001` still `REVIEW` (BLK-003),
  `GET /analytics/leaderboard` and `/by-hotel/:hotel_id` still unguarded in
  `backend/src/modules/analytics/routes.ts` (BLK-004), `SIR-DOC-005`/`007`, `SIR-CHAT-005`/`006`,
  and `OD-GEO-001`/`002` still open (BLK-005, BLK-007, BLK-008), 11 `SIR-CONSENT-*` items and
  ownership still unresolved (BLK-006), auth's 4 High findings + absent MFA still open (BLK-009),
  and no mobile location-permission package present in `mobile/worker-app` (BLK-010). No obsolete
  or marketplace-era-terminology blocker found; none removed or corrected.
- **`CURRENT_SPRINT.md`:** reduced to status/owner/issue-PR/blocker tracking only. Removed the
  restated Phase 0 goal/exit-gate prose, the per-item deliverable descriptions (now a link to the
  owning backlog epic instead), and the parallelization/out-of-scope prose paragraphs — replaced
  with a one-line out-of-scope note in the header table.
- **`IMPLEMENTATION_TRACKER.md`:** Epic Tracker's per-epic notes replaced with `BLK-*` ID
  cross-references (where a tracked blocker exists) or a terse `PRE:` spec-freeze pointer,
  removing prose that restated backlog prerequisite text.
- **`PROGRESS.md`:** confirmed as a pure derived summary — removed the per-item Sprint 0 status
  table (duplicated `CURRENT_SPRINT.md`) and the prose Critical-Path Watch table (duplicated
  `BLOCKERS.md`), replacing both with a single computed count plus a link to the authoritative
  file. Removed the `Status` column values from the Milestone Progress table (phase status is
  tracked once, in `IMPLEMENTATION_TRACKER.md`).
- No specification, ADR, architecture, or `docs/04-implementation/`/`docs/03-modules/` planning
  artifact was read as anything other than authoritative source; none was modified. No new planning
  was introduced — this pass only removed duplication and corrected links within
  `docs/05-execution/`.

## 2026-07-15 — Execution Preparation Layer opened

- Created `docs/05-execution/` as the operational layer, per the Execution Preparation Workflow.
- Added [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md): phase and epic status tracker,
  initialized from [ART-PLAN-001](../04-implementation/IMPLEMENTATION_MASTER_PLAN.md),
  [IMPLEMENTATION_BACKLOG.md](../04-implementation/IMPLEMENTATION_BACKLOG.md), and
  [IMPLEMENTATION_PHASES.md](../04-implementation/IMPLEMENTATION_PHASES.md). All phases
  `NOT_STARTED` except Phase 0, opened `IN_PROGRESS`.
- Added [CURRENT_SPRINT.md](CURRENT_SPRINT.md): Sprint 0 defined from Phase 0
  (EPIC-PLATFORM, EPIC-SECREM immediate portion, EPIC-OWNERSHIP), 7 backlog items, all
  `NOT_STARTED`.
- Added [PROGRESS.md](PROGRESS.md): milestone progress dashboard (M0–M7 + continuous client
  track), all at 0% except M0 tracked as open.
- Added [BLOCKERS.md](BLOCKERS.md): 10 open blockers seeded from the Phase Gate Summary and
  backlog prerequisites (BLK-001..BLK-010), covering ownership assignment, the missing
  hotel-workers spec, Calendar G2 freeze, the analytics security-gated freeze, Documents/Consent/
  Chatbot/Geo decision blockers, auth release-prereqs, and mobile location-permission readiness.
- No specification, ADR, architecture, or `docs/04-implementation/` planning document was
  modified. This layer is transitional record-keeping — it moves the repository from planned to
  tracked, it does not itself constitute implementation work.

**Baseline:** planning artifacts at `09e0b162297162c8a93975ce55ccd3c406218606`; execution layer
opened at repository revision `cde1d141d436bf26960d21758dcc44a20fb5acc1`.
