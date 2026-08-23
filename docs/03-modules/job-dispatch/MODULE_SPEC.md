# Module Specification: `job-dispatch` (backend-work-requests, backend-work-applications, backend-assignments)

> Specification of ONE bounded capability — job dispatch & assignment — spanning three
> backend modules. This capability is **MID-PIVOT**. It carries two labeled layers:
> `[CURRENT STATE]` — already-implemented marketplace apply/accept behavior, reverse-specified
> at code base revision `f37a39b`; and `[TARGET STATE]` — the confirmed two-tier
> calendar-direct-assignment + skill-based-broadcast model that is authoritative but
> largely unbuilt. `[MIGRATION GAP]` marks the delta between them. Every material claim
> is bound to source: current-state claims cite `path:line @f37a39b`; target-state claims
> cite the confirmed authorities `PIVOT_DESIGN_DOCUMENT.md` (PIVOT §x) and
> `CONFIRMED_REQUIREMENTS_REGISTER.md` (CONFIRMED §x). This document records behavior and
> confirmed contract; it does not create product policy. All human-authority decisions are
> carried as explicit open decisions and are NOT resolved here.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-JOB-DISPATCH-001 / 0.3.8` |
| Status | `FROZEN` |
| Owner | `unassigned (SYNC-001, human authority required; PIVOT §13 names "Owner: Mayank (Lead), Reviewers: Ritik (PM)" for the design doc — corroborating only, not a knowledge-layer encoding)` |
| Authors / reviewers | Author: Module Author agent. Reviewers (G4 complete, original v0.3.0): Architecture (BLOCKED — human), Dependency (PASS_WITH_ACTIONS), Consistency (PASS_WITH_ACTIONS), Security (FAIL — 1 Critical/2 High), Performance (PASS_WITH_ACTIONS). **Correction v0.3.1 (2026-07-19, `ADR-021`) affected-reviewer re-verification:** Dependency (`PASS_WITH_ACTIONS`, upgraded from a `SPEC-CALENDAR-001`-side `BLOCKED`, FIND-DEP-001/002/003 resolved), Architecture (`PASS_WITH_ACTIONS`, boundary internally consistent, no new ownership ambiguity), Consistency (targeted re-check of the correction's cross-module attribution, see Review and Change Log). |
| Repository revision | Code base described: `f37a39bf8535973366f5b1ccc4f2ccbaa3c60090` (`f37a39b`). Candidate reviewed/committed at `22569f0` (also `f74f039`) — identical working trees to `f37a39b` (FIND-ARCH-005, FIND-CONS-003). Branch `claude/spec-freeze-job-dispatch-fuyxmw`. |
| Approved by / at | FROZEN at G2 Specification Freeze on 2026-07-15 by the commissioning human via the G2 Approval Workflow. Per the approving decision, the specification is frozen independently of implementation security findings: the open security findings recorded against this module remain **implementation/release prerequisites** (must be fixed or re-reviewed before G8 Release Readiness), NOT specification-freeze blockers. No temporary Risk Assessment was created. Cross-cutting G2 blockers cleared by ADR-001..010 (ratified 2026-07-15) and the cross-owner accept-transaction coupling disposed as superseded-by-pivot by ADR-018 (Accepted, 2026-07-15), clearing the Architecture `BLOCKED`. Security posture: the Critical (`PATCH /assignments/:id` unguarded) + 2 High findings stay OPEN as release prerequisites (must be fixed before G8; the Critical warrants immediate remediation on a security timeline). **Amended (Correction, v0.3.0→0.3.1) 2026-07-19 by the commissioning human, per `ADR-021`** (Calendar↔Job-Dispatch scheduling-ownership boundary, Accepted 2026-07-19): the re-authored `SPEC-CALENDAR-001@0.2.0`'s G4 Dependency re-review found this frozen document's `CalendarEntry`/`TREQ-009`/`TRULE-008`/notification text contradicted `ADR-021`'s premise that Job Dispatch would be left "unchanged" (`FIND-DEP-001/002/003`). This correction narrowly reconciles exactly those three points — `CalendarEntry` scoped to the assignment kind only, the sick/vacation auto-cancel converted from an atomic single transaction to consumption of Calendar's `EVT-CAL-SickVacationMarked`, and the sick/vacation manager notification ceded to Calendar — and touches no other requirement, rule, security finding, or open decision. FROZEN status is retained (narrow reconciliation of an already-ratified boundary decision, not a re-opening of unresolved scope); Status stays `FROZEN` per the same G2 authority, extended by this session's explicit "amend the frozen spec" direction. **Amended (Correction, v0.3.1→0.3.2) 2026-07-27, per `GD-05`** (Per-hotel "pause new jobs" toggle, Decided): closes `SIR-CRM-016`/`OD-CRM-16` (architecture review `FIND-002`, `SPEC-CRM-001`), which required this module to acknowledge its dependency on `Hotel.accepting_jobs` before `OD-CRM-04` could be implemented. `WorkRequestService.create()` (`work-requests/service.ts`) reads `Hotel.accepting_jobs` (owned/written exclusively by `backend-crm`) and rejects creation with `ConflictError` (409 — a business-state precondition, not an authorization check, consistent with this module's other state-based rejections e.g. `RULE-008`'s illegal-transition `ConflictError`) when it is `false`, per `GD-05`'s ratified enforcement boundary. This is a read-only cross-module dependency, consistent with this module's existing pattern of reading `Hotel.deleted_at` at the same call site — no new write, no new ownership claim. See `REQ-040`/`RULE-008` (unaffected — this is an additional precondition to `create()`, not a change to the transition model) and the new `TREQ`/`TRULE` row below. No other requirement, rule, security finding, or open decision is touched. FROZEN status retained (narrow reconciliation, same precedent as this document's own v0.3.0→0.3.1 correction). **Amended (Correction, v0.3.2→0.3.3) 2026-07-29, per Epic 9 PR 9.4** (`WorkRequest`→`JobRequest` model rename, `TREQ-013`/`MIG-GAP-12`, commits `a69c8fd`, merged `b0904ba`): the `WorkRequest` Prisma model was renamed `JobRequest` (`@@map("WorkRequest")` preserves the physical table — zero data migration); the `backend/src/modules/work-requests/` module directory and `WorkRequestService` class were renamed to `job-requests`/`JobRequestService`. The public route mount path `/work-requests` is retained unchanged (public API contract, not renamed) — only internal model/module/class names changed. No requirement, rule, security finding, or open decision content is touched by this rename; this entry formalizes an amendment already recorded in the knowledge layer (`MODULE_REGISTRY.yaml`, `SYNC-061`) but missing its own Document Control/Review-and-Change-Log record in this document until now. FROZEN status retained (a pure identifier rename, not a re-opening of scope). **Amended (Correction, v0.3.3→0.3.4) 2026-07-29, per Epic 9 PR 9.7** (`TREQ-002`/`TREQ-003`/`TREQ-010`, `MIG-GAP-04`/`MIG-GAP-05`): adds `JobRequestSkillSlot` (new Prisma model, migration `20260729040000_add_job_request_skill_slot`, purely additive — one row per skill×headcount line on a broadcast `JobRequest`, e.g. "2 Cleaners + 1 Waiter" per `CONFIRMED_REQUIREMENTS_REGISTER.md` §13) and `JobRequestService.raiseBroadcast()`/`getBroadcastEligibility()` (`job-requests/service.ts`). Closes the persistence half of `TREQ-002` (skill×headcount, `MIG-GAP-04`), the eligibility-computation half of `TREQ-003` (skill match ∧ free that day — reuses `isWorkerFreeOnDay()`/`ACTIVE_ASSIGNMENT_STATUSES` from Epic 9 PR 9.6 and `listEligibleWorkerIds()` from `roster-scope.ts` rather than duplicating either), and the broadcast-path half of `TREQ-010` (`MIG-GAP-05`, skill enum). Explicitly does NOT close: the notification-delivery half of `TREQ-003` and `TREQ-005`'s "requirement fulfilled" response (both PR 9.8/9.9), `TREQ-004`'s arbitration (PR 9.9, though `JobRequestSkillSlot.confirmed_count` was added now as its future optimistic-concurrency target per this PR's preceding architecture review), and `TREQ-006`'s auto-close (PR 9.10). **Transitional-compatibility decision on the legacy marketplace fields (confirmed 2026-07-29, pre-merge review of PR 9.7 — Option B, documentation-only correction, no runtime behavior change):** `JobRequestSkillSlot` is the sole source of truth for a broadcast's skill×headcount data and the only thing any decision logic (this PR's eligibility computation; PR 9.9's future arbitration) may read as authoritative. `raiseBroadcast()` ALSO writes `position`/`workers_needed` on the created row — NOT independently authored, but a compatibility projection derived from the skill_slots breakdown (`position` = a generated summary string, e.g. `"2x CLEANER, 1x WAITER"`; `workers_needed` = the sum of per-skill headcounts) — so a broadcast row stays readable through existing surfaces that have no other field to read for it (`job-requests/service.ts`'s `list()`/`getById()` DTO mapping, `analytics/service.ts`'s `_sum(workers_needed/workers_confirmed)` aggregate, `mobile/worker-app`'s marketplace screen) without adding a broadcast-aware branch to any of them. This is intentional, not accidental, and distinct from the marketplace `create()`/`update()` flow's independent, manager-authored `position` input. `workers_confirmed` is NOT written by `raiseBroadcast()` (broadcast-accept is PR 9.9's scope; the column keeps its schema default of `0` on a freshly-raised broadcast). Superseded once `TREQ-011` retires the marketplace fields entirely. New route `POST /work-requests/broadcasts` + `GET /work-requests/broadcasts/:id/eligibility`, gated by the existing `FEATURE_JOBDISPATCH_PHASE2` flag (default off), mirroring PR 9.5's `/calendar-entries` gating shape. No requirement, rule, security finding, or open decision touched beyond the TREQ/MIG-GAP status updates above. FROZEN status retained (additive capability build within already-ratified target architecture, not a re-opening of scope). **Amended (Correction, v0.3.4→0.3.5) 2026-07-29, per Epic 9 PR 9.8** (`TREQ-003` delivery half): extends `raiseBroadcast()`'s transaction with a `JOB_REQUEST_BROADCAST` notification (new additive `NotificationType` value, migration `20260729050000_add_job_request_broadcast_notification_type`, `ALTER TYPE ... ADD VALUE`, irreversible-forward per the same precedent `20260727050000_add_calendar_notification_type` established) enqueued to every eligible worker per matching skill slot, reusing PR 9.7's `getBroadcastEligibility()` eligibility computation (factored into a shared private `computeBroadcastEligibility()`, called by both the public read route and this notification step) rather than recalculating eligibility. `OutboxSourceModule.WORK_REQUESTS` is reused unchanged (verified against Epic 9 PR 9.4's actual diff: the `WorkRequest`→`JobRequest` rename never touched this enum, so no `JOB_REQUESTS` value exists to add or prefer) — same transaction-join pattern `ADR-029`/Epic 7 PR 7.3 established, mirroring `enqueueRosterPublished()`'s existing shape. Closes `TREQ-003`'s notification-delivery half (`MIG-GAP-04`'s remaining open half). Does NOT close: `TREQ-004`'s arbitration, `TREQ-005`'s "requirement fulfilled" response, or `TREQ-006`'s auto-close (PR 9.9/9.10, unchanged). No other requirement, rule, security finding, or open decision touched. FROZEN status retained (additive capability build within already-ratified target architecture, not a re-opening of scope). **Amended (Correction, v0.3.5→0.3.6) 2026-07-30, per Epic 9 PR 9.9** (`TREQ-004`/`TREQ-005`, `MIG-GAP-06`): adds `JobRequestService.acceptBroadcast()` — a worker accepts one skill slot on a broadcast via first-accept optimistic-concurrency arbitration (a transactional conditional `updateMany` on `JobRequestSkillSlot.confirmed_count`; on `claimed.count === 0` returns the "requirement fulfilled" response (`TREQ-005`) instead of throwing; on success, creates a `WorkerAssignment` directly with `job_request_id` set and `work_request_id` left null, the identical disposition PR 9.5's `placeOnCalendar()` established). **Pre-implementation ADR conflict found and resolved before this PR's code was written:** `ADR-057` (ratified 2026-07-28) names the arbitration mechanism as "a version column plus a transactional conditional update," but `JobRequestSkillSlot` (built by PR 9.7, a day after `ADR-057`'s ratification, which could not have anticipated a per-skill-slot arbitration grain) has no `version` column, only `confirmed_count`/`headcount`. An architecture review confirmed a bare `confirmed_count`-guard conditional update is fully atomic/race-safe in Postgres and mechanistically equivalent to a version column (both are a monotonic guard re-evaluated post-lock by the same row-level-locking mechanism) but is not literally what `ADR-057`'s unhedged text names, and escalated rather than resolving it by inference. The commissioning human ratified a 2026-07-30 addendum to `ADR-057` (same file) confirming the bare `confirmed_count` guard is a conforming instance of the ratified mechanism for this per-skill-slot grain — no schema change was made or required. **A second design gap found and escalated:** `WorkerAssignment.assigned_by_id` (`NOT NULL`, `onDelete: Restrict`, relation name `"assignment_manager"`) has no natural value for a worker-initiated self-accept (no manager acts in the moment of acceptance); the commissioning human confirmed `assigned_by_id` is set to the broadcast `JobRequest.created_by_id` (the manager who raised it), not the accepting worker's own id. New route `POST /work-requests/broadcasts/:id/accept` (no `requireRole` gate — worker-initiated, mirrors `getBroadcastEligibility()`'s and `getWorkRequest()`'s worker-facing no-gate shape; the service enforces worker roster-eligibility, skill match, and daily-exclusivity itself), gated by the existing `FEATURE_JOBDISPATCH_PHASE2` flag. Test file `job-requests-arbitration.test.ts` includes the concurrency test the module's own governance register flags as historically untested for the marketplace equivalent (`FIND-BRV-006`) — mandatory per this PR's own scope, not deferred: a stateful mock proves exactly one of two concurrent claimants on a single-headcount slot wins, the other receives "requirement fulfilled," and exactly one `WorkerAssignment` row is created. Closes `TREQ-004`/`TRULE-003` and `TREQ-005`/`TRULE-004`; `MIG-GAP-06` fully closed. Does NOT implement: auto-close, scheduler registration, or any PR 9.10 behavior. No other requirement, rule, security finding, or open decision touched. FROZEN status retained (additive capability build within already-ratified target architecture, not a re-opening of scope). **Amended (Correction, v0.3.6→0.3.7) 2026-07-30, per Epic 9 PR 9.10** (`TREQ-006`/`TRULE-005`, `MIG-GAP-09`): adds `JobRequestAutoCloseJob` (`job-requests/auto-close-job.ts`, mirroring `SessionSweepJob`'s/`GeoRetentionSweepJob`'s exact shape — constructor-injected config, `name`/`intervalMs`/`run()`), registered on the Platform Worker's `Scheduler` (`worker.ts`), confirming `ADR-057`'s Platform-Worker-not-BullMQ decision in code (no new job runtime introduced). The job delegates to a new `JobRequestService.closeExpiredBroadcasts(cutoff, batchSize)` method rather than duplicating the close-and-notify logic — a batched loop (mirroring the two sweep jobs' bounded-page shape) that closes every broadcast `JobRequest` still `OPEN` more than 6 hours after creation (default, config-driven), transitioning it to `EXPIRED` and notifying the raising manager (new additive `NotificationType.JOB_REQUEST_CLOSED` value, migration `20260730000000_add_job_request_closed_notification_type`, `ALTER TYPE ... ADD VALUE`, irreversible-forward, same precedent as the three prior `NotificationType` additions in this epic). Also adds `JobRequestService.manualClose()` + new route `POST /work-requests/broadcasts/:id/close` (manager-initiated, `requireRole(['admin','manager'])`, mirrors `raiseBroadcast()`'s route shape) so a manager may close an unfilled broadcast before the 6h mark — both paths share the same private `enqueueJobRequestClosed()` notification helper, so a manager sees identical notification behavior regardless of which path closed their broadcast. **Repository-reality verification before implementation:** confirmed `EXPIRED` (not `CANCELLED`) is the correct target status via `REQ-013`'s own "RESOLVED-BY-TARGET: target replaces with a 6h auto-close job" disposition, and confirmed no code path currently sets `EXPIRED` (the existing `OPEN`→`CANCELLED` transition in the shared `ALLOWED_TRANSITIONS` table, reachable via the generic `update()` endpoint, is a distinct, already-working manual-cancel path — not the same thing as a manual early-close to `EXPIRED`). `OPEN`→`EXPIRED` is deliberately NOT added to the shared `ALLOWED_TRANSITIONS` table (that table also governs the marketplace `create()`/`update()` flow, which has no `EXPIRED`-via-manual-action concept); `manualClose()` validates the `OPEN` + is-a-broadcast precondition itself, reusing the same `wr.skill_slots.length === 0` broadcast-detection guard `getBroadcastEligibility()`/`acceptBroadcast()` already use. This choice (new dedicated `manualClose()` transitioning to `EXPIRED`, rather than treating the existing `CANCELLED` transition as already-sufficient) was confirmed by the commissioning human before implementation, since the plan's own text was ambiguous between the two. Closes `TREQ-006`/`TRULE-005`; `MIG-GAP-09` fully closed. This is Epic 9's final planned PR — every `TREQ`/`MIG-GAP` row this module's Phase 1/Phase 2 target-state scope named is now built in code — but `SIR-JOBD-006` (the `MIG-GAP-01..12` register enumeration) is deliberately NOT closed by this pass: per the standing instruction recorded by SYNC-064 and reaffirmed by every subsequent PR in this epic, closing that register row is reserved as its own, later, dedicated implementation-completion act (verifying each gap's closure against the register's own text, not just this document's), not a per-PR act this pass performs implicitly. No other requirement, rule, security finding, or open decision touched. FROZEN status retained (additive capability build within already-ratified target architecture, not a re-opening of scope). | **Documentation-correction pass, 2026-07-30, following the Epic 9 Completion Audit** (the dedicated implementation-completion act SYNC-064/v0.3.7 reserved): this pass makes no code or requirement change; it corrects five stale status cells this document's own body had left inconsistent with its own Review-and-Change-Log narrative above. Every correction below was independently re-verified against current `origin/main` (tip `ca22207`) before being applied, not copied from a prior summary. `TREQ-001`/`MIG-GAP-03`, `TREQ-007`/`MIG-GAP-08`, `TREQ-011`/`MIG-GAP-01`, `TREQ-012`/`MIG-GAP-02`, and `TREQ-013`/`MIG-GAP-12` were each still marked "Target; unbuilt" in the Target-State Requirements table (§Evidence and Traceability) despite this Review-and-Change-Log already recording each as built (v0.3.3 PR 9.4, v0.3.4 PR 9.7, and the Epic 9 PR 9.2/9.3/9.5/9.6 commits below) — all five status cells are now updated to "Built", each re-citing its closing PR and commit: `TREQ-001` by PR 9.5 (`2c77ee0`, `CalendarEntry` + `placeOnCalendar()`); `TREQ-007` by PR 9.6 (`3be6019`, `(worker_id, day)` partial unique index); `TREQ-011` by PR 9.2 (`12b1c31`, merged `b035700`, `WorkApplication` removal); `TREQ-012` by PR 9.3 (`58e1366`, nullable `job_request_id`) together with PR 9.2's FK drop; `TREQ-013` by PR 9.4 (`a69c8fd`, `WorkRequest`→`JobRequest` rename). The `MIG-GAP` enumeration table (§`[MIGRATION GAP]` enumeration) is corrected on three rows whose attribution this pass found incorrect on re-verification: `MIG-GAP-11`'s row still described the `PATCH /assignments/:id` authorization gap as an open CRITICAL item — it is not; `git show 9495c5b` confirms it was fixed by **Epic 1 PR 1.1** (2026-07-08, well before Epic 9 existed), independently tracked `RESOLVED` in the governance register as `SIR-JOBD-001` (re-verified there 2026-07-23); this row is corrected to attribute closure to Epic 1 PR 1.1 and cross-reference `SIR-JOBD-001` rather than re-litigating the finding here. `MIG-GAP-07`'s row is corrected to attribute the role×scope hotel-scoping closure to **Epic 8** (2026-07-23, `SIR-JOBD-002`, `isHotelInScope()` wired into `work-requests`/`work-applications`) — independently confirmed both by `DEPENDENCY_GRAPH.yaml`'s own pre-existing `permissions-middleware` consumer note and by Epic 9 PR 9.1's own commit message (`2b2d395`), which states it only *verified* TREQ-008/TRULE-007 against the three marketplace modules ("No fix needed there"), not built it; MIG-GAP-07 is corrected from an unattributed "Target; unbuilt" framing to record Epic 8/`SIR-JOBD-002` as its closer, with Epic 9 PR 9.1 noted as verification-only. `MIG-GAP-10`'s row is corrected to attribute the same-day sick/vacation auto-cancel closure to the **Calendar module's own direct call** (`calendar/service.ts`'s `AssignmentService.update()` invocation, ratified as the platform's synchronous-transport standard by `ADR-032`, 2026-07-28) rather than any Epic 9 PR — Epic 9 built no code touching this path; `ADR-021`'s event-driven-framing amendment (v0.3.1) is unaffected and retained. No requirement, rule, security finding, or open decision text is altered by this pass; only status/attribution cells and this log entry are added. FROZEN status retained (a documentation-accuracy correction, not a re-opening of scope). |
| Supersedes | Supersedes `SPEC-JOB-DISPATCH-001 / 0.1.0`. First specification for these three modules (registry `specification: UNKNOWN` prior). |

## Purpose and Scope

**Outcome:** Define the contract for the hotel's job dispatch & assignment capability across
its full pivot arc. This is ONE bounded capability implemented by three backend modules; it
is specified as a single capability (the three modules are NOT split).

- `[CURRENT STATE]` (implemented @f37a39b): a **marketplace apply/accept** flow — a hotel
  publishes a shift (`WorkRequest`), rostered workers browse and **apply** (`WorkApplication`),
  a manager **accepts** an application which atomically creates a confirmed `WorkerAssignment`
  and an `EXPECTED` `Attendance` row, and the assignment is driven through its lifecycle.
- `[TARGET STATE]` (confirmed, largely unbuilt — PIVOT §4.4/§5.5, CONFIRMED §13/§34): a
  **two-tier direct-dispatch** model. PRIMARY = manager places workers on a calendar
  day-by-day (**direct assignment, no accept step**). FALLBACK = manager raises a standalone
  **broadcast `JobRequest`** (skill × headcount) to eligible workers (matching skill ∧ free
  that day); **first-accept wins**; slot exhaustion notifies losers "requirement fulfilled";
  a 6-hour timer or manual action closes the request. The marketplace `WorkApplication` step
  is **removed**.

**In scope:**
- `backend/src/modules/work-requests/` — **path renamed to `backend/src/modules/job-requests/` by Epic 9 PR 9.4 (see Review and Change Log, 0.3.3); the route mount `/work-requests` was deliberately retained.** `[CURRENT]` create, publish, list, get, patch, roster fan-out; `[TARGET]` repurposed as broadcast `JobRequest` (PIVOT §9.1).
- `backend/src/modules/work-applications/` — **path no longer exists; the module was removed (TREQ-011/`ADR-058`) and its behaviour folded into `backend/src/modules/assignments/` by the person-centric assignment rework (PR #361).** `[CURRENT]` apply, list, review (accept/reject/withdraw), 7-step accept transaction; `[TARGET]` module and model **removed** (PIVOT §9.2).
- `backend/src/modules/assignments/` — `[CURRENT]` list, get, lifecycle transitions; `[TARGET]` created directly from calendar or broadcast accept, mandatory `application_id` dropped (PIVOT §9.1).
- Data contract for `WorkRequest`, `WorkApplication`, `WorkerAssignment`, and the migration-level CHECK and partial unique index that back capacity/double-booking invariants; `[TARGET]` new `CalendarEntry` and `JobRequest` models (PIVOT §9.3) and the daily-exclusivity partial unique index (PIVOT §9.4).

**Out of scope:**
- `backend/src/modules/attendance/`, `.../quality/`, `.../notifications/` internals (referenced only as consumed/written state or delivery sink). `[TARGET]` geofence attendance (PIVOT §7.4) is a separate capability; assignment→attendance direction is unchanged.
- Onboarding, contracts, consent gate, retention sweeps, i18n (PIVOT §7.1/§7.6/§7.7, §10 Phases 3–4).
- Rating computation (`WorkerOverallRating` is read-only here for the current apply-time snapshot; snapshot is retired in target).

**Non-goals:** Requirements discovery, product-policy invention, code planning, independent review, or resolving any open decision below.

## Evidence and Traceability

`[CURRENT STATE]` requirements (REQ-001..043) — reverse-specified at `f37a39b`:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-001` create as DRAFT (default) | `work-requests/types.ts:32`; `work-requests/service.ts:56-75` @f37a39b | Code | Observed |
| `REQ-002` create directly OPEN (publish-on-create) | `work-requests/service.ts:56,71-72` @f37a39b | Code | Observed |
| `REQ-003` create against missing/deleted hotel -> NotFoundError | `work-requests/service.ts:53-54` @f37a39b | Code | Observed |
| `REQ-004` request captures position/workers_needed/shift window/rate/currency/description/requirements | `work-requests/service.ts:58-74`; `schema.prisma:236-260` @f37a39b | Code | Observed |
| `REQ-005` defaults workers_needed=1, currency=EUR | `work-requests/types.ts:23,28`; `service.ts:68`; `schema.prisma:243,250` @f37a39b | Code | Observed |
| `REQ-006` publish (DRAFT->OPEN) sets published_at | `work-requests/service.ts:71-72,184-186` @f37a39b | Code | Observed |
| `REQ-007` publish fans out WORK_REQUEST_PUBLISHED to ACTIVE roster (fire-and-forget) | `work-requests/service.ts:222-250` @f37a39b | Code | Observed |
| `REQ-008` terms editable only while DRAFT; else silently ignored | `work-requests/service.ts:196-209` @f37a39b | Code | Observed |
| `REQ-009` manual transitions DRAFT->{OPEN,CANCELLED}, OPEN->CANCELLED, PARTIALLY_FILLED->CANCELLED; illegal->ConflictError | `work-requests/service.ts:15-19,177-180` @f37a39b | Code | Observed |
| `REQ-010` cancel sets cancelled_at + cancellation_reason | `work-requests/service.ts:188-191` @f37a39b | Code | Observed |
| `REQ-011` cancel does NOT cascade to assignments/attendance nor reopen | `work-requests/service.ts:162-227` (no cascade logic) @f37a39b | Code (absence) | Observed; policy open (OQ-03) |
| `REQ-012` FILLED/PARTIALLY_FILLED system-driven by accept pipeline | `work-requests/service.ts:12-19`; `work-applications/service.ts:276-287` @f37a39b | Code | Observed |
| `REQ-013` EXPIRED set by external scheduled job (not in repo) | `work-requests/service.ts:13-14` (comment); no job in repo @f37a39b | Code + absence | Observed; RESOLVED-BY-TARGET (6h auto-close, PIVOT §5.6) |
| `REQ-014` version increments on each status-changing write | `work-requests/service.ts:211`; `schema.prisma:245` @f37a39b | Code | Observed |
| `REQ-015` list with filters hotel_id/status/position/shift_date, paginated | `work-requests/service.ts:85-124`; `types.ts:58-65`; `controller.ts:40-72` @f37a39b | Code | Observed |
| `REQ-016` non-mgmt list scoped to ACTIVE roster hotels; empty if none | `work-requests/service.ts:98-112` @f37a39b | Code | Observed |
| `REQ-017` getById NotFound if absent; non-mgmt Forbidden without ACTIVE membership | `work-requests/service.ts:131-144` @f37a39b | Code | Observed |
| `REQ-018` worker/checker getById embeds my_application (latest) | `work-requests/service.ts:148-157`; `types.ts:91` @f37a39b | Code | Observed |
| `REQ-019` create/patch RBAC = admin/manager only | `work-requests/routes.ts:18,21` @f37a39b | Code | Observed |
| `REQ-020` worker applies via nested POST | `work-applications/service.ts:37-111`; `routes.ts:14`; `v1/index.ts:27` @f37a39b | Code | Observed |
| `REQ-021` apply only when request OPEN or PARTIALLY_FILLED else ConflictError | `work-applications/service.ts:44-47` @f37a39b | Code | Observed |
| `REQ-022` applicant must be ACTIVE on hotel roster else ForbiddenError | `work-applications/service.ts:50-53` @f37a39b | Code | Observed |
| `REQ-023` one application per (request,worker); duplicate non-WITHDRAWN -> ConflictError | `work-applications/service.ts:56-61`; `schema.prisma:301` @f37a39b | Code | Observed |
| `REQ-024` re-apply after WITHDRAWN reuses row, resets review fields | `work-applications/service.ts:70-84` @f37a39b | Code | Observed |
| `REQ-025` rating snapshot at apply time from WorkerOverallRating (null if none) | `work-applications/service.ts:64-67,77,92`; `schema.prisma:291` @f37a39b | Code | Observed |
| `REQ-026` apply notifies creator APPLICATION_RECEIVED (fire-and-forget) | `work-applications/service.ts:103-108` @f37a39b | Code | Observed |
| `REQ-027` apply RBAC = worker only | `work-applications/routes.ts:14` @f37a39b | Code | Observed |
| `REQ-028` list applications: mgmt sees all (filter status); worker sees only own | `work-applications/service.ts:113-148` @f37a39b | Code | Observed |
| `REQ-029` update application only when status PENDING else ConflictError | `work-applications/service.ts:163-165` @f37a39b | Code | Observed |
| `REQ-030` workers may only withdraw own; other transitions Forbidden; admin/manager accept/reject/withdraw | `work-applications/service.ts:167-173` @f37a39b | Code | Observed |
| `REQ-031` reject sets review fields + rejection_reason; notifies APPLICATION_REJECTED | `work-applications/service.ts:179-200` @f37a39b | Code | Observed |
| `REQ-032` accept (status=ACCEPTED) dispatches atomic approve pipeline | `work-applications/service.ts:175-177` @f37a39b | Code | Observed |
| `REQ-033` approve requires request OPEN/PARTIALLY_FILLED else ConflictError | `work-applications/service.ts:211-215` @f37a39b | Code | Observed |
| `REQ-034` approve claims slot via optimistic updateMany (version + workers_confirmed<workers_needed); count 0 -> ConflictError | `work-applications/service.ts:219-230` @f37a39b | Code | Observed; UNTESTED (FIND-BRV-006) |
| `REQ-035` approve accepts application (status ACCEPTED, reviewer, reviewed_at) | `work-applications/service.ts:233-240` @f37a39b | Code | Observed; UNTESTED |
| `REQ-036` approve creates WorkerAssignment (CONFIRMED, confirmed_at, mandatory application_id) | `work-applications/service.ts:243-253`; `schema.prisma:324-327` @f37a39b | Code | Observed; UNTESTED |
| `REQ-037` approve pre-creates EXPECTED Attendance with denormalized expected_start/end | `work-applications/service.ts:256-273`; `schema.prisma:359-367` @f37a39b | Code | Observed; UNTESTED |
| `REQ-038` approve recomputes FILLED (set filled_at) vs PARTIALLY_FILLED | `work-applications/service.ts:276-287` @f37a39b | Code | Observed; UNTESTED |
| `REQ-039` approve emits APPLICATION_ACCEPTED + ASSIGNMENT_CONFIRMED to worker | `work-applications/service.ts:299-311` @f37a39b | Code | Observed; UNTESTED |
| `REQ-040` assignment transitions CONFIRMED->{IN_PROGRESS,CANCELLED}, IN_PROGRESS->{COMPLETED,CANCELLED}; illegal/no-op->ConflictError; timestamps per transition | `assignments/service.ts:6-9,92-108` @f37a39b | Code | Observed |
| `REQ-041` list/get assignment scoping: list workers=own only; getById own OR ACTIVE membership | `assignments/service.ts:41-45,67-78` @f37a39b | Code | Observed |
| `REQ-042` active double-booking prevented (partial unique index status IN CONFIRMED,IN_PROGRESS) | `migration.sql:580-582`; `schema.prisma:344-345` @f37a39b | Migration + Lead Architect (OQ-12) | Confirmed (High) |
| `REQ-043` capacity invariant 0 <= workers_confirmed <= workers_needed (CHECK) | `migration.sql:564-566`; `schema.prisma:266` @f37a39b | Migration + Lead Architect (OQ-12) | Confirmed (High) |
| Every mutation writes an AuditLog row via BaseService.logAudit | `work-requests/service.ts:77,215`; `work-applications/service.ts:99,188,294`; `assignments/service.ts:112` @f37a39b | Code | Observed |
| Response envelope `{status,data,pagination?,meta}` | `work-requests/controller.ts:30-34,56-68` @f37a39b | Code | Observed |
| No event bus; notifications synchronous fire-and-forget | `work-requests/service.ts:238-248`; `work-applications/service.ts:103,194,299,306` @f37a39b | Code + MODULE_REGISTRY (none-observed) | Observed |
| Cross-module writes inside accept tx (WorkRequest/WorkerAssignment/Attendance) | DEPENDENCY_GRAPH edges `edge-work-applications-writes-{work-request,worker-assignment,attendance}` (graph:116-136); `work-applications/service.ts:219,243,256,278,283` @f37a39b | Code + graph | Observed; coupling open (FIND-ARCH-003); MOOT in target (flow removed, PIVOT §5.5) |
| Modular-monolith architecture (ADR-003) | PIVOT §5.1, §11 ("Keep modular monolith"); `backend/src/modules/*` @f37a39b | Architecture decision | Confirmed |
| Prisma 5 ORM over PostgreSQL (ADR-004) | PIVOT §2.1, §11; `backend/prisma/schema.prisma` @f37a39b | Architecture decision | Confirmed |

