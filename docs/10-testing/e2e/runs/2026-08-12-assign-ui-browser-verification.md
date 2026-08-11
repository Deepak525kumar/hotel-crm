# E2E Run — 2026-08-12 — Assign UI browser verification (real Playwright clicking)

- **Commit under test:** working tree on `fix/worker-onboarding-gates`, starting from `9e21d03`
  (uncommitted fixes made during this run, not yet committed)
- **Environment:** local dev (Docker Postgres/Redis, backend :3001, frontend :3000, real HTTP
  calls through the Next.js proxy at :3000)
- **Executed by:** Claude (agent session), driven by the project owner
- **Trigger:** the previous session had built an approve→assign modal chain in `ReviewQueueTable`
  but only verified it via code review, `tsc`, `eslint`, and backend API tests — never with actual
  browser clicks. The project owner explicitly asked for real UI interaction: "interact with ui
  try clicking buttons verifying ui and verifying everything is proper."

## What this run actually did

Seeded three fresh applicants (one Manager, one Regional Manager, one Worker) through the real
`POST /users` + `POST /employees` APIs — not direct DB writes — targeting a brand-new hotel group
and hotel created via the real CRM API specifically so there was no pre-existing manager/RM to
collide with. Then drove a real Chromium browser via Playwright:

1. Logged in as each applicant and opened `/onboarding`.
2. Uploaded all 6 required documents via real `input[type=file]` interaction (not API calls).
3. Clicked Submit for Review.
4. Logged in as Admin, opened the Review Queue, clicked Review, clicked Approve & Activate.
5. For the Manager and RM applicants, filled the resulting assign modal's target picker and
   clicked Complete Assignment.
6. For the Worker applicant, clicked Reject with a native-dialog reason instead.
7. Verified every claimed outcome by reading Postgres directly — `EmploymentRecord.status`,
   `Hotel.manager_user_id`, `HotelGroup.regional_manager_user_id` — never trusting a screenshot or
   a "no error shown" as proof.

## Results

| Area | Result | Notes |
|---|---|---|
| Manager applicant `/onboarding` load | **FAIL → FIXED** | "Failed to load onboarding record" — applicant couldn't view their own record pre-assignment. See defect below. |
| RM applicant `/onboarding` load | **FAIL → FIXED** | Same root cause as Manager. |
| Document checklist load (both roles) | **FAIL → FIXED** | "Failed to load document status" — same root cause, different guard. |
| Document upload (6 files, real browser) | PASS (after fix) | Both Manager and RM applicants; checklist flips to "Uploaded" per category. |
| Submit for Review | PASS (after fix) | Button enabled, click persists `submitted_for_review_at`, verified in DB. |
| Admin Review Queue → modal → Approve | PASS | Applicant details and all 6 documents render correctly in the modal. |
| Assign modal appears after Approve | PASS | Automatically, for both MANAGER and REGIONAL_MANAGER roles. |
| Assign modal target picker | PASS | Correct picker type per role (hotel select for Manager, group select for RM); options list real hotels/groups. |
| Complete Assignment click | **FAIL → FIXED** | 422 on every attempt — frontend sent `null` for the unused field. See defect below. |
| Assign write verified in DB | PASS (after fix) | `Hotel.manager_user_id` and `HotelGroup.regional_manager_user_id` both correctly set; `EmploymentRecord.status = ACTIVE`. |
| Reject flow (never tested before) | PASS | Real click → native `prompt()` → `POST /employees/:id/reject` → status `REJECTED`, verified in DB. |
| Backend test suite after fixes | PASS | 108/108 suites, 2687/2687 tests (one flaky unrelated pair failed on a full-suite run, passed clean on isolated re-run and a second full re-run — pre-existing test-pollution, not caused by these changes). |
| Frontend `tsc --noEmit` | PASS | Clean after both fixes. |

## Defects found and fixed this run

1. **Manager/RM applicant could not view their own onboarding record before assignment** — two
   independent visibility guards (`employee-management/service.ts`'s `assertVisibility`,
   `middleware/permissions.ts`'s `resolveWorkerScope`) checked group/scope membership for
   manager/RM actors with no self-record exception, and a pre-assignment applicant has no group
   yet. This blocked 100% of Manager/RM self-service onboarding — the entire point of ADR-065's
   hierarchical gate — and was invisible to every existing test because none of them drove a real
   manager/RM applicant through their own onboarding page in a browser. Fixed by adding a
   `record.user_id === actor.userId` / `actorId === workerId` early-return before the scope check
   in both guards.
2. **Assign UI 422'd on every single attempt, both roles** — `ReviewQueueTable.handleAssign()`
   sent `null` for whichever of `hotel_group_id`/`primary_hotel_id` didn't apply, but the backend's
   Zod schema only accepts `undefined` for "omitted", not `null`. Fixed by sending only the
   relevant field and narrowing `AssignEmploymentInput`'s type to make `null` a type error.

Both defects are the kind unit tests structurally cannot catch: #1 requires an actor with no scope
yet calling a scope-checking guard on their own record (a state combination the mocked tests never
constructed), and #2 requires the real request body shape a browser's `onClick` produces, not the
clean single-field call every existing service-level test made.

## Could not test / deferred

1. **The malware-scan hook specifically on `contract-scan`** — the contract flow itself (create →
   scan → confirm) was exercised through the real API as a prerequisite for reaching the approve
   gate, but no attempt was made to upload an actually-malicious file through it this run.
2. **`contract-extend`/`contract-lapse`** — untouched.
3. **Manager's and RM's own "My Onboarding" pages once ACTIVE** — walked the applicant-side view
   pre-activation only; never revisited `/onboarding` as the same user post-activation.
4. **Multi-tab, session expiry mid-flow, accessibility** — still open from the previous run.

## Notable process lessons (worth keeping)

- **A visibility guard that checks group/scope membership will always deny a pre-assignment
  applicant reading their own record.** Any future manager/RM self-service route needs an explicit
  self-record check before the scope branch — this exact bug existed independently in two
  different files at once.
- **Zod's `.optional()` rejects `null`.** A frontend sending `null` for "not applicable" against
  an `.optional()` field gets a 422, and this is very easy for a service-level unit test to miss
  because it never constructs that exact request shape.
- **Playwright silently swallows clicks on buttons wired to native `window.prompt()`/`confirm()`**
  unless a `dialog` handler is attached — looks identical to a broken button until you know to
  check for it.
- **Reading the database after every claimed state change caught both defects.** The 422 was
  visible in the console immediately; the visibility gap would have been easy to miss without
  actually trying to load the applicant's own page as that applicant.

## Scenario files updated this run

`scenarios/08-known-gaps-and-next.md` — moved defect #2 to fixed-and-verified, added new defects
#7-#9 (two real bugs + one test-harness note), updated §3/§4/§5, added two fixed-history rows.
