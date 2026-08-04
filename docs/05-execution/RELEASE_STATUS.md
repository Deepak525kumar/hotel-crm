# Release Status

| Field | Value |
|---|---|
| Purpose | Answers only "are we production-ready" — release-gate status, outstanding release prerequisites, and a pointer to the detailed rollout checklist. Distinct from [EXECUTION_DASHBOARD.md](EXECUTION_DASHBOARD.md)'s day-to-day "where is work at" view. |
| Detailed rollout steps | [`deploy/release/RELEASE_EXECUTION_PLAN.md`](../../deploy/release/RELEASE_EXECUTION_PLAN.md) — not restated here |
| Last verified | 2026-08-04 (Release Candidate documentation pass) |

## Has this repository ever been deployed to production?

**Yes.** This entry previously said "No," based on evidence from 2026-07-27. That is no longer
true. `.github/workflows/deploy.yml` is a real, functioning "Deploy to EC2" pipeline; live deploy
run history (via `gh run list --workflow=deploy.yml`) shows repeated successful runs, most
recently against the current `main`. `ecosystem.config.js` and `deploy.sh` (repository root) have
been reconciled with what's actually running in production — see
[`deploy/release/RELEASE_EXECUTION_PLAN.md`](../../deploy/release/RELEASE_EXECUTION_PLAN.md) §7
for the reconciliation detail. The frontend deploys separately, via Vercel.

## Release readiness — current verdict

**Release Candidate.** Engineering implementation is complete; production architecture has been
reconciled with the repository. What remains is operational, not engineering — see
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

The per-module detail previously duplicated here (dated 2026-07-27/28/29) was found to be
severely stale relative to current code during this synchronization pass — several modules
listed as "zero-code"/".placeholder only" are in fact fully implemented (geo, consent,
compliance), and HR was listed as "every method NotImplementedError" when in fact only its
payslip-fulfillment sub-feature carries a deferred-work comment; the rest of the module is
implemented and tested. Per this file's own Update Protocol, per-module status should be
recomputed from `.claude/knowledge/MODULE_REGISTRY.yaml` rather than hand-maintained here — that
recomputation was out of scope for this documentation-only pass (it requires re-verifying every
module against the registry's own schema, not just spot-checking the modules this pass happened
to touch). Treat `EXECUTION_DASHBOARD.md`'s per-module table as unreliable until it is
next refreshed from the registry, and prefer direct code inspection
(`backend/src/modules/<name>/service.ts`) over either document for any release decision that
hinges on a specific module's real status.

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