`[TARGET STATE]` requirements (TREQ-001..013) — confirmed authorities, largely unbuilt:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `TREQ-001` calendar direct assignment (manager places workers per day; NO accept step; appears on worker calendar; NO broadcast) | PIVOT §4.4, §5.5, §7.2; CONFIRMED §13 (Primary) | Confirmed authority | **Built, Epic 9 PR 9.5** (commit `2c77ee0`, merged `428f465`): `CalendarEntry` model + `placeOnCalendar()` (`assignments/service.ts`). `MIG-GAP-03` closed. |
| `TREQ-002` broadcast JobRequest fired only on a standalone manager request; skill(s) × headcount-per-skill | PIVOT §4.4, §7.3; CONFIRMED §13 (Fallback) | Confirmed authority | **Built, Epic 9 PR 9.7** (`raiseBroadcast()`, `job-requests/service.ts`; `JobRequestSkillSlot`, `schema.prisma`) — persistence half only; MIG-GAP-04 closed for this requirement's data-shape half (MIG-GAP-05 also closes here, see below) |
| `TREQ-003` eligibility = matching skill ∧ free that day; only those workers notified | PIVOT §5.5; CONFIRMED §13 | Confirmed authority | **Built, Epic 9 PR 9.7 (eligibility computation) + PR 9.8 (delivery)**: `getBroadcastEligibility()` computes the eligible set (PR 9.7); `enqueueBroadcastNotifications()` (PR 9.8) enqueues a `JOB_REQUEST_BROADCAST` notification per eligible worker per matching skill slot, reusing that same computation via a shared private `computeBroadcastEligibility()` rather than recalculating it. Both halves now closed. |
| `TREQ-004` first-accept wins; tie-break = earliest server-received timestamp; optimistic concurrency (version column + transactional conditional update), per `ADR-057` — no Redis mutex | PIVOT §5.5, §7.3; CONFIRMED §13; `ADR-057` | Confirmed authority | **Built, Epic 9 PR 9.9** (`acceptBroadcast()`, `job-requests/service.ts`) — first-accept-wins via a transactional conditional `updateMany` on `JobRequestSkillSlot.confirmed_count`; `ADR-057`'s 2026-07-30 addendum confirms this bare count-guard (no separate `version` column) is a conforming instance of the ratified mechanism for this per-skill-slot grain. Concurrency test (`job-requests-arbitration.test.ts`) proves exactly one winner under concurrent last-slot accepts. `MIG-GAP-06` closed. |
| `TREQ-005` when a skill's slots fill, later responders receive explicit "requirement fulfilled" notification (not silence, not error) | PIVOT §4.4, §7.3; CONFIRMED §13 | Confirmed authority | **Built, Epic 9 PR 9.9**: `acceptBroadcast()` returns the `requirement_fulfilled` response (no error, no assignment created) when its slot claim affects zero rows. `MIG-GAP-04`'s remaining open half closed (its notification-delivery half was closed by PR 9.8). |
| `TREQ-006` unfilled JobRequest auto-closes after 6 hours; manager may close manually sooner | PIVOT §4.4, §5.6; CONFIRMED §13 | Confirmed authority | **Built, Epic 9 PR 9.10** (`JobRequestAutoCloseJob`, `job-requests/auto-close-job.ts`, registered on the Platform Worker `Scheduler`; `JobRequestService.closeExpiredBroadcasts()`/`manualClose()`) — auto-close at 6h (config-driven) transitions `OPEN`→`EXPIRED` and notifies the raising manager; manual close available earlier via `POST /work-requests/broadcasts/:id/close`. `MIG-GAP-09` fully closed. |
| `TREQ-007` daily exclusivity: one active assignment per worker per DAY (calendar OR broadcast); partial unique index | PIVOT §4.4, §9.4; CONFIRMED §12, §13 | Confirmed authority | **Built, Epic 9 PR 9.6** (commit `3be6019`): `(worker_id, day)` partial unique index re-keyed off the original `(work_request_id, worker_id)` constraint; denormalized `day` column added and backfilled. `MIG-GAP-08` closed. |
| `TREQ-008` role × scope RBAC, deny-by-default; new Regional Manager role; Hotel Manager scoped to one hotel; cross-hotel only within Hotel Group; JWT scope claim | PIVOT §5.3, §5.4; CONFIRMED §1, §11, §12 | Confirmed authority | Role×scope half **closed pre-Epic-9, by Epic 8** (2026-07-23, `SIR-JOBD-002`: `isHotelInScope()` wired into `work-requests`/`work-applications`), independently verified by Epic 9 PR 9.1 (commit `2b2d395`) rather than built by it — see `MIG-GAP-07`. The `assignments`-side authorization gap (`MIG-GAP-11`) is a separate, already-`RESOLVED` matter tracked at `SIR-JOBD-001` (Epic 1 PR 1.1, commit `9495c5b`, 2026-07-08) — see that row and cross-reference, not re-litigated here. |
| `TREQ-009` on consuming Calendar's `EVT-CAL-SickVacationMarked` (Calendar-owned sick/vacation mark, `ADR-021`), cancel the same-day assignment; Calendar sends the manager notification | PIVOT §7.2; CONFIRMED §22; `ADR-021` | Confirmed authority | **Built by the Calendar module, not Epic 9** — `calendar/service.ts`'s direct call to `AssignmentService.update()`, the synchronous-transport shape ratified platform-wide by `ADR-032` (2026-07-28). `MIG-GAP-10` closed; event-driven documentation framing per `ADR-021` Correction v0.3.1 retained (the label, not a dispatcher, per `ADR-032`). |
| `TREQ-010` skills constrained to enum {Cleaner, Public Service, Kitchen Dishwasher, Waiter} (replaces free-text `position`) | CONFIRMED §4; PIVOT §4.4 | Confirmed authority | **Built for the broadcast path, Epic 9 PR 9.7** (`JobRequestSkillSlot.skill SkillTag`, validated via `RaiseBroadcastSchema`'s `z.nativeEnum(SkillTag)`); the pre-existing marketplace `JobRequest.position` free-text field is deliberately left untouched (still read by the live publish/apply flow and the analytics aggregate, confirmed by architecture review before this PR) — full replacement of `position` awaits the marketplace path's own retirement (`TREQ-011`), not this requirement's scope |
| `TREQ-011` remove `WorkApplication` model and all worker-initiated application endpoints | PIVOT §5.5, §9.2; CONFIRMED §34, §37 (NON-GOALS) | Confirmed authority | **Built, Epic 9 PR 9.2** (commit `12b1c31`/`2e89c4f`, merged `b035700`): `work-applications` module, `WorkApplication` model, `ApplicationStatus` enum, and `WorkerAssignment.application_id` FK all removed (breaking, pre-launch). `MIG-GAP-01` closed. |
| `TREQ-012` `WorkerAssignment` created directly from calendar or broadcast accept; drop mandatory `application_id` FK | PIVOT §9.1 | Confirmed authority | **Built, Epic 9 PR 9.3** (commit `58e1366`, adds nullable `job_request_id`) together with PR 9.2's `application_id` FK drop: assignments now created directly via `placeOnCalendar()` (PR 9.5) and `acceptBroadcast()` (PR 9.9), no mandatory `application_id`. `MIG-GAP-02` closed. |
| `TREQ-013` no formal job-status state machine (Open→Assigned→InProgress removed); "rest handled manually" | CONFIRMED §13 (Removed); PIVOT §5.5 | Confirmed authority | **Built, Epic 9 PR 9.4** (commit `a69c8fd`): `WorkRequest`→`JobRequest` rename off "marketplace" framing; no formal state machine introduced in target. `MIG-GAP-12` closed. |

## Actors and Terminology

Role-token case mapping (FIND-CONS-001): the Prisma `UserRole` enum values are UPPER-CASE
(`WORKER`, `CHECKER`, `ADMIN`, `MANAGER`) while route/service guards compare lower-case
string literals (`'worker'`, `'admin'`, `'manager'`, `'checker'`); the auth layer normalizes
role to the guard casing. Statements below use the guard casing.

| Term/actor | Canonical definition | Source |
|---|---|---|
| Work request | `[CURRENT]` A hotel-published shift opening carrying position, capacity (`workers_needed`), shift date/time window, and commercial terms; lifecycle DRAFT->OPEN/CANCELLED->PARTIALLY_FILLED/FILLED/EXPIRED. | `schema.prisma:236`; `work-requests/service.ts` (TERMINOLOGY promotion proposed) |
| Work application | `[CURRENT; RETIRED in target]` A rostered worker's expression of interest in one work request; at most one live row per (request,worker); accepted applications are the sole gateway to an assignment. Removed in target (PIVOT §9.2). | `schema.prisma:279`; `work-applications/service.ts` |
| Assignment (WorkerAssignment) | A confirmed booking of a worker to work. `[CURRENT]` created only from an accepted application (mandatory `application_id` FK), driven CONFIRMED->IN_PROGRESS->COMPLETED/CANCELLED. `[TARGET]` created directly from calendar or broadcast accept; `application_id` dropped (PIVOT §9.1). | `schema.prisma:314`; `assignments/service.ts` |
| Roster | The set of `HotelWorker` memberships for a hotel; ACTIVE membership gates non-management visibility and the current apply precondition. `[TARGET]` HotelWorker becomes the permanent-employment record (PIVOT §9.1). | `schema.prisma:206`; `work-requests/service.ts:101,135`; `work-applications/service.ts:50` |
| Slot | One unit of `workers_needed` capacity; `[CURRENT]` claimed via optimistic `updateMany`; `[TARGET]` claimed via the same optimistic-concurrency pattern (version column + transactional conditional update), one per skill (PIVOT §5.5, §7.3; `ADR-057`). | `work-applications/service.ts:219-229`; `schema.prisma:243-244` |
| admin / manager (management) | `[CURRENT]` Roles permitted to create/patch work requests and accept/reject applications; exempt from roster-scoping on reads and NOT hotel-scoped. | `work-requests/routes.ts:18,21`; `work-applications/service.ts:122,167` |
| worker | Role permitted to apply and to withdraw own application; reads scoped to own resources/rostered hotels. | `work-applications/routes.ts:14`; `work-requests/service.ts:100,148` |
| checker | Non-management role treated as worker for read-scoping and `my_application` embedding. | `work-requests/service.ts:148` |
| Hotel Group `[TARGET]` | A set of hotels aggregated under one Regional Manager, with shared billing; the boundary of permitted cross-hotel assignment. | PIVOT §4.3, §14 (Glossary); CONFIRMED §11, §12 |
| Regional Manager `[TARGET]` | NEW role: all Hotel-Manager actions across an entire Hotel Group; cannot create hotels or modify groups. | PIVOT §4.1, §5.4; CONFIRMED §1, §11 |
| Hotel Manager `[TARGET]` | Manager scoped to exactly ONE hotel (schedule, raise job requests, approve onboarding, manage hotel). | PIVOT §5.4; CONFIRMED §1, §11 |
| Scope `[TARGET]` | The hotel or hotel-group a user may act within, carried as a JWT claim; second authorization dimension alongside role. | PIVOT §5.3, §5.4 |
| Broadcast / JobRequest `[TARGET]` | Gap-fill dispatch to eligible workers (skill × headcount); first-accept wins; 6h auto-close. | PIVOT §4.4, §7.3, §14 (Glossary); CONFIRMED §13 |
| Calendar direct assignment `[TARGET]` | Primary path: manager places workers per day; no accept step; new `CalendarEntry` model. | PIVOT §4.4, §7.2, §9.3; CONFIRMED §13 |
| Daily exclusivity `[TARGET]` | Once assigned anything for a day, a worker is blocked from any further assignment that whole day. | PIVOT §4.4, §9.4, §14 (Glossary); CONFIRMED §12, §13 |
| Skill `[TARGET]` | One of {Cleaner, Public Service, Kitchen Dishwasher, Waiter}; replaces free-text `position`. | CONFIRMED §4 |

## Requirements and Acceptance Criteria

`[CURRENT STATE]` requirements (all Observed @f37a39b unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| REQ-001 | A work request is created as DRAFT by default. | Must | POST with no/`DRAFT` status persists status=DRAFT, published_at=null, HTTP 201. | RULE-001 |
| REQ-002 | A work request may be created directly as OPEN (publish-on-create). | Must | POST with status=OPEN persists status=OPEN and sets published_at. | RULE-001 |
| REQ-003 | Creation against a missing/soft-deleted hotel fails. | Must | Unknown or `deleted_at` hotel -> NotFoundError (no row created). | — |
| REQ-004 | A work request records position, workers_needed, shift date, start/end time, hourly_rate, currency, description, requirements. | Must | Persisted row + DTO echo all supplied fields. | — |
| REQ-005 | workers_needed defaults to 1 and currency to EUR. | Should | Omitted fields default to 1 / "EUR". | RULE-006 |
| REQ-006 | Publishing (DRAFT->OPEN) stamps published_at once. | Must | First OPEN transition sets published_at; not overwritten if already set. | RULE-001 |
| REQ-007 | Publishing notifies every ACTIVE roster worker with WORK_REQUEST_PUBLISHED. | Should | Each ACTIVE `HotelWorker` receives one notification; delivery failure does not roll back publish. | RULE-012 |
| REQ-008 | Commercial terms are mutable only while DRAFT; in any other state term fields are silently ignored. | Must | PATCH of term fields on OPEN+ request returns 200 with terms unchanged (no error). | RULE-002 |
| REQ-009 | Manual status transitions are limited to DRAFT->{OPEN,CANCELLED}, OPEN->CANCELLED, PARTIALLY_FILLED->CANCELLED. | Must | Any other manual transition -> ConflictError. | RULE-001 |
| REQ-010 | Cancelling stamps cancelled_at and stores cancellation_reason. | Must | Transition to CANCELLED sets cancelled_at=now and cancellation_reason (nullable). | RULE-001 |
| REQ-011 | Cancelling a work request does not cascade to assignments/attendance nor reopen it. | Must | After cancel, existing assignments/attendance are unchanged; workers_confirmed unchanged. | RULE-001 |
| REQ-012 | FILLED and PARTIALLY_FILLED are driven only by the accept pipeline. | Must | No manual PATCH reaches FILLED/PARTIALLY_FILLED (absent from transition table). | RULE-001, RULE-007 |
| REQ-013 | EXPIRED is set by an external scheduled job (absent from this repo). | Should | No in-repo path sets EXPIRED; documented as external. RESOLVED-BY-TARGET: target replaces with a 6h auto-close job (TREQ-006). | RULE-001 |
| REQ-014 | version increments on each status-changing write. | Must | Any status change increments version by 1; term-only DRAFT edits do not. | RULE-001 |
| REQ-015 | Work requests can be listed with hotel_id/status/position/shift_date filters, paginated. | Must | List returns filtered, paginated data + pagination envelope. | RULE-011a |
| REQ-016 | Non-management list is scoped to hotels where the actor holds ACTIVE roster membership. | Must | Non-mgmt with no ACTIVE membership -> empty result; otherwise only rostered hotels. | RULE-011a |
| REQ-017 | getById returns NotFound if absent and Forbidden for non-mgmt without ACTIVE membership on the request's hotel. | Must | Missing -> NotFoundError; non-mgmt non-member -> ForbiddenError. | RULE-011a |
| REQ-018 | For worker/checker, getById embeds the latest my_application. | Should | DTO includes my_application (id,status,created_at) or null. | RULE-011b |
| REQ-019 | Create and patch are restricted to admin/manager. | Must | Other roles -> route-level 403 before service. | RULE-005 |
| REQ-020 | A worker applies to a work request via the nested endpoint. | Must | POST /work-requests/:id/applications creates a PENDING application, HTTP 201. | RULE-011e |
| REQ-021 | Applications may be **submitted** only while the request is OPEN or PARTIALLY_FILLED. | Must | Apply (submit) to any other status -> ConflictError. (Verb standardized per FIND-CONS-002: "submit" for worker apply; "accept/approve" reserved for manager acceptance.) | RULE-003 |
| REQ-022 | The applicant must be ACTIVE on the hotel roster. | Must | Non-member applicant -> ForbiddenError. | RULE-011e |
| REQ-023 | Only one application per (request,worker) may be live. | Must | Duplicate with status != WITHDRAWN -> ConflictError; enforced by @@unique. | RULE-004 |
| REQ-024 | Re-applying after WITHDRAWN reuses the existing row and resets review fields. | Must | WITHDRAWN row is updated to PENDING with reviewer/rejection fields cleared. | RULE-004 |
| REQ-025 | The worker's overall rating is snapshotted onto the application at apply time. | Should | worker_rating_snapshot = average_score or null if no rating exists. | RULE-013 |
| REQ-026 | Applying notifies the request creator with APPLICATION_RECEIVED. | Should | One fire-and-forget notification to created_by_id; failure does not roll back apply. | RULE-012 |
| REQ-027 | Apply is restricted to the worker role. | Must | Non-worker -> route-level 403. | RULE-005 |
| REQ-028 | Management lists all applications (filterable by status); a worker sees only their own. | Must | Non-mgmt result is the single own application or empty. | RULE-011b |
| REQ-029 | An application may be updated only while PENDING. | Must | Update of non-PENDING -> ConflictError. | RULE-003 |
| REQ-030 | Workers may only withdraw their own application; management may accept/reject/withdraw. | Must | Worker non-owner -> Forbidden; worker non-WITHDRAWN target -> Forbidden; mgmt unrestricted by owner. | RULE-005 |
| REQ-031 | Rejecting stamps review fields and rejection_reason and notifies the worker. | Must | Status REJECTED sets reviewed_at/reviewed_by; APPLICATION_REJECTED sent. | RULE-005, RULE-012 |
| REQ-032 | Accepting an application dispatches the atomic approve pipeline. | Must | status=ACCEPTED routes into approve() transaction. | RULE-003, RULE-009 |
| REQ-033 | Approve requires the request to still be OPEN or PARTIALLY_FILLED. | Must | Approve on any other status -> ConflictError. | RULE-003 |
| REQ-034 | Approve claims a slot with an optimistic conditional update. | Must | updateMany WHERE version=known AND workers_confirmed<workers_needed; count 0 -> ConflictError. | RULE-006, RULE-007 |
| REQ-035 | Approve marks the application ACCEPTED with reviewer and timestamp. | Must | Application status=ACCEPTED, reviewed_by_id=actor, reviewed_at=now. | RULE-003 |
| REQ-036 | Approve creates a CONFIRMED assignment linked to the application. | Must | WorkerAssignment created with status=CONFIRMED, confirmed_at, non-null application_id. | RULE-009 |
| REQ-037 | Approve pre-creates an EXPECTED attendance row with denormalized shift window. | Must | Attendance created status=EXPECTED, expected_start/end derived from shift. | RULE-009 |
| REQ-038 | Approve recomputes fill status. | Must | workers_confirmed>=workers_needed -> FILLED + filled_at; else PARTIALLY_FILLED. | RULE-007 |
| REQ-039 | Approve emits APPLICATION_ACCEPTED and ASSIGNMENT_CONFIRMED to the worker. | Should | Two fire-and-forget notifications post-commit; failure does not roll back. | RULE-012 |
| REQ-040 | Assignments transition CONFIRMED->{IN_PROGRESS,CANCELLED} and IN_PROGRESS->{COMPLETED,CANCELLED}, stamping timestamps. | Must | Illegal or no-op transition -> ConflictError; started_at/completed_at/cancelled_at set per target. | RULE-008 |
| REQ-041 | Assignment reads are scoped: workers list only their own; getById permits own or ACTIVE membership. | Must | Worker list filtered to worker_id=self; getById non-owner non-member -> Forbidden. | RULE-011c, RULE-011d |
| REQ-042 | A worker cannot hold two active (CONFIRMED/IN_PROGRESS) assignments for the same request. | Must | Partial unique index rejects a second active row (DB-level). Note: current index keys on (request,worker), NOT per-day — target changes this (TREQ-007, MIG-GAP-08). | RULE-010 |
| REQ-043 | workers_confirmed stays within [0, workers_needed]. | Must | CHECK constraint rejects any violating write. | RULE-006 |
| REQ-044 | Work-request creation is rejected when the target hotel has paused accepting new jobs. | Must | `create()` reads `Hotel.accepting_jobs` (owned by `backend-crm`, `SPEC-CRM-001` `RULE-CRM-09`); `false` -> ConflictError (business-state precondition, not authorization), checked immediately after the existing `deleted_at` check. | RULE-014 |

`[TARGET STATE]` requirements (confirmed authority; unbuilt unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| TREQ-001 | Manager places workers on a calendar day-by-day as a DIRECT assignment — no worker accept/decline; the shift appears on the worker's calendar; no broadcast fires. | Must | A calendar placement creates a `CalendarEntry`/assignment directly; no application row; no broadcast notification emitted. | TRULE-001 |
| TREQ-002 | A broadcast `JobRequest` fires only when a manager raises a standalone request specifying skill(s) and headcount per skill. | Must | JobRequest persists skill×headcount; calendar edits never emit a broadcast. | TRULE-002 |
| TREQ-003 | Only workers with a matching skill who are free that day are eligible and notified. | Must | Eligible set = {skill matches ∧ no assignment that day}; only they receive push. | TRULE-002, TRULE-006 |
| TREQ-004 | First acceptance wins each slot; ties broken by earliest server-received timestamp; arbitration via optimistic concurrency (version column + transactional conditional update), per `ADR-057`. | Must | Under concurrent accepts on the last slot, exactly one succeeds (earliest timestamp); losing transactions receive zero affected rows and the "requirement fulfilled" response. | TRULE-003 |
| TREQ-005 | When a skill's slots are full, later responders receive an explicit "requirement fulfilled" notification (not silence, not an error). | Must | Post-fill accept returns a "requirement fulfilled" message; no assignment created. | TRULE-004 |
| TREQ-006 | An unfilled JobRequest auto-closes 6 hours after creation; the manager may close it manually sooner. | Must | Scheduled job closes at +6h and notifies the manager; manual close available earlier. | TRULE-005 |
| TREQ-007 | A worker assigned anything for a day (calendar OR broadcast) is blocked from any further assignment that whole day (daily exclusivity), enforced by a partial unique index (one active assignment per worker per day). | Must | Second same-day assignment rejected at DB level; eligibility computation excludes already-assigned workers. | TRULE-006 |
| TREQ-008 | Authorization is two-dimensional (role × scope), deny-by-default; the new Regional Manager role acts across a Hotel Group; a Hotel Manager is scoped to one hotel; cross-hotel assignment is permitted only within the worker's Hotel Group; scope is a JWT claim. | Must | Actor outside target hotel's scope -> denied; Regional Manager permitted across group; Hotel Manager denied on out-of-hotel action. | TRULE-007 |
| TREQ-009 | On consuming Calendar's `EVT-CAL-SickVacationMarked` (a worker marking a current/future day sick or vacation, owned by `backend-calendar`'s `state-calendar-absence` per `ADR-021`), cancel any existing same-day assignment. **Amended by `ADR-021` (2026-07-19, Correction v0.3.1):** the sick/vacation mark itself and the manager notification are Calendar's, not this module's; this module owns only the resulting assignment cancellation. | Must | On consuming `EVT-CAL-SickVacationMarked` (worker, day, kind), the same-day `WorkerAssignment` for that worker is cancelled within this module's own boundary; no state persists where the worker is both on-leave and assigned that day, once consumed. | TRULE-008 |
| TREQ-010 | Worker skills are constrained to the enum {Cleaner, Public Service, Kitchen Dishwasher, Waiter}; broadcast skill selection draws from this list (replacing free-text `position`). | Must | Skill values validated against the enum; broadcast per-skill headcount references enum members. | TRULE-009 |
| TREQ-011 | The `WorkApplication` model and all worker-initiated application endpoints are removed. | Must | No apply endpoint; no `WorkApplication` table; worker-initiated application is a confirmed NON-GOAL. | (retires RULE-003/004/013) |
| TREQ-012 | `WorkerAssignment` is created directly from a calendar placement or broadcast accept; the mandatory `application_id` FK is dropped. | Must | Assignment rows exist with no application linkage; creation path does not require an application. | (retires RULE-009) |
| TREQ-013 | No formal job-status state machine is enforced (Open→Assigned→InProgress removed); remaining status handling is manual. | Should | No system-enforced multi-state job lifecycle beyond assignment existence + attendance. | TRULE-005 |

## Business Rules

`[CURRENT STATE]` rules (RULE-001..013) — BRV corrections from v0.1.0 preserved; RETIRED-by-pivot flagged:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-001 | Manual PATCH/create of a WorkRequest | Allowed manual transitions: create->DRAFT or ->OPEN(direct); DRAFT->{OPEN,CANCELLED}; OPEN->CANCELLED; PARTIALLY_FILLED->CANCELLED. FILLED/PARTIALLY_FILLED are system-driven; EXPIRED is external. Cancel stamps cancelled_at and does NOT cascade to assignments/attendance nor reopen. | Illegal transition -> ConflictError. `[TARGET]` WorkRequest repurposed as JobRequest; marketplace status machine RETIRED (CONFIRMED §13, TREQ-013). | `unassigned (SYNC-001)`; `work-requests/service.ts:15-19,177-191` |
| RULE-002 | PATCH of a WorkRequest | Commercial/term fields are mutable IFF status==DRAFT. In any other state term fields are silently ignored (200, no error); only status may change. | Concurrent DRAFT term edits are unguarded by version (was OQ-11; superseded — DRAFT/term model retired in target). | `unassigned (SYNC-001)`; `work-requests/service.ts:196-209` |
| RULE-003 `[RETIRED in target]` | Apply, or accept/reject/withdraw of an application | Applications are created/approved only while the request is OPEN or PARTIALLY_FILLED; updates require the application to be PENDING. | Otherwise ConflictError. Approve-on-closed is UNTESTED (FIND-BRV-009). RETIRED by TREQ-011 (applications removed). | `unassigned (SYNC-001)`; `work-applications/service.ts:44-47,163-165,213-215` |
| RULE-004 `[RETIRED in target]` | Apply to a request | At most one application per (request,worker); only a WITHDRAWN row may re-apply (row reused). | PENDING/ACCEPTED/REJECTED block re-apply -> ConflictError. (Former OQ-06 "REJECTED permanent lock" MOOT — applications removed.) RETIRED by TREQ-011. | `unassigned (SYNC-001)`; `work-applications/service.ts:56-84`; `schema.prisma:301` |
| RULE-005 | Update of an application | A worker may only withdraw their own application; admin/manager may accept, reject, OR withdraw any pending application (worker-branch guards apply only when isWorker). | Route RBAC limits create/patch of requests and apply to management/worker respectively. `[TARGET]` application-update authz RETIRED; superseded by role×scope (TRULE-007). | `unassigned (SYNC-001)`; `work-applications/service.ts:167-173`; `work-requests/routes.ts:18,21` |
| RULE-006 | Slot claim + all WorkRequest writes | Invariant 0 <= workers_confirmed <= workers_needed, enforced by app-layer predicate and DB CHECK. | Claim predicate returning count 0 -> ConflictError. `[TARGET]` slot arbitration remains optimistic concurrency, same mechanism, per `ADR-057` (TRULE-003). | `unassigned (SYNC-001)`; `work-applications/service.ts:219-230`; `migration.sql:564-566` |
| RULE-007 `[RETIRED in target]` | Accept transaction commit | FILLED (with filled_at) iff workers_confirmed>=workers_needed after claim; otherwise PARTIALLY_FILLED. | — RETIRED: accept-transaction fill recompute removed with the marketplace flow (TREQ-011/012/013). | `unassigned (SYNC-001)`; `work-applications/service.ts:276-287` |
| RULE-008 | Update of an assignment | Lifecycle CONFIRMED->{IN_PROGRESS,CANCELLED}; IN_PROGRESS->{COMPLETED,CANCELLED}. COMPLETED and CANCELLED are terminal. Cancel stamps cancelled_at only — it does NOT decrement workers_confirmed nor reopen the request. | Illegal/no-op -> ConflictError. NO_SHOW/REASSIGNED declared but UNREACHABLE (superseded — target simplifies job status, TREQ-013); cancel side-effect is a target design detail (OQ-02, partially resolved by TREQ-009's event-driven sick/vacation cancel, `ADR-021`). | `unassigned (SYNC-001)`; `assignments/service.ts:6-9,92-108`; `schema.prisma:55-62` |
| RULE-009 `[RETIRED in target]` | Assignment creation | Every assignment traces to an accepted application via a non-null `application_id` FK (onDelete Restrict); no bypass path exists. | — RETIRED by TREQ-012: assignment created directly from calendar/broadcast; `application_id` dropped. | `unassigned (SYNC-001)`; `schema.prisma:324-327`; `work-applications/service.ts:243-253` |
| RULE-010 | Two active assignments for same (request,worker) | A worker may hold at most one CONFIRMED/IN_PROGRESS assignment per request. | DB partial unique index rejects the second active row. `[TARGET]` re-keyed to one active assignment per worker per DAY (TRULE-006). | `unassigned (SYNC-001)`; `migration.sql:580-582` |
| RULE-011a | Non-mgmt list/get of a WorkRequest | Requires ACTIVE HotelWorker membership on the request's hotel; management exempt. | List -> filtered/empty; getById non-member -> ForbiddenError. `[TARGET]` management read-scoping tightened to role×scope (TRULE-007). | `unassigned (SYNC-001)`; `work-requests/service.ts:98-112,134-144` |
| RULE-011b | Non-mgmt list of WorkApplications; my_application embed | Ownership only: a worker sees exactly their own application. | Non-owner sees nothing. `[TARGET]` RETIRED with applications. | `unassigned (SYNC-001)`; `work-applications/service.ts:122-130`; `work-requests/service.ts:148-157` |
| RULE-011c | Non-mgmt getById of a WorkerAssignment | Permitted if actor is the assigned worker OR holds ACTIVE membership on the assignment's hotel. | Neither -> ForbiddenError. | `unassigned (SYNC-001)`; `assignments/service.ts:67-78` |
| RULE-011d | Non-mgmt list of WorkerAssignments | Ownership only: results forced to worker_id=self. | — | `unassigned (SYNC-001)`; `assignments/service.ts:41-45` |
| RULE-011e | Apply precondition (distinct from read-visibility) | Applying requires ACTIVE HotelWorker membership on the request's hotel. | Non-member -> ForbiddenError. `[TARGET]` RETIRED with applications. | `unassigned (SYNC-001)`; `work-applications/service.ts:50-53` |
| RULE-012 | Any notification emission | Delivery is best-effort synchronous fire-and-forget; it never participates in or rolls back the originating transaction (all notifications sent post-commit / catch-swallowed). | Delivery failure is silent. `[TARGET]` push-only channel (CONFIRMED §18); broadcast notifies only eligible workers. | `unassigned (SYNC-001)`; `work-requests/service.ts:238-248`; `work-applications/service.ts:103,299` |
| RULE-013 `[RETIRED in target]` | Apply time | Worker overall rating is snapshotted onto the application (null when none exists). | — RETIRED with applications (TREQ-011). | `unassigned (SYNC-001)`; `work-applications/service.ts:64-67` |
| RULE-014 | Work-request creation | Rejected when `Hotel.accepting_jobs` is `false` (`GD-05`, `SPEC-CRM-001` `RULE-CRM-09`) — a read-only cross-module dependency on CRM-owned state, checked before the manager hotel-scope check. | ConflictError (409) — a business-state precondition, not an authorization check; does not affect existing/DRAFT requests, only new creation. | This module reads; `backend-crm` owns/writes (Current: `work-requests/service.ts`; `GD-05`, 2026-07-27) |

`[TARGET STATE]` rules (TRULE-001..009) — confirmed authority:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| TRULE-001 | Manager places a worker on a calendar day | Direct assignment created; worker calendar reflects it; NO accept/decline step; NO broadcast fired. | Blocked if worker already assigned/sick/vacation that day (TRULE-006). | PIVOT §4.4, §7.2; CONFIRMED §13 |
| TRULE-002 | Manager raises a standalone JobRequest | Broadcast targets only workers with matching skill who are free that day; per-skill headcount honored; calendar edits never broadcast. | Ineligible workers not notified. | PIVOT §4.4, §7.3; CONFIRMED §13 |
| TRULE-003 | Concurrent broadcast accepts | First accept to win the optimistic-concurrency claim wins; ties broken by earliest server-received timestamp; version column + transactional conditional update, per `ADR-057` — no Redis mutex. | Losers do not get an assignment (TRULE-004). No client retry semantics defined (see Performance). | PIVOT §5.5, §7.3; CONFIRMED §13; `ADR-057` |
| TRULE-004 | A skill's slots are full | Later responders receive an explicit "requirement fulfilled" notification. | Not an error, not silence. | PIVOT §4.4, §7.3; CONFIRMED §13 |
| TRULE-005 | JobRequest open | Auto-closes 6h after creation via scheduled job (notifies manager); manager may close manually sooner. | Prevents zombie requests. | PIVOT §4.4, §5.6; CONFIRMED §13 |
| TRULE-006 | Any assignment (calendar or broadcast) for a day | One active assignment per worker per day; further same-day assignment blocked (partial unique index). | DB rejects second same-day active row. | PIVOT §4.4, §9.4; CONFIRMED §12, §13 |
| TRULE-007 | Any authorized action | role × scope, deny-by-default; cross-hotel only within the actor's/worker's Hotel Group; hotel creation Admin/HQ only; scope carried in JWT. | Out-of-scope action denied. Resolves former OQ-07 (hotel scoping REQUIRED). | PIVOT §5.3, §5.4; CONFIRMED §1, §11, §12 |
| TRULE-008 | This module consumes Calendar's `EVT-CAL-SickVacationMarked` (worker marked a current/future day sick or vacation — Calendar's own act, per `ADR-021`) | Any same-day assignment is cancelled by this module on consuming the event; manager notification is sent by Calendar, not this module. | No state persists where a worker is both on-leave and assigned that day, once the event is consumed; convergence is eventual (event-driven), not a cross-module atomic transaction (`ADR-021`, superseding the prior single-transaction model). | PIVOT §7.2; CONFIRMED §22; `ADR-021` (Accepted 2026-07-19) |
| TRULE-009 | Skill selection (profile or broadcast) | Skills constrained to {Cleaner, Public Service, Kitchen Dishwasher, Waiter}. | Values outside enum rejected. | CONFIRMED §4 |

## Ownership and Boundaries

**Module owner:** `unassigned (SYNC-001, human authority required)`. No CODEOWNERS file exists and
`backend/package.json` author is empty; owner assignment is reserved human authority and is NOT
invented here. PIVOT §13 names "Owner: Mayank (Lead), Reviewers: Ritik (PM)" for the design
document — corroborating evidence for the human decision, but not an authoritative knowledge-layer
(MODULE_REGISTRY / CODEOWNERS) encoding.

**Owned state (per DEPENDENCY_GRAPH state-domains):**
- `state-work-request` (`schema.prisma:236`) — owned by backend-work-requests. `[TARGET]` repurposed as `JobRequest`.
- `state-work-application` (`schema.prisma:279`) — owned by backend-work-applications. `[TARGET]` REMOVED (PIVOT §9.2).
- `state-worker-assignment` (`schema.prisma:314`) — owned by backend-assignments. `[TARGET]` drop `application_id`; add `CalendarEntry` (PIVOT §9.1, §9.3).

**Consumed state (read):**
- `state-hotel` (`work-requests/service.ts:53`) — hotel existence/soft-delete check; also `accepting_jobs` pause-toggle check (`GD-05`, `RULE-014`, `SPEC-CRM-001` `RULE-CRM-09`).
- `state-hotel-worker` (`work-requests/service.ts:101,135,233`; `work-applications/service.ts:50`; `assignments/service.ts:69`) — roster membership for scoping and apply precondition.
- `state-worker-overall-rating` (`work-applications/service.ts:64`) — apply-time rating snapshot (`[TARGET]` retired).
- `state-audit-log` (write, cross-cutting via BaseService) — audit trail.

**Permitted writes:** Each module writes its own owned state. `[CURRENT]` NOTABLE cross-module write
coupling (observed): the accept transaction in backend-work-applications WRITES state owned by other
modules inside a single `$transaction`:
- `state-work-request` (owner backend-work-requests) — slot claim + fill recompute (`work-applications/service.ts:219,278,283`).
- `state-worker-assignment` (owner backend-assignments) — assignment creation (`work-applications/service.ts:243`).
- `state-attendance` (owner backend-attendance) — EXPECTED pre-creation (`work-applications/service.ts:256`).
These correspond to DEPENDENCY_GRAPH edges `edge-work-applications-writes-{work-request,worker-assignment,attendance}`.
`[MIGRATION GAP]` This coupling is MOOT in the target: the accept transaction and `WorkApplication` are
removed and the assignment is created directly (PIVOT §5.5, §9.1). Whether the current coupling warrants
a Decision Record or is simply recorded as superseded-by-pivot is an open human/architecture decision
(FIND-ARCH-003). It is documented here as observed behavior only, not endorsed as policy.

**Boundary/non-responsibilities:** This capability does not own attendance check-in/verification, quality
verification, rating computation, or notification delivery mechanics. `[CURRENT]` It does not implement the
EXPIRED scheduled job; it does not perform hotel-scoping on create/patch and performs NO ownership/role
authorization on assignment updates (FIND-SEC-001, current-state CRITICAL). `[TARGET]` It does not own the
calendar UI, onboarding, consent, or retention; it does own calendar/broadcast assignment creation and
daily exclusivity.

## Interfaces and Contracts

Base router mounts at `v1/index.ts:26-28`. All routes require `authMiddleware`. Envelope:
`{ status:"success", data, pagination?, meta:{timestamp,request_id} }`. Error types map to HTTP via the
shared error layer: `ValidationError` (400, Zod field details), `NotFoundError` (404), `ForbiddenError`
(403), `ConflictError` (409). Compatibility vocabulary (FIND-DEP-003): these contracts are **unversioned**
in code (no explicit contract version/registry entry), so their compatibility posture is recorded as
**baseline/UNKNOWN**, not "Additive/Stable"; any change must be assessed against a future versioned baseline.

`[CURRENT STATE]` endpoints (implemented @f37a39b):

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `POST /work-requests` (unversioned) | inbound | `CreateWorkRequestSchema` (hotel_id, position, workers_needed<=1000, shift_date YYYY-MM-DD, HH:MM times, hourly_rate?, currency(3)?, description?, requirements?, status DRAFT/OPEN, expires_at?) | 201 `WorkRequestDto` | ValidationError, NotFoundError(hotel) | requireRole(admin,manager) | baseline/UNKNOWN |
| `GET /work-requests` (unversioned) | inbound | `ListWorkRequestsQuerySchema` (hotel_id?, status?, position?, shift_date?, page, per_page<=100) | 200 `WorkRequestDto[]` + pagination | ValidationError | any authenticated (service-scoped, RULE-011a) | baseline/UNKNOWN |
| `GET /work-requests/:id` (unversioned) | inbound | path id | 200 `WorkRequestDto` (+my_application for worker/checker) | NotFoundError, ForbiddenError | any authenticated (RULE-011a) | baseline/UNKNOWN |
| `PATCH /work-requests/:id` (unversioned) | inbound | `UpdateWorkRequestSchema` (term fields?, status?, cancellation_reason?) | 200 `WorkRequestDto` | ValidationError, NotFoundError, ConflictError | requireRole(admin,manager) | baseline/UNKNOWN; term fields silently ignored unless DRAFT (RULE-002) |
| `POST /work-requests/:id/applications` (unversioned) `[TARGET: REMOVED]` | inbound | `ApplyWorkRequestSchema` (cover_note<=1000?) | 201 `WorkApplicationDto` | ValidationError, NotFoundError, ConflictError, ForbiddenError | requireRole(worker) | baseline/UNKNOWN; REMOVED in target Phase 1 (TREQ-011, breaking) |
| `GET /work-requests/:id/applications` (unversioned) `[TARGET: REMOVED]` | inbound | `ListApplicationsQuerySchema` (status?, page, per_page<=100) | 200 `WorkApplicationDto[]` + pagination | ValidationError, NotFoundError | any authenticated (mgmt=all, worker=own; RULE-011b) | baseline/UNKNOWN; REMOVED in target (TREQ-011) |
| `PATCH /work-requests/:id/applications/:applicationId` (unversioned) `[TARGET: REMOVED]` | inbound | `UpdateApplicationSchema` (status ACCEPTED/REJECTED/WITHDRAWN?, rejection_reason?, cancellation_reason?) | 200 `WorkApplicationDto` (ACCEPTED runs approve tx) | ValidationError, NotFoundError, ConflictError, ForbiddenError | any authenticated; service guards (worker=own withdraw only; mgmt=accept/reject/withdraw; RULE-005). NO route-level role guard. | baseline/UNKNOWN; REMOVED in target (TREQ-011) |
| `GET /assignments` (unversioned) | inbound | `ListAssignmentsQuerySchema` (hotel_id?, work_request_id?, worker_id?, status?, page, per_page<=100) | 200 `AssignmentDto[]` + pagination | ValidationError | any authenticated (worker=own; RULE-011d) | baseline/UNKNOWN |
| `GET /assignments/:id` (unversioned) | inbound | path id | 200 `AssignmentDto` | NotFoundError, ForbiddenError | any authenticated (RULE-011c) | baseline/UNKNOWN |
| `PATCH /assignments/:id` (unversioned) | inbound | `UpdateAssignmentSchema` (status IN_PROGRESS/COMPLETED/CANCELLED?, cancellation_reason?) | 200 `AssignmentDto` | ValidationError, NotFoundError, ConflictError | any authenticated. **NO ownership/role/hotel authorization guard in route or service** (FIND-SEC-001, current-state CRITICAL). Route comment claims non-existent "service-level guards" (FIND-SEC-005; code fix, Phase 1). | baseline/UNKNOWN; authz gap unresolved (open decision) |

DTO shapes: `WorkRequestDto` (`work-requests/types.ts:69-92`), `WorkApplicationDto` (`work-applications/types.ts:26-38`),
`AssignmentDto` (`assignments/types.ts:23-37`).

`[TARGET STATE]` interfaces (unbuilt; shapes not yet authored): broadcast `JobRequest` endpoints
(raise request with skill×headcount, accept-first, manual close) and calendar direct-assignment
endpoints are TARGET and UNBUILT (PIVOT §4.4, §7.2, §7.3; §10 Phase 2). Their contracts are not
specified here beyond the confirmed behavior in Requirements/Rules; they will be authored when
the target milestone (M2 Dispatch, PIVOT §12) begins. WorkApplication endpoints (above) are
removed in Phase 1.


### Named interface contracts (added 2026-08-23, recorded not versioned)

**Why this table exists.** This specification described its HTTP envelope and error mapping but
declared no named `IF-*` contracts, so nothing could reference this module's capabilities by
identifier. `ADR-053` requires every chatbot tool to invoke an **existing** `IF-*` interface owned by
another module, and forbids creating backend capability for the chatbot's benefit — which made a
module with zero named interfaces unreachable by design.

These are **as-built**, reverse-specified from the code cited in each row at `8626256`. They name what
already exists; **no new capability is introduced, and no behaviour changes.** Contracts remain
**unversioned** in code, so each carries `v0` and a compatibility posture of baseline/UNKNOWN,
matching this document's existing vocabulary.

The **Risk tier** column is `ADR-053`'s classification, recorded here so a future tool registry does
not have to re-derive it: *read-only* executes immediately; *low-risk write* takes confirmation per
tool at registration; *high-risk write* takes **mandatory** confirmation enforced by the
orchestration layer regardless of registration preference. Assigning a tier here is **not** approval
to expose any of these as a tool — `ADR-053` principle 4 requires each tool integration to be its
own explicit approval.

| Contract ID / version | Direction | Input | Output | Risk tier | Authorization | Evidence |
|---|---|---|---|---|---|---|
| `IF-JOBD-CreateJobRequest / v0` | Inbound (command) | job request payload | Created `JobRequest` | **High-risk write** — creates operational demand others act on | `requireRole(['admin','manager','regional_manager'])` + `staffing:write` | `job-requests/routes.ts:113` → `service.ts:154` |
| `IF-JOBD-ListJobRequests / v0` | Inbound (query) | filters | `JobRequest[]`, scope-filtered | Read-only | Authenticated; scope enforced in service | `job-requests/routes.ts:114` → `service.ts:212` |
| `IF-JOBD-GetJobRequest / v0` | Inbound (query) | job request id | `JobRequest` | Read-only | Authenticated; scope-checked | `job-requests/routes.ts:115` → `service.ts:306` |
| `IF-JOBD-UpdateJobRequest / v0` | Inbound (command) | job request id, patch | Updated `JobRequest` | **High-risk write** | role guard + `staffing:write` | `job-requests/routes.ts:116` → `service.ts:343` |
| `IF-JOBD-RaiseBroadcast / v0` | Inbound (command) | broadcast input (skill slots, counts) | Created broadcast + notifications to every eligible worker, in one transaction | **High-risk write** — fans out notifications to many people and cannot be un-sent | role-gated; `FEATURE_JOBDISPATCH_PHASE2` | `job-requests/routes.ts:33` → `service.ts:547` |
| `IF-JOBD-GetBroadcastEligibility / v0` | Inbound (query) | broadcast id | Whether the caller may accept, and why not | Read-only | Authenticated | `job-requests/routes.ts:58` → `service.ts:644` |
| `IF-JOBD-AcceptBroadcast / v0` | Inbound (command) | broadcast id | `WorkerAssignment`, or `requirement_fulfilled` when another worker won the race | **High-risk write** — commits the worker to a shift; first-accept arbitration via a conditional `updateMany` on `confirmed_count` (`ADR-057`) | **No role gate — worker-initiated by design** | `job-requests/routes.ts:72` → `service.ts:860` |
| `IF-JOBD-CloseBroadcast / v0` | Inbound (command) | broadcast id | Broadcast closed early; raising manager notified | **High-risk write** — withdraws an offer others may be acting on | role-gated | `job-requests/routes.ts:84` → `service.ts:1007` |
| `IF-JOBD-CloseExpiredBroadcasts / v0` | **Internal (scheduled job)** | cutoff, batch size | Count transitioned `OPEN → EXPIRED` | Not tool-eligible | Platform Worker only; no HTTP surface | `job-requests/service.ts:1124`, `worker.ts` |
| `IF-ASSIGN-ListAssignments / v0` | Inbound (query) | filters | `WorkerAssignment[]`, scope-filtered | Read-only | Authenticated; scope enforced | `assignments/routes.ts:86` → `service.ts:241` |
| `IF-ASSIGN-GetAssignment / v0` | Inbound (query) | assignment id | `WorkerAssignment` | Read-only | Authenticated; eligibility re-checked for worker callers | `assignments/routes.ts:87` → `service.ts:325` |
| `IF-ASSIGN-UpdateAssignment / v0` | Inbound (command) | assignment id, patch (incl. status transitions) | Updated `WorkerAssignment` | **High-risk write** — drives shift lifecycle (start/complete/cancel) | Authenticated; scope + eligibility guard | `assignments/routes.ts:88` → `service.ts:358` |
| `IF-ASSIGN-Reassign / v0` | Inbound (command) | assignment id, new worker | Atomically reassigned; both workers notified | **High-risk write** — removes work from one person and gives it to another | Manager/admin scope | `assignments/routes.ts:122` → `service.ts:564` |
| `IF-ASSIGN-LogRoomsCompleted / v0` | Inbound (command) | assignment id, room count | Created `RoomsCompletedEntry` | Low-risk write — additive, correctable via the update contract | Authenticated; scope-checked | `assignments/routes.ts:100` → `service.ts:760` |
| `IF-ASSIGN-UpdateRoomsCompleted / v0` | Inbound (command) | assignment id, corrected count | Updated entry | Low-risk write | Authenticated; scope-checked | `assignments/routes.ts:108` → `service.ts:834` |
| `IF-ASSIGN-PlaceOnCalendar / v0` | Inbound (command) | worker, hotel, date | Created `CalendarEntry` + `WorkerAssignment` | **High-risk write** — commits a person to a day; rejected if they have a declared absence | Manager/admin scope | `assignments/routes.ts:31` → `service.ts:923` |
| `IF-ASSIGN-MoveCalendarEntry / v0` | Inbound (command) | entry id, target date | Moved entry | **High-risk write** | Manager/admin scope | `assignments/routes.ts:65` → `service.ts:1082` |
| `IF-ASSIGN-ListCalendarEntries / v0` | Inbound (query) | date range, scope filters | `CalendarEntry[]` | Read-only | Authenticated; scope enforced | `assignments/routes.ts:49` → `service.ts:1219` |

## Events

No event bus exists (MODULE_REGISTRY `published_events: none-observed`, `consumed_events: none-observed`
for all three modules). `[CURRENT]` "Events" below are synchronous, best-effort, fire-and-forget calls to
`notificationService.sendNotification` — never transactional (RULE-012). Delivery failures are
`.catch(() => {})`-swallowed. `[TARGET]` this capability additionally **consumes** `EVT-CAL-SickVacationMarked`
(published by `backend-calendar`; see `SPEC-CALENDAR-001` Events) to drive `TREQ-009`/`TRULE-008`'s
same-day assignment cancellation — unbuilt, contract `[OPEN]`, same status as every other target-plane
event in this document (`ADR-021`, Correction v0.3.1).

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `WORK_REQUEST_PUBLISHED` | backend-work-requests | DRAFT->OPEN publish commit | `service.ts:240-246` (work_request_id, hotel_id) | Each ACTIVE roster worker | Fire-and-forget; not idempotent; failure swallowed |
| `APPLICATION_RECEIVED` `[TARGET: retired]` | backend-work-applications | apply() success | `service.ts:103-108` (application_id, work_request_id) | Request creator | Fire-and-forget; failure swallowed |
| `APPLICATION_REJECTED` `[TARGET: retired]` | backend-work-applications | reject update | `service.ts:194-199` (application_id, work_request_id, rejection_reason) | Applicant worker | Fire-and-forget; failure swallowed |
| `APPLICATION_ACCEPTED` `[TARGET: retired]` | backend-work-applications | approve tx post-commit | `service.ts:299-304` (application_id, work_request_id) | Applicant worker | Post-commit; failure swallowed; UNTESTED |
| `ASSIGNMENT_CONFIRMED` | backend-work-applications | approve tx post-commit | `service.ts:306-311` (assignment_id, work_request_id) | Applicant worker | Post-commit; failure swallowed; UNTESTED |

Declared-but-NEVER-emitted `NotificationType` values relevant to this capability (`schema.prisma:89-111`):
`WORK_REQUEST_CANCELLED`, `WORK_REQUEST_EXPIRING_SOON`, `APPLICATION_WITHDRAWN`, `ASSIGNMENT_CANCELLED`,
`SHIFT_REMINDER`, `CHECK_IN_REMINDER` — no code path emits these (superseded: target redesigns
notifications push-only, CONFIRMED §18; application-type notifications retired with TREQ-011).

`[TARGET]` New notification triggers implied by confirmed behavior (unbuilt): broadcast "job available"
to eligible workers (TREQ-003), "requirement fulfilled" to losers (TREQ-005), 6h auto-close manager
notification (TREQ-006). Channel is push-only (CONFIRMED §18). **The sick/vacation manager notification
is Calendar's, not this module's** (`ADR-021`, Correction v0.3.1) — this module's only sick/vacation-adjacent
action is consuming `EVT-CAL-SickVacationMarked` to cancel the assignment (`TREQ-009`); it sends no
notification for that event.

## Dependencies

`[CURRENT]` existing DEPENDENCY_GRAPH edges referenced (no new backend edges proposed by this spec):

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `edge-work-requests-notifications`, `edge-work-applications-notifications` | Roster/review notifications | `notificationService.sendNotification` | baseline/UNKNOWN | Best-effort; swallowed (RULE-012) |
| `edge-work-requests-reads-hotel` | Hotel existence/soft-delete at create | Prisma read `state-hotel` | baseline/UNKNOWN | Missing/deleted -> NotFoundError |
| `edge-work-requests-reads-hotel-worker`, `edge-work-applications-reads-hotel-worker`, `edge-assignments-reads-hotel-worker` | Roster scoping + apply precondition | Prisma read `state-hotel-worker` | baseline/UNKNOWN | No ACTIVE membership -> empty/Forbidden |
| `edge-work-requests-reads-work-application` | my_application embed | Prisma read `state-work-application` | baseline/UNKNOWN | Absent -> null |
| `edge-work-applications-reads-work-request` | Status/version checks | Prisma read `state-work-request` | baseline/UNKNOWN | Missing -> NotFoundError |
| `edge-work-applications-reads-worker-overall-rating` | Apply-time snapshot | Prisma read `state-worker-overall-rating` | baseline/UNKNOWN | Absent -> null snapshot |
| `edge-work-applications-writes-work-request` | Slot claim + fill recompute in accept tx | Prisma write `state-work-request` (cross-owner) | baseline/UNKNOWN; coupling FIND-ARCH-003 (MOOT in target) | Rolls back whole tx on conflict |
| `edge-work-applications-writes-worker-assignment` | Assignment creation in accept tx | Prisma write `state-worker-assignment` (cross-owner) | baseline/UNKNOWN; MOOT in target | Rolls back whole tx |
| `edge-work-applications-writes-attendance` | EXPECTED attendance pre-creation | Prisma write `state-attendance` (cross-owner) | baseline/UNKNOWN; MOOT in target | Rolls back whole tx |
| `edge-attendance-reads-worker-assignment`, `edge-quality-reads-worker-assignment`, `edge-analytics-reads-*` | Downstream consumers of owned state | Prisma reads | baseline/UNKNOWN | Consumer-side |

`[CURRENT]` client consumers of the inbound endpoints (FIND-DEP-002 — recorded for completeness):
- `frontend-web` (Next.js manager/admin web app) consumes work-request/assignment endpoints.
- `mobile-worker-app` (Expo/RN Employee App) consumes work-request and application endpoints — notably the apply/list-my-application path (`mobile/worker-app/src/lib/api.ts:173-181`; `app/job/[id].tsx:36,57`). The corresponding `edge-mobile-worker-work-applications` edge is MISSING from DEPENDENCY_GRAPH (FIND-DEP-001) — proposed as a knowledge delta below. These consumers are the reason WorkApplication removal (TREQ-011) is a breaking change (mitigated by being pre-launch, PIVOT §10).

`[TARGET]` new dependencies (unbuilt):
- **No new runtime dependency for slot arbitration.** First-accept arbitration reuses the existing
  optimistic-concurrency mechanism (version column + transactional conditional update) already in use by
  this capability; no Redis slot lock is introduced (PIVOT §5.5, §7.3, superseded on this point by
  `ADR-057`).
- **New models** — `CalendarEntry` (per-worker per-day **assignment kind only** — sick/vacation is Calendar's own `state-calendar-absence` model, owned by `backend-calendar` per `ADR-021`, Accepted 2026-07-19, Correction v0.3.1) and `JobRequest` (broadcast; skills×headcount; 6h auto-close), PIVOT §9.3; plus the daily-exclusivity partial unique index (PIVOT §9.4), both owned and enforced by this capability.
- **Scheduled jobs** — job-request auto-close (6h) via the Platform Worker / `state-outbox` (PIVOT §5.6; `ADR-029`; `ADR-057`).
- **`EVT-CAL-SickVacationMarked` (consumed)** — published by `backend-calendar` (`SPEC-CALENDAR-001`); triggers this module's same-day assignment cancellation (`TREQ-009`/`TRULE-008`). Contract `[OPEN]`; event-driven, not a cross-module transaction (`ADR-021`, Correction v0.3.1).
- Architecture anchors: modular-monolith (ADR-003, PIVOT §5.1/§11) and Prisma-over-PostgreSQL (ADR-004, PIVOT §2.1/§11) are retained.

## State and Lifecycle

`[CURRENT STATE]` state machines (@f37a39b):

**WorkRequest state machine** (`work-requests/service.ts:15-19`; `schema.prisma:38-45`):
- Entry: create -> DRAFT (default) or -> OPEN (direct publish).
- Manual: DRAFT->OPEN (stamps published_at, fans out publish notification, increments version); DRAFT->CANCELLED; OPEN->CANCELLED; PARTIALLY_FILLED->CANCELLED (stamps cancelled_at + reason, increments version).
- System (accept pipeline): OPEN/PARTIALLY_FILLED -> PARTIALLY_FILLED or FILLED (stamps filled_at) via slot recompute.
- External: -> EXPIRED via scheduled job absent from repo (RESOLVED-BY-TARGET: 6h auto-close, TREQ-006).
- Terminal-ish: CANCELLED, FILLED, EXPIRED have no outgoing manual transition. CANCELLED does not cascade (REQ-011/OQ-03).
- Invariants: RULE-006 (capacity CHECK), version optimistic lock on status-changing writes only.

**WorkApplication state machine** `[TARGET: model removed]` (`schema.prisma:47-53`; `work-applications/service.ts`):
- Entry: apply -> PENDING (new row, or reused WITHDRAWN row reset to PENDING).
- PENDING -> ACCEPTED (approve tx), REJECTED (stamps review + reason), WITHDRAWN (worker or mgmt).
- WITHDRAWN -> PENDING (re-apply reuse). ACCEPTED/REJECTED terminal in-code.
- EXPIRED enum value declared but UNREACHABLE. Update guarded to PENDING only (RULE-003).

**WorkerAssignment state machine** (`assignments/service.ts:6-9`; `schema.prisma:55-62`):
- Entry: `[CURRENT]` created CONFIRMED only by the accept transaction (RULE-009); `[TARGET]` created directly from calendar/broadcast (TREQ-012).
- CONFIRMED -> IN_PROGRESS (started_at) or CANCELLED (cancelled_at + reason).
- IN_PROGRESS -> COMPLETED (completed_at) or CANCELLED.
- COMPLETED and CANCELLED are terminal. NO_SHOW and REASSIGNED declared but UNREACHABLE. `previous_assignment_id` reassignment chain exists in schema but no service writes it (superseded — no reassignment flow in target).

**Concurrency (`[CURRENT]` optimistic version model):** Slot claim uses
`updateMany WHERE id AND version=known AND workers_confirmed<workers_needed`, incrementing both
`workers_confirmed` and `version`; a returned count of 0 (lost race or full) raises ConflictError and
aborts the transaction (`work-applications/service.ts:219-230`). Active double-booking is additionally
prevented by the DB partial unique index (RULE-010). `[TARGET]` concurrency arbitration retains this same
optimistic-concurrency mechanism (first-accept wins, earliest-timestamp tie-break); no Redis mutex is
introduced (TRULE-003; PIVOT §5.5; `ADR-057`).

**`[CURRENT]` Atomic 7-step accept transaction** (`work-applications/service.ts:217-290`): (1) optimistic
slot claim; (2) mark application ACCEPTED; (3) create CONFIRMED WorkerAssignment with mandatory
application_id; (4) pre-create EXPECTED Attendance with denormalized window; (5) re-read WorkRequest;
(6) set FILLED+filled_at or PARTIALLY_FILLED; (7) return accepted app + assignment. Two notifications fire
AFTER commit. Any step's throw rolls back all writes including the cross-owner writes.
`[MIGRATION GAP]` This entire transaction is removed in the target (TREQ-011/012).

**`[TARGET]` direct-assignment + broadcast flow** (PIVOT §5.5, §7.2, §7.3; CONFIRMED §13): (a) Calendar —
manager writes a `CalendarEntry`/assignment directly; no acceptance; subject to daily exclusivity
(TRULE-006). (b) Broadcast — manager raises a `JobRequest` (skill×headcount); system computes eligible
workers (skill ∧ free that day); targeted push; first accept wins the optimistic-concurrency claim and
creates the `WorkerAssignment` (`ADR-057`); losers get "requirement fulfilled"; 6h timer (Platform Worker/
outbox, `ADR-029`) or manual action closes the request.
Per CONFIRMED §13 there is **no formal job-status state machine** in the target (Open→Assigned→InProgress
removed); remaining status handling is manual (TREQ-013).

**Retention/migration:** `[CURRENT]` Rows persist; no soft-delete on these three models. Schema governed by
`20260613120000_v2_marketplace_init` (SP-3/SP-5/SP-9 constraints). `[TARGET]` forward refactor, no data
migration (pre-launch, PIVOT §10); Phase 1 removes `WorkApplication` and repoints `WorkerAssignment`.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** `[CURRENT]` Conflict/validation/not-found/forbidden surface as typed HTTP
errors. Accept-transaction failures roll back atomically. Notification delivery failures are swallowed
and never roll back (RULE-012) — a published request or accepted application can succeed while its
notification is silently lost. `[TARGET]` broadcast concurrency resolved by the same optimistic-concurrency
mechanism (first-accept wins); no Redis dependency, no degraded-mode path to reason about (`ADR-057`).

**Trust boundaries/authorization:** `[CURRENT]` Route RBAC guards create/patch work-request
(admin,manager) and apply (worker). Read scoping is enforced in-service by roster membership/ownership
(RULE-011a-e). CRITICAL GAP (FIND-SEC-001): `PATCH /assignments/:id` has NO route-level role guard AND
no service-level ownership/role/hotel check — any authenticated user can transition ANY assignment; the
route comment claiming "service-level guards" is inaccurate (FIND-SEC-005). This is exploitable NOW.
Create/patch work-request have role but NO hotel-scoping — any admin/manager acts on any hotel
(FIND-SEC-002/003, cross-tenant, High). `[TARGET]` direction RESOLVED: two-dimensional role × scope,
deny-by-default, Regional Manager added, cross-hotel only within Hotel Group (TREQ-008/TRULE-007). The
residual questions (remediate current defects pre-pivot vs accept-risk until Phase 1 removes/replaces the
flow) are carried as open decisions below. This spec does NOT invent the missing current-state rule.

**Data classification/retention:** `[CURRENT]` Applications carry a `worker_rating_snapshot` (worker
performance data) and `cover_note` (worker-authored). Audit rows persist actor id/role and entity ids for
every mutation (immutable, retained 5y per CONFIRMED §30). `[TARGET]` assignment feeds attendance whose
clock coordinates carry a 6-month TTL (CONFIRMED §17; separate capability).

**Performance budgets/workload:**
- **No explicit budgets or SLOs are defined in code or authority docs.** `[ESCALATION]` No SLO for dispatch/accept latency or broadcast fan-out is defined; setting one is a human decision, currently blocked on ownership (SYNC-001). Recorded per FIND-PERF-004; see open decisions.
- Workload assumptions (FIND-PERF-004, explicit, unconfirmed): roster size per hotel and concurrent-accept volume are UNKNOWN; single-tenant-per-client deployment (PIVOT §5.1) suggests modest scale, but no figures are confirmed.
- FIND-PERF-001 (owned capacity risk): publish fan-out issues one notification per ACTIVE roster worker in parallel (`Promise.all`, `work-requests/service.ts:222-250`) and is **awaited on the request path** — cost is O(roster); large rosters degrade publish latency. `[TARGET]` broadcast targets only eligible (skill ∧ free) workers, bounding fan-out.
- FIND-PERF-002 (contention): concurrent multi-slot accepts serialize on the single-row optimistic `updateMany`; losers get ConflictError with **no server-side retry** — clients must retry. `[TARGET]` arbitration remains the same optimistic-concurrency mechanism (TRULE-003; `ADR-057`); retry semantics for the target path are undefined and should be specified at M2.
- FIND-PERF-003 (Low, tracked): redundant in-transaction `findUnique` re-read of WorkRequest before fill recompute (`work-applications/service.ts` step 5).
- FIND-PERF-005 (Low, tracked): list endpoints use offset pagination with an unindexed `created_at` sort; may degrade on large tables.
- Hot-path index `@@index([hotel_id, status, shift_date])` (`schema.prisma:273`) supports open-shift queries. `[TARGET]` PIVOT §9.4 adds `(skill, hotel_id)` + availability indexing for fast eligible-worker computation.

**Observability/audit:** Every mutation calls `BaseService.logAudit` -> AuditLog
(CREATE/UPDATE/APPLY/APPLICATION_*/UPDATE_ASSIGNMENT). No metrics/tracing observed. Responses carry
`request_id` in `meta`.

## Rollout and Compatibility

`[CURRENT]` Behavior is already deployed at `f37a39b`; the current-state layer is a reverse specification,
not a change. Schema/constraints are established by migration `20260613120000_v2_marketplace_init`
(CHECK `migration.sql:564-566`, partial unique index `migration.sql:580-582`). No feature flags observed
for these modules today.

`[TARGET]` Migration strategy (PIVOT §10) — a **forward refactor**, not a dual-running migration, because
the system is **pre-launch with no production employee data**:
- **Phase 1 — Foundation realignment:** add Regional Manager role + scope to auth/RBAC; refactor the
  success envelope behind `sendSuccess()`/`sendPaginated()`; **REMOVE `WorkApplication`**; repoint
  `WorkerAssignment` to direct creation; re-label the schema off "marketplace".
- **Phase 2 — Core dispatch:** Calendar + daily exclusivity + sick/vacation auto-cancel; Broadcast
  JobRequest + optimistic-concurrency slot arbitration + 6h auto-close on the Platform Worker/outbox
  (`ADR-029`; `ADR-057`).
- **Feature-flagged:** each new module gated by the existing `FEATURE_*` env convention; partial deploys
  are safe.
- **Backward compatibility:** the **only breaking change is the removal of `WorkApplication`**, done in
  Phase 1 **before any client depends on it** (pre-launch).
- **Rollback:** because phases are additive and pre-launch, rollback = disable the flag + redeploy the
  prior build.
- **Success criteria per phase (PIVOT §10, §12):** module tests green; envelope conformance passes;
  RBAC/scope tests pass; concurrency + exclusivity tests pass at M2.

### `[MIGRATION GAP]` enumeration (current code vs target authority)

| Gap ID | Current state (evidence) | Target requirement (evidence) | Phase |
|---|---|---|---|
| MIG-GAP-01 | `WorkApplication` model + apply/list/review endpoints implemented (`work-applications/*`; `schema.prisma:279`) | Remove `WorkApplication` and all worker-initiated application endpoints (PIVOT §5.5, §9.2; CONFIRMED §34, §37) — TREQ-011 | 1 (breaking) |
| MIG-GAP-02 | `WorkerAssignment` requires mandatory `application_id` FK (`schema.prisma:324-327`; `work-applications/service.ts:243`) | Drop `application_id`; create assignment directly from calendar/broadcast (PIVOT §9.1) — TREQ-012 | 1 |
| MIG-GAP-03 | No calendar direct-assignment path (`calendar` module is non-dispatch; no `CalendarEntry`) | Manager places workers per day, no accept step; new `CalendarEntry` (PIVOT §4.4, §7.2, §9.3; CONFIRMED §13) — TREQ-001 | 2 |
| MIG-GAP-04 | Marketplace `WorkRequest` (publish + apply) is the only fan-out (`work-requests/service.ts:222-250`) | Repurpose as broadcast `JobRequest` (skill×headcount; eligibility skill ∧ free; "requirement fulfilled") (PIVOT §7.3, §9.1; CONFIRMED §13) — TREQ-002/003/005 | 2 — **fully closed, Epic 9 PR 9.9**: `raiseBroadcast()` + `JobRequestSkillSlot` close the skill×headcount persistence half (TREQ-002, PR 9.7); `getBroadcastEligibility()` closes the eligibility-computation half (TREQ-003, PR 9.7); `enqueueBroadcastNotifications()` closes the notify-eligible-workers delivery half (TREQ-003, PR 9.8); `acceptBroadcast()` closes the "requirement fulfilled" half (TREQ-005, PR 9.9). |
| MIG-GAP-05 | `position` is free text (`schema.prisma:236-260`; `CreateWorkRequestSchema`) | Skills constrained to enum {Cleaner, Public Service, Kitchen Dishwasher, Waiter} (CONFIRMED §4) — TREQ-010 | 2 — **closed for the broadcast path, Epic 9 PR 9.7** (`JobRequestSkillSlot.skill SkillTag` is the authoritative, enum-constrained value); `position` remains a `String` column on every `JobRequest` row including broadcasts, but for a broadcast it is no longer free text authored by the manager — `raiseBroadcast()` derives it as a generated summary of the `skill_slots` breakdown (compatibility projection for `list()`/`getById()`/analytics, corrected 2026-07-29 pre-merge review; see the 0.3.4 Review-and-Change-Log entry). The marketplace `create()`/`update()` flow's independent free-text `position` input is unaffected and still live until `TREQ-011`'s removal. |
| MIG-GAP-06 | Slot arbitration via single-row optimistic `updateMany` (`work-applications/service.ts:219-230`); no Redis | First-accept via the same optimistic-concurrency pattern (version column + transactional conditional update), per `ADR-057` — TREQ-004 | 2 — **closed, Epic 9 PR 9.9**: `acceptBroadcast()` claims a `JobRequestSkillSlot` via `WHERE confirmed_count < headcount` (`ADR-057`'s 2026-07-30 addendum confirms this is a conforming instance of the ratified mechanism at the per-skill-slot grain, since the whole-request `version`-column precedent this gap's evidence cites arbitrates a different grain than `JobRequestSkillSlot` requires). |
| MIG-GAP-07 | Roles admin/manager/worker/checker; managers NOT hotel-scoped (`work-requests/routes.ts:18,21`; no scope check) | role × scope, deny-by-default; new Regional Manager; Hotel Manager one-hotel; cross-hotel within group; JWT scope (PIVOT §5.3, §5.4; CONFIRMED §1, §11, §12) — TREQ-008 | 1 (role), 2 (scope) — **closed pre-Epic-9, by Epic 8** (2026-07-23, `SIR-JOBD-002`/`FIND-SEC-002`/`FIND-SEC-003`): `work-requests/service.ts` (`create()`, `update()`) and `work-applications/service.ts` (`approve()`, reject path) now call `isHotelInScope()` per `DEPENDENCY_GRAPH.yaml`'s `permissions-middleware` node. Epic 9 PR 9.1 (commit `2b2d395`) only **verified** this closure against the three marketplace modules ("No fix needed there") — it did not build it; corrected here, 2026-07-30 documentation-correction pass. |
| MIG-GAP-08 | Partial unique index keyed on active (request,worker) (`migration.sql:580-582`) | Re-key: one active assignment per worker per DAY (daily exclusivity) (PIVOT §9.4) — TREQ-007 | 2 |
| MIG-GAP-09 | EXPIRED via external job absent from repo; `expires_at` arbitrary (`work-requests/service.ts:13-14`) | 6h auto-close via the Platform Worker/outbox + manual close (PIVOT §4.4, §5.6; `ADR-029`; `ADR-057`) — TREQ-006 | 2 — **closed, Epic 9 PR 9.10**: `JobRequestAutoCloseJob` closes any broadcast still `OPEN` 6h past creation (config-driven interval, default every 15 min, checking a config-driven 6h cutoff), writing `EXPIRED` directly (not through `ALLOWED_TRANSITIONS`, mirroring the marketplace's original "EXPIRED is set by a scheduled job" comment) and notifying the raising manager; `manualClose()` lets a manager close early via a dedicated validated transition. |
| MIG-GAP-10 | No same-day assignment auto-cancel path | On consuming Calendar's `EVT-CAL-SickVacationMarked` (Calendar-owned `state-calendar-absence` mark; Calendar sends the manager notification), cancel the same-day assignment (PIVOT §7.2; CONFIRMED §22) — TREQ-009. **Amended by `ADR-021`** (Correction v0.3.1): no longer a cross-module atomic transaction; event-driven, eventual convergence. | 2 — **closed by the Calendar module, not Epic 9**: `calendar/service.ts`'s direct call to `AssignmentService.update()`, the synchronous-transport shape ratified platform-wide by `ADR-032` (2026-07-28). No Epic 9 PR touches this path; corrected here, 2026-07-30 documentation-correction pass. |
| MIG-GAP-11 | `PATCH /assignments/:id` unguarded — any authenticated user drives any assignment (`assignments/service.ts:83-118`; `routes.ts:14`) | Assignment actions behind role × scope, deny-by-default (PIVOT §5.4) — TREQ-008; current-state CRITICAL (FIND-SEC-001) | 1/2 — **RESOLVED by Epic 1 PR 1.1** (commit `9495c5b`, 2026-07-08), predating Epic 9 entirely — deny-by-default guard added to `AssignmentService.update()` mirroring `getById()`. Independently tracked `RESOLVED` in the governance register at `SIR-JOBD-001` (re-verified there 2026-07-23); see that entry rather than re-litigating here. This row previously read as an open CRITICAL gap — corrected, 2026-07-30 documentation-correction pass. See open-decision row `OQ-01`/`FIND-SEC-001` below, which requires the same correction. |
| MIG-GAP-12 | Marketplace framing + WorkRequest/Assignment status machine (DRAFT/OPEN/PARTIALLY_FILLED/FILLED; CONFIRMED/IN_PROGRESS/COMPLETED) | Re-label off "marketplace"; no formal job-status state machine (CONFIRMED §13; PIVOT §10 Phase 1) — TREQ-013 | 1 |

## Validation Plan

`[CURRENT STATE]` criteria:

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| REQ-001/002/003 create paths | Unit/integration | `work-requests.test.ts` | Persisted status + published_at; NotFound on bad hotel |
| REQ-008 terms-locked-when-OPEN (RULE-002) | Integration | seeded OPEN request | PATCH ignores term fields, 200, unchanged terms |
| REQ-009/010/014 transitions + version | Integration | seeded requests per state | ConflictError on illegal; cancelled_at/version increments |
| REQ-011 cancel non-cascade (RULE-001) | Integration | request with assignment | assignment/attendance/workers_confirmed unchanged after cancel |
| REQ-016/017/018 read scoping (RULE-011a/b) | Integration | rostered vs non-rostered actors | empty/Forbidden as specified; my_application embed |
| REQ-021/022/023/024 apply guards (RULE-003/004/011e) | Integration | roster + duplicate/WITHDRAWN rows | Conflict/Forbidden; row reuse on re-apply |
| REQ-025/026 snapshot + notify | Integration | worker with/without rating | snapshot value; APPLICATION_RECEIVED attempted |
| REQ-029/030/031 update guards (RULE-003/005) | Integration | PENDING vs non-PENDING; worker vs mgmt | Conflict/Forbidden; reject notify |
| REQ-034 slot claim + conflict (RULE-006) | Integration + concurrency | concurrent approves on capacity-1 request | one success, one ConflictError | **CURRENTLY UNTESTED — FIND-BRV-006** |
| REQ-035-039 accept transaction (RULE-007/009/012) | Integration | OPEN request + PENDING app | ACCEPTED app, CONFIRMED assignment, EXPECTED attendance, FILLED/PARTIALLY_FILLED, 2 notifications | **CURRENTLY UNTESTED — FIND-BRV-006** |
| REQ-033 approve-on-closed (RULE-003 approve-side) | Integration | CANCELLED/FILLED request | ConflictError | **CURRENTLY UNTESTED — FIND-BRV-009** |
| REQ-040 assignment lifecycle (RULE-008) | Integration | assignments per state | timestamps set; Conflict on illegal/no-op |
| REQ-041 assignment read scoping (RULE-011c/d) | Integration | owner/member/other | own-only list; Forbidden getById |
| REQ-042 active double-booking (RULE-010) | DB/integration | two active rows same (request,worker) | DB rejects second active row | **UNTESTED via accept path — FIND-BRV-006** |
| REQ-043 capacity CHECK (RULE-006) | DB constraint test | forced over-fill | CHECK violation | **UNTESTED — FIND-BRV-006** |
| Authorization on PATCH /assignments (FIND-SEC-001) | Security test (to add) | arbitrary authenticated user | MUST fail once rule exists — no rule/test today |

`[TARGET STATE]` criteria (to be authored at M2; recorded as expectations, not yet executable):
TREQ-004 concurrency (exactly one winner under concurrent last-slot accepts, optimistic-concurrency path, `ADR-057`);
TREQ-007 daily-exclusivity DB rejection; TREQ-008 role×scope deny-by-default + cross-group denial;
TREQ-009 event-driven sick/vacation same-day cancel (on consuming `EVT-CAL-SickVacationMarked`, `ADR-021`); TREQ-006 6h auto-close job. Success gates per PIVOT §10/§12.

## Risks, Assumptions, and Open Decisions

Genuine remaining human-authority items (status OPEN). Most prior current-state OQs are resolved by the
confirmed target authority and are recorded as RESOLVED-BY-TARGET / SUPERSEDED below (traceability only).

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OQ-01 / FIND-SEC-001 | decision | `PATCH /assignments/:id` has NO authz guard — any authenticated user can drive any assignment lifecycle; exploitable NOW. Target direction resolved (role × scope, TREQ-008). **RESOLVED — Epic 1 PR 1.1** (commit `9495c5b`, 2026-07-08, predating Epic 9): `AssignmentService.update()` now enforces a deny-by-default guard mirroring `getById()`. Independently tracked `RESOLVED` in the governance register at `SIR-JOBD-001` (re-verified 2026-07-23). This row previously read `OPEN — CRITICAL`, contradicting that already-shipped fix; corrected in the 2026-07-30 documentation-correction pass (found while re-verifying `MIG-GAP-11`, which cites the same evidence). | `assignments/service.ts` `update()` (guard mirrors `getById()`); `backend/src/__tests__/assignments-update-authz.test.ts`; `SIR-JOBD-001` | human/unassigned | **RESOLVED — 2026-07-08 (Epic 1 PR 1.1), row corrected 2026-07-30** |
| FIND-SEC-002/003 | decision | Work-request create/patch and application approve/reject are role-guarded but NOT hotel-scoped -> cross-tenant. Target REQUIRES scope (TREQ-008/TRULE-007, resolving the "should managers be scoped" question). Residual decision: remediate the current cross-tenant defect pre-pivot vs accept-risk until Phase-1/2 scope lands. | `work-requests/routes.ts:18,21` + no hotel-membership check. Severity High (current-state). | human/unassigned | **OPEN — High** |
| SYNC-001 / FIND-ARCH-002 | decision | All module/state/contract owners are `unassigned` (no CODEOWNERS; empty package author). PIVOT §13 names a lead (Mayank) as corroborating, but the authoritative knowledge-layer (MODULE_REGISTRY/CODEOWNERS) encoding is a human action. Blocks accountable ownership and SLO-setting. | MODULE_REGISTRY.yaml header; DEPENDENCY_GRAPH nodes; PIVOT §13 | human | **OPEN** |
| FIND-ARCH-003 | decision | The current cross-owner accept-transaction coupling (3 state domains) warrants either a Decision Record OR an explicit "superseded-by-pivot" record (the coupling is MOOT in target since the flow is removed). Which to record is a human/architecture call. | `work-applications/service.ts:219,243,256`; DEPENDENCY_GRAPH cross-owner write edges; PIVOT §5.5/§9.1 | human/architecture | **OPEN** |
| ESC-PERF-01 / FIND-PERF-004 | decision | No performance SLO is defined for dispatch/accept latency or broadcast fan-out, and workload figures (roster size, concurrent-accept volume) are unconfirmed. Setting an SLO is a human decision, currently blocked on ownership (SYNC-001). | Code has no budgets; PIVOT/CONFIRMED define none. | human/unassigned | **OPEN — escalation** |

RESOLVED-BY-TARGET / SUPERSEDED (moved out of open decisions; retained for traceability):

| Prior ID | Prior description | Resolution |
|---|---|---|
| OQ-04 | EXPIRED transition owner/job unknown | RESOLVED-BY-TARGET: 6h auto-close via the Platform Worker/outbox (TREQ-006; PIVOT §5.6; `ADR-029`; `ADR-057`). Current absence = MIG-GAP-09. |
| OQ-05 | Accept-tx cross-owner coupling approved? | RESOLVED-BY-TARGET: MOOT — accept tx and `WorkApplication` removed; assignment created directly (TREQ-011/012; PIVOT §5.5). Current-state architecture observation only (see FIND-ARCH-003 for the record type). |
| OQ-06 | REJECTED applicant permanently barred? | RESOLVED-BY-TARGET: MOOT — applications removed (TREQ-011). |
| OQ-07 | Create/patch not hotel-scoped — intended? | RESOLVED-BY-TARGET: hotel/group scoping is REQUIRED (TREQ-008/TRULE-007; PIVOT §5.4). Current lack = MIG-GAP-07 + current-state FIND-SEC-002/003 (residual remediation decision above). |
| OQ-02 / OQ-03 | Assignment cancel / request cancel cascade semantics | PARTIALLY RESOLVED-BY-TARGET: on consuming Calendar's `EVT-CAL-SickVacationMarked`, this module auto-cancels the same-day assignment (TREQ-009/TRULE-008; PIVOT §7.2; event-driven per `ADR-021`, not a cross-module atomic transaction). Broader broadcast slot reopen semantics are a target design detail for M2; no marketplace PARTIALLY_FILLED in target. |
| OQ-08 | NO_SHOW/REASSIGNED/EXPIRED enums unreachable | SUPERSEDED: target has no formal job-status state machine (TREQ-013; CONFIRMED §13). |
| OQ-09 | `previous_assignment_id` reassignment chain unused | SUPERSEDED: no reassignment flow in target; assignment creation reworked (TREQ-012). |
| OQ-10 | Declared-but-unemitted marketplace NotificationTypes | SUPERSEDED: notifications redesigned push-only (CONFIRMED §18); application types retired with TREQ-011. |
| OQ-11 | DRAFT term edits unguarded by version | SUPERSEDED: WorkRequest repurposed as JobRequest; marketplace DRAFT/term model retired (MIG-GAP-12). |
| OQ-12 | Migration CHECK + active-slot unique index back REQ-042/043 | RESOLVED (High) at v0.1.0. Note: the active-slot index is re-keyed per-day in target (MIG-GAP-08). |

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| ASM-01 | assumption | Current code roles are `admin`, `manager`, `worker`, `checker` (management = admin+manager); role tokens are lower-cased guard strings mapped from UPPER-CASE `UserRole` enum (FIND-CONS-001). | `work-requests/service.ts:100,148`; Prisma `UserRole` | Assumption for current-state; target role model authoritatively defined (CONFIRMED §1). |

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate.

- **MODULE_REGISTRY.yaml:** set `specification` for `backend-work-requests`, `backend-work-applications`,
  and `backend-assignments` from `UNKNOWN` -> `SPEC-JOB-DISPATCH-001@0.2.0 (REVIEW)`. Do not alter `owner`
  (remains `unassigned`, SYNC-001; PIVOT §13 lead noted as corroborating only).
- **DEPENDENCY_GRAPH.yaml (proposed):**
  - ADD missing edge `edge-mobile-worker-work-applications` (mobile-worker-app -> `state-work-application` /
    apply endpoints), evidence `mobile/worker-app/src/lib/api.ts:173-181`, `app/job/[id].tsx:36,57`
    (FIND-DEP-001). This edge is retired when TREQ-011 lands, but the graph must reflect current reality.
  - NOTE (future, do not add yet): target introduces new `CalendarEntry` and `JobRequest` state domains
    + a 6h auto-close job on the Platform Worker/`state-outbox` (PIVOT §5.5, §5.6, §9.3; `ADR-029`;
    `ADR-057`); broadcast slot arbitration reuses the existing optimistic-concurrency mechanism and
    introduces no new infrastructure. The current cross-owner accept-tx write edges become removable when
    the accept flow is deleted (Phase 1).
  - ADD (per `ADR-021`, Correction v0.3.1): this capability **consumes** `EVT-CAL-SickVacationMarked`
    (published by `backend-calendar`) to drive `TREQ-009`/`TRULE-008`'s same-day assignment cancellation.
    Mirrors `SPEC-CALENDAR-001`'s own publisher-side proposed delta so the bidirectional edge has a
    proposal from both endpoints; contract `[OPEN]` (OD-CAL-08), target-plane only, no code yet.
- **TERMINOLOGY.md:** promote to canonical: `Work request`, `Work application` (mark "current-state,
  retired in target"), `Assignment` (WorkerAssignment), `Roster`, `Slot`. ADD role-token case mapping
  (`UserRole.WORKER` == guard `'worker'`, etc., FIND-CONS-001) and standardized verb note (worker
  "submit"; manager "accept/approve", FIND-CONS-002). ADD new target terms: `Hotel Group`,
  `Regional Manager`, `Hotel Manager`, `Scope`, `Broadcast / JobRequest`, `Calendar direct assignment`,
  `Daily exclusivity`, `Skill` — sourced to PIVOT §4.x/§5.4/§14 and CONFIRMED §1/§4/§12/§13.
- **DECISION_INDEX.md:** reference ADR-003 (modular monolith, PIVOT §5.1/§11) and ADR-004 (Prisma ORM,
  PIVOT §2.1/§11) as existing anchors (FIND-ARCH-004). A NEW Decision Record MAY be requested by
  architecture/human for the current cross-owner accept-tx coupling, OR that coupling recorded as
  "superseded-by-pivot" (FIND-ARCH-003) — proposed, not created here.
- **SYNC_STATE.yaml:** none proposed by the author; the synchronization owner records spec issuance if/when
  this candidate advances.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-06 | Initial current-state reverse specification at `f37a39b`. REQ-001..043, RULE-001..013 (RULE-011 split 011a-e). Folded FIND-BRV-003/004/005/007/008; recorded FIND-BRV-006/009 UNTESTED. Carried OQ-01..OQ-11 + SYNC-001; OQ-12 resolved. | FIND-BRV-003/004/005/007/008 | None — REVIEW, not approved. |
| 0.2.0 | 2026-07-06 | Added Current/Target/Migration-Gap/Open-Decision separation. Added TARGET requirements TREQ-001..013, TARGET rules TRULE-001..009 (all cited to PIVOT/CONFIRMED); labeled current requirements/rules [CURRENT] and flagged RETIRED-by-pivot (RULE-003/004/007/009/011b/011e/013). Added MIGRATION GAP enumeration MIG-GAP-01..12. Reduced open decisions to 5 genuine human items; moved OQ-04/05/06/07 (and 02/03/08/09/10/11) to RESOLVED-BY-TARGET/SUPERSEDED. Folded author-fixable G4: FIND-ARCH-004 (ADR-003/004), FIND-ARCH-005/CONS-003 (revision reconciliation f37a39b vs 22569f0), FIND-DEP-002 (client consumers), FIND-DEP-003 (compatibility = baseline/UNKNOWN), FIND-CONS-001 (role-token case map), FIND-CONS-002 (verb standardization; REQ-021 "submitted"), FIND-SEC-006 (OQ-01 -> CRITICAL), FIND-PERF-001/002/003/004/005 (fan-out capacity, no-retry contention, no-SLO escalation, tracked lows). Proposed knowledge deltas updated (registry@0.2.0, FIND-DEP-001 missing edge, terminology promotions + target terms). | FIND-ARCH-004, FIND-ARCH-005, FIND-DEP-002, FIND-DEP-003, FIND-CONS-001, FIND-CONS-002, FIND-CONS-003, FIND-SEC-006, FIND-PERF-001, FIND-PERF-002, FIND-PERF-003, FIND-PERF-004, FIND-PERF-005 (author-fixable folded). Human-authority items (FIND-SEC-001/002/003, FIND-ARCH-001/002/003, FIND-BRV-001/006/009) carried as open decisions/notes. | None — status REVIEW, G2 freeze reserved to human. |
| 0.3.1 | 2026-07-19 | **Correction, amending the FROZEN v0.3.0** per `ADR-021` (Calendar↔Job-Dispatch scheduling-ownership boundary, Accepted 2026-07-19). `SPEC-CALENDAR-001@0.2.0`'s G4 Dependency re-review (`SYNC-042`) found this document's `CalendarEntry`/`TREQ-009`/`TRULE-008`/notification text contradicted `ADR-021`'s "Job Dispatch unchanged" premise: `CalendarEntry` was defined here as "assignment/sick/vacation" (overlapping Calendar's new `state-calendar-absence`); the sick/vacation auto-cancel was modeled as this module's own atomic single transaction with zero declared consumed events (contradicting Calendar's event-driven design); and this module claimed to publish the sick/vacation manager notification Calendar now owns. Narrowly reconciled exactly those three points: `CalendarEntry` scoped to the assignment kind only (Dependencies); `TREQ-009`/`TRULE-008` changed from an atomic transaction to consumption of Calendar's `EVT-CAL-SickVacationMarked` (Requirements, Business Rules, Events, `MIG-GAP-10`, Validation Plan, `OQ-02/03`); the sick/vacation manager notification ceded to Calendar (Events). No other requirement, rule, interface, security finding, or open decision touched; the Critical/High security findings and all other open decisions carry forward unchanged. Status remains `FROZEN` — this is a narrow reconciliation of an already-ratified boundary decision (`ADR-021`), not a re-opening of unresolved scope, authorized by the same G2 authority extended via this session's explicit "amend the frozen spec" direction. | `FIND-DEP-001`, `FIND-DEP-002`, `FIND-DEP-003` (all from `SPEC-CALENDAR-001`'s G4 re-run) | Commissioning human (2026-07-19) |
| 0.3.2 | 2026-07-27 | **Correction, per `GD-05`** (Per-hotel "pause new jobs" toggle, Decided). Retroactively logged 2026-07-29 (Epic 9 PR 9.6 repository-synchronization pass) — this amendment's content was already recorded in Document Control's prose and the spec body (`RULE-014`, Dependencies §280) at the time of the 0.3.2 bump, but never given its own Review-and-Change-Log row until now; no content change accompanies this log entry, it only formalizes what already existed. Closes `SIR-CRM-016`/`OD-CRM-16` (architecture review `FIND-002`, `SPEC-CRM-001`): `WorkRequestService.create()` now reads `Hotel.accepting_jobs` (owned/written exclusively by `backend-crm`) and rejects creation with `ConflictError` (409) when `false`, per `GD-05`'s ratified enforcement boundary — a read-only cross-module dependency, no new write, no new ownership claim. No other requirement, rule, security finding, or open decision touched. FROZEN status retained (narrow reconciliation, same precedent as v0.3.0→0.3.1). | `SIR-CRM-016`/`OD-CRM-16` | Commissioning human (2026-07-27, `GD-05`) |
| 0.3.3 | 2026-07-29 | **Correction, per Epic 9 PR 9.4** (`WorkRequest`→`JobRequest` model rename, `TREQ-013`/`MIG-GAP-12`, commits `a69c8fd`, merged `b0904ba`). The `WorkRequest` Prisma model was renamed `JobRequest` (`@@map("WorkRequest")` preserves the physical table — zero data migration); the module directory/class renamed `work-requests`/`WorkRequestService` → `job-requests`/`JobRequestService`. The public route mount path `/work-requests` retained unchanged (public API contract, not renamed) — only internal model/module/class identifiers changed. No requirement, rule, security finding, or open decision content touched; this entry formalizes an amendment already recorded in the knowledge layer (`MODULE_REGISTRY.yaml`, `SYNC-061`) but missing its own Document Control/Review-and-Change-Log record in this document until this pass (Epic 9 PR 9.6 repository-synchronization, 2026-07-29). FROZEN status retained (pure identifier rename, not a re-opening of scope). | — (mechanical rename; no finding) | Commissioning human (2026-07-29, Epic 9 PR 9.4 authorization) |
| 0.3.4 | 2026-07-29 | **Correction, per Epic 9 PR 9.7** (`TREQ-002`/`TREQ-003`/`TREQ-010`, `MIG-GAP-04`/`MIG-GAP-05`). Adds `JobRequestSkillSlot` (new additive Prisma model + migration `20260729040000_add_job_request_skill_slot`) and `JobRequestService.raiseBroadcast()`/`getBroadcastEligibility()`. Closes: `TREQ-002`'s skill×headcount persistence half; `TREQ-003`'s eligibility-computation half (reuses PR 9.6's `isWorkerFreeOnDay()`/`ACTIVE_ASSIGNMENT_STATUSES` and `roster-scope.ts`'s `listEligibleWorkerIds()`); `TREQ-010`'s broadcast-path skill-enum half. Does NOT close: `TREQ-003`'s notification-delivery half, `TREQ-004`'s arbitration, `TREQ-005`'s "requirement fulfilled" response (PR 9.8/9.9), or `TREQ-006`'s auto-close (PR 9.10) — all explicitly out of this PR's scope per the implementation execution plan. **Documentation correction (2026-07-29, pre-merge review):** this row originally stated the legacy `JobRequest.position`/`workers_needed`/`workers_confirmed` fields are "left untouched" by `raiseBroadcast()`. That was imprecise: `raiseBroadcast()` DOES write `position`/`workers_needed` on every broadcast row, as a derived compatibility projection of the `skill_slots` breakdown (`position` = a generated summary string; `workers_needed` = the summed headcount) — not independently authored, and never read back as authoritative by any decision logic (`skill_slots` alone is authoritative). This is a deliberate transitional-compatibility choice (Option B), confirmed correct and now documented accurately; no runtime behavior changed as part of this correction. `workers_confirmed` is genuinely untouched (stays at its schema default of `0`; broadcast-accept is PR 9.9's scope). Full retirement of all three legacy fields awaits `TREQ-011`. New routes `POST /work-requests/broadcasts` + `GET /work-requests/broadcasts/:id/eligibility`, gated by the existing `FEATURE_JOBDISPATCH_PHASE2` flag (default off). No other requirement, rule, security finding, or open decision touched. FROZEN status retained (additive capability build within already-ratified target architecture). | — (no finding; additive build within ratified target; the mid-cycle correction above is a documentation-accuracy fix, not a new finding) | Commissioning human (2026-07-29, Epic 9 PR 9.7 authorization; documentation correction confirmed same day via pre-merge review) |
| 0.3.5 | 2026-07-29 | **Correction, per Epic 9 PR 9.8** (`TREQ-003` delivery half, `MIG-GAP-04`). Adds a new additive `NotificationType.JOB_REQUEST_BROADCAST` value (migration `20260729050000_add_job_request_broadcast_notification_type`, `ALTER TYPE ... ADD VALUE`, irreversible-forward per the `20260727050000_add_calendar_notification_type` precedent) and `JobRequestService.enqueueBroadcastNotifications()`, called inside `raiseBroadcast()`'s existing creation transaction (same transaction-join pattern `ADR-029`/Epic 7 PR 7.3 established, mirroring `enqueueRosterPublished()`'s shape). Reuses PR 9.7's eligibility computation (factored out of `getBroadcastEligibility()` into a shared private `computeBroadcastEligibility()`, called by both the public read route and this notification step) rather than recalculating the eligible-worker set — a worker eligible on more than one skill slot of the same broadcast receives one notification per matching slot (distinct openings, not deduplicated). `OutboxSourceModule.WORK_REQUESTS` reused unchanged (confirmed against Epic 9 PR 9.4's actual diff before authoring, per this PR's own instruction: the `WorkRequest`→`JobRequest` rename never touched this enum). Closes `TREQ-003`'s remaining notification-delivery half and `MIG-GAP-04`'s remaining open half. Does NOT close: `TREQ-004`'s arbitration, `TREQ-005`'s "requirement fulfilled" response, or `TREQ-006`'s auto-close (PR 9.9/9.10, unchanged, explicitly out of this PR's scope). No requirement, rule, security finding, or open decision touched beyond the `TREQ-003`/`MIG-GAP-04` status updates above. FROZEN status retained (additive capability build within already-ratified target architecture, not a re-opening of scope). | — (no finding; additive build within ratified target) | Commissioning human (2026-07-29, Epic 9 PR 9.8 authorization) |
| 0.3.6 | 2026-07-30 | **Correction, per Epic 9 PR 9.9** (`TREQ-004`/`TREQ-005`, `MIG-GAP-06`). Adds `JobRequestService.acceptBroadcast()` — first-accept optimistic-concurrency arbitration via a transactional conditional `updateMany` on `JobRequestSkillSlot.confirmed_count`; on zero-affected-rows returns the `requirement_fulfilled` response (`TREQ-005`) instead of throwing; on success creates a `WorkerAssignment` directly (`job_request_id` set, `work_request_id` left null, PR 9.5's disposition). Two pre-implementation escalations resolved before code was written: (1) `ADR-057` (ratified 2026-07-28) named "a version column plus a transactional conditional update" as the arbitration mechanism, but `JobRequestSkillSlot` (built by PR 9.7, one day after ratification, arbitrating at a per-skill grain `ADR-057` could not have anticipated) has no `version` column — resolved via a 2026-07-30 addendum to `ADR-057` confirming a bare `confirmed_count` guard is a conforming instance of the same mechanism (both are a monotonic guard column re-evaluated post-lock by Postgres's row-level locking, the actual source of atomicity), not a deviation requiring schema change; (2) `WorkerAssignment.assigned_by_id` (`NOT NULL`, relation `"assignment_manager"`) has no natural value for a worker-initiated self-accept — resolved by setting it to the broadcast `JobRequest.created_by_id` (the manager who raised it), confirmed by the commissioning human. New route `POST /work-requests/broadcasts/:id/accept`, no `requireRole` gate (worker-initiated, service enforces roster-eligibility/skill-match/daily-exclusivity), gated by `FEATURE_JOBDISPATCH_PHASE2`. Test file `job-requests-arbitration.test.ts` includes the mandatory concurrency test (`FIND-BRV-006` precedent — this PR does not repeat that historically-untested gap): exactly one winner among concurrent last-slot claimants, proven via a stateful mock. Closes `TREQ-004`/`TRULE-003`, `TREQ-005`/`TRULE-004`; `MIG-GAP-04` and `MIG-GAP-06` both fully closed. Does NOT implement auto-close, scheduler registration, or any PR 9.10 behavior. No other requirement, rule, security finding, or open decision touched. FROZEN status retained (additive capability build within already-ratified target architecture, not a re-opening of scope). | — (no finding; additive build within ratified target; ADR-057 addendum is a scope-preserving clarification of the ratified mechanism, not a new decision) | Commissioning human (2026-07-30, Epic 9 PR 9.9 authorization; ADR-057 addendum and assigned_by_id resolution both confirmed same day via pre-implementation escalation) |
| 0.3.7 | 2026-07-30 | **Correction, per Epic 9 PR 9.10** (`TREQ-006`/`TRULE-005`, `MIG-GAP-09`). Adds `JobRequestAutoCloseJob` (mirroring `SessionSweepJob`'s/`GeoRetentionSweepJob`'s exact shape), registered on the Platform Worker `Scheduler`, delegating to a new `JobRequestService.closeExpiredBroadcasts(cutoff, batchSize)` (batched, closes every broadcast still `OPEN` 6h past creation, notifying the raising manager via a new additive `NotificationType.JOB_REQUEST_CLOSED` value, migration `20260730000000_add_job_request_closed_notification_type`). Adds `JobRequestService.manualClose()` + new route `POST /work-requests/broadcasts/:id/close` for a manager-initiated early close, sharing the same notification helper as the scheduled path. Confirmed via repository-reality verification before implementation: `EXPIRED` (not `CANCELLED`) is the correct target status (`REQ-013`'s own RESOLVED-BY-TARGET disposition); the existing `OPEN`→`CANCELLED` transition already reachable via `update()` is a distinct manual-cancel path, not the same as a manual early-close to `EXPIRED` — this ambiguity was confirmed by the commissioning human before code was written. `OPEN`→`EXPIRED` is deliberately NOT added to the shared `ALLOWED_TRANSITIONS` table (that table also governs the marketplace flow, which has no `EXPIRED`-via-manual-action concept); `manualClose()` validates the precondition itself, reusing the existing broadcast-detection guard. Confirms `ADR-057`'s Platform-Worker-not-BullMQ decision in code — no new job runtime introduced. Closes `TREQ-006`/`TRULE-005`; `MIG-GAP-09` fully closed. This is Epic 9's final planned PR — every `TREQ`/`MIG-GAP` row this module's target-state scope named is now built in code — but `SIR-JOBD-006` (the register enumeration) is deliberately NOT closed by this pass, reserved for its own later, dedicated implementation-completion act per the standing instruction every prior PR in this epic already recorded. No other requirement, rule, security finding, or open decision touched. FROZEN status retained (additive capability build within already-ratified target architecture, not a re-opening of scope). | — (no finding; additive build within ratified target) | Commissioning human (2026-07-30, Epic 9 PR 9.10 authorization; manualClose()/EXPIRED-status ambiguity confirmed via pre-implementation escalation) |
| 0.3.8 | 2026-07-30 | **Documentation-correction pass, following the Epic 9 Completion Audit** (the dedicated implementation-completion act v0.3.7/`SYNC-064` reserved as a later, separate act). No requirement, rule, security finding, or open decision content is touched; no code changed. Corrects five `TREQ` status cells in `[TARGET STATE]` requirements (§Evidence and Traceability) that had been left reading "Target; unbuilt" even though this same Review-and-Change-Log already narrated each as built in a prior row above — each is now updated to "Built", independently re-verified against current `origin/main` (`ca22207`) rather than copied from any prior summary: `TREQ-001`/`MIG-GAP-03` — Epic 9 PR 9.5, commit `2c77ee0` (`CalendarEntry` + `placeOnCalendar()`); `TREQ-007`/`MIG-GAP-08` — Epic 9 PR 9.6, commit `3be6019` ((`worker_id`,`day`) partial unique index); `TREQ-011`/`MIG-GAP-01` — Epic 9 PR 9.2, commit `12b1c31`/`2e89c4f` (merged `b035700`, `WorkApplication` removal); `TREQ-012`/`MIG-GAP-02` — Epic 9 PR 9.3, commit `58e1366` (nullable `job_request_id`) together with PR 9.2's FK drop; `TREQ-013`/`MIG-GAP-12` — Epic 9 PR 9.4, commit `a69c8fd` (`WorkRequest`→`JobRequest` rename). Also corrects three `MIG-GAP` enumeration-table rows (§`[MIGRATION GAP]` enumeration) whose attribution this pass's re-verification found incorrect: `MIG-GAP-11` (`PATCH /assignments/:id` authorization) was still framed as an open CRITICAL gap — `git show 9495c5b` confirms it was actually closed by **Epic 1 PR 1.1** (2026-07-08), predating Epic 9 entirely, and is independently tracked `RESOLVED` at `SIR-JOBD-001` in the governance register (re-verified there 2026-07-23); this row now attributes closure to Epic 1 PR 1.1 and cross-references `SIR-JOBD-001` rather than restating it. `MIG-GAP-07` (role×scope RBAC/hotel-scoping) is corrected to attribute closure to **Epic 8** (2026-07-23, `SIR-JOBD-002`: `isHotelInScope()` wired into `work-requests`/`work-applications`), not Epic 9 — independently confirmed by `DEPENDENCY_GRAPH.yaml`'s own pre-existing `permissions-middleware` note and by Epic 9 PR 9.1's own commit message (`2b2d395`), which states it only verified this gap against the three marketplace modules ("No fix needed there"). `MIG-GAP-10` (same-day sick/vacation auto-cancel) is corrected to attribute closure to the **Calendar module's own direct call** (`calendar/service.ts` → `AssignmentService.update()`, the synchronous-transport shape ratified platform-wide by `ADR-032`, 2026-07-28), not any Epic 9 PR — Epic 9 shipped no code on this path; `ADR-021`'s event-driven documentation framing (v0.3.1) is retained as a label per `ADR-032`'s own disposition, not re-opened. `SIR-JOBD-006` (the governance register's `MIG-GAP-01..12` enumeration) is separately closed in this same pass, per its own update protocol — see `governance/SPECIFICATION_ISSUES_REGISTER.md`; that closure is recorded there, not in this document's Review-and-Change-Log, per the register's "reference over copy" convention. FROZEN status retained (a documentation-accuracy correction, not a re-opening of scope). | — (no finding; documentation-accuracy correction correcting this document's own internal inconsistency, found by the Epic 9 Completion Audit and independently re-verified before this pass applied it) | Commissioning human (2026-07-30, Epic 9 Completion Audit governance-closure authorization) |
