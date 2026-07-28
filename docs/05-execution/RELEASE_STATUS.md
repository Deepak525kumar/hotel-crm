# Release Status

| Field | Value |
|---|---|
| Purpose | Answers only "are we production-ready" — G8 release-gate status per phase/module, outstanding release prerequisites, and a pointer to the detailed rollout checklist. Distinct from [EXECUTION_DASHBOARD.md](EXECUTION_DASHBOARD.md)'s day-to-day "where is work at" view: release readiness has its own gate criteria and its own (less frequent, higher-stakes) update cadence. |
| Detailed rollout steps | [`docs/implementation/ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md`](../implementation/ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md) — not restated here |
| Last verified | 2026-07-27 |

## Has this repository ever been deployed to production?

**No.** Per `ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md`'s own evidence (as of 2026-07-27): no AWS
resources have ever been provisioned, no completed deployment is recorded in any document
postdating 2026-06-20, and every sampled `production`-environment deployment run in GitHub's
Deployments API from 2026-06-14 through 2026-07-26 (192 recorded attempts) resolved to `failure`
(root cause: `DATABASE_URL` resolving empty — production secrets were never populated). Zero
`release/*` tags exist. Full evidence detail lives only in that checklist file.

## G8 Release-Gate Status

G8 (release readiness) is a per-module gate reviewed independently of G2 (specification freeze).
A module being `FROZEN` at G2 does **not** imply it has cleared G8 — every frozen module below
still carries open G8 prerequisites.

| Module | Spec freeze (G2) | Open G8 / release prerequisites |
|---|---|---|
| backend-auth | FROZEN @0.3.0 | `ADR-031` closed the session/token-revocation and rate-limiting prerequisites (`GD-07`). `SIR-AUTH-017` (password-reset timing side-channel) and per-account rate-limiting remain explicitly open and out of `ADR-031`'s scope. MFA (`GD-08`) undecided — no data model or endpoint exists. |
| backend-users | FROZEN @0.2.0 | `OQ-USERS-01/02/05/06`, `SIR-USERS-005` (Medium), owner assignment (`SYNC-001`) |
| backend-crm | FROZEN @0.2.1 | Owner assignment (`SYNC-001`); hotel/hotel-group writes now Admin-only per `ADR-030` |
| backend-work-requests / work-applications / assignments | FROZEN @0.3.2 | Owner assignment (`SYNC-001`) |
| backend-attendance | FROZEN @0.2.2 | Cross-tenant hotel-scoping (`OQ-02`, High, tracked `SYNC-019`); optimistic-locking mechanism pending implementation (`GD-10`/`ADR-036` decided the standard, concrete mechanism deferred); auto-ABSENT/NO_SHOW automation architecture ratified (`GD-21`/`ADR-059`), implementation itself still pending |
| backend-quality | FROZEN @0.2.0 | Dual-writer aggregate correctness bug resolved (`GD-04`, `SIR-QUAL-005`, 2026-07-27); `OQ-01..09` and owner assignment remain G8 items |
| backend-hr (SPEC-EMP-001 mapping) | FROZEN @0.2.0 | No dedicated test file (`active-no-tests`); special-category access/audit controls unbuilt but disclosed; boundary conflict with a second, non-frozen `SPEC-HR-001` targeting the same code path is disclosed, not resolved |
| employee-management | FROZEN @0.2.0 | Owner assignment; provisional perf budget (`OD-EMP-16`) |
| backend-notifications | FROZEN @0.3.0 | `OQ-NOTIF-02/-03/-05`, owner assignment |
| backend-analytics | FROZEN @0.2.1 | Medium `OQ-ANALYTICS-11` (cross-module-read boundary, tracks to `GD-13`) and Low `OQ-ANALYTICS-12`; worker-facing analytics 403 resolved (`GD-06`, `SIR-ANLY-002`, 2026-07-27) |
| backend-calendar | FROZEN @0.3.1 | `active-partial` (2026-07-27): worker self-mark sick/vacation built (`GD-18` narrow slice); manager weekly-plan placement view + availability read-model remain unbuilt, blocked on `GD-18`'s remaining scope + Phase-1 schema realignment (`SPEC-JOB-DISPATCH-001`) |
| backend-chatbot | REVIEW (not FROZEN) | Cannot reach G2 until `GD-19` decided; zero code |
| backend-geo | REVIEW (not FROZEN) | Cannot reach G2 until `GD-14` decided; zero code |
| backend-consent / compliance / retention | REVIEW (not FROZEN) | Zero code footprint; blocked on `GD-17`, `GD-09` respectively |

Full per-finding detail (Critical/High/Medium/Low), evidence citations, and G4 review outcomes for
every row above live only in `.claude/knowledge/MODULE_REGISTRY.yaml` and
`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` — not restated here.

## Platform-Wide Release Prerequisites

| Prerequisite | Status |
|---|---|
| Test suite green | 69/69 suites, 1071/1071 tests passing; `tsc --noEmit` clean (independently re-verified 2026-07-27) |
| Accountable ownership (`SYNC-001`) | Fully unassigned repository-wide — no CODEOWNERS file, `backend/package.json` author empty. Hard release-accountability gate reserved to the human. |
| MFA (`GD-08`) | No data model or endpoint anywhere; undecided |
| Performance SLO & workload baseline (`GD-11`) | Undefined; blocks G8 for multiple modules until the human supplies workload assumptions |
| Platform ADR ratification (`GD-23`) | `ADR-001..009`, `ADR-019/020` still `Proposed`; governance-record cleanup only, 0 code |
| Production deployment | Never completed — see "Has this repository ever been deployed" above |

## Feature-Flag / Rollout Gate (ADR-031)

`ADR-031` introduced two feature flags (`FEATURE_DERIVED_PERMISSIONS`,
`FEATURE_TOKEN_GENERATION_ENFORCEMENT`) that are code-complete and retired from the codebase as of
PR-7, but the checklist's operational rollout gate — the conditions that must hold before either
flag is ever flipped `true` in a **real** production environment — has not been exercised because
no such environment exists yet. Full checklist, evidence, and sign-off log:
[`ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md`](../implementation/ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md).

## Update Protocol

Update this file only when a module's G8 status changes, a platform-wide release prerequisite
closes, or the rollout checklist's status changes. Do not restate `GOVERNANCE_DECISIONS_REQUIRED.md`,
`MODULE_REGISTRY.yaml`, or `ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md` content here — reference by ID
or link.
