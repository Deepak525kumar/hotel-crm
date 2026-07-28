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
  already-existing tables) despite being bundled with the manager-placement view under `GD-18`.
  **`GD-18` is now Decided (2026-07-28, `ADR-049`–`ADR-052`)** — the governance-ambiguity blocker
  this note originally flagged no longer applies; both `REQ-CAL-T06` and the manager-placement view
  (`REQ-CAL-T01`) may now be planned against settled timezone/RM-scope/operations-stub decisions.
  Both remain unbuilt, but that is an implementation-effort gap now, not a governance one.
- `IF-COMPLIANCE-GetAuditTrail` (a read-only surface over the already-existing `AuditLog` table)
  appears to have no governance blocker — but this has not been confirmed by an owner or
  architecture decision, only by this audit's reading of `ADR-016`.

Neither claim should be treated as settled until a decision is made the same way `GD-16` was.

`GD-09` (GDPR retention tiers) and `GD-12` (event-bus / inter-module transport) are **no longer
pending — both Decided 2026-07-28**, see below. `GD-09`'s tax-advisor sign-off (`OD-RETENTION-01`)
remains its own separate, non-blocking follow-up with an external lead time that runs regardless of
when it's pursued — it no longer gates the tier mapping itself or any dependent module.

> **Sync note (2026-07-28):** `GD-12` was decided via the Governance Resolution workflow
> (`ADR-032`, Option (a): direct in-process calls are the platform standard for synchronous
> cross-module effects; the existing Outbox, `ADR-029`, is the sole approved async/durable
> mechanism; no generic event bus exists or is introduced; a future pub/sub need requires its own
> new ADR). This resolves the *transport mechanism* question only — it does not itself unblock
> any module's own build scope (HR/EMP/Calendar/Consent/CRM/Documents/Chatbot each still gated on
> their own remaining `GD-*`/`OD-*` items as listed in this document). Full record:
> `GOVERNANCE_DECISIONS_REQUIRED.md` GD-12 section; `docs/implementation/GOVERNANCE_REGISTER.md`.

