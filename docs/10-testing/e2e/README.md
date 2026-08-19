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

**Start with 00. Then 01-07 and 09-12 in order.** 08 is not a test — it is the backlog and the
"what we still haven't checked" list. Read it at the end of a run and update it.

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
