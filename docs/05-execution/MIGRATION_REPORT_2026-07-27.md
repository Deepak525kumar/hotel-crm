# Execution-Tracking System Migration Report

**Date:** 2026-07-27
**Trigger:** ADR-030 and ADR-031 both fully merged (PR-1..PR-8 and PR-0..PR-8 respectively); the
prior `docs/05-execution/` tracker, built around a pre-pivot Phase 0–7 / `EPIC-*` planning model,
no longer reflected reality — `EPIC-AUTH`/`EPIC-USERS` still read `NOT_STARTED` while a full
authorization/authentication rebuild had shipped through a different track entirely
(`GOVERNANCE_DECISIONS_REQUIRED.md`'s `GD-*` rows).

## What was deleted

| File | Why |
|---|---|
| `docs/05-execution/PROGRESS.md` | Pure roll-up of the other four files, all four now gone or restructured; its own milestone-progress table still read `0%` across every phase despite the shipped work. No content survived unabsorbed. |
| `docs/05-execution/IMPLEMENTATION_TRACKER.md` | Tracked the stale Phase/Epic model directly (`EPIC-AUTH: NOT_STARTED`, contradicted by ADR-030/031). Its `EPIC-*` taxonomy doesn't describe how work has actually been delivered since the ADR/GD governance-decision track took over. |
| `docs/05-execution/CURRENT_SPRINT.md` | Tracked "Sprint 0 — Foundation & Enablement," a narrow, long-since-superseded scope (CI, migration harness, one analytics hotfix) unrelated to current work. |
| `docs/05-execution/BLOCKERS.md` | Its content (`SYNC-001` ownership gap, etc.) is now one section of `EXECUTION_DASHBOARD.md`'s Blockers table — "what's blocking active work" doesn't need a dedicated file when nothing else in the repo needs to link to blocker detail independent of overall status. |
| `docs/05-execution/CHANGELOG.md` | A hand-maintained narrative of state transitions that `git log`/PR history already provides in full. Per `.claude/CLAUDE.md`'s own instruction ("treat archive paths as historical evidence only" / prefer not preserving structure "for history" when git history exists), this was pure duplication with a maintenance cost and no unique information. |

**Nothing was preserved unabsorbed.** Every file above was read in full before deletion; any fact
still true today (e.g., `SYNC-001`'s ownership gap, `SIR-AUTH-022`'s backup-table cleanup need) was
carried into the new structure. Facts that were simply wrong (0% progress, `NOT_STARTED` epics)
were not carried forward — they were the reason for this migration, not content to migrate.

## What was created

| File | Responsibility |
|---|---|
| `docs/05-execution/EXECUTION_DASHBOARD.md` (138 lines) | The single "where is engineering work at right now" view: current milestone, per-module implementation status (sourced live from `MODULE_REGISTRY.yaml`, independently re-verified against `backend/src/modules/*/service.ts`), completed work, remaining modules/work, and blockers. |
| `docs/05-execution/RELEASE_STATUS.md` (70 lines) | The single "are we production-ready" view: G8 release-gate status per module, platform-wide release prerequisites, and the ADR-031 rollout-gate summary. Deliberately separate from the dashboard — different audience (release sign-off vs. day-to-day engineering), different gate criteria (G8 exit conditions), different update cadence. |
| `docs/05-execution/README.md` (16 lines) | One-paragraph index stating the directory holds exactly these two files, and explicitly forbidding a future third file (sprint tracker, changelog, blockers-only file) that would reintroduce the same duplication this migration removed. |

Two files, not five. **Minimized by design**, not by omission: `ROADMAP.md`/`CURRENT_WORK.md` were
considered and rejected as separate files — "current milestone, active work, upcoming work,
remaining modules" is one connected status question, and splitting it in two would reproduce the
exact multi-file-silent-divergence failure mode the old `PROGRESS.md`/`CURRENT_SPRINT.md`/
`IMPLEMENTATION_TRACKER.md` trio demonstrated.

## What was merged

- `BLOCKERS.md`'s content → `EXECUTION_DASHBOARD.md`'s "Blockers to Active Work" table.
- `IMPLEMENTATION_TRACKER.md`'s G5/G8 status columns → split across both new files (G5-adjacent
  "is it built" facts → `EXECUTION_DASHBOARD.md`; G8 release-gate facts → `RELEASE_STATUS.md`).
- `PROGRESS.md`'s roll-up role → no longer needed; both new files carry their own current status
  directly rather than being derived from three other files.

## What was renamed

Nothing was renamed 1:1 — every new file was authored fresh against current repository state
(`MODULE_REGISTRY.yaml`, `DEPENDENCY_GRAPH.yaml`, `GOVERNANCE_DECISIONS_REQUIRED.md`, and live code)
rather than restructured from the old files' content, since the old content's facts were
themselves the problem.

