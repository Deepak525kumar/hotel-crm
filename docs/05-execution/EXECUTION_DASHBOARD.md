# Execution Dashboard

| Field | Value |
|---|---|
| Purpose | The single operational status view: current milestone, per-module implementation state, completed vs. remaining modules, active work, upcoming work, and open blockers to that work |
| Out of scope | Production-release sign-off (see [RELEASE_STATUS.md](RELEASE_STATUS.md)) and ADR/governance-decision status (see [`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md), [`DECISION_INDEX.md`](../../.claude/knowledge/DECISION_INDEX.md)) — this file links to both, never restates them |
| Per-module status source | [`.claude/knowledge/MODULE_REGISTRY.yaml`](../../.claude/knowledge/MODULE_REGISTRY.yaml) `implementation_status`/`lifecycle` fields — this table summarizes, it does not duplicate the registry's evidence/specification detail |
| Last verified | 2026-07-27 (module implementation status independently re-checked against `backend/src/modules/*/service.ts`; test suite re-run: 67/67 suites, 1033/1033 tests passing; `tsc --noEmit` clean) |

## Current Milestone

**Authorization Foundation — COMPLETE (2026-07-27).** `ADR-030` (Manager Write-Authority Capability
Model) and `ADR-031` (Request-Time Permission Derivation, Token-Generation Revocation, Auth
Rate-Limiting) are both Accepted and fully built (PR-1..PR-8 each, merged 2026-07-25 through
2026-07-27). Full delivery record: [`MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md`](../implementation/MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md)
(linked, not restated). This closed the `GD-02`, `GD-03` (permission-set half), and `GD-07` rows in
[`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md).

**Next milestone (in progress): "MVP Completion Decisions."** `GD-04`, `GD-05`, and `GD-06` are all
Decided. `GD-04` (quality rating single-writer fix) and `GD-05` (per-hotel "pause new jobs" toggle)
are built and merged (2026-07-27; PR #237/#238 for `GD-04`; `GD-05`'s PR pending review). `GD-06`
(worker-facing analytics endpoint) remains Decided but unbuilt. See the Blockers table below for
what each still blocks; full options/impact detail lives only in
[`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md).

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
| backend-analytics | active | active | SPEC-ANALYTICS-001@0.2.0 FROZEN |
| backend-calendar | active | stub (route-registered; every `CalendarService` method throws `NotImplementedError`) | SPEC-CALENDAR-001@0.3.0 FROZEN |
| backend-chatbot | declared | unimplemented-stub (`.placeholder` only, not route-registered) | SPEC-CHATBOT-001@0.1.3 REVIEW |
| backend-geo | declared | unimplemented-stub (`.placeholder` only, not route-registered) | SPEC-GEO-001@0.1.1 REVIEW |
| backend-consent | no module directory | zero-code | SPEC-CONSENT-001@0.1.1 REVIEW |
| backend-compliance | no module directory | zero-code | SPEC-COMPLIANCE-001@0.1.0 REVIEW |
| backend-retention | no module directory | zero-code | SPEC-RETENTION-001@0.2.0 REVIEW |
| frontend-web, mobile-worker, mobile-checker | active | active | UNKNOWN (no client spec) |
| operations (infra) | active | not-applicable | UNKNOWN |

**Independently re-verified 2026-07-27:** `backend/src/modules/hr/service.ts` and
`backend/src/modules/calendar/service.ts` both still throw `NotImplementedError` from every
service method; `backend/src/modules/chatbot/` and `backend/src/modules/geo/` contain only
`.placeholder`, no route mount.

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
- `GD-05` Per-hotel "pause new jobs" toggle — Decided and built (2026-07-27): `Hotel.accepting_jobs`
  boolean (default `true`), set via `PATCH /hotels/:hotel_id`, enforced in
  `work-requests/service.ts` `create()`. `SIR-CRM-004`/`SIR-CRM-016` resolved; `SPEC-CRM-001`
  amended to @0.2.1, `SPEC-JOB-DISPATCH-001` to @0.3.2 (reciprocal cross-module acknowledgment).
  Frontend hotel-admin toggle UI not yet built (out of scope for this PR).

Full narrative and PR-by-PR delivery evidence for all of the above:
[`MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md`](../implementation/MILESTONE_AUTHORIZATION_FOUNDATION_COMPLETE.md).
Decision rationale and options considered: [`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md).

## Remaining Modules & Work

Everything below is blocked on a specific, named `GD-*` owner decision — no module is currently
blocked by missing code review, dependency conflict, or infrastructure gap. Decision detail for
every `GD-*` ID lives only in
[`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md).

| Area | State | Blocked on |
|---|---|---|
| backend-hr | mounted, every method `NotImplementedError` | `GD-15` (HR/EMP build scope), which itself depends on `GD-03`'s open org-chart half, `GD-09`, `GD-16`, `GD-12` |
| backend-calendar | mounted, every method `NotImplementedError` | `GD-18` (Calendar module scope), depends on `GD-01` (done) / `GD-03` (role part done, RM edit scope `OD-CAL-07` build pending) / `GD-12` |
| backend-chatbot | zero code, `.placeholder` only | `GD-19` (chatbot scope & LLM safety) — spec cannot reach G2 freeze until decided |
| backend-geo | zero code, `.placeholder` only | `GD-14` (geofencing/location model) |
| backend-consent, backend-compliance, backend-retention | zero code, no module directory | `GD-17` (consent), `GD-09` (retention, external tax-advisor sign-off), compliance is read-only downstream of both |
| Quality rating tiers/warnings/photo policy (deferred sub-decision, not built by `GD-04`'s fix) | undecided | separate future `GD-*` (not yet assigned) |
| Worker-facing analytics endpoint | see Blockers below | `GD-06` |
| MFA | no data model or endpoint anywhere | `GD-08` |
| Platform event-bus formalization | in-process singleton only | `GD-12` (zero-code decision, gates HR/EMP/Calendar/Consent event contracts) |
| GDPR retention-tier assignment + Retention module | unbuilt | `GD-09` (external sign-off, long lead time) |
| Optimistic-locking/concurrency pattern (attendance, CRM hotel update, quality aggregate) | unbuilt | `GD-10` |
| Performance SLO & workload baseline | undefined | `GD-11` (unblocks G8 for multiple modules) |
| Cross-module state-read boundary ratification (analytics reads 6+ state domains it doesn't own) | undocumented | `GD-13` |
| Documents module (RBAC/storage) | zero code | `GD-16` (gates HR contract-scan upload and onboarding) |
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
| GD-06 | Worker-facing analytics scope | mobile-worker calls admin/manager-only `/analytics/stats`, always 403 | Human (Product Owner) — Decided, not yet built |

Governance-decision (`GD-*`) status in full, including options and ROI ranking, is tracked
exclusively in [`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md) —
not duplicated here beyond the summary above.

## Update Protocol

Update this file as an exit condition of the Implementation and Post-flight workflows whenever a
module's `implementation_status` changes, a milestone closes, or a blocker resolves. Recompute the
per-module table from `.claude/knowledge/MODULE_REGISTRY.yaml` rather than hand-editing status
that the registry already tracks; verify against `backend/src/modules/*/service.ts` for any module
claimed as a stub before publishing an update.
