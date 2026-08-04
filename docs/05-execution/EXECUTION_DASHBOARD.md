# Execution Dashboard

| Field | Value |
|---|---|
| Purpose | The single operational status view: current milestone, per-module implementation state, completed vs. remaining modules, active work, upcoming work, and open blockers to that work |
| Out of scope | Production-release sign-off (see [RELEASE_STATUS.md](RELEASE_STATUS.md)) and ADR/governance-decision status (see [`GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md), [`DECISION_INDEX.md`](../../.claude/knowledge/DECISION_INDEX.md)) — this file links to both, never restates them |
| Per-module status source | [`.claude/knowledge/MODULE_REGISTRY.yaml`](../../.claude/knowledge/MODULE_REGISTRY.yaml) `implementation_status`/`lifecycle` fields — this table summarizes, it does not duplicate the registry's evidence/specification detail |
| Last verified | 2026-08-04 (Release Candidate documentation pass) — see "Currency note" below |

## Current Milestone

**MVP — Release Candidate.** Engineering implementation is complete. Production deployment
architecture has been reconciled with the repository (PM2 process topology, deploy script, deploy
pipeline all now agree with live production evidence — see
[`deploy/release/RELEASE_EXECUTION_PLAN.md`](../../deploy/release/RELEASE_EXECUTION_PLAN.md) §7).
What remains before full production rollout is operational, not engineering: push-credential
provisioning, UAT execution, release tagging, and rollout. See
[`deploy/release/RELEASE_SUMMARY.md`](../../deploy/release/RELEASE_SUMMARY.md) for the current
authoritative summary.

## Currency note (read before trusting anything below this line)

The detailed per-module table and historical governance narrative below this line were last
substantively verified 2026-08-01 and record a long, real history of decisions through that date.
During this pass, a spot-check against current code found **several rows in that table are now
factually wrong**:

- `backend-hr` was recorded as "mounted, every method `NotImplementedError`." As of this pass,
  `backend/src/modules/hr/service.ts` is ~900 lines with real, tested logic for contract
  lifecycle, document scan/confirm, and extend/lapse flows. Only its payslip-fulfillment
  sub-feature still carries a deferred-work comment in the file header.
- `backend-geo` was recorded as "unimplemented-stub, `.placeholder` only." As of this pass,
  `backend/src/modules/geo/` has real `service.ts`, `controller.ts`, `routes.ts`, and a
  retention-sweep job — no `.placeholder` file exists there.
- `backend-consent` was recorded as "no module directory, zero-code." As of this pass,
  `backend/src/modules/consent/` is fully implemented (`service.ts`, `controller.ts`,
  `routes.ts`, `types.ts`), and `docs/03-modules/consent/MODULE_SPEC.md` is `FROZEN`.
- `backend-compliance` was recorded as "no module directory, zero-code." As of this pass,
  `backend/src/modules/compliance/` is implemented (real orchestration logic over
  auth/consent/document services), though its spec remains `REVIEW`, not frozen.
- `backend-chatbot` is still accurately recorded — `.placeholder` only, zero code, spec `REVIEW`.
- The test-suite figures quoted at various points below (69/69, 71/71 suites) are stale. Current:
  **99/99 suites, 1698/1698 tests passing** (re-verified 2026-08-04).
- "Has this repository ever been deployed to production? No" (recorded via `RELEASE_STATUS.md`
  at the time) is now **No longer true** — see `RELEASE_STATUS.md`'s current entry.

**A full recomputation of the per-module table against `.claude/knowledge/MODULE_REGISTRY.yaml`
and current code was out of scope for this documentation-only pass** — it requires re-verifying
every module individually against the registry's schema, not a spot-check of the modules this
pass happened to touch. Until that recomputation happens, treat every row in the table below as
**unverified against current code** and confirm directly against
`backend/src/modules/<name>/service.ts` before making any decision that depends on a specific
module's real status. The historical governance narrative (Sync notes, `GD-*`/`ADR-*`
resolutions) is not affected by this caveat — those are decision records, not implementation-
status claims, and remain a reliable history of what was decided and when.

---

## Per-Module Implementation Status (unverified against current code — see Currency note above)

| Module | `lifecycle` | `implementation_status` (as last recorded 2026-08-01) | Spec |
|---|---|---|---|
| backend-auth | active | active | SPEC-AUTH-001@0.3.0 FROZEN |
| backend-users | active | active | SPEC-USERS-001@0.2.0 FROZEN |
| backend-crm | active | active | SPEC-CRM-001@0.2.1 FROZEN |
| backend-hotel-workers | removed | removed | RETIRED (ADR-022) |
| backend-work-requests / work-applications / assignments | active | active | SPEC-JOB-DISPATCH-001@0.3.2 FROZEN |
| backend-attendance | active | active | SPEC-ATT-001@0.2.0 FROZEN |
| backend-quality | active | active | SPEC-QUAL-001@0.2.0 FROZEN |
| backend-hr | active | **stale — see Currency note; mostly implemented, only payslip-fulfillment sub-feature deferred** | SPEC-EMP-001@0.2.0 FROZEN |
| employee-management | active | active | SPEC-EMP-001@0.2.0 FROZEN |
| backend-notifications | active | active | SPEC-NOTIF-001@0.3.0 FROZEN |
| backend-analytics | active | active | SPEC-ANALYTICS-001@0.2.1 FROZEN |
| backend-calendar | active | active-partial (`/operations` remains stub; worker self-mark sick/vacation real) | SPEC-CALENDAR-001@0.3.1 FROZEN |
| backend-chatbot | declared | unimplemented-stub (`.placeholder` only, not route-registered) — confirmed still accurate | SPEC-CHATBOT-001@0.1.3 REVIEW |
| backend-geo | active | **stale — see Currency note; fully implemented, not a placeholder** | SPEC-GEO-001 (status not re-checked this pass) |
| backend-consent | active | **stale — see Currency note; fully implemented** | SPEC-CONSENT-001 FROZEN |
| backend-compliance | active | **stale — see Currency note; implemented, spec still REVIEW** | SPEC-COMPLIANCE-001 REVIEW |
| backend-retention | active-partial | active-partial (confirmed still accurate this pass) | SPEC-RETENTION-001@0.2.0 REVIEW |
| frontend-web, mobile-worker, mobile-checker | active | active | UNKNOWN (no client spec) |
| operations (infra) | active | not-applicable | UNKNOWN |

## Remaining Modules & Work

Per the Currency note above, treat every status claim below as unverified against current code.

| Area | Last-recorded state | Blocked on |
|---|---|---|
| backend-hr payslip fulfillment | Deferred per in-code comment; rest of module implemented | Verify directly against `backend/src/modules/hr/service.ts` before treating as blocked — this pass found the module far more complete than previously recorded |
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
status that the registry already tracks; **verify directly against
`backend/src/modules/*/service.ts` for any module claimed as a stub or "zero-code" before
publishing an update** — this pass found that check had lapsed for at least three modules.
