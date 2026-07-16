# Execution Changelog

| Field | Value |
|---|---|
| Purpose | Chronological record of execution-layer state changes (phase/epic status transitions, sprint closes, blocker resolutions) |
| Scope | `docs/05-execution/` only — does not record changes to specifications, ADRs, or `docs/04-implementation/` planning artifacts |

Entries are newest-first. Each entry cites what changed, in which execution document, and why
(with a repository reference where applicable). This is not a duplicate of git history — it is
the human-readable narrative of execution progress.

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
