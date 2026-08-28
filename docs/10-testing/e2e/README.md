# End-to-End Test Suite (human/agent-executable)

**Purpose.** This directory is the durable record of every end-to-end scenario that has
actually been executed against a running stack, with its exact commands, expected results,
and the real defects each one found. It exists so that a verification pass is **repeatable
by a different person, or a different AI session, with no memory of the original run** —
in particular after a production deployment.

**If you are an AI agent asked to "test the app", "verify the onboarding flow", "re-run the
E2E tests", or anything similar: read this file first, then execute the scenario files in
`scenarios/` in the order listed below.** Do not invent an ad-hoc test plan; these scenarios
encode defects that were expensive to find and are easy to regress. Add to them rather than
replace them.

---

## How to use this suite

1. **Bring up the stack** — `scenarios/00-environment-setup.md`. Do this first, every time.
2. **Run each scenario file in numeric order.** Each is self-contained: preconditions,
   numbered steps with copy-pasteable commands, and explicit pass criteria.
3. **Record results** in a new dated run log under `runs/` (see the template at the bottom of
   this file). Never edit a historical run log — append a new one.
4. **When you find something new**, add it to the relevant scenario file (or create a new
   scenario) in the same pass, so the next run inherits it. A defect found but not written
   down here will be found again from scratch.

### Rules that make this trustworthy

- **Verify at the data layer, not just the UI or the API response.** Several defects in the
  history below returned `200 success` while writing nothing, or wrote the wrong thing.
  A green response is not evidence; a database read is.
- **Never substitute a direct DB write for the path under test.** If the real path can't run
  (e.g. missing credentials), record that as a gap — do not work around it and report a pass.
  Seeding *unrelated* prerequisites via Prisma is fine and is called out where intended.
- **Distinguish three outcomes**: a real code defect, an environment/config problem, and
  something you could not test. Conflating these has produced false "all clear" reports before.
- **Re-check citations.** File paths and line numbers in these docs drift. Confirm before
  relying on one.

---

## Scenario index

| # | File | Covers |
|---|---|---|
| 00 | `scenarios/00-environment-setup.md` | Stack bring-up, migrations, seed data, teardown |
| 01 | `scenarios/01-onboarding-happy-path.md` | Worker/Checker create → docs → submit → approve → assign |
| 02 | `scenarios/02-manager-rm-onboarding.md` | Manager & Regional Manager lifecycle, approval hierarchy |
| 03 | `scenarios/03-authorization-isolation.md` | Review Queue isolation, cross-scope denial, role gating |
| 04 | `scenarios/04-document-upload-s3.md` | Real multipart upload → S3 → presigned retrieval, rejections |
| 05 | `scenarios/05-race-conditions.md` | Concurrency: approve/reject, double-submit, reassignment |
| 06 | `scenarios/06-edge-cases-ambiguity.md` | Deactivation, reassignment, stale state, feature flags |
| 07 | `scenarios/07-frontend-ui-playwright.md` | Browser-driven UI walkthrough (Playwright) |
| 08 | `scenarios/08-known-gaps-and-next.md` | Open defects, untested areas, what to cover next time |
| 09 | `scenarios/09-retention-sweep.md` | Retention sweep job |
| 10 | `scenarios/10-calendar-shift-summary.md` | Calendar / daily shift summary |
| 11 | `scenarios/11-daily-consent-gate.md` | Daily consent gate: enforcement, escape hatches, day rollover |
| 12 | `scenarios/12-checker-photo-evidence-and-rework.md` | Checker photo evidence, rework loop, escalation, ADR-069 metric exclusion |
| 16 | `scenarios/16-push-notification-delivery.md` | Push delivery end to end: token registration, APNs topic/environment, outbox fan-out, invalid-token pruning |
| 17 | `scenarios/17-email-delivery.md` | Email delivery end to end: handler resolution, sending-domain authentication, recipient/body shapes, bounce blindness |

