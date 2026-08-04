# Execution Dashboard

| Field | Value |
|---|---|
| Purpose | The single operational status view: current milestone, per-module implementation state, completed vs. remaining modules, active work, upcoming work, and open blockers to that work |
| Out of scope | Production-release sign-off (see [RELEASE_STATUS.md](RELEASE_STATUS.md)) and ADR/governance-decision status (see [`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md), [`DECISION_INDEX.md`](../../.claude/knowledge/DECISION_INDEX.md)) — this file links to both, never restates them |
| Per-module status source | [`.claude/knowledge/MODULE_REGISTRY.yaml`](../../.claude/knowledge/MODULE_REGISTRY.yaml) `implementation_status`/`lifecycle` fields — this table summarizes, it does not duplicate the registry's evidence/specification detail |
| Last verified | 2026-08-04 (Release Candidate documentation pass); per-module table below spot-checked, not fully recomputed from the registry — see note under the table |

## Current Milestone

**MVP — Release Candidate.** Engineering implementation is complete. Deploy configuration
(`ecosystem.config.js`, `deploy.sh`, the deploy pipeline) has been rewritten to match what's
verified via live GitHub Actions deploy logs — see
[`deploy/release/RELEASE_SUMMARY.md`](../../deploy/release/RELEASE_SUMMARY.md) for exactly what's
confirmed vs. still-inferred, and
[`deploy/release/RELEASE_EXECUTION_PLAN.md`](../../deploy/release/RELEASE_EXECUTION_PLAN.md) §7
for detail. What remains before full production rollout is operational, not engineering:
push-credential provisioning, UAT execution, release tagging, and rollout.

## Per-Module Implementation Status

| Module | `lifecycle` | `implementation_status` | Spec |
|---|---|---|---|
| backend-auth | active | active | SPEC-AUTH-001@0.3.0 FROZEN |
| backend-users | active | active | SPEC-USERS-001@0.2.0 FROZEN |
| backend-crm | active | active | SPEC-CRM-001@0.2.1 FROZEN |
| backend-hotel-workers | removed | removed | RETIRED (ADR-022) |
| backend-work-requests / work-applications / assignments | active | active | SPEC-JOB-DISPATCH-001@0.3.2 FROZEN |
| backend-attendance | active | active | SPEC-ATT-001@0.2.0 FROZEN |
| backend-quality | active | active | SPEC-QUAL-001@0.2.0 FROZEN |
| backend-hr | active | mostly implemented, payslip-fulfillment sub-feature deferred | SPEC-EMP-001@0.2.0 FROZEN |
| employee-management | active | active | SPEC-EMP-001@0.2.0 FROZEN |
| backend-notifications | active | active | SPEC-NOTIF-001@0.3.0 FROZEN |
| backend-analytics | active | active | SPEC-ANALYTICS-001@0.2.1 FROZEN |
| backend-calendar | active | active-partial (`/operations` remains stub; worker self-mark sick/vacation real) | SPEC-CALENDAR-001@0.3.1 FROZEN |
| backend-chatbot | declared | unimplemented-stub (`.placeholder` only, not route-registered) | SPEC-CHATBOT-001@0.1.3 REVIEW |
| backend-geo | active | fully implemented | SPEC-GEO-001 (status not re-checked this pass) |
| backend-consent | active | fully implemented | SPEC-CONSENT-001 FROZEN |
| backend-compliance | active | implemented | SPEC-COMPLIANCE-001 REVIEW |
| backend-retention | active-partial | active-partial | SPEC-RETENTION-001@0.2.0 REVIEW |
| frontend-web, mobile-worker, mobile-checker | active | active | UNKNOWN (no client spec) |
| operations (infra) | active | not-applicable | UNKNOWN |

Rows above marked "fully implemented"/"implemented" (geo, consent, compliance) and "mostly
implemented" (hr) were spot-checked directly against `backend/src/modules/<name>/service.ts`
during the 2026-08-04 pass — the prior table entries for these four rows were factually wrong at
the time (recorded as zero-code/placeholder) and have been corrected here. This was a targeted
correction, not a full re-derivation from `.claude/knowledge/MODULE_REGISTRY.yaml`; verify
directly against the service file for any module whose real status matters to a decision.

## Remaining Modules & Work

| Area | Last-recorded state | Blocked on |
|---|---|---|
| backend-hr payslip fulfillment | Deferred per in-code comment; rest of module implemented | None — implementation-effort gap only |
| backend-calendar: manager weekly-plan placement view (`REQ-CAL-T01`) | unbuilt | No governance blocker (`GD-18` decided); implementation-effort gap only |
| backend-chatbot | zero code, `.placeholder` only | `GD-19` deferred to post-MVP by explicit decision, not an unresolved item |
| backend-compliance: governance report interface | Not built | `OD-COMPLIANCE-006` (RBAC scope for an Admin/DPO caller class) — the rest of the compliance module is implemented |

Full historical governance narrative (every `GD-*`/`ADR-*` decision through 2026-07-29,
including the Authorization Foundation milestone, retention-module build, and the capability-
level readiness audit) is preserved in git history for this file and in
[`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md) — not
restated here to keep this dashboard readable as a current-state view rather than an archive.

## Blockers to Active Work

| ID | Blocks | Description | Resolution owner |
|---|---|---|---|
| SYNC-001 | Every module/contract/state-domain ownership assignment | No CODEOWNERS file exists; every module `owner: unassigned` in the registry | Human (reserved authority) |
| — | `FEATURE_RM_ROLE` production enablement | `backend/src/scripts/run-regional-manager-promotion.ts` has no demote path — a one-way operation once run | Human risk decision (see `deploy/release/RELEASE_EXECUTION_PLAN.md` §2) |

## Update Protocol

Update this file as an exit condition of the Implementation and Post-flight workflows whenever a
module's `implementation_status` changes, a milestone closes, or a blocker resolves. Recompute
the per-module table from `.claude/knowledge/MODULE_REGISTRY.yaml` rather than hand-editing
status that the registry already tracks; verify directly against
`backend/src/modules/*/service.ts` for any module claimed as a stub or "zero-code" before
publishing an update.
