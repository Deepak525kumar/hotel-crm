# Execution Dashboard

| Field | Value |
|---|---|
| Purpose | The single operational status view: current milestone, per-module implementation state, completed vs. remaining modules, active work, upcoming work, and open blockers to that work |
| Out of scope | Production-release sign-off (see [RELEASE_STATUS.md](RELEASE_STATUS.md)) and ADR/governance-decision status (see [`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md), [`DECISION_INDEX.md`](../../.claude/knowledge/DECISION_INDEX.md)) — this file links to both, never restates them |
| Per-module status source | [`.claude/knowledge/MODULE_REGISTRY.yaml`](../../.claude/knowledge/MODULE_REGISTRY.yaml) `implementation_status`/`lifecycle` fields — this table summarizes, it does not duplicate the registry's evidence/specification detail |
| Last verified | 2026-07-28 (SYNC-055 repository-synchronization pass, post-PR #243/#244/#245; module implementation status independently re-checked against `backend/src/modules/*/service.ts`; test suite re-run: 71/71 suites, 1113/1113 tests passing; `tsc --noEmit` clean) |

## Current Milestone

**Authorization Foundation — COMPLETE (2026-07-27).** `ADR-030` (Manager Write-Authority Capability
Model) and `ADR-031` (Request-Time Permission Derivation, Token-Generation Revocation, Auth
Rate-Limiting) are both Accepted and fully built (PR-1..PR-8 each, merged 2026-07-25 through
2026-07-27). Full delivery record: [`MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md`](../implementation/MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md)
(linked, not restated). This closed the `GD-02`, `GD-03` (permission-set half), and `GD-07` rows in
[`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md).

**MVP Completion Decisions — COMPLETE (2026-07-27).** `GD-04`, `GD-05`, and `GD-06` are all Decided
and built: `GD-04` (quality rating single-writer fix, PR #237/#238), `GD-05` (per-hotel "pause new
jobs" toggle, PR #239), `GD-06` (worker-scoped analytics endpoint). No blocker remains open from
this batch. Full options/impact detail lives only in
[`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md).

**Landed since:** `GD-16` (Documents module RBAC & storage) **Decided** 2026-07-27, option (a) —
self-upload + manager-upload only, hotel-scoped read via existing `checkHotelAccess()`,
presigned-URL retrieval, SSE-at-rest, malware-scan hook. `SPEC-DOCUMENTS-001` frozen @0.1.4 the
same day (G2 approval granted per `GD-16`); the `backend-documents` module was then built and
merged the same day (PR #245) — see its row below for what shipped vs. what remains deferred
(multipart upload, real S3 SDK, `MIG-GAP-DOC-001`). Repository-synchronization pass SYNC-055
(2026-07-28) reconciled the knowledge layer against this and the two other PRs merged since GD-16
(`#243` GD-18 calendar-absence slice, `#244` the GD-16 decision/freeze itself).

**Analysis, not a ratified decision:** a capability-level readiness audit (2026-07-27, per your own
direction to decompose modules into individual requirements rather than trust one module-level
verdict) additionally flagged two candidates that have **not** been decided or acted on — recorded
here as findings for a future owner call, not as architecture fact:
- `REQ-CAL-T06` (Calendar's availability read-model) appears technically unblocked (reads only
  already-existing tables) despite being bundled with the still-deferred manager-placement view
  under `GD-18` — but `GD-18` itself remains undecided, so building this ahead of that decision
  would be building ahead of governance, not following it.
- `IF-COMPLIANCE-GetAuditTrail` (a read-only surface over the already-existing `AuditLog` table)
  appears to have no governance blocker — but this has not been confirmed by an owner or
  architecture decision, only by this audit's reading of `ADR-016`.

Neither claim should be treated as settled until a decision is made the same way `GD-16` was.

Also pending, independent of the above: `GD-09` (GDPR retention tiers — has an external
tax-advisor sign-off dependency, so its lead time runs regardless of when work on it starts) and
`GD-12` (event-bus formalization, zero-code — blocks HR/EMP/Calendar/Consent event-contract
builds until decided).

## Per-Module Implementation Status

Derived from `.claude/knowledge/MODULE_REGISTRY.yaml`. See that file for each module's evidence
path, specification reference, and freeze/review disposition.

| Module | `lifecycle` | `implementation_status` | Spec |
|---|---|---|---|
| backend-auth | active | active | SPEC-AUTH-001@0.3.0 FROZEN |
| backend-users | active | active | SPEC-USERS-001@0.2.0 FROZEN |
| backend-crm | active | active | SPEC-CRM-001@0.2.1 FROZEN |
| backend-hotel-workers | removed | removed | RETIRED (ADR-022) |
| backend-work-requests | active | active | SPEC-JOB-DISPATCH-001@0.3.2 FROZEN |
| backend-work-applications | active | active | SPEC-JOB-DISPATCH-001@0.3.2 FROZEN |
| backend-assignments | active | active | SPEC-JOB-DISPATCH-001@0.3.2 FROZEN |
| backend-attendance | active | active | SPEC-ATT-001@0.2.0 FROZEN |
| backend-quality | active | active | SPEC-QUAL-001@0.2.0 FROZEN |
| backend-hr | active | active-no-tests | SPEC-EMP-001@0.2.0 FROZEN (see registry `related_specification` note re: SPEC-HR-001 boundary disclosure) |
| employee-management | active | active | SPEC-EMP-001@0.2.0 FROZEN |
| backend-notifications | active | active | SPEC-NOTIF-001@0.3.0 FROZEN |
| backend-analytics | active | active | SPEC-ANALYTICS-001@0.2.1 FROZEN |
| backend-calendar | active | active-partial (2026-07-27, `GD-18` narrow slice: `GET`/`POST /calendar/my-absences` real; `/operations` remains stub, unrelated capability `OD-CAL-10`) | SPEC-CALENDAR-001@0.3.1 FROZEN |
| backend-chatbot | declared | unimplemented-stub (`.placeholder` only, not route-registered) | SPEC-CHATBOT-001@0.1.3 REVIEW |
| backend-geo | declared | unimplemented-stub (`.placeholder` only, not route-registered) | SPEC-GEO-001@0.1.1 REVIEW |
| backend-consent | no module directory | zero-code | SPEC-CONSENT-001@0.1.1 REVIEW |
| backend-compliance | no module directory | zero-code | SPEC-COMPLIANCE-001@0.1.0 REVIEW |
| backend-retention | no module directory | zero-code | SPEC-RETENTION-001@0.2.0 REVIEW |
| frontend-web, mobile-worker, mobile-checker | active | active | UNKNOWN (no client spec) |
| operations (infra) | active | not-applicable | UNKNOWN |

**Independently re-verified 2026-07-27:** `backend/src/modules/hr/service.ts` still throws
`NotImplementedError` from every service method. `backend/src/modules/calendar/service.ts`'s
`/operations` methods still throw `NotImplementedError` (unrelated capability, `OD-CAL-10`), but
`getOwnAbsences`/`markAbsence` (the `GD-18` narrow slice: worker self-marks sick/vacation) are real
— see Completed Work below. `backend/src/modules/chatbot/` and `backend/src/modules/geo/` contain
only `.placeholder`, no route mount.

## Completed Work (this milestone)

- `GD-01` Notification dispatch & delivery model — Decided (`ADR-029`) and built (Epic 7, PRs
  7.1–7.8): Transactional Outbox + Platform Worker with real EMAIL (SendGrid/Resend) and PUSH
  (APNs/FCM) transport handlers.
- `GD-02` Manager write-permission authority — Decided and built (`ADR-030`, PR-1..PR-8, merged
  2026-07-25/26): capability-based model, hotel/hotel-group writes Admin-only, scoped
  `users:write`.
- `GD-03` 5-role model & Regional-Manager permission set — Decided and built (`ADR-030` D-5,
  `REGIONAL_MANAGER` enum + capability gates, merged). The org-chart/reporting-model half
  (`OD-EMP-12`, `OQ-AUTH-08`) is explicitly **not** resolved by this decision.
- `GD-07` Session/token revocation & auth rate-limiting — Decided and built (`ADR-031`, PR-0..PR-8
  incl. PR-4a, merged 2026-07-26/27): request-time permission derivation, `token_generation`
  revocation counter, session/reset-token sweep job, Nginx-edge rate limiting.
  `SIR-AUTH-017` (password-reset timing side-channel) and per-account rate-limiting are explicitly
  excluded from this decision's scope and remain open.
- `GD-04` Quality rating single-writer + delete-behavior fix — Decided and built (2026-07-27, PR
  #237/#238): dropped the DB trigger that partially duplicated `WorkerOverallRating` maintenance;
  the app-level `refreshWorkerOverallRating()` is now the sole writer, called from both rating
  creation and assignment-completion/cancellation. `SIR-QUAL-005` resolved. Tiers/warnings/photo
  policy remain deferred as a separate product sub-decision, not covered by this fix.
- `GD-05` Per-hotel "pause new jobs" toggle — Decided and built (2026-07-27, PR #239 backend,
  follow-up PR frontend): `Hotel.accepting_jobs` boolean (default `true`), set via
  `PATCH /hotels/:hotel_id`, enforced in `work-requests/service.ts` `create()` (`ConflictError` —
  a business-state precondition, not an authorization check). `SIR-CRM-004`/`SIR-CRM-016` resolved;
  `SPEC-CRM-001` amended to @0.2.1, `SPEC-JOB-DISPATCH-001` to @0.3.2 (reciprocal cross-module
  acknowledgment). Frontend: edit-mode checkbox in `HotelForm.tsx` (same pattern as `is_active`),
  paused-status badge on the hotel detail page and list page.
- `GD-06` Worker-facing analytics scope & metric definitions — Decided and built (2026-07-27,
  option (a), scoped to currently-derivable metrics): new self-scoped `GET /analytics/my-stats`
  route (any authenticated role, scoped server-side to `req.auth.userId`, no admin/manager gate),
  `AnalyticsService.getWorkerStats()`, and a `WorkerStats` type distinct from `DashboardStats`.
  Resolves the mobile-worker dashboard's previously-silent 403 (`SIR-ANLY-002`) and the independent
  `DashboardStats` type-shape mismatch it also carried (the mobile client's old type never matched
  any real backend response). `SPEC-ANALYTICS-001` amended to @0.2.1. Warning counts and
  sick/vacation counts remain explicitly deferred (`GD-04`'s tiers, `GD-18`'s Calendar).
- `GD-18` (Calendar) — **narrow slice built 2026-07-27**, `GD-18` itself still undecided as a
  formal product decision. Per the frozen `SPEC-CALENDAR-001`'s own text (its `ADR-021` boundary
  and `REQ-CAL-T08`'s explicit no-Phase-1-dependency note), the worker self-mark
  sick/vacation capability (`REQ-CAL-T03/T04/T08`) required no governance decision to build — it
  is independent of the manager weekly-plan placement view (`REQ-CAL-T01`, which does depend on
  the still-marketplace-era `WorkerAssignment` schema) and independent of `GD-12`
  (event-bus). Built: `CalendarAbsence` model (`state-calendar-absence`), `GET`/`POST
  /calendar/my-absences` (self-scoped, any authenticated role), same-day auto-cancel via a direct
  in-process call to `AssignmentService.update()` (not the target `EVT-CAL-SickVacationMarked`
  event — no event bus exists yet), best-effort manager notification via the worker's
  `EmploymentRecord`→`HotelGroup.regional_manager_user_id`. Independently architecture-reviewed:
  the `ADR-021` ownership boundary (Calendar never writes `WorkerAssignment`/`CalendarEntry`
  directly) holds. `SPEC-CALENDAR-001` amended to @0.3.1; `OD-CAL-04` (timezone) and `OD-CAL-06`
  (notification transport) carry implementation-time defaults, not formal resolutions. The manager
  weekly-plan placement view and the today-only availability read-model remain unbuilt.

Full narrative and PR-by-PR delivery evidence for all of the above:
[`MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md`](../implementation/MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md).
Decision rationale and options considered: [`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md).

## Remaining Modules & Work

Per a capability-level readiness audit (2026-07-27): most items below are genuinely blocked on a
named `GD-*` owner decision, but not every requirement inside a "blocked" module is itself
blocked — see the Calendar and Documents rows for the two exceptions found. Decision detail for
every `GD-*` ID lives only in
[`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md).

| Area | State | Blocked on |
|---|---|---|
| backend-hr | mounted, every method `NotImplementedError`; every individual requirement checked, none independently ready | `GD-15` (HR/EMP build scope), which itself depends on `GD-03`'s open org-chart half, `GD-09`, `GD-16` (now Decided, see below), `GD-12` |
| backend-calendar: manager weekly-plan placement view (`REQ-CAL-T01`) | unbuilt (worker self-mark sick/vacation half already built, see Completed Work) | `GD-18` (remaining scope) + Phase-1 schema realignment (`WorkerAssignment.application_id` still mandatory) owned by `SPEC-JOB-DISPATCH-001` |
| backend-calendar: today-only availability read-model (`REQ-CAL-T06`) | unbuilt | `GD-18` (still undecided) — an audit finding (2026-07-27, not a ratified decision) observed this reads only already-existing tables and is not itself schema-blocked, but building it would still be getting ahead of `GD-18`'s own scope decision, not a substitute for one |
| backend-documents (Documents module, RBAC/storage) | **in progress (2026-07-27):** `WorkerDocument` model + migration landed; module built (`types.ts`, `validation.ts`, `storage.ts` (S3 stub, real client deferred — `@aws-sdk/client-s3` not yet a dependency), `service.ts`, `controller.ts`, `routes.ts`); mounted at `/v1/documents`. All five `IF-DOC-*` target interfaces implemented. No multipart/file-parsing middleware wired yet — uploads persist metadata with an empty byte buffer (same gap the migrated-from `backend-hr` stub had, `MIG-GAP-DOC-001`, itself still open and out of this session's scope). `MIG-GAP-DOC-001` (migrating `backend-hr`'s stub route to call into this module) not yet done. | **`GD-16` Decided 2026-07-27** (option (a): self-upload + manager-upload only, hotel-scoped read, presigned URLs, SSE-at-rest). No governance blocker remains. Gates HR's `REQ-HR-008/011` contract-scan upload and onboarding document collection (neither wired yet). |
| backend-chatbot | zero code, `.placeholder` only; every requirement checked, none independent | `GD-19` (chatbot scope & LLM safety) — spec cannot reach G2 freeze until decided |
| backend-geo | zero code, `.placeholder` only; every requirement checked, none independent | `GD-14` (geofencing/location model) |
| backend-consent | zero code, no module directory | `GD-17`; a narrow consent-log table + notice-version catalog (no enforcement) is buildable without `GD-17`'s fail-open/closed question, but full daily-gate enforcement is not |
| backend-compliance | zero code, no module directory | No dedicated `GD-*`; an audit finding (2026-07-27, not owner-confirmed) reads `IF-COMPLIANCE-GetAuditTrail` (read-only over the already-existing `AuditLog` table, boundary per `ADR-016`) as having no governance blocker — the rest of the module (subject-rights orchestration) is downstream of Consent/Retention/Documents |
| backend-retention | zero code, no module directory; every requirement checked, none independent | `GD-09` (external tax-advisor sign-off, long lead time) — the one module where full-module-blocked holds up under decomposition |
| Quality rating tiers/warnings/photo policy (deferred sub-decision, not built by `GD-04`'s fix) | undecided | separate future `GD-*` (not yet assigned) |
| MFA | no data model or endpoint anywhere | `GD-08` |
| Platform event-bus formalization | in-process singleton only | `GD-12` (zero-code decision, gates HR/EMP/Calendar/Consent event contracts) |
| Optimistic-locking/concurrency pattern (attendance, CRM hotel update, quality aggregate) | unbuilt | `GD-10` |
| Performance SLO & workload baseline | undefined | `GD-11` (unblocks G8 for multiple modules) |
| Cross-module state-read boundary ratification (analytics reads 6+ state domains it doesn't own) | undocumented | `GD-13` |
| Job-Dispatch two-tier calendar+broadcast pivot | not started | `GD-20` (recommendation: defer) |
| Attendance auto-ABSENT/NO_SHOW automation | unbuilt | `GD-21` |
| Hotel-Group billing model | undecided | `GD-22` (recommendation: defer) |
| Platform ADR ratification cleanup (ADR-001..009, ADR-019/020) | governance-record only, 0 code | `GD-23` |

**Engineering hygiene items (non-blocking):** `TD-1` orphan-doc warnings, `TD-4` mobile Expo
scaffold residue, `TD-3` dead `super_admin` branch, `TD-5` no CI coverage gate / no frontend unit
tests / no e2e. (`SIR-AUTH-022`, the backup-table cleanup ticket, is tracked once, in the Blockers
table below — not repeated here.)

## Blockers to Active Work

| ID | Blocks | Description | Resolution owner |
|---|---|---|---|
| SYNC-001 | Every module/contract/state-domain ownership assignment | No CODEOWNERS file exists; `backend/package.json` "author" is empty; every module `owner: unassigned` in the registry | Human (reserved authority) |
| OD-EMP-12 / OQ-AUTH-08 | Org-chart/reporting-model data structure | `ADR-030` D-5 explicitly resolved only the Regional-Manager permission set, not the underlying reporting-relationship model | Human decision |
| SIR-AUTH-022 | Cleanup of `_User_permissions_backup_20260727` | Pre-drop backup table from `ADR-031` has no tracked removal date | Scheduled migration/ticket, possibly folded into `GD-09` |

No `GD-*` blocker remains open from the MVP Completion Decisions batch (`GD-04`/`GD-05`/`GD-06`,
all built as of 2026-07-27). Governance-decision (`GD-*`) status in full, including options and ROI ranking, is tracked
exclusively in [`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md) —
not duplicated here beyond the summary above.

## Update Protocol

Update this file as an exit condition of the Implementation and Post-flight workflows whenever a
module's `implementation_status` changes, a milestone closes, or a blocker resolves. Recompute the
per-module table from `.claude/knowledge/MODULE_REGISTRY.yaml` rather than hand-editing status
that the registry already tracks; verify against `backend/src/modules/*/service.ts` for any module
claimed as a stub before publishing an update.