**Start with 00. Then 01-07, 09-12, 16 and 17 in order.** 08 is not a test — it is the backlog and the
"what we still haven't checked" list. Read it at the end of a run and update it.

### Known coverage gaps (recorded 2026-08-22, extended 2026-08-25, one closed 2026-08-28)

Three shipped features have no scenario. Listed here rather than left to be rediscovered, per this
suite's own rule that a gap found but not written down gets found again from scratch. **These are
outstanding work, not passed checks.**

| Missing scenario | Feature | Shipped | Governing record |
|---|---|---|---|
| `13-language-and-rtl.md` | Six UI locales (`de en fr ar uk ur`), two right-to-left, persisted on `User.preferred_language`, across web and both mobile apps | PRs #471–#484 | **none — undocumented, no specification** |
| `14-payslip-requests.md` | Payslip request intake, manager fulfilment, date validation | PRs #487–#491 | `ADR-014`, `SPEC-HR-001` |
| `15-re-onboarding.md` | Re-onboarding of inactive/deactivated workers, nav lockout, capability pin | PRs #468, #469 | `ADR-065` (partially) |

**`16-push-notification-delivery.md` was written on 2026-08-28** and is no longer a gap — see
the scenario index above. It was written the expensive way: the missing scenario is exactly
what let a placeholder APNs bundle ID take out 100% of iOS push, for both apps, undetected for
as long as it stood. Every observable inside the system stayed green.

The language one matters most of the remaining three, and is the least testable as things stand: there is no specification
saying which language any surface should render in, so a scenario would have to invent its own pass
criteria. Writing the specification comes first.

