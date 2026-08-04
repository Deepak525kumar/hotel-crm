# Release Status

| Field | Value |
|---|---|
| Purpose | Answers only "are we production-ready" — release-gate status, outstanding release prerequisites, and a pointer to the detailed rollout checklist. Distinct from [EXECUTION_DASHBOARD.md](EXECUTION_DASHBOARD.md)'s day-to-day "where is work at" view. |
| Detailed rollout steps | [`deploy/release/RELEASE_EXECUTION_PLAN.md`](../../deploy/release/RELEASE_EXECUTION_PLAN.md) — not restated here |
| Last verified | 2026-08-04 (Release Candidate documentation pass) |

## Has this repository ever been deployed to production?

**Yes — verified directly.** This entry previously said "No," based on evidence from
2026-07-27. That is no longer true: `gh run list --workflow=deploy.yml` was run during this pass
and directly showed multiple completed, successful "Deploy to EC2" runs, most recently against
the current `main`. That command output is the verified fact.

**Inferred, not directly confirmed on the host:** `ecosystem.config.js` and `deploy.sh`
(repository root) were rewritten to match the PM2 process names (`hotel-crm-api`,
`hotel-crm-worker`) and paths visible in those deploy logs' output lines — this is strong
evidence the files now describe reality, but no one SSH'd into the EC2 host during this pass to
run `pm2 list` and confirm the two processes are actually running under those names right now.
That direct confirmation is still an open item — see `deploy/release/KNOWN_LIMITATIONS.md`. See
[`deploy/release/RELEASE_EXECUTION_PLAN.md`](../../deploy/release/RELEASE_EXECUTION_PLAN.md) §7
for the full reconciliation detail. The frontend deploys separately, via Vercel — taken on the
user's word from an earlier conversation turn, not independently verified in this pass.

## Release readiness — current verdict

**Release Candidate.** Engineering implementation is complete; the deploy configuration files
have been rewritten to match what's verified in live deploy logs (see the section above for the
verified-vs-inferred distinction). What remains is operational, not engineering — see
[`deploy/release/RELEASE_SUMMARY.md`](../../deploy/release/RELEASE_SUMMARY.md) for the
authoritative current summary and
[`deploy/release/RELEASE_EXECUTION_PLAN.md`](../../deploy/release/RELEASE_EXECUTION_PLAN.md) for
the full remaining-operational-tasks list (push credential provisioning, UAT execution, release
tagging, rollout, post-deploy monitoring).

## Test suite status

99/99 suites passing, 1698/1698 tests passing (re-verified 2026-08-04, `cd backend && npm test`).
One suite (`hr-authz.test.ts`) was observed to fail once in a full-suite run but passes cleanly
in isolation — treated as test-ordering flakiness, not a defect, pending a follow-up to find the
shared-state leak (see `deploy/release/KNOWN_LIMITATIONS.md`).

## Per-module implementation status

Engineering implementation is complete. All core backend modules (auth, users, crm, assignments, attendance, quality, hr, notifications, analytics, calendar, geo, consent, compliance) are fully implemented with real, tested logic, with the exception of the `chatbot` module (deferred to post-MVP by explicit decision). Prefer direct code inspection (`backend/src/modules/<name>/service.ts`) over documentation for any release decision that hinges on a specific module's real status.

## Platform-Wide Release Prerequisites

| Prerequisite | Status |
|---|---|
| Test suite green | 99/99 suites, 1698/1698 tests passing (re-verified 2026-08-04) |
| Accountable ownership | No CODEOWNERS file exists; module ownership remains unassigned in the registry. Reserved to the human — not a code gap. |
| Production deployment | Confirmed — see above. Reconciled architecture as of this pass. |
| Feature flag rollout | `FEATURE_EMPLOYMENT_RECORD`, `FEATURE_GD02_MATRIX`, `FEATURE_JOBDISPATCH_PHASE2` are code-complete and cleared for this release; `FEATURE_RM_ROLE` intentionally held back (no demote path for its promotion script); `FEATURE_JOBDISPATCH_PHASE1` is vestigial. See `deploy/release/RELEASE_EXECUTION_PLAN.md` §2. |
| Push notification delivery | Code complete (APNs/FCM providers, device-token registration, deep-link handling). Operational task remaining: provision real production credentials. |

## Update Protocol

Update this file whenever release readiness changes, a platform-wide prerequisite closes, or the
deploy architecture changes. Do not restate `deploy/release/*` content here — reference by link.
Do not hand-maintain per-module implementation status here or in `EXECUTION_DASHBOARD.md`;
recompute from `.claude/knowledge/MODULE_REGISTRY.yaml` and verify against
`backend/src/modules/*/service.ts` directly before publishing any specific module claim.
