# Hotel CRM — MVP Handoff

Last updated: 2026-08-04 (Release Candidate synchronization pass)
Current status: **Release Candidate.** Engineering implementation is complete. Production
architecture (PM2 process topology, deploy script, deploy pipeline) has been reconciled with
this repository. What remains is operational: provisioning real push-notification credentials,
running UAT, and performing the production rollout. See `deploy/release/RELEASE_SUMMARY.md` for
the authoritative current-state summary, and `deploy/release/` generally for the full release
package.

This file previously accumulated several rounds of same-day self-correction as stale claims were
found and fixed. Those corrections have now been folded into one clean statement below — the
history is preserved in git, not in this file's prose.

---

## What's done

All MVP features are implemented, merged to `main`, and verified:

- **Employee Management / Employment Record** — admin onboarding flow, lifecycle transitions
  (INACTIVE → UNDER_REVIEW → ACTIVE), employment profiles, skills, hotel blocklists.
- **Worker mobile app** — Documents (upload + view), Consent, HR self-service (contract view,
  payslip requests), shift/attendance, absence requests, dashboard stats, push-notification
  registration and receipt.
- **Checker mobile app** — attendance verification, quality ratings, worker ratings,
  cross-hotel leaderboard.
- **Manager/admin web app** — hotel and hotel-group management, HR contracts/payroll, job
  dispatch (broadcast offers, calendar direct-assignments), geo check-in review, analytics
  dashboards, user/role management.
- **Password reset** — transactional token generation + outbox enqueue, web UI, mobile
  delegates to the web flow via in-app browser.
- **Split permission matrix** — permissions derived at request time from role; the legacy
  stored `User.permissions` column has been dropped.

No dual/conflicting worker-eligibility model exists — `EmploymentRecord`/`EmploymentStatus` is
the single model used consistently across assignments, HR, and attendance.

## Production architecture — reconciled

A prior pass through this repository found a real mismatch between the committed
`ecosystem.config.js` (which declared three PM2 processes) and what live production deploy logs
proved was actually running (one process, under a different name). That mismatch has since been
resolved directly in the repository:

- `ecosystem.config.js` now declares exactly two PM2 processes — `hotel-crm-api`
  (`backend/dist/server.js`, port 3001) and `hotel-crm-worker` (`backend/dist/worker.js`, the
  outbox-drain worker, no HTTP port) — both with `cwd: /home/ubuntu/apps/hotel-crm` and
  `node_args: '--env-file=./backend/.env'`.
- `deploy.sh` lives at the repository root (the previous `scripts/deploy.sh` was removed as
  redundant) and reloads by ecosystem file: `pm2 reload ecosystem.config.js --env production
  --update-env`, so both processes are reloaded together on every deploy.
- `.github/workflows/deploy.yml`'s path filter and SSH commands correctly reference the root
  `deploy.sh`, and its post-deploy check hits `/api/v1/health/ready` (verifies DB connectivity,
  not just process liveness).

**Three smaller artifacts were not part of this reconciliation and remain genuinely stale —
flagged here as known limitations, not fixed, since fixing them requires a decision this document
can't make on its own:**
- `scripts/rotate-secrets.sh` still edits `/etc/hotel-crm/.env` and reloads only `hotel-crm-api`.
  The running process actually loads env from `backend/.env` (relative to `cwd`), so this
  script's edits would not reach the live process, and it would also leave `hotel-crm-worker`
  running on stale secrets. Treat this script as non-functional until it's updated to match.
- `nginx/hotelcrm.conf` still has a full server block proxying `hotelcrm.app`/`www.hotelcrm.app`
  to `127.0.0.1:3000` — but nothing in `ecosystem.config.js` or `deploy.sh` runs anything on port
  3000. The frontend (`frontend/`, Next.js) is deployed separately, on Vercel, not via this
  EC2/PM2/Nginx stack. This nginx block is vestigial and should either be removed or explicitly
  annotated as dead configuration in a future pass — it currently has no corresponding process.
- `scripts/setup-ec2.sh` (new-host provisioning) still provisions `/opt/hotel-crm` under a
  `deploy` user with secrets at `/etc/hotel-crm/.env` — none of which matches the reconciled
  `deploy.sh`/`ecosystem.config.js`. Only matters if a new host is ever provisioned from this
  script; the existing running host is unaffected.

## What's left before production