## What was explicitly preserved unchanged (out of scope for this migration)

- `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` — the sole source of truth for `GD-*`/ADR
  status. Both new files reference it by ID, never restate its content.
- `docs/implementation/MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md` — the delivery record for
  ADR-030/031. Referenced, not duplicated.
- `docs/implementation/ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md` — the detailed production rollout
  gate. One stale cross-reference to the now-deleted `CHANGELOG.md` was fixed in place (see below);
  everything else in that file is untouched.
- `.claude/knowledge/MODULE_REGISTRY.yaml`, `DEPENDENCY_GRAPH.yaml`, `CONTRACT_INDEX.yaml`,
  `DECISION_INDEX.md` — read as sources, not modified.
- `docs/04-implementation/*` (the original frozen planning layer) — untouched; it's the planning
  baseline, not the execution-tracking layer this migration replaces.
  **2026-07-29 note:** this directory was subsequently archived to `docs/legacy/04-implementation/`
  (SYNC-057, hygiene sweep) as a never-adopted G3 draft; the statement above remains accurate as of
  this migration's own date (2026-07-27) and is retained unchanged as historical narration. A
  redirect stub now lives at `docs/04-implementation/README.md`.
- All ADR files and `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` — ADR authoring/status
  has its own governance lifecycle, explicitly out of scope for this new system per the task's own
  requirement.

## Reference cleanup

Repo-wide grep (`docs/**`, `.claude/**`, `backend/**`, `frontend/**`, `mobile/**`, all `README.md`,
all `*.yaml`/`*.yml`/`*.json`) for every deleted filename found exactly **3 remaining hits, all for
`CHANGELOG.md`, zero for the other four deleted files**:

1. `.claude/REPOSITORY_INTEGRITY_VALIDATION_REPORT.md:48` — a frozen 2026-07-16 incident report.
   Left the original prose untouched; appended a one-line dated note marking the citation as
   pointing to a since-deleted, `git log`-recoverable file.
2. `docs/15-audits/ADR_INTEGRITY_RESTORATION_2026-07-16.md:45` — same treatment, same reasoning
   (frozen historical incident narrative).
3. `docs/implementation/ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md:29` — **this one was live evidentiary
   content, not frozen narrative** (a bulleted "Evidence (as of 2026-07-27)" list), so it was
   corrected in place rather than annotated: the `CHANGELOG.md` citation was removed from the
   bullet's claim and replaced with a note that the file was deleted as part of this migration and
   never recorded a deployment either way.

No other file in the repository references `PROGRESS.md`, `CURRENT_SPRINT.md`,
`IMPLEMENTATION_TRACKER.md`, `BLOCKERS.md`, or the `ART-EXEC-001` artifact ID by path.

## Independent verification performed

- Full backend test suite re-run: 67/67 suites, 1024/1024 tests passing; `tsc --noEmit` clean.
- Every module marked as a stub in the new dashboard spot-checked directly against source: `hr`
  and `calendar` service files confirmed to still throw `NotImplementedError` from every method;
  `chatbot` and `geo` confirmed to contain only `.placeholder`, not route-registered.
- All facts in the new files cross-checked against `MODULE_REGISTRY.yaml`, `DEPENDENCY_GRAPH.yaml`,
  and `GOVERNANCE_DECISIONS_REQUIRED.md` rather than copied from the deleted files' claims.
- A second, independent read-through found and fixed two minor internal-duplication issues in the
  first draft (the three `GD-04`/`GD-05`/`GD-06` MVP-blocking decisions were stated in three
  places within `EXECUTION_DASHBOARD.md` alone; `SIR-AUTH-022` was stated twice) — each now has
  exactly one home (the Blockers table), with other sections cross-referencing it.

## Why the new structure is superior

1. **Single source of truth per question.** The old system had three files (`PROGRESS.md`,
   `CURRENT_SPRINT.md`, `IMPLEMENTATION_TRACKER.md`) all claiming to answer "what's the current
   status," with no mechanism forcing them to agree — and they didn't (`PROGRESS.md` never got
   updated after ADR-030/031 shipped). The new system has exactly one file per question:
   `EXECUTION_DASHBOARD.md` for "where are we," `RELEASE_STATUS.md` for "are we ready to ship."
2. **Grounded in facts that update themselves.** Per-module status is sourced from
   `MODULE_REGISTRY.yaml` and verified against actual code, not hand-maintained prose that silently
   rots (exactly what happened to the old tracker).
3. **Does not compete with the governance-decision layer.** The old system had no formal
   relationship to `GOVERNANCE_DECISIONS_REQUIRED.md` — they just both existed, disagreeing. The
   new system references it by ID everywhere and explicitly refuses to restate ADR/GD content,
   closing off the exact failure mode that made the old tracker stale in the first place.
4. **Fewer files, each with one job.** Two substantive files instead of five, with a README that
   actively discourages adding a third.