The welcome-email-on-account-creation path (PR #508) landed after the newest run log and is not yet
exercised by any scenario. Login throttling (`ADR-070`, PR #509) was exercised ad-hoc on
2026-08-25 (`runs/2026-08-25-checker-app-login-verification.md`: 401 through attempt 10, 429 with
`Retry-After: 900` on attempt 11, enforced ahead of the bcrypt compare so the correct password is
refused during the window) — but it still has no scenario file of its own.

**Mobile screen coverage is new and thin.** The
2026-08-25 mobile flow verification (`runs/2026-08-25-mobile-app-flow-verification.md`) found eight
defects, five of them living in `.tsx` files that passed typecheck — contract download threw on
every attempt, onboarding submission 404'd, marking a vacation always failed, and a checker saw the
tail of a cuid where a worker's name belonged. None were caught by a green suite, because the jest
configs collected only `**/__tests__/**/*.test.ts` and no suite could reach a screen.

Both apps' `jest.config.js` now add a second `components` project that collects `*.test.tsx`, and
it does run — 150 tests in `checker-app`, 210 in `worker-app`, verified both in CI and from a clean
checkout on 2026-08-25 (`runs/2026-08-25-checker-app-login-verification.md`). Screen coverage is
still partial — most screens have no component test — so "the mobile tests pass" remains weak
evidence about any particular screen.

A 2026-08-25 pass on the checker app's sign-in
(`runs/2026-08-25-checker-app-role-gate.md`) found that its role allow-list was consulted only on
the login screen, after the auth store had already been populated — so a restored session of any
role came back on every launch unchecked. The gate now lives in the store. The lesson generalises:
a client-side check that runs *after* state is set is not a gate, because the navigation guard
watches that same state.

A second build-level trap, found from a real iOS build on 2026-08-26: both mobile apps defaulted to
Expo's dev-server port 8081, and when worker-app's server holds it, `expo run:ios` in `checker-app`
can skip starting a server and bake 8081 into the build — so a checker build serves worker-app's
JavaScript. The apps look alike enough that this reads as a checker-app bug. `checker-app` now sets port 8082 in
three places, because each start path bypasses the others: `--port` in its npm scripts,
`RCT_METRO_PORT` in a committed `.env` (for `npx expo …` run directly), and a config plugin that
writes the export into `ios/.xcode.env` on each prebuild (for builds started from Xcode, where the
port is compiled into `RCTBundleURLProvider.mm` and no Expo CLI runs at all).
`src/__tests__/dev-server-port.test.ts` guards all three. The first fix covered only the scripts and
the failure came straight back. **Before believing any mobile finding, confirm which app's bundle you are actually
running.**

The 2026-08-27 checker check-in run (`runs/2026-08-27-checker-checkin-and-worker-picker.md`) is the
clearest case yet for testing against a live API rather than fixtures. A client-side gate had been
written on the assumption that `GET /attendance` is self-scoped — it is not for a checker, which
backs the verification queue and returns other workers' rows. The unit tests shared the assumption
and passed; the first real response disproved it. **A fixture written from the same belief as the
code under test proves only that the belief is self-consistent.**

One caution from that run, about diagnosis rather than coverage: a jest-expo preset error blamed on
a missing dependency turned out to be a locally-broken `node_modules` (`--legacy-peer-deps`
suppresses the peer install `react-native` relies on), not a repository defect. Reproduce a
dependency failure in a clean worktree, and check what CI did on the base commit, before believing
it.

Push is the newest and most consequential of these: the 2026-08-25 run (`runs/2026-08-25-auth-and-push-verification.md`) found that no device had ever registered a token, and that a `DELIVERED` PUSH outbox event does not mean a device received anything — `PushTransportHandler.deliver()` returns early without throwing when the recipient has no devices, and the worker marks any non-throwing deliver as `DELIVERED`. **Do not read outbox status as evidence that push works.** A scenario here has to assert on a real device token and a real provider response, not on event status.

---

## Governing specifications

These scenarios verify behaviour defined by:

- `docs/14-governance/architecture-decisions/ADR-065-hierarchical-onboarding-gate.md` —
  the onboarding gate, approval hierarchy, post-activation assignment, document checklist
- `docs/14-governance/architecture-decisions/ADR-066-worker-document-malware-scan-position.md` —
  malware-scan seam on the WorkerDocument upload path
- `docs/03-modules/onboarding/MODULE_SPEC.md` §6.2, §6.8, §6.9 — document requirements,
  hierarchical gate, UI surfaces
- `ADR-022`/`ADR-023`/`ADR-025` — employment-record scope grain, HotelGroup/Hotel assignment FKs
- `ADR-036` — optimistic concurrency as the platform standard
- `ADR-029` — single-commit outbox / transactional side-effects
- `ADR-044` — the HR contract-scan malware hook (sibling precedent to ADR-066)
- `ADR-067` — worker visibility of the quality leaderboard (own hotel group, non-contact fields)
- `ADR-068` — Ukrainian added to the consent notice languages; the notice follows the selected language
- `ADR-069` — rework is a new assignment linked to the original, with 20-minute escalation (scenario 12)
- `ADR-070` — bounded per-account login throttle (defense-in-depth alongside edge rate limiting)

When a scenario's expected result contradicts one of these, **the specification wins** and the
scenario is the thing to correct — unless investigation shows the spec itself is wrong, in which
case stop and escalate rather than editing either silently.

---

## Run-log template

Create `runs/YYYY-MM-DD-<context>.md` (e.g. `runs/2026-08-20-post-prod-deploy.md`):

```markdown
# E2E Run — YYYY-MM-DD — <context, e.g. "post-production-deploy">

- **Commit under test:** <git rev-parse --short HEAD>
- **Environment:** local dev / staging / production
- **Executed by:** <person or agent>
- **Stack versions:** backend <x>, frontend <y>, Postgres <z>

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00 Environment | PASS/FAIL | |
| 01 Happy path | PASS/FAIL | |
| ... | | |

## New defects found
1. <symptom> — <file:line> — <severity> — <filed where?>

## Could not test
1. <what> — <why> — <what would be needed>

## Scenario files updated this run
- <which, and what was added>
```