> **Sync note (2026-07-28, cont'd):** `GD-09`'s mapping half was also decided via the Governance
> Resolution workflow (`ADR-033`, Option (c): every previously-unassigned record type provisionally
> mapped to one of CRR §25's three tiers now — `Notification`/`User`/`Session`/HR contracts/
> documents/chatbot metadata/consent records; `AuditLog` excluded, retained indefinitely — tax-advisor
> sign-off, `OD-RETENTION-01`, tracked separately as a non-blocking follow-up rather than a gate).
> This resolves the *tier-mapping* question only — it does not itself unblock `backend-retention`'s
> own build, which remains gated on `OD-RETENTION-05/10/11/14/15` (RBAC scope, cross-module delete
> authorization, sweep query design, owner assignment, fan-out workload). Full record:
> `GOVERNANCE_DECISIONS_REQUIRED.md` GD-09 section; `ADR-033`.

> **Sync note (2026-07-28, cont'd 2):** `GD-13` was also decided via the Governance Resolution
> workflow (`ADR-034`, Option (c): direct read-only cross-module Prisma reads ratified as the
> platform standard for aggregator/reporting modules — analytics' existing seven `reads-state`
> edges all satisfy the criterion, no code change — subject to a three-point allow-list; a future
> read-model interface remains a named, unmet escalation trigger tied to `GD-11`'s still-open SLO
> baseline). Full record: `GOVERNANCE_DECISIONS_REQUIRED.md` GD-13 section; `ADR-034`.

> **Sync note (2026-07-28, cont'd 3):** `GD-11` was also decided via the Governance Resolution
> workflow (`ADR-035`, Option (a): platform-wide workload baseline — ~100 hotels, ~5,000 workers,
> ~300 concurrent users at peak — and p95 latency targets by query class: simple reads ≤150ms,
> scoped list/filter ≤400ms, cross-module aggregation ≤800ms; leaderboard pagination now a MUST,
> default 25/max 100; cross-module fan-out capped at 15 parallel queries per request, feeding
> `ADR-034`'s escalation trigger). Per-endpoint conformance to these targets remains a G8
> verification activity, not settled by this decision alone. Full record:
> `GOVERNANCE_DECISIONS_REQUIRED.md` GD-11 section; `ADR-035`.

> **Sync note (2026-07-28, cont'd 4):** `GD-10` was also decided via the Governance Resolution
> workflow (`ADR-036`: optimistic concurrency adopted as the platform standard, ratifying the
> pattern `WorkRequest.version` already establishes; attendance's `checkIn`/`update` double-submit
> race MUST be fixed, not accepted as residual risk; the concrete mechanism — version column,
> transactional row-level lock, or another optimistic-concurrency-consistent approach — is
> explicitly deferred to implementation). Verification found two of this GD's three original
> "merges findings" items already resolved by other decisions — `Hotel`'s lost-update risk via
> `ADR-030` (2026-07-25) and the quality rating aggregate's divergence via `GD-04`+PR #237/#238
> (2026-07-27) — neither reopened by `ADR-036`. Full record: `GOVERNANCE_DECISIONS_REQUIRED.md`
> GD-10 section; `ADR-036`.

> **Sync note (2026-07-28, cont'd 5):** `GD-17` was also decided via the Governance Resolution
> workflow (`ADR-037`: `OD-CONSENT-002` resolved via Option (b) — chatbot engagement requires
> explicit consent, a decline routes the worker to a manual/non-chatbot onboarding path rather than
> blocking onboarding outright; `OD-CONSENT-006` resolved fail-closed — dependent flows block, not
> silently proceed, when Consent is unavailable; five smaller lifecycle/RBAC items also resolved:
> `OD-CONSENT-001`/`004`/`007`/`009`/`011`). Onboarding's `OPQ-3` and Chatbot's `OD-CHAT-008`
> (consent portion only — transcript-persistence remains its own open question) were updated to
> reflect the concrete resolution. Full record: `GOVERNANCE_DECISIONS_REQUIRED.md` GD-17 section;
> `ADR-037`.

> **Sync note (2026-07-28, cont'd 6):** `GD-23` was also decided (Option (a): ratify as-is) —
> `ADR-019` and `ADR-020` flipped Proposed → Accepted; `.claude/VERSION.yaml` corrected in three
> places (1.5.0 entry, 1.4.0 entry, 1.5.0-supersedes-1.4.0 summary comment). Verification found
> ADR-001..009 were already ratified 2026-07-15 — `SIR-GLOB-003`'s last open element was already
> closed and is now corrected to RESOLVED in the Specification Issues Register. Full record:
> `GOVERNANCE_DECISIONS_REQUIRED.md` GD-23 section.

> **Sync note (2026-07-28, cont'd 7):** `GD-08` was also decided (Option (c): explicit deferral) —
> MFA is deferred to a post-MVP hardening milestone, a deliberate scheduling decision, not a silent
> gap; no data model or mechanism (TOTP vs. OTP) is selected. `TREQ-AUTH-006` remains a confirmed,
> unimplemented requirement. Full record: `GOVERNANCE_DECISIONS_REQUIRED.md` GD-08 section; `ADR-038`.

> **Sync note (2026-07-28, cont'd 8):** `GD-15` was also decided — ten sub-decisions, each its own
> ADR (`ADR-039` through `ADR-048`): `OD-HR-02` payroll-type redesign; `OD-HR-03`/`07` manager-only
> contract continuation; `OD-HR-09` 3-day payslip escalation via Outbox; `OD-HR-10` self-scoped
> worker RBAC; `OD-HR-13` list-route scope-filtering; `OD-HR-14` synchronous malware-scan hook;
> `OD-EMP-04` hybrid offboarding trigger + new-record re-engagement; `OD-EMP-06` platform-wide
> worker self-edit boundary; `OD-EMP-08` per-row bulk-import isolation; `OD-EMP-13`/`14` Admin-managed
> lookup tables. A pre-decision audit found the standing `OD-HR-01a`/`OD-HR-01b` architecture blocker
> (HR-vs-Onboarding module boundary) had already been resolved by `ADR-012` on 2026-07-12 — a
> documentation-synchronization gap, corrected before the ten sub-decisions were addressed. `OD-EMP-16`
> was separately found already resolved by `GD-11`/`ADR-035`, its own stale spec row corrected.
> `OD-HR-02b` and `GD-03`'s org-chart half remain genuinely open. Full record:
> `GOVERNANCE_DECISIONS_REQUIRED.md` GD-15 section; `ADR-039`–`ADR-048`.

> **Sync note (2026-07-28, cont'd 9):** `GD-18` was also decided — four sub-decisions, each its own
> ADR (`ADR-049` through `ADR-052`): `OD-CAL-04` timezone anchored to `Hotel.timezone` (currently
> `Europe/Berlin` for all deployments), not a hardcoded constant; `OD-CAL-07` Regional-Manager
> cross-hotel edit scope resolved by adopting the existing `ADR-030`/`ADR-023` authorization model
> (hotel-group grain), independent of `OD-EMP-12`; `OD-CAL-10` the `/operations` stub removed,
> underlying occupancy/staffing-demand state left unassigned pending future Requirements Intake,
> Calendar's weekly-plan view established as a composite read model under `ADR-034`'s existing
> read-only allow-list; `OD-CAL-11` Calendar's auto-cancel responsibility ends at cancellation,
> re-broadcast policy deferred entirely to Job Dispatch/`GD-20`, not prohibited. `ADR-051`'s
> resolution was informed by a real-world weekly-planner ("Dienstplan") artifact the commissioning
> human supplied mid-decision, and surfaced two likely-missing requirements (arrivals count,
> staffing-demand target) flagged for a future Requirements Intake pass, not resolved by this
> workflow. Full record: `GOVERNANCE_DECISIONS_REQUIRED.md` GD-18 section; `ADR-049`–`ADR-052`.

> **Sync note (2026-07-28, cont'd 10):** `GD-19`'s first sub-decision (`OD-CHAT-002`, tool-execution
> scope) was decided — the chatbot is ratified as a first-class platform interface (dedicated chat
> page + floating widget) and an AI orchestration layer, not a business module: it owns conversation,
> intent recognition, clarification, tool selection, and response generation; every executable
> platform capability is a tool invoking an existing `IF-*` interface owned by another module, which
> retains all business rules, validation, authorization, state, persistence, and auditing. Tools are
> allow-listed via a tool-registry/plugin model, risk-tiered (read-only / low-risk write / high-risk
> write) with a corresponding confirmation policy. Full record: `ADR-053`. **Immediately after this
> ADR merged, the commissioning human explicitly deferred the remainder of `GD-19` to post-MVP** —
> `ADR-053` is retained in force, unweakened; every other `OD-CHAT-*` item's exact status, every
> dependency, and every preserved recommendation is recorded at
> `docs/implementation/GD-19_CHATBOT_CHECKPOINT.md` for zero-context-loss resumption. Verified
> isolated from all remaining MVP decisions (`GD-20`/`21`/`22`) — no dependency either direction.
> Actively-pursuable open count is now **3**: `GD-20/21/22`.
>
> **Synchronization note (2026-07-28, later the same day):** all three were subsequently resolved.
> `GD-20` → `ADR-054` through `ADR-058` (5 sub-decisions). `GD-21` → `ADR-059` (sole sub-decision;
> two further items closed as consistency corrections, not governance forks). `GD-22` → resolved by
> disposition, no new architecture (`ADR-023` had already settled Hotel-Group billing ownership; no
> new ADR authored). Actively-pursuable open count across the full `GD-01..23` numbering is now
> **zero**, outside `GD-19`'s deferred remainder and two named residual items (`OD-HR-02b`, `GD-03`'s
> org-chart half) — see `docs/implementation/GOVERNANCE_REGISTER.md` for the current canonical status.

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
  sick/vacation counts remain explicitly deferred (`GD-04`'s tiers, `GD-18`'s Calendar — `GD-18`
  now Decided 2026-07-28, see below; the metric itself remains deferred on implementation, not
  governance ambiguity).
- `GD-18` (Calendar) — **narrow slice built 2026-07-27; `GD-18` itself Decided 2026-07-28
  (`ADR-049`–`ADR-052`, see Sync note below).** At the time of this narrow slice, `GD-18` was still
  undecided as a formal product decision. Per the frozen `SPEC-CALENDAR-001`'s own text (its `ADR-021` boundary
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
| backend-hr | mounted, every method `NotImplementedError`; every individual requirement checked, none independently ready | `GD-15` **Decided 2026-07-28** (`ADR-039`–`ADR-048`, ten sub-decisions; see Sync note below) — no governance blocker remains for this module's own scoping. Remaining prerequisite: ownership assignment (`SYNC-001`) and ordinary G4/G2 gate progression. `GD-03`'s org-chart half (`OD-EMP-12`) remains separately open, not part of `GD-15`'s resolution. |
| backend-calendar: manager weekly-plan placement view (`REQ-CAL-T01`) | unbuilt (worker self-mark sick/vacation half already built, see Completed Work) | `GD-18` **Decided 2026-07-28** (`ADR-049`–`ADR-052`, see Sync note above) — no governance blocker remains; still gated on Phase-1 schema realignment (`WorkerAssignment.application_id` still mandatory) owned by `SPEC-JOB-DISPATCH-001`, and on ordinary implementation effort |
| backend-calendar: today-only availability read-model (`REQ-CAL-T06`) | unbuilt | `GD-18` **Decided 2026-07-28** — the governance-scope blocker this row previously flagged no longer applies; this item reads only already-existing tables and is not schema-blocked, so it may now be built without waiting on any further governance decision |
| backend-documents (Documents module, RBAC/storage) | **in progress (2026-07-27):** `WorkerDocument` model + migration landed; module built (`types.ts`, `validation.ts`, `storage.ts` (S3 stub, real client deferred — `@aws-sdk/client-s3` not yet a dependency), `service.ts`, `controller.ts`, `routes.ts`); mounted at `/v1/documents`. All five `IF-DOC-*` target interfaces implemented. No multipart/file-parsing middleware wired yet — uploads persist metadata with an empty byte buffer (same gap the migrated-from `backend-hr` stub had, `MIG-GAP-DOC-001`, itself still open and out of this session's scope). `MIG-GAP-DOC-001` (migrating `backend-hr`'s stub route to call into this module) not yet done. | **`GD-16` Decided 2026-07-27** (option (a): self-upload + manager-upload only, hotel-scoped read, presigned URLs, SSE-at-rest). No governance blocker remains. Gates HR's `REQ-HR-008/011` contract-scan upload and onboarding document collection (neither wired yet). |
| backend-chatbot | zero code, `.placeholder` only; every requirement checked, none independent | `GD-19` **⏸ DEFERRED — POST-MVP, 2026-07-28** (explicit commissioning-human decision, not an unresolved item). Sub-decision 1 (`OD-CHAT-002`) Decided → `ADR-053` (orchestration-layer/tool-registry architecture, retained in force). Remainder deferred; spec cannot reach G2 freeze until `GD-19` resumes post-MVP and its three standing blockers (`OD-CHAT-005/006/013`) are resolved. Full checkpoint: `docs/implementation/GD-19_CHATBOT_CHECKPOINT.md`. |
| backend-geo | zero code, `.placeholder` only; every requirement checked, none independent | `GD-14` (geofencing/location model) |
| backend-consent | zero code, no module directory | `GD-17` **Decided 2026-07-28** (`ADR-037`) — chatbot consent gate resolved (Option (b): decline routes to manual onboarding, does not block), fail-closed adopted, five smaller lifecycle/RBAC items resolved. No governance blocker remains; the module's own build is now a scoping/prioritization question, not an open architecture decision. |
| backend-compliance | zero code, no module directory | No dedicated `GD-*`; an audit finding (2026-07-27, not owner-confirmed) reads `IF-COMPLIANCE-GetAuditTrail` (read-only over the already-existing `AuditLog` table, boundary per `ADR-016`) as having no governance blocker — the rest of the module (subject-rights orchestration) is downstream of Consent/Retention/Documents |
| backend-retention | zero code, no module directory; every requirement checked, none independent | `GD-09`'s mapping half now **Decided** (`ADR-033`, see Sync note above); module build remains gated on `OD-RETENTION-05/10/11/14/15` (RBAC scope, cross-module delete authorization, sweep query design, owner assignment, fan-out workload) and, for legal certification only (non-blocking for the build itself), `OD-RETENTION-01` tax-advisor sign-off |
| Quality rating tiers/warnings/photo policy (deferred sub-decision, not built by `GD-04`'s fix) | undecided | separate future `GD-*` (not yet assigned) |
| ~~MFA~~ | ~~no data model or endpoint anywhere~~ | **`GD-08` Decided 2026-07-28 (`ADR-038`)** — explicitly deferred to a post-MVP hardening milestone; no mechanism selected. `TREQ-AUTH-006` remains confirmed, unimplemented, disclosed as deferred rather than a silent gap. |
| ~~Platform event-bus formalization~~ | ~~in-process singleton only~~ | **`GD-12` Decided 2026-07-28 (`ADR-032`)** — direct in-process calls for sync effects, existing Outbox (`ADR-029`) for async/durable; no event bus exists or is introduced. Struck through per this row's own resolution, not removed; individual HR/EMP/Calendar/Consent/CRM/Documents/Chatbot build gates are unaffected by this row and remain tracked in their own rows above. |
| ~~Optimistic-locking/concurrency pattern (attendance, CRM hotel update, quality aggregate)~~ | ~~unbuilt~~ | **`GD-10` Decided 2026-07-28 (`ADR-036`)** — optimistic concurrency adopted as the platform standard; attendance's `checkIn`/`update` race MUST be fixed, mechanism deferred to implementation. CRM hotel-update and quality-aggregate items were verified already resolved by `ADR-030`/`GD-04` before this decision, not reopened. |
| ~~Performance SLO & workload baseline~~ | ~~undefined~~ | **`GD-11` Decided 2026-07-28 (`ADR-035`)** — platform baseline (~100 hotels/~5,000 workers/~300 concurrent users); p95 targets 150/400/800ms by query class; leaderboard pagination now a MUST; cross-module fan-out capped at 15 parallel queries. Per-endpoint conformance remains a G8 verification activity. |
| ~~Cross-module state-read boundary ratification (analytics reads 6+ state domains it doesn't own)~~ | ~~undocumented~~ | **`GD-13` Decided 2026-07-28 (`ADR-034`)** — direct read-only reads ratified as the platform standard for aggregators, subject to a three-point allow-list; a future read-model interface remains a named, unmet escalation trigger tied to `GD-11`'s SLO baseline. No code change. |
| ~~Job-Dispatch two-tier calendar+broadcast pivot~~ | ~~not started~~ | **`GD-20` Decided 2026-07-28 (`ADR-054`–`ADR-058`, 5 sub-decisions)** — two-tier target architecture ratified, marketplace confirmed as current (not legacy) implementation; implementation eligibility gated on `GD-03`, scheduling deferred to implementation planning. Struck through per this row's own resolution, not removed; the module itself remains unbuilt. |
| ~~Attendance auto-ABSENT/NO_SHOW automation~~ | ~~unbuilt~~ | **`GD-21` Decided 2026-07-28 (`ADR-059`)** — automated reminders + automatic ABSENT/NO_SHOW marking ratified as permanent target architecture, implementation timing deferred. Two consistency corrections (checker `getById` alignment, `AuditLog` `old_values`/`new_values`) applied directly, not treated as governance forks. Struck through per this row's own resolution; automation itself remains unbuilt. |
| ~~Hotel-Group billing model~~ | ~~undecided~~ | **`GD-22` Resolved by disposition 2026-07-28 — no new architecture.** `ADR-023` already settled ownership (`backend-crm`); no billing mechanics existed in CRR/PDD to decide, so none were invented. `billing_info` remains an opaque placeholder pending a concrete requirement. Struck through per this row's own resolution, not removed. |
| ~~Platform ADR ratification cleanup (ADR-001..009, ADR-019/020)~~ | ~~governance-record only, 0 code~~ | **`GD-23` Decided 2026-07-28** — `ADR-019`/`ADR-020` ratified Proposed → Accepted (Option (a): as-is); `VERSION.yaml` corrected in three places. ADR-001..009 verified already ratified 2026-07-15 — `SIR-GLOB-003` now RESOLVED, correcting this row's own prior stale framing. |

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