**Operational only — no engineering work remains.** See the dedicated
"Remaining Operational Tasks Before Production" section in `deploy/release/RELEASE_SUMMARY.md`
for the full list (push credential provisioning, UAT execution, release tagging, rollout,
post-deploy monitoring).

`FEATURE_RM_ROLE` stays off this release: the Regional Manager role is fully built server- and
client-side (frontend and both mobile apps already handle `regional_manager` correctly), but its
promotion script (`backend/src/scripts/run-regional-manager-promotion.ts`) has no corresponding
demote path — a promoted account cannot be cleanly reverted by disabling the flag alone. Holding
this flag is a risk decision, not a missing-feature gap.

## Established mobile-app conventions (apply to any future mobile work)

- **No shared state-management library** — every screen manages its own `useState`/`useCallback`
  load/error/pending cycle locally. Deliberate, confirmed working across every mobile feature
  built so far.
- **No component library** beyond `ThemedText`/`ThemedView`/`Spacing` — forms use plain
  `Pressable`/`TextInput` styled via `StyleSheet.create()`. No `Select`/`Checkbox`/`Modal`/`Badge`
  exists on mobile (unlike web, which has a full `components/ui` kit).
- **No semantic theme colors** — status colors (success/error/warning) are hardcoded hex
  literals colocated with the component that renders them, never centralized.
- **Navigation pattern** — worker self-service features are stack screens
  (`mobile/worker-app/src/app/<feature>.tsx`), reached via a link row on
  `(app)/profile.tsx`, not new tabs.
- **Test conventions** — mobile Jest config (`testEnvironment: 'node'`) cannot import real Expo
  native modules. Pure logic that needs testing must live in a file with zero native-module
  imports.
- **Known, tolerated lint baseline** — a fixed set of `react-hooks/set-state-in-effect` warnings
  exist in both mobile apps (traced to a foundational commit, not a regression) and are **not**
  gated by CI — the mobile CI job runs typecheck and tests only, no lint step.

## Boundaries / operating rules for whoever picks this up

- **Never push or open a PR without confirming with the user first.**
- **Never merge your own PR.** The user merges after reviewing.
- **Don't silently fix bugs found outside your current work's scope** — flag and document
  instead of drifting.
- **Don't invent new architectural patterns without evidence there's no existing one to
  follow** — grep the actual codebase for precedent first.
- **When investigation surfaces a backend gap, stop and produce an evidence package** — do not
  invent an endpoint or silently work around it client-side.
- **This repo's `.claude/CLAUDE.md`-defined "AI Engineering Platform Bootloader"** references
  `constitution/`, `workflows/`, `agents/`, `knowledge/`, `governance/`, `VERSION.yaml` at the
  repository root. Most of these do not exist at the root — but a real, populated knowledge and
  governance layer does exist under `.claude/knowledge/` and `.claude/governance/`
  (`MODULE_REGISTRY.yaml`, `SPECIFICATION_ISSUES_REGISTER.md`, and others). Check `.claude/`
  before concluding the framework is purely aspirational — parts of it are real and current,
  parts of it point nowhere.

## Quick reference: where things are

| What | Where |
|---|---|
| Backend HR module | `backend/src/modules/hr/{routes,controller,service,types}.ts` |
| Backend Documents module | `backend/src/modules/documents/{routes,controller,service,types,upload-policy,validation}.ts` |
| Backend Consent module | `backend/src/modules/consent/{routes,controller,service,types}.ts` |
| Backend Employee Management module | `backend/src/modules/employee-management/{routes,controller,service,types}.ts` |
| Web HR components | `frontend/components/hr/{ContractCard,PayslipRequestsCard}.tsx`, `frontend/lib/api.ts`'s `hrApi` |
| Mobile worker-app screens | `mobile/worker-app/src/app/{documents,consent,hr}.tsx`, `(app)/profile.tsx` (link mounting point) |
| Mobile worker-app API client | `mobile/worker-app/src/lib/api.ts` |
| Permission tokens / role matrix | `backend/src/config/constants.ts` (search `ROLE_PERMISSIONS`) |
| Deploy tooling | `ecosystem.config.js`, `deploy.sh` (both at repo root) |
| Full release package | `deploy/release/` |

## Immediate next action

Follow `deploy/release/RELEASE_EXECUTION_PLAN.md` for the deployment sequence and feature-flag
rollout order, then `deploy/release/UAT_CHECKLIST.md` before declaring the release complete. See
`deploy/release/RELEASE_SUMMARY.md` for the current release-readiness verdict.
