# ADR-031 Production Rollout Checklist

**Status:** Open — no item below has been completed as of this writing.
**Owner decision (2026-07-27):** ADR-031's PR sequence (PR-1 through PR-8) may complete —
including PR-7's irreversible `User.permissions` column drop — once PR-1 through PR-6 are
implemented and gate-verified in the repository, **independent of whether a production
environment has ever run this code.** As of PR-7, this repository has no completed production
deployment (see Evidence below) — the "full-release soak" precondition ADR-031 §7 originally
attached to PR-7 is therefore **not a repository-implementation gate**. It is relocated here, as
an **operational rollout gate that must be satisfied before either feature flag below is ever set
to `true` in a real production environment**, whenever that environment first exists.

This file is the durable record of that relocation. It does not change ADR-031's technical
reasoning (D-1 through D-6, C-1 through C-7 remain the authoritative design) — it changes *where*
the "has this actually run in production long enough to trust it" precondition is tracked, since
tying it to a PR-merge gate was only ever a proxy for "this has been safely observed live," and
that proxy breaks in a repository with no live deployment.

## Evidence (as of 2026-07-27)

- `docs/legacy/infrastructure/AWS_DEPLOYMENT_EXECUTION_PLAN.md` (2026-06-20, first-party):
  "Guardrails honored: no AWS resources provisioned, no deployment performed."
- `docs/legacy/infrastructure/DEPLOYMENT_READINESS_REPORT.md` (2026-06-17, first-party):
  "Infrastructure provisioned: ❌ 0% (never deployed)."
- GitHub Deployments API: every sampled `production`-environment deployment run from
  2026-06-14 through 2026-07-26 (192 recorded attempts) resolved to `failure`, root cause
  `DATABASE_URL` resolving to an empty string at the migration step (`PROD_DATABASE_URL` and
  related secrets were never populated in GitHub). Zero `release/*` tags exist.
- No document postdating 2026-06-20 in `docs/` or `docs/05-execution/CHANGELOG.md` records a
  completed deployment.
- `scripts/deploy.sh` (a manual, SSH-based deploy path independent of GitHub Actions) exists and
  is not itself proven unused — but no record of its use appears anywhere in the repository.

## The two flags this checklist gates

| Flag | Introduced | Default | What flipping it on does |
|---|---|---|---|
| `FEATURE_DERIVED_PERMISSIONS` | ADR-031 PR-3 | `false` (and, per PR-7, retired from the codebase entirely — see note below) | Permissions become derived request-time from `ROLE_PERMISSIONS[user.role]` instead of the stored `User.permissions` snapshot. |
| `FEATURE_TOKEN_GENERATION_ENFORCEMENT` | ADR-031 PR-3 | `false` (retired at PR-7) | A `token_generation` mismatch or a claim-less token (post-PR-5) causes a 401 `TOKEN_REVOKED`. |

**Note:** PR-7 removes both flags from the codebase (they become the only behavior, not a toggle) once repository-implementation is complete. This checklist is therefore about the **first time
this code — with derivation and enforcement always-on, as PR-7 leaves it — runs against a real
production database and real user sessions**, not about a runtime flag flip. Re-read as: "the
first real production deployment of any commit at or after PR-7."

## Checklist — must all be satisfied before real users hit this code in production

- [ ] **RO-1** A real production environment exists and is reachable (infrastructure provisioned:
      EC2/RDS or equivalent, per `docs/legacy/infrastructure/AWS_DEPLOYMENT_EXECUTION_PLAN.md`'s
      plan or its successor).
- [ ] **RO-2** The deploy pipeline (automated via `.github/workflows/deploy-production.yml`, or the
      manual `scripts/deploy.sh` path) completes successfully at least once against that
      environment — i.e., a `release/*` tag exists, or an equivalent manual-deploy record is made.
- [ ] **RO-3** `token_generation` is verified live-readable on the production `User` table (M-1's
      migration has actually run there — `prisma migrate deploy` succeeded, not just validated).
- [x] **RO-4 — moot as of PR-7, not skipped.** M-2's reconciliation-report script
      (`npm run token-generation:reconciliation-report`) and its underlying source data
      (`User.permissions`) were both retired by PR-7's M-3 column drop — the script is deleted and
      there is no stored snapshot left to compare against `ROLE_PERMISSIONS`. This check is
      structurally unrunnable post-drop, not merely unperformed: by the time any real production
      deployment reaches this checklist, derivation is the only behavior the code has (no flag, no
      claim-honoring branch), so there is nothing for a "before you trust derivation" report to
      gate. **Security-review finding (PR-7):** confirmed no production deployment has ever existed
      for this repository (see Evidence above), so C-2's drift risk was never live against real
      data — it is closed by the column's removal, not bypassed. If a *future* ADR reintroduces a
      stored-then-derived transition (a different cutover, not this one), that ADR must define its
      own equivalent of this check; this row does not carry forward as a template to skip.
- [ ] **RO-5** PR-4a's client behavior (`TOKEN_REVOKED` handling, all three clients) is confirmed
      deployed to real users — app store / web release, not just merged to `main` — before any
      revocation-triggering event (role change, deactivation, password reset, admin revoke) can
      occur against a real account.
- [ ] **RO-6** The Platform Worker (PR-6's session sweep) is confirmed running as a live process in
      production (not just code-complete) before relying on `Session`/`PasswordResetToken` growth
      being bounded.
- [ ] **RO-7** A rollback plan for this specific deployment is written and reviewed (which commit
      to revert to, how to reverse `M-1` if ever needed, who has authority to pull the trigger) —
      distinct from the code-level "flags off reproduces prior behavior" reversibility ADR-031
      already provides, which stops applying once PR-7 removes the flags.
- [ ] **RO-8** Whoever owns the production environment has explicitly signed off that the above are
      complete, dated, and recorded in this file (replace this bullet with a signed entry).

## Sign-off log

_(empty — populate when RO-1 through RO-7 are satisfied and RO-8 is granted)_
