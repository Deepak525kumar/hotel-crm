# Hotel CRM — Handoff

> ⚠️ **Staleness notice (added 2026-08-22).** This file's own header says it is current to 2026-08-09 and that §1–§8 are a historical snapshot. It has since fallen roughly 250 commits behind `main` and **§0 is no longer maintained either** — treat the whole file as historical.
>
> For current state use: [`docs/05-execution/EXECUTION_DASHBOARD.md`](docs/05-execution/EXECUTION_DASHBOARD.md) (where work is), [`.claude/knowledge/MODULE_REGISTRY.yaml`](.claude/knowledge/MODULE_REGISTRY.yaml) (per-module status and specification versions), and `git log origin/main` (what actually merged — advice this file gives about itself in its own PR #392 incident note, and which still applies).


Last updated: 2026-08-09 (#394 and #395 both merged to `main`; feature-scoping decisions recorded
for dark mode, document templates, language switcher, contract-type workflow, and Leave & Sickness
OCR — see §0.3. #396, this doc-sync PR, still open).

**Note on this file's history below (§1–§8):** sections §1–§8 date from 2026-08-07 and earlier and
were NOT kept current through the 2026-08-08/09 security-hardening + calendar-feature session
(PRs #379–#395). Treat everything below §0 as a historical snapshot of the employment-lifecycle
rework and its immediate aftermath, not current status — §0 is the only section actively
maintained now. Going forward this file is updated after every PR, not just at session boundaries.

## 0. Current status (2026-08-09)

**Security-hardening batch (original 12-item list): all 12 closed.** Also shipped this session: a
full calendar-absence feature, a failed-login monitoring/escalation feature (replacing the
originally-requested rate-limiter by explicit user decision), removal of dead calendar-operations
stub routes, and — after a real merge-topology incident (see below) — the frontend half of the
httpOnly-cookie migration finally reconciled onto `main`. Rooms-completed data (#395) now has a
calendar UI surface. Currently working a second checklist of user-reported items (§0.3).

### ⚠️ Known incident: PR #392 never reached `main`, fixed by PR #394 — read before trusting any
### "merged" status on this repo without checking `git log origin/main`

PR #392 (frontend half of the cookie migration) was based on `fix/auth-cookies-backend` (PR #391's
branch), per plan — backend ships first, frontend second. What went wrong: **#391 merged into
`main` directly**, and **#392 merged into `fix/auth-cookies-backend`** — but nobody then merged
`fix/auth-cookies-backend` into `main` afterward. Result: `main` had the backend cookie support
live, but the frontend was still reading/writing `localStorage` tokens, even though GitHub showed
#392 as "Merged". The actual XSS-closing fix was never in production despite the green checkmark.
Caught only by diffing `origin/main`'s `frontend/lib/config.ts` against what #392's diff should
have produced. **Fixed by PR #394** (`fix/auth-cookies-frontend-remerge` → `main`, clean merge, all
3 original commits verbatim) — **confirmed merged into `main` 2026-08-09T21:07:50Z**, the frontend
cookie migration is live. **Lesson: `mergedAt`/"Merged" in `gh pr view` only tells you the PR's OWN
base branch received the commits — it says nothing about whether that base branch ever reached
`main`.** Always check the PR's `baseRefName`, and if it isn't `main`, verify the base branch itself
later reached `main` before trusting the feature is live.

### Merged, this session (chronological)
| PR | What |
|---|---|
| #379 | Critical IDOR fix — `AssignmentService` ownership check (original batch #11) |
| #380 | JWT algorithm-confusion fix — `algorithms: ['HS256']` pinned on `jwt.verify()` (#5) |
| #381 | Sidebar fixed in place, profile moved to a pinned footer above Settings |
| #382 | Malformed-JSON error code, phone validation, JobRequest/Attendance manager-scope IDORs, worker RoleGate gap (#3, #10, part of #11/#12) |
| #383 | Checkout manipulation/geofence, hotel cascade, remaining manager-scope IDORs (#12) |
| #384 | Gated `PayslipRequestsCard` actions to backend-allowed roles |
| #385 | **Critical bug** (not from the audit report) — block placing a worker on a day they have a declared SICK/VACATION absence; explicit `BLOCKING_ABSENCE_KINDS` list + day-grain semantics documented per review |
| #386 | Calendar-absence feature: manager+worker marking, mandatory-for-VACATION reason, drag-to-move, bidirectional notifications, auto-cancel of a conflicting shift when absence is marked (a second critical bug found and fixed mid-PR) |
| #387 | Sidebar collapse/expand transition smoothed |
| #388 | All 11 npm audit vulnerabilities patched (lockfile-only, no breaking changes) (#7, #8) |
| #389 | Failed-login monitoring + manager escalation (TREQ-AUTH-007) — replaces the originally-requested rate limiter; user explicitly chose this over `express-rate-limit` since app-layer rate limiting would contradict frozen spec TREQ-AUTH-008 (#6) |
| #390 | Removed dead calendar daily-operations stub routes (ADR-051) (#2) |
| #391 | httpOnly auth-cookie support, backend half of #4 |
| #393 | Worker self-stats enrichment (`total_assignments`/`attendance_rate`/`current_month`/`recent_ratings`) — see §0.2 for why this replaced an earlier leaderboard-access attempt |
| #394 | `fix/auth-cookies-frontend-remerge` → `main`. Reconciles #392's frontend cookie migration onto `main` after the merge-topology incident above (#392 itself never reached `main` — see the incident note). httpOnly cookies are confirmed live now that this is merged. |
| #395 | Rooms-completed data (ADR-028's manager-entered per-shift room count) surfaced in the calendar UI. Had zero read path and zero UI surface before this — fixed with a new `AssignmentDto.rooms_completed` field (visibility follows the *existing* ownership/scope gate on `getById`/`list`, no new authz surface) plus a `PATCH /:id/rooms-completed` correction endpoint (kept separate from `POST`, whose create-once/409-on-repeat contract is unchanged and tested). Both endpoints require `assignment.status === COMPLETED` (a real pre-existing gap, closed by explicit user decision — a manager could previously log a count for a shift that hadn't started). Follow-up review pass added `entered_by_name` to the DTO, a genuine optimistic UI update in the calendar modal, and a full-shape DTO regression test (mutation-verified). |

### Open
- **#396** — this PR: syncs `HANDOFF.md` to reflect #394/#395 actually merging and records the §0.3
  feature-scoping decisions below.
- **#398** — Document Templates + Digital Signature. See §0.3's Document templates entry below for
  full status (built, not yet merged, not yet run end-to-end, needs Chromium in CI/EC2).
- **#399** — Calendar Today button turned into a real toggle (highlighted+disabled when the visible
  grid already contains today, outline+clickable otherwise) — small, unrelated to #398.

### Original 12-item security batch — final disposition (all 12 closed)
| # | Item | Status |
|---|---|---|
| 1 | `Hotel.manager_user_id` no `@unique` | Already mitigated pre-batch (PR #370/#376) |
| 2 | Calendar `NotImplementedError` dead stubs | #390 |
| 3 | Malformed JSON → wrong error code | #382 |
| 4 | JWT in localStorage (XSS) | #391 (backend) + #392/#394 (frontend — see the incident note above; confirmed merged and live) |
| 5 | JWT algorithm-confusion | #380 |
| 6 | No rate limiting | #389 (failed-login monitoring instead, by explicit user decision) |
| 7/8 | npm audit vulns | #388 |
| 9 | Stale schema comment | separate commit `c9c7c2e` |
| 10 | Unvalidated phone field | #382 |
| 11 | Critical IDOR — `AssignmentService` ownership | #379, hardened further in #382/#383 |
| 12 | Attendance checkout missing geofence | #383 |

### §0.1 — Second checklist (user-reported items), verification + work status
Cross-referenced against current `main`, most already resolved by earlier PRs in this same session
before being re-checked:
- **Assignment completed but work request still pending** — RESOLVED by #369 (`deriveFillStatus`,
  predates this session but confirmed still correct).
- **No ranking/leaderboard visible** — see §0.2 below; NOT fixed the way originally planned. Note
  also: backend + frontend UI both already exist (`LeaderboardTable`, `/analytics` page), but the
  sidebar nav entry is still role-gated to manager/regional_manager/admin (`SidebarNav.tsx`) —
  invisible to a `worker`-role user regardless of §0.2's outcome. That nav gate is itself a
  candidate GD-06-consistent behavior (workers aren't meant to see the leaderboard at all per that
  ruling), not a bug to fix independently — don't "fix" the nav visibility without first resolving
  whether GD-06 even wants a worker-visible leaderboard.
- **Rooms/occupancy stats editable in calendar** — RESOLVED by #395 (this session, see above). Note:
  the hotel-level DAILY AGGREGATE (stay-over/checkout/total-people-working) is a genuinely different,
  still-nonexistent concept from `RoomsCompletedEntry` (per-assignment, not per-day-hotel) — that
  was the removed `DailyOperation` type (#390) and has NOT been rebuilt. If the user still wants a
  hotel-level daily rooms/occupancy dashboard, that's separate, unscoped work.
- **Data protection consent missing** — RESOLVED as a mechanism (daily gate, decline→manager notify,
  audit trail all built/wired), but the legal notice text is a literal placeholder ("legal content
  pending Zirove/DPO authorship") — a legal/DPO content gap, not engineering.
- **Broadcast-accepted assignment not showing in calendar** — RESOLVED by #371 (predates this session).
- **Check-in geofence not applied** — RESOLVED, already hard-enforced by design (soft-skip only when
  a hotel has no geofence configured at all, which is intentional).
- **Genuinely not started** (real feature work, need scoping before building): contract-type
  detection + part/mid/full-time approval workflow ("middle time" is ambiguous, needs
  clarification); Leave & Sickness (multi-day requests, clash detection beyond same-day, certificate
  OCR — zero precedent in this codebase, reminders); dark mode (no toggle exists); language switcher
  (zero i18n infrastructure); document templates (no template concept anywhere, not even for HR's
  existing `Contract.template_id` field). **Scoping for these is now recorded in §0.3.**

### §0.2 — GD-06 governance conflict (worker analytics scope) — a real lesson, not just a footnote
Attempted to open the manager-facing leaderboard (`GET /analytics/leaderboard`) to workers to
resolve "no ranking system visible" — but this directly contradicts **GD-06** (2026-07-27), a
ratified governance decision that explicitly weighed "worker sees own stats" vs. "worker sees
broader analytics" and chose the former (encoded in ADR-030 §3's `C-31` capability matrix,
worker=deny, enforced by `capability-policy.test.ts`). **Reverted that branch entirely** rather than
override a deliberate product decision without a real business reason surfacing during the
investigation. Built #393 instead: enriched the existing self-scoped `GET /analytics/my-stats`
(which already existed, GD-06-compliant, but had a thin response and no dashboard placement) with
`total_assignments`/`attendance_rate`/`current_month`/`recent_ratings`, still zero peer-identifying
data, now also on the dashboard (previously `/profile`-only). **If a real leaderboard-for-workers
requirement ever comes up again, it needs a GD-06 AMENDMENT (dated note + updated ADR-030 matrix
row, same pattern as ADR-030's own C-16 supersession precedent) — not a direct code change.**

### Two frozen-spec amendments flagged, not yet done
Both FROZEN specs; amending them follows their own protocol, not a routine edit:
- `SPEC-CALENDAR-001` (RULE-CAL-04/REQ-CAL-T04) — needs updating for the day-grain absence-blocking
  behavior from #385.
- `SPEC-AUTH-001` (REQ-AUTH-003) — its "no failed-attempt counting or notification of any kind
  exists" line is now stale after #389.

### §0.3 — Deferred feature scoping (explicit user decision, 2026-08-09)
Of the 5 not-started items from §0.1, scoping was resolved for 2 (dark mode, document templates)
and explicitly deferred for 3. **When asked "what's left," report these three as open/undecided —
do not silently re-derive a scope for them.**

**Deferred, no scope decided yet:**
- **Contract-type detection + approval workflow.** "Middle time" was never defined — the user
  said to leave it and note it as a later decision. Nothing to build until that's resolved.
- **Leave & Sickness — OCR portion specifically.** The user deferred OCR (sick-note upload/
  extraction, certificate reminders) without picking a scoping approach. Multi-day leave requests
  + clash detection (the non-OCR half) are UNSTARTED too — the user's answer deferred the whole
  item, not just OCR; don't assume the non-OCR half is authorized to build without checking back.

**Scoped, ready to build (once picked up):**
- **Dark mode**: manual toggle in Settings (Light/Dark/System), System defaults to
  `prefers-color-scheme`, persisted (not an auth token, plain localStorage is fine here — do not
  confuse with the httpOnly-cookie auth-token work, unrelated). Not yet started.
- **Document templates**: **in-app fillable form templates** (not static file uploads) — a
  template defines structured fields, filled through a form in the app, rendered to a document.
  **Also requires digital signature capture** (explicit user requirement, not implied by "template"
  alone). **Built and open as PR #398** (`feat/document-templates`) — full backend module (7 Prisma
  models, fork-on-edit template versioning, Playwright PDF rendering, attestation-level signature
  capture) plus frontend (template CRUD, fill/sign wizard, `signature_pad` canvas capture). NOT yet
  merged; NOT yet run end-to-end against a real database/browser; needs the Chromium binary
  installed in CI/EC2 before it can actually render a PDF in those environments. See PR #398's own
  description for the full verification status and open decisions before assuming this is done.
- **Language switcher**: **full coverage**, not UI-only — "everything the user will see, be it
  notifications or whatever, should be translated." This is a much larger scope than the original
  UI-only framing: every notification-producing code path (in-app `Notification` records, any
  future email/push text) needs translation, not just frontend component strings. Target
  languages still unspecified — needs that decision plus an i18n architecture pass (message
  catalog format, where translated notification text is generated — at write time per-recipient
  locale, or at read time) before implementation starts. Not yet started.

---

### Addendum, 2026-08-10 — PR #397 (dark mode) review follow-up, tracked not actioned

Review feedback on PR #397 (`feat/dark-mode-toggle`) suggested tokenizing the dark-mode approach:
instead of a `dark:` Tailwind variant on every affected utility class (repeated across the ~66-file
surface that PR touches), introduce semantic classes (`bg-surface`, `bg-surface-secondary`,
`text-primary`, `text-secondary`, `border-default`, ...) mapped to CSS variables in `globals.css`.
That would make future palette/contrast tweaks a one-file change instead of a repo-wide sweep.

**Explicitly NOT done now** — the reviewer's own call, agreed with: retrofitting tokens means
re-touching every one of those ~66 files a second time for zero user-visible change, which is real
scope and regression risk for a toggle that already works correctly. Left as `dark:`-variant-based
for this PR. **Next person touching dark-mode styling broadly (not a one-off tweak) should consider
this tokenization first**, rather than adding a 67th file's worth of `dark:` variants to the pile.

---

## 1. What's merged (this session, chronological, oldest first)

Every PR below is merged to `main`, CI-green, and — starting at #347 — independently re-reviewed by
a background adversarial-review agent that found and got real bugs fixed before merge. That review
step is now the established bar for this repo; don't skip it for future PRs of comparable size.

| PR | Title | What it actually did |
|---|---|---|
| #345 | Work-request/dispatch lifecycle audit | 6 confirmed bugs fixed (audit-trail gaps, `confirmed_count` decrement, `cancellation_reason` surfacing, dead worker-facing UI) + 3 built-not-deferred features: assignment-lifecycle notifications, cancel-cascade to assigned workers, atomic reassign endpoint. |
| #346 | CI dedup | Added `concurrency` groups to `ci.yml`/`migration-harness.yml` keyed on `github.head_ref \|\| github.ref`, so `push` and `pull_request` runs on the same commit don't both run to completion (was doubling CI usage). Root cause: a deliberate d464e68 fix for a different problem, not an oversight — verified via `git show`, not guessed. |
| #347 | Modal focus-steal fix | The shared `Modal` component's focus-management `useEffect` depended on `onClose`, a prop that's a fresh function reference on almost every render → typing in ANY modal's form field stole focus back to the close (×) button after every keystroke. Root-cause fixed in the shared primitive, not the one symptom (`WorkerOnboardingCard`) originally reported. |
| #348 | Hotel manager/group wiring | `Hotel.manager_user_id` already existed in the schema and was already **read** by `auth/service.ts#resolveScope` as the sole source of a Hotel Manager's JWT scope — but nothing ever **wrote** it. A manager account had no way to ever get a working scope. Wired the full write path (create/edit form, service validation, token-generation bump on reassignment). Review found and fixed a real TOCTOU race (manager reassignment didn't lock the affected user row before writing). |
| #349 | Manager/RM user-scope fix | `updateUser`/`getUser` (the legacy default path) had **zero scope check**, letting any manager/RM read or write any user platform-wide. Fixed with a scope rule: manager/RM may only touch worker/checker targets already in their group. Review found a real bug (the fix also broke a manager's ability to edit *their own* profile) — fixed with a self-edit exemption. Also exposed the "Users" nav/pages to manager/RM (previously admin-only, despite the API being scope-correct). |
| #350 | Manager/RM vacancy-history model | Follow-up to #348's review: demoting a manager/RM who still owned a hotel/group either silently left a stale association or was blocked outright. Built a full vacancy model: `ManagerVacancyReason` enum, `assigned_at`/`vacated_at`/`vacancy_reason` fields on `Hotel` and `HotelGroup`, two new history tables (`RegionalManagerAssignmentHistory`, `HotelManagerAssignmentHistory`). Demotion now auto-clears with a reason instead of blocking. Review found and fixed a second real concurrency bug (`updateHotel` never locked/re-read the `Hotel` row itself, only the User rows) and a backfill-timestamp bug (used a generic `updated_at` column that unrelated edits bump, not a true assignment date — fixed by leaving it `NULL` for pre-existing data rather than guessing). |
| #351 | Sidebar icons + hover-expand collapse | Added `lucide-react` (first icon library in the app — everything before was inline SVGs). Sidebar collapses to an icon-only rail by default, expands on hover **or keyboard focus**. Review found two real blockers: the collapsed rail's own padding was clipping its icons (the *default* state, not an edge case), and mouse-hover/keyboard-focus shared one state variable so they cancelled each other (tabbing into a link then moving the mouse collapsed the rail while that link still had focus). Both fixed; also deduplicated two identical icons (`/assignments` and `/attendance` both used `ClipboardCheck`). |
| #352 | Navbar notifications bell | Removed "Notifications" from the sidebar, added a bell icon + unread badge in the navbar with a dropdown preview (reuses the existing `useNotifications()` SWR hook — same cache as the full `/notifications` page). Review found two real bugs: a single shared `useAsyncAction()` instance meant concurrent "mark as read" clicks on *different* notifications corrupted each other's pending state (fixed by giving each row its own hook instance via an extracted `NotificationRow` component); and mark-read failures were silently swallowed (no error UI) — fixed. Also fixed `role="menu"` being applied with none of that ARIA role's required semantics (dropped it; native list/link/button semantics are correct here). **Had a merge conflict against #351** (both touched `SidebarNav.tsx`/`AppShell.tsx`) — resolved by rebasing, keeping #351's icon/collapse structure and #352's notification-bell removal together; verified with typecheck/lint/build before force-pushing. |
| #353 | Date/time validation on work-request/broadcast forms | Neither "New work request" nor "New broadcast" validated `shift_date`/times beyond native browser widgets — a shift could be created in the past or with an end time ≤ start time. Review found the initial fix used `new Date().toISOString().slice(0,10)` for "today," which is the **UTC** date, not local — this would incorrectly block *today's* legitimate submissions every evening for any US timezone (verified empirically with `TZ=America/New_York`). Fixed with a new `localToday()` helper in `lib/format.ts` using `toLocaleDateString("en-CA")`; also fixed the identical latent bug in the pre-existing `AbsencesCard.tsx`, which had it too but was lower-severity there (it has a backend fallback check; work-requests/broadcasts do not). |

**Net effect of #345–#353**: dispatch lifecycle is fully audited and hardened, manager/RM
authorization has no known scope gaps, the hotel-manager role is actually functional end-to-end for
the first time, and several small but real UI bugs (modal focus theft, sidebar icon clipping,
notification race conditions, timezone validation bug) are fixed. Every fix above was verified via
an *independent* adversarial review, not just self-review — that pattern caught a real bug in every
single PR from #348 onward. Keep using it.

## 1.5. PR #358 (open, `fix/hotel-group-hotels-filter`) — hotel-group/hotel-detail bugs + app-wide raw-id sweep

Started from two directly-reported bugs, then expanded into a full audit per an explicit "test
yourself, find as many similar bugs as you can and fix them" directive covering assignments, work
requests, and notifications.

**Original two fixes:**
1. Hotel group detail's "Hotels in this group" list silently dropped entries past the first 100
   hotels platform-wide (client-side filter on a capped, unfiltered page). Added a server-side
   `hotel_group_id` filter to `GET /crm/hotels` (`ListHotelsQuerySchema` + `CrmService.listHotels`)
   — composes correctly with the existing worker roster-scope filter (separate `where` keys, ANDed).
2. Hotel detail page never showed the Regional Manager (only Hotel Manager existed). Added a
   "Regional manager" row mirroring the existing Manager row's pattern (link, resolved name,
   vacancy state).

**Follow-up sweep — resolves deferred item #4 below** (raw worker ID in "Placement details"): that
report turned out to be one instance of a pattern repeated across most job-related UI. Audited every
list/detail page that should show worker/hotel/job context and fixed each occurrence via the
existing `useUsersByIds`/`useHotel`/`useWorkRequest` hooks:
- Assignments (list + detail): worker name, hotel name, work-request position/shift resolved.
- Calendar placements (`assignments/calendar-entries/page.tsx`): worker name + hotel column added
  (this was the sibling list the original calendar-grid fix missed).
- Attendance (list + detail): worker/hotel/verified-by names resolved; assignment link fixed.
- Geo check-ins (list): worker/hotel names resolved (detail page was already correct).
- Work requests / broadcasts (list + detail, both surfaces): added missing hotel name; work request
  detail now also shows who created it.
- Notifications (list + detail): added the previously-never-shown hotel column/row; `data`'s
  deep-link ids (`assignment_id`, `work_request_id`, `worker_id`, etc.) now render as real links via
  a `DATA_KEY_ROUTES` map instead of a raw key/value text dump.

Verified: `tsc --noEmit` clean, `eslint` clean, `next build` succeeds, backend suite unaffected
(frontend-only change). CI (Vercel preview build) green. Could not drive the live authenticated app
in this environment (see §6).

## 2. What's open

**PR #358** (see §1.5 above) — awaiting review/merge.

## 3. The employment-lifecycle rework (research complete, PR 1 implemented, PRs 3–5 remaining)

**Origin**: during a Priority-2 (Employee Management) audit, three known gaps were investigated:
1. Hotel blocklist entries have no removal path, and — bigger finding — **the blocklist doesn't
   actually block anything**: no scheduling/assignment code path anywhere checks
   `EmployeeBlocklistEntry`. It's pure audit-log data today.
2. `EmploymentStatus` (`INACTIVE, UNDER_REVIEW, ACTIVE, REJECTED, DEACTIVATED`) has `REJECTED` and
   `DEACTIVATED` as **hard terminal states** in `ALLOWED_TRANSITIONS`
   (`backend/src/modules/employee-management/constants.ts`) — confirmed deliberate via an existing
   test (`employee-management.test.ts`) that explicitly asserts no recovery is intended
   (`RULE-EMP-02/03/12`).
3. `User.is_active`/`deleted_at` and `EmploymentRecord.status` can drift independently —
   `deleteUser()` never touches `EmploymentRecord`, so a soft-deleted user's employment record can
   stay `ACTIVE` forever and remain roster-eligible.

**User's decisions on scope** (via `AskUserQuestion`, all confirmed, none walked back):
- Blocklist: **do the removal fix AND wire real enforcement** (not just add a delete button —
  make `isWorkerEligibleForHotel`/assignment-creation actually deny a blocklisted worker).
- Terminal-status gap: **do NOT leave as documented-intentional**. The user gave a full alternate
  spec (verbatim, reproduced below) — implement a **permanent, non-terminal employment lifecycle
  with first-class rehire support**. This supersedes the existing `RULE-EMP-02/03/12` design.
- Missing deactivate UI: **yes, add it** (the only backend endpoint for this,
  `POST /employees/:id/deactivate`, has zero frontend caller today).
- Sequencing: **do the lifecycle rework FIRST**, blocklist/deactivate-button fixes after.
- Process: **write a full implementation plan first**, get it approved, before touching any code.
  (This is why plan mode was active when the interruption happened — no code was written.)

**The user's exact target spec** (authoritative — do not reinterpret, this is a direct quote):

> Implement a permanent user lifecycle with rehire support. This is a repository-wide invariant
> change, not a localized feature.
>
> **Business rules (authoritative)**: A User represents a person. A User is permanent until
> explicitly hard-deleted from the database (not part of this work). Employment status changes
> over time. The system must never require creating duplicate users for the same person.
>
> **New lifecycle**: `PENDING, ACTIVE, DEACTIVATED, REJECTED, DELETED` (soft delete). **None of
> these states are terminal.**
>
> **Required workflows**:
> - Approve: `PENDING → ACTIVE`
> - Reject: `PENDING → REJECTED`
> - Deactivate: `ACTIVE → DEACTIVATED`
> - Soft Delete: `ACTIVE/DEACTIVATED/REJECTED → DELETED`
> - Rehire: `REJECTED → ACTIVE`, `DEACTIVATED → ACTIVE`, `DELETED → ACTIVE` (restore + rehire)
>
> A person returning to the company must always reuse the existing User. Never create a duplicate
> user.
>
> **Implementation requirements**: Treat this as a domain-model change. Do NOT patch individual
> endpoints. First determine every affected module. Update every affected place consistently.
> Maintain repository-wide consistency. No duplicated business rules. No temporary compatibility
> code. No TODO implementations. No partial migrations.
>
> **Repository audit** (before changing code) must include: database schema, prisma constraints,
> services, routes, permissions, onboarding, recruitment, HR, assignments, attendance, calendar,
> notifications, documents, contracts, analytics, authentication, JWT/session lifecycle, frontend,
> API clients, validation, documentation, tests. If another module depends on employment being
> terminal, update it. Do not leave inconsistent assumptions.
>
> **Rehire** must: reuse existing User, preserve all history, restore operational capability,
> reset onboarding only where appropriate, preserve audit history/attendance/assignments/
> documents/ratings/analytics continuity. Do NOT create duplicate users.
>
> **Delete** is a soft delete. The user disappears from operational UI. History remains intact.
> Deleted users must still be rehirable.
>
> **Consistency review**: search the repo for every assumption that REJECTED/DEACTIVATED/DELETED
> is terminal, or that employment cannot resume, or one-way state transitions. Replace every
> incorrect assumption.
>
> **Security**: review authorization for rehire/restore/deactivate/delete/approve/reject — all
> require correct permissions. Review JWT/session invalidation, token generation, cache
> invalidation, audit logging.
>
> **Database**: if schema changes are required, provide safe migrations, maintain forward/backward
> compatibility where possible, protect production data, use transactions, prevent races.
>
> **Documentation**: synchronize ADRs, module specs, requirement register, decision records, API
> docs, known limitations. Remove obsolete assumptions.
>
> **Testing**: update every affected test, add missing tests, no outdated expectations, no skipped
> tests.
>
> **End-to-end verification** (after implementation, not just unit tests) — walk through 10 named
> scenarios: (1) create→approve→assign hotel→assign work→deactivate→rehire→schedule→check-in,
> (2) create→reject→rehire→complete onboarding→assign work, (3) create→deactivate→delete→
> restore→rehire, (4) manager attempts unauthorized rehire, (5) Regional Manager permissions,
> (6) Admin lifecycle, (7) Notifications, (8) Audit logs, (9) Analytics continuity, (10) Search
> and filters. Verify every transition, no orphaned data, no stale cache, no broken permissions, no
> duplicate users, no impossible state, frontend/backend consistency, documentation consistency.
> Finally perform a repository-wide regression audit and report every change, every affected
> module, any owner decisions required, and any remaining risks before opening the PR.

**Research completed so far** (one Explore agent finished, full output preserved below — treat as
ground truth, re-verify only if something seems to have changed since):

<details>
<summary>Agent 1 output — schema, write paths, read paths, terminal-state assumptions, user-creation sequencing, JWT/notification involvement (click to expand in a markdown viewer, or just read inline — it's not collapsed in plain-text editors)</summary>

**1. Full current schema**
- `EmploymentStatus` enum — `backend/prisma/schema.prisma:232-238`: `INACTIVE, UNDER_REVIEW, ACTIVE, REJECTED, DEACTIVATED`.
- `User` — `schema.prisma:253-342`. Key fields: `is_active Boolean @default(true)` (269), `deleted_at DateTime?` (273, GDPR soft delete), `token_generation Int @default(0)` (279, monotonic revocation counter mirrored into JWT claim). 1:1 optional relation `employment_record EmploymentRecord?` (308). Indexes on `role`, `is_active`, `deleted_at` (339-341) — **no employment-status-aware index on User, because User has no status field of its own.**
- `EmploymentRecord` — `schema.prisma:572-595`. `user_id String @unique` (574, "one record per account"), `employee_id String @unique` (human-facing ID), `status EmploymentStatus @default(INACTIVE)` (579), `hotel_group_id String?`, `deleted_at DateTime?` (587, "soft delete REQ-EMP-010"), `@@index([status])`. **Both `user_id` and `employee_id` are `@unique` at the DB level** — this is the crux of "never create a duplicate" for rehire: it's already structurally impossible to create a second `EmploymentRecord` for the same `user_id`, so rehire cannot be "create a new record," it must be "transition the existing record."
- `EmployeeBlocklistEntry` — `schema.prisma:600-614`. FK `employment_record_id` → `EmploymentRecord` with `onDelete: Cascade`. `@@unique([hotel_id, employment_record_id])`. **Important for the rehire design**: because the FK is keyed by `EmploymentRecord.id` (not `user_id`) and cascades on delete, IF any future design ever deleted-and-recreated the EmploymentRecord row (which the unique constraints already rule out, but worth stating explicitly as a constraint check), all blocklist history for that person would be destroyed. Since rehire will transition the *same* row, this is a non-issue — but it's the kind of thing the "no orphaned data" verification pass should explicitly re-confirm once the rehire code is written.
- Other models: `HotelWorker` has its own `HotelWorkerStatus` enum (`INVITED, ACTIVE, SUSPENDED, REMOVED`) but is **confirmed dormant** — a backfill script's own docstring (`backend/src/scripts/employment-record-backfill-status.ts`) states it is "completely dormant — unread by any application code." No FK to `EmploymentRecord`. Not in scope for this rework.

**2. Every current write path to EmploymentRecord.status / User.is_active / User.deleted_at**
- `EmploymentRecord.status` writes, all in `backend/src/modules/employee-management/service.ts`:
  - `createEmployee` line 80: `status: EmploymentStatus.INACTIVE` (initial create only, no prior-state transition check).
  - `deactivate` line 279: `{ status: DEACTIVATED, deleted_at: new Date() }` — **note this couples DEACTIVATED with setting `deleted_at`, a coupling the new design must break**, since under the new design DEACTIVATED and DELETED become two distinct, both-non-terminal states, not "deactivate = soft-delete."
  - `deactivateForContractLapse` line 309: identical `{ status: DEACTIVATED, deleted_at: new Date() }` coupling.
  - `lifecycleSignal` lines 344/360: `data.status = target`, `target` from `SIGNAL_TARGET` map (321-325: `submitted_for_review→UNDER_REVIEW`, `approved→ACTIVE`, `rejected→REJECTED`); on `approved` also connects `hotel_group` (354-357).
  - All three (not `createEmployee`) gate through `assertTransition()` (`constants.ts:24-31`) before writing.
- `User.is_active`/`deleted_at` writes, all in `backend/src/modules/users/service.ts`:
  - `updateUser` line 271: `is_active: newIsActive`, conditionally bumps `token_generation` if role changed or `is_active` flipped false (line 258 `shouldBump` logic).
  - `updateUserProfile` line 334: same pattern, line 324 bump logic.
  - `deleteUser` line 496: `{ deleted_at: new Date(), is_active: false }` inside a `$transaction` with `bumpTokenGeneration(tx, userId)` (498).
- **Confirmed: none of the User-side writes touch EmploymentRecord, and none of the EmploymentRecord-side writes touch User.** They are currently fully independent — this is exactly the drift bug from gap #3 above, and it's the reason "Delete is a soft delete... user disappears from operational UI" in the new spec needs a decision on whether Delete-the-employment-lifecycle-state is the SAME action as `deleteUser()`, or a distinct EmploymentRecord-only transition that leaves the User row untouched. (This is a real open question for the plan — see "Open questions" below.)

**3. Every current READ of EmploymentRecord.status for authorization/roster/scope**
- `backend/src/lib/roster-scope.ts:48` — `resolveWorkerGroupScope()`: `record.status !== ACTIVE` → deny (returns null scope). Used by `isWorkerEligibleForHotel`, `listEligibleHotelIds`.
- `backend/src/lib/roster-scope.ts:93` — `listEligibleWorkerIds()`: `where: { hotel_group_id, status: ACTIVE }`.
- `backend/src/lib/scope.ts:118-135` — `isWorkerInGroupScope()` — **does NOT check status at all**, only `hotel_group_id` presence. Used by `users/service.ts:247` for manager/RM edit-scope checks (the #349 fix). **This is a pre-existing inconsistency**: a REJECTED/DEACTIVATED worker who still has `hotel_group_id` set would pass this scope check even though roster-scope.ts would deny them for actual work eligibility. Worth deciding whether the new lifecycle design should also tighten this, or leave it (it's a pre-existing gap, not introduced by this rework, but the rework is exactly the kind of change that should either fix it or explicitly document it as still-open).
- `backend/src/modules/calendar/service.ts:233`, `backend/src/modules/hr/service.ts:559` and `:782`, `backend/src/modules/consent/service.ts:284` — all four are **notification-gating** checks (`status !== ACTIVE` → skip notifying the responsible manager), not authorization gates. Lower risk to change but still need updating for the new enum values.
- `backend/src/modules/job-requests/service.ts` — no direct status read; relies on `roster-scope.ts`'s already-ACTIVE-gated functions upstream.
- `assignments/service.ts`/`assignments/routes.ts` — no direct EmploymentStatus read at all, same upstream reliance.

**4. Every place assuming REJECTED/DEACTIVATED are terminal**
- `backend/src/modules/employee-management/constants.ts:12-22` — the `ALLOWED_TRANSITIONS` table itself: `REJECTED: []`, `DEACTIVATED: []`. This is THE place that encodes the old design; it's also exactly where the new transitions get added.
- `service.ts:303` (`deactivateForContractLapse`) — short-circuits with `if (status === DEACTIVATED) return` treating it as a stable idempotent end-state. Needs re-examination once DEACTIVATED is no longer assumed permanent (still fine to keep as an idempotency guard for THIS specific method, since re-lapsing an already-deactivated contract is still a no-op — just shouldn't be read as "and there's nothing else that could ever happen to this record.")
- `service.ts:507-509`/`516` (`getByUserId`) — `if (!record || record.deleted_at) return null` — treats a soft-deleted record as permanently invisible. **This directly couples `deleted_at` with visibility**, which conflicts with the new spec's "Deleted users must still be rehirable" (rehire needs to find and act on a deleted record, so at minimum an admin-facing lookup path must NOT hard-return-null on `deleted_at` the way this general-purpose lookup does — likely needs a scoped "include deleted" query variant for the rehire flow specifically, while keeping this method's current behavior for normal/non-admin lookups).
- **Tests requiring rewrite** — `backend/src/__tests__/employee-management.test.ts`:
  - Lines 189-198 `it.each` "rejects illegal transition" — specifically asserts `[REJECTED, ACTIVE]` and `[DEACTIVATED, ACTIVE]` and `[DEACTIVATED, INACTIVE]` as illegal. **The first two of these three assertions are exactly what "Rehire" must make LEGAL** — these test cases don't just need updating, they need to be inverted (from "rejects" to "allows, and records rehire semantics").
  - Lines 432-438 "idempotent when already DEACTIVATED" (in `deactivateForContractLapse`) — keep as-is (still a valid idempotency guard, orthogonal to terminality).
  - Lines 463-471 "rejects illegal transition e.g. from REJECTED" (also in `deactivateForContractLapse`'s own test block) — this one specifically tests that `deactivateForContractLapse` (an HR-triggered contract-lapse call) can't fire on a REJECTED record. Worth deciding: should contract-lapse be able to deactivate a REJECTED-then-rehired-then-ACTIVE record? Yes, trivially, once it's ACTIVE again this method's existing `ACTIVE→DEACTIVATED` path just works. But should contract-lapse fire directly on a still-REJECTED record? Almost certainly still no — keep this specific test's assertion, just re-verify against the new transition table that REJECTED still can't go directly to DEACTIVATED (only to ACTIVE, via Rehire, or to DELETED, via Soft Delete).
  - Lines 497-505 "returns null for soft-deleted instead of resurfacing deactivated history" — feeds `{status: DEACTIVATED, deleted_at: <date>}` into `getByUserId` and asserts null. **This test's premise (DEACTIVATED implies deleted_at is set) must be broken apart** under the new design, where DEACTIVATED and DELETED are separate statuses and a DEACTIVATED record is NOT soft-deleted. Needs a full rewrite, not a tweak.
  - Line 208-211 "has no Suspended state" — this one's fine to keep (the new design still has no SUSPENDED, it's a different 5 values but still exactly 5 named non-Suspended states); just double check the value list in the assertion gets updated to the new enum members.

**5. User creation / auth flow sequencing**
- `auth/service.ts:79-101` (`signup`) and `users/service.ts:153-193` (`createUser`, admin-facing) — **both create only a `User` row, zero EmploymentRecord involvement.** No `employmentRecord.create` call in either.
- `EmploymentRecord` creation is a separate, later, admin-only step: `employee-management/service.ts:57-92` (`createEmployee`), called with an already-existing `user_id`, throws `ConflictError` on duplicate `user_id` or `employee_id` (lines 66-72).
- **This confirms rehire is structurally easy on the "don't duplicate the User" front**: since User creation and EmploymentRecord creation are ALREADY two independent steps with no coupling, rehire simply never calls User-creation logic at all — it only ever transitions the existing EmploymentRecord row via its existing `user_id`. The "never create a duplicate user" requirement is satisfied by construction as long as rehire's entry point takes an existing `user_id`/`employee_id`/`EmploymentRecord.id` as input (find-or-fail), never a fresh signup payload.

**6. JWT / session / token_generation involvement**
- `bumpTokenGeneration` (`auth/service.ts:27-35`) is called only from `updateUser`, `updateUserProfile`, `deleteUser` (users/service.ts) and `updateUserRole`, `revokeAllSessions`, password-reset-completion (auth/service.ts). **Zero call sites in employee-management/service.ts** — no EmploymentStatus transition today bumps token_generation or touches sessions.
- `resolveScope` (`auth/service.ts:51-77`) builds the JWT `scope` claim from `HotelGroup.regional_manager_user_id`/`Hotel.manager_user_id` only — **no EmploymentRecord read at all**. Worker roster scope is resolved fresh per-request via `roster-scope.ts`, deliberately NOT baked into the JWT (so it can't go stale the way a baked-in claim would).
- **Implication for the new design**: a Deactivate/Reject/Delete/Rehire transition changing a worker's *operational* eligibility doesn't need a token bump, because roster-scope.ts re-checks fresh every time — the existing architecture already handles this correctly for workers. This only matters if a future decision ties `EmploymentStatus` changes to something that DOES get baked into a token (unlikely, but flag it as a "verify still true" item in the security-review checklist the spec asked for).

**7. Notifications tied to lifecycle events**
- `NotificationType` enum (`schema.prisma:97-136`) has **no employment-onboarding-specific member** (no `EMPLOYEE_APPROVED`/`REJECTED`/`DEACTIVATED`/etc.). Closest are HR-contract-flavored (`HR_CONTRACT_LAPSED`, `HR_CONTRACT_EXPIRY_REMINDER`) and job-dispatch (`APPLICATION_ACCEPTED`/`REJECTED`, unrelated to EmploymentRecord).
- `employee-management/service.ts` has **zero notification-service calls anywhere** — `createEmployee`/`deactivate`/`lifecycleSignal`/`deactivateForContractLapse` only write `logAudit` + a structured log line. A code comment (line ~367) confirms this is deliberate: "no event bus exists in this codebase... domain events are represented as a structured log line only." **This means the spec's requirement to review "Notifications" for lifecycle changes is mostly about deciding whether to ADD notifications for Approve/Reject/Deactivate/Rehire/Delete (a new capability), not about fixing existing ones** — there's nothing existing to fix, only a gap to optionally close. Needs an explicit decision in the plan (recommend: at minimum, notify the affected worker on Approve/Reject/Rehire, matching the pattern used for assignment notifications in earlier PRs — see #345's notification additions for precedent).

</details>

**Research completed (round 2)**: frontend consumers (exactly 4 files reference `EmploymentStatus`
in the lifecycle sense — `WorkerOnboardingCard.tsx`, `org-chart/page.tsx`, `lib/types.ts`,
`lib/api.ts`; the frontend currently has **zero** deactivate/rehire/delete/restore UI, only
create→submit→approve/reject); permissions (`lifecycle-signal` was admin-only at both route and
service — expanding this to manager/RM was a real permission *expansion*, not a restatement);
HR cross-dependency (`manualLapseContract` is the only external caller, confirmed via exhaustive
grep); Analytics/Documents modules (zero `EmploymentStatus` dependency in either); migration
precedent (no prior migration in this repo ever collapsed enum values with a data remap — the
closest precedent, `20260726000000_add_regional_manager_role/down.sql`, only ever removed an
unused value and had never run forward); docs/specs (`REQ-EMP-002`/`RULE-EMP-02/03/12` are real,
authoritative content in `docs/03-modules/employee-management/MODULE_SPEC.md`, not just code
comments — still need formal revision, tracked as part of PR 5 below).

**All open design questions resolved** (via `AskUserQuestion` with the user, plus one Opus
subagent verification pass that caught the literal "assignment becomes unassigned/open" proposal
describing a schema state that doesn't exist — `WorkerAssignment.worker_id` is non-nullable):

- **DELETED = `deleteUser()`, one unified action.** Soft-deletes the User account too (`deleted_at`,
  `is_active=false`, `token_generation` bump), not a separate EmploymentRecord-only state.
- **INACTIVE/UNDER_REVIEW collapse into PENDING via a sub-state field**, not a 6th enum value:
  `EmploymentRecord.submitted_for_review_at` (null = old INACTIVE, non-null = old UNDER_REVIEW).
- **DELETED → PENDING → ACTIVE** (full re-approval required) for a true rehire.
- **DEACTIVATED means a temporary pause ONLY** (leave/seasonal/suspension, reason required) and
  always reactivates *directly* to ACTIVE — this was the pivotal correction from an earlier draft
  of the plan, made after user review: without this split, `DEACTIVATED` was ambiguous between
  "still employed, paused" and "left the company," which is exactly the conflation the old code had
  (every historical `DEACTIVATED` write was paired with `deleted_at`). Someone who actually left
  goes to `DELETED` instead.
- **Rehire permission**: admin unrestricted, or manager/regional_manager scoped to their own group.
- **Cycle history**: new `EmploymentStatusHistory` table (append-only, one row per transition,
  same transaction) plus a denormalized `employment_cycle` counter incrementing only on
  `DELETED → PENDING`.
- **Assignment handling on deactivate/delete**: cancel future assignments via the *existing*
  `AssignmentService.update()` path (which already decrements a broadcast slot's `confirmed_count`,
  reopening it for another worker — no new "vacant" schema needed). On delete, also invalidate
  sessions and auto-reopen a `FILLED` JobRequest that drops below headcount.
- **Migration mapping**: every pre-existing `DEACTIVATED` row remaps to `DELETED`, not the new
  `DEACTIVATED` — verified exhaustively (grep, not assumption) that every historical write ever
  producing that status paired it with `deleted_at`.

The full plan (with rationale for every decision above) is preserved at
`~/.claude/plans/expressive-floating-koala.md` on this machine.

### 3.5. PR #354 — merged (schema/migration + service-layer, combined per user instruction)

- New migration `20260806123146_employment_lifecycle_rework` — enum rename/recreate/cast/drop
  (Postgres has no native enum-value-collapse), remaps `DEACTIVATED→DELETED` for existing rows with
  a queryable provenance history row, adds `EmploymentStatusHistory`, `employment_cycle`,
  `submitted_for_review_at`, `deactivation_reason`, `deleted_reason`. `down.sql` has an *enforced*
  precondition guard (`RAISE EXCEPTION`, not just a comment) refusing to roll back if any real
  post-rework rehire/transition has occurred.
- `employee-management/service.ts` rewritten around one `applyTransition()` helper — every status
  write goes through it, one `EmploymentStatusHistory` row per transition, same transaction.
- New actions: `submitForReview`, `approve`, `reject`, `deactivate`, `reactivate`, `rehire`,
  `delete`, `restore` — 8 explicit endpoints replacing the old single `/lifecycle-signal` endpoint.

**Adversarial review (Opus) found and fixed 2 HIGH-severity bugs before merge:**
1. `cancelFutureAssignments` was re-authorizing each cancellation through `AssignmentService.update()`'s
   own hotel-grain check, which always threw for the contract-lapse's system-driven cascade and could
   abort mid-loop for a manager acting across their whole group — fixed by recognizing the employment
   service as the sole authority that already authorized the parent action.
2. Manager/RM could never actually reach submit-for-review/approve/reject/rehire, since those records
   start with no `hotel_group_id` and the scope check denies on null — added an explicit "does this
   actor own a group at all" fallback for exactly those four actions.

Also fixed 2 MEDIUM findings: `restore()` wasn't clearing `marked_suitable` (leaking probation status
across a rehire), and the down-migration's remap discriminator used a forgeable free-text field (fixed
to use the deterministic history-row id).

**A second, user-driven review round** (after the PR was opened) caught one more real bug: `approve()`
(`PENDING → ACTIVE`) had no check that `submitted_for_review_at` was ever set — `assertTransition`
alone can't express a sub-state guard, so an application could be approved without ever being
submitted. Fixed with an explicit `ConflictError` guard. The migration's `UNDER_REVIEW` timestamp
backfill comments were also strengthened to disclose it's an approximation (`updated_at`, not the true
event time) for pre-migration rows only.

**Governance conflict, resolved by amending ADR-030.** The permission expansion (scoped manager/RM can
now approve/reject/deactivate/reactivate/rehire) directly contradicted the ratified ADR-030 capability
matrix (`C-16` was pinned admin-only, deferred to a `backend-onboarding` module that was never built;
`C-18` was a separate admin-only "Deactivate employee" row) — caught by `capability-policy.test.ts`,
which exists specifically to catch this kind of drift. Resolved (user's explicit call) by amending
`ADR-030-manager-write-authority-capability-model.md` itself rather than pinning the divergence as known
debt: `C-16` now reflects the new grant, `C-18` is merged into it (deactivate is just one of six
uniformly-authorized transitions now), and two genuinely new admin-only capabilities (`delete`/`restore`)
are documented as deliberately NOT covered by `C-16`'s grant, since they cross the account boundary.

**CI debugging: a real, pre-existing landmine, not a new bug — found and fixed.** Three test suites
failed to even load with a confusing `TS1343`/`import.meta` error. Extensive bisection (schema, imports,
file size, `moduleResolution`) failed to isolate it; a targeted `diagnostics: warnOnly` dump plus a
fresh-context Opus subagent found the real root cause: **Jest in this repo never actually runs in
native-ESM mode** (the ESM preset needs `NODE_OPTIONS=--experimental-vm-modules`, which nothing sets),
so every file compiles as CommonJS regardless of config, and `config/env.ts`'s literal `import.meta.url`
is a syntax error under CommonJS. This was already known and worked around elsewhere in the codebase
(`route-registry.ts` and `outbox-config.test.ts` both have comments about it; 32 of 103 test files mock
`config/env.js` to sidestep it) — PR #354 was simply the first change to create an *unmocked* import path
reaching it (`employee-management/service.ts` → `auth/service.ts`, added for `bumpTokenGeneration`). Fixed
with a `backendRoot()` helper in `env.ts` that's safe under both CJS (Jest) and native ESM (production),
no behavior change. This unmasked (didn't cause) 15 genuinely stale test assertions in two suites that
could never previously load — rewritten in the same PR against the new lifecycle model rather than
deferred, since the user asked for it pulled forward.

**Final state**: `tsc --noEmit` and `eslint` clean; full suite 103/103 passed, 2249/2249 tests. Migration
harness (`Forward · Rollback · Recovery`) green — also caught and fixed two real `down.sql` bugs (a drop
ordering issue, and a redundant transaction wrapper conflicting with the harness's own `--single-transaction`).
Merged as commit `a25308b`.

### 3.6. PR #355 — merged (frontend lifecycle UI)

New `employeesApi` client methods for all 8 lifecycle actions; `EmploymentStatus`/`EmploymentRecord`
types updated to the new 5-value enum; new shared `lib/employmentStatus.ts` deduping the
`STATUS_TONE`/`STATUS_LABEL` maps that were previously copy-pasted in `WorkerOnboardingCard.tsx` and
`org-chart/page.tsx`; net-new action buttons (deactivate/reactivate/rehire/delete/restore) with
required-reason modals for deactivate/delete; a "Deleted" badge/date/reason display.

**Review (the user directly, not a subagent this round) caught a real gap**: every button rendered
for every viewer regardless of role — the frontend relied entirely on backend authorization with no
UI visibility gating (including Admin-only delete/restore rendering for a manager). Fixed:
`WorkerOnboardingGate` widened from admin-only to admit manager/RM (matching the six now-scoped
backend actions); the three still-admin-only actions (create/delete/restore) gated via a new
`useEmploymentPermissions()` hook — a named-capability hook (`canDeleteEmployment`, etc.), not
inline role-string checks, per a direct follow-up ask to avoid role checks scattering across
components as this surface grows. `refresh()` also broadened to revalidate org-chart/analytics SWR
caches via a key-matching predicate, not just the employment-record cache. `tsc`/`eslint`/`next
build` all clean.

### 3.7. PR #356 — merged (blocklist removal + real enforcement)

`isWorkerEligibleForHotel()` (`lib/roster-scope.ts`, the single choke point already used by
reassignment and broadcast-accept) now also checks the blocklist — previously it existed as pure
audit-log data, created and readable but enforced nowhere. New `DELETE
/employees/hotels/:hotel_id/blocklist/:entry_id` endpoint. Per an explicit user decision, also
fixed a separate gap found while tracing the enforcement path: `placeOnCalendar()` (manual calendar
placement) never checked worker eligibility at all, only the acting manager's own scope — now uses
the same check as the other two assignment-creation paths.

**Adversarial review (Opus) found and fixed one CRITICAL bug**: `removeBlocklist()` took only an
entry id and never verified it belonged to the hotel in the route path — `checkHotelAccess()`
validates the *path's* hotel_id, but the service silently ignored it, so a manager scoped to hotel
h1 could delete a blocklist entry belonging to hotel h2 just by knowing/guessing its id, fully
bypassing the route-level scope check. Proven end-to-end (204 where 403/404 was expected) before the
fix landed: `removeBlocklist()` now takes `hotelId` alongside `entryId` and 404s (not 403, to avoid
confirming the id exists elsewhere) on a mismatch. Regression tests added at both the service-unit
and full-route levels reproducing the exact scenario.

**GitHub Actions outage during this PR** (confirmed via `githubstatus.com` — `Actions:
major_outage`, `Pages: major_outage`, not an account billing issue as first suspected): CI never
ran. Cancel/rerun attempts on the queue both failed with contradictory state errors, consistent
with a platform-wide incident, not something fixable from this repo's side. Merged after full local
verification (backend `tsc`/`eslint`/103-suite-2265-test run, migration harness pairing, frontend
`tsc`/`eslint`/`next build`, both `.claude/tooling/*.js` validation scripts) substituted for CI, per
explicit user instruction — not a shortcut taken unilaterally.

### 3.8. PR #357 — merged (`MODULE_SPEC.md` doc sync)

`SPEC-EMP-001` (FROZEN, v0.2.7) still described the terminal 5-state lifecycle that #354 replaced in
code — ADR-030's amendment covered the permission-matrix side, this spec covered the lifecycle-model
side and was still stale. Amended to v0.2.8 following the doc's own precedented "Correction" pattern
(Document Control table entry), citing the shipped implementation + the ADR-030 amendment as
authority — **a deliberate "pragmatic sync" scope decision**, not the full formal process this
repo's documentation discipline would otherwise call for (updating
`CONFIRMED_REQUIREMENTS_REGISTER.md`/`PIVOT_DESIGN_DOCUMENT.md` first). CRR/PDD are explicitly
flagged as NOT updated and still stale on this point — a future documentation pass should reconcile
them, but this correction didn't block on that. Updated: `REQ-EMP-002`/`RULE-EMP-02/03`, the full
State and Lifecycle section, the interface catalog (retired `IF-EMP-LifecycleSignal`/
`IF-EMP-Deactivate`, added the 8 real endpoints + `IF-EMP-RemoveBlocklist`), the events table, the
permission matrix, plus a stale cross-reference in `docs/03-modules/documents/MODULE_SPEC.md` and a
forward-note (not an amendment) on `ADR-023`. Also merged during the GitHub Actions outage, same
local-verification substitution as #356 (docs-only — `repository-integrity-check.js`/
`context-loader.js --validate` both exit 0).

**The employment-lifecycle rework is now fully shipped end to end.** Full 21-scenario end-to-end
verification list (including the environment's no-live-DB constraint)
is in the plan file — not yet run, since PRs 3–5 aren't fully built.

## 4. Deferred bug reports — 6 from the prior session + 11 new, none investigated yet

These arrived mid-research on the lifecycle plan (6 originally, then 11 more mid-session). The
user explicitly chose to finish the lifecycle plan first and triage these after, then — when the
11 new ones arrived — explicitly said to "bunch similar work of bugs and do that way" once
lifecycle work resumes. **None of the below have been looked at, reproduced, or root-caused yet.**
Investigate each fresh; don't assume any are related to each other or to the lifecycle work above.

The original 6 (numbered 1–6 below) predate the batching instruction and haven't been re-sorted
into it, but conceptually: #1 and the new "assignment completed but request still pending" item
belong together (calendar/assignment status-sync); #4 and #5/#6 are UI-surface bugs, not a natural
fit for any one batch below.

**Batch — calendar/assignment status sync** (item #1 below + two new items):
- Worker accepted a broadcast job but it's not in the calendar (see #1 below, full detail).
- **Assignment marked completed but the work request still shows pending** — likely the same class
  of bug as #1: some downstream read (work-request status) isn't reacting to an upstream write
  (assignment completion). Check whether `job-requests/service.ts` recomputes/reads `JobRequest`
  fulfillment status off `WorkerAssignment.status` synchronously, or whether it's cached/derived
  incorrectly. Investigate both together — a shared root cause (status change not propagating to
  a dependent read) is plausible but not yet confirmed.
- **Assignments should not be able to start before their assigned date/time.** Not yet reproduced —
  need to determine whether this means (a) `AssignmentService.update()` allows a transition to
  `IN_PROGRESS` with no check against `WorkerAssignment.day`/a shift start time, (b) attendance
  check-in has no guard against checking in early, or (c) both. Check
  `assignments/service.ts#update()` (`ALLOWED_TRANSITIONS`, ~line 186) for any date/time
  comparison before allowing `CONFIRMED → IN_PROGRESS` — on a first read there does not appear to
  be one, but confirm rather than assume, and check the attendance module's check-in path
  separately since "start" could mean either.

**Batch — dashboard/analytics visibility** (4 new items, all in Analytics/reporting territory —
confirmed in this session's lifecycle research that the Analytics module currently has **zero**
`EmploymentStatus` filtering, for context, though these 4 items are about missing UI, not that):
- Color coding (red/green) for worker availability, visible to managers — no such indicator exists
  today; needs a "what does available/unavailable mean" clarification (currently `ACTIVE` status?
  no conflicting assignment that day? something else?) before building.
- Search/filter analytics and workforce by hotel, with room to scale to more hotels — check
  `frontend/app/(protected)/analytics/` (or wherever the analytics pages live) for existing
  hotel-filter patterns to extend, e.g. the org-chart's hotel-group scoping.
- No ranking/leaderboard system — Analytics `service.ts` (`getWorkerStats` etc., per this session's
  research) has the raw aggregate data (ratings, completed assignments) but no ranking query or UI
  surfaces it.
- Total rooms (stay-over/checkout/total headcount) per day, with notes on what work was done — a
  new reporting view; check `RoomsCompletedEntry` (referenced in this session's Analytics research)
  as a likely existing data source before assuming this needs new schema.

**Batch — missing UI controls** (3 new items, small/independent — likely 3 separate quick PRs):
- No hotel delete button (a delete/soft-delete action exists for hotels per the backend, per
  `hotels/[id]/page.tsx`'s existing "Deactivate" button noted in this session's research — confirm
  whether this is actually about a *different*, currently-absent delete action, or the user wants
  the existing Deactivate button relabeled/relocated).
- No language switcher — entirely new i18n surface; clarify scope (how many languages, where does
  the toggle live) before estimating.
- No edit-profile button — check `frontend/app/(protected)/profile/page.tsx`, referenced in this
  session's research as the navbar's profile destination; may already support editing and just be
  missing a discoverable entry point, similar to the "no leave/absence" ambiguity in #3 below.

**New feature — Leave & Sickness module** (leave requests, clash check, sick-note OCR): explicitly
scoped as a NEW feature by the user, separate from item #3 below (`AbsencesCard`'s existing
single-day mark-absence flow). OCR for sick notes is a genuinely new capability with no existing
precedent in this codebase — needs its own design/plan pass, not a quick add.

**Zirove copyright/footer notice**: clarified with the user — this means adding a "© zirove" (or
similar) copyright/ownership notice, most likely in the app footer or an About surface. Not a
LICENSE file or legal document change. Should be one of the smallest, fastest items to close once
picked up.

1. **Worker accepted a broadcast job but it's not showing in the calendar.** User's own hypothesis
   to check first: "should check if db has marked with calendar and user is blocked to the
   assignment for that day and time." Likely starting points: `job-requests/service.ts`'s
   broadcast-accept path (`acceptBroadcast`, referenced in earlier session summaries as writing a
   `WorkerAssignment` row with `skill_slot_id`), and whatever query populates the calendar grid
   (`frontend/app/(protected)/calendar/page.tsx`, `assignments/service.ts`'s
   `listCalendarEntries`/`moveCalendarEntry`). Check whether the calendar's day-exclusivity unique
   index (`WorkerAssignment_active_slot_unique`) or the roster-eligibility check is silently
   rejecting/hiding the row rather than erroring.

2. **"Check work requests staffing — no logic is correct or not."** Vague as given; needs
   clarification on what specifically looks wrong before investigating. Don't guess at a specific
   bug — ask the user what staffing behavior they observed that seemed incorrect, unless a look at
   `job-requests/service.ts`'s staffing/fulfillment logic surfaces something obviously broken on
   inspection first.

3. **No way to create a leave or absence.** Note: `frontend/components/calendar/AbsencesCard.tsx`
   already exists and has a "Mark absence" flow (confirmed to exist and just got a timezone bugfix
   in PR #353) — so this report likely means either (a) the entry point to that card isn't
   discoverable from wherever the user was looking, (b) a specific role can't reach it, or (c) this
   is about a *different* kind of leave/absence than what `AbsencesCard` already covers (e.g. a
   multi-day leave request vs. single-day sick/vacation mark). Clarify which before assuming
   AbsencesCard needs fixing vs. a genuinely new feature is being asked for.

4. **RESOLVED in PR #358 (§1.5).** Raw worker ID showing in "Placement details" was one instance of
   a pattern repeated across `assignments/calendar-entries/page.tsx` (the exact sibling list the
   original calendar-grid fix missed) plus assignments, attendance, geo-checkins, work requests,
   broadcasts, and notifications. All fixed via `useUsersByIds`/`useHotel`/`useWorkRequest`.

5. **No Settings tab; want it at the bottom of the sidebar, with the profile button moved above
   it (out of the navbar).** This is a UI reorganization request layered on top of the just-shipped
   sidebar rework (#351/#352) — check `frontend/app/(protected)/profile/page.tsx` (exists per the
   navbar's current profile link in `AppShell.tsx`) to see what "Settings" would actually contain
   vs. what's already in Profile; may be a rename/relocate rather than new functionality. The
   navbar currently has: mobile menu button, "Hotel CRM" wordmark (mobile only), notifications
   bell (#352), profile link+badge, logout button (see `AppShell.tsx`'s header section). Moving
   profile to the sidebar bottom is a structural AppShell change, same file the last two PRs just
   modified — read it fresh, don't assume the structure described in this handoff's PR summaries
   above is still exactly current once other fixes land on top.

6. **Sidebar toggle/expand-collapse "not smooth."** This is feedback on the exact feature just
   shipped in #351 (hover-expand-to-w-60 rail) and fixed further in that PR's own review round
   (icon clipping, focus/hover collision). "Not smooth" is vague — could mean: the 200ms
   `transition-[width]` duration/easing feels off, the label fade-in is visually janky (the #351
   review already flagged that fixed-width `max-w-[10rem]` labels of different lengths finish
   revealing at different points relative to the icon transition, calling it a minor cosmetic
   desync, not something that was fixed), or something else entirely (e.g. layout thrashing in a
   real browser that the Playwright static-HTML preview used for verification wouldn't have
   caught, since PR #351/#352/#353 all explicitly noted they could NOT drive the live authenticated
   app in this environment — no seed script, no test credentials, and the only configured
   `DATABASE_URL` is a shared remote instance). **Get a screen recording or more specific
   description from the user before guessing at a fix** — this is exactly the kind of thing that's
   hard to diagnose from a text description alone, and the previous PRs already exhausted the
   "reasonable guesses from the code" approach once.

## 5. Standing user preferences / feedback to apply going forward

- **EC2 deploy/restart actions are pre-authorized.** Don't pause to confirm before deploying or
  restarting the app on the project's EC2 instance — this was an explicit correction earlier this
  session (previously I'd been cautious about this class of action; user considers it pre-approved
  going forward, at least for this repo's EC2 target). Also saved to persistent memory
  (`feedback_ec2_deploy_autonomy.md`) so this should already be in effect in future sessions too.
- **One logical change per PR/branch** — this discipline has been followed all session and should
  continue. Don't bundle unrelated fixes into one PR even when they're found together (e.g. the
  three deferred bug reports above, once investigated, should very likely become 3+ separate PRs,
  not one).
- **Independent adversarial review before considering a PR "done."** Every PR from #348 onward
  got a background review agent pass that found real bugs before merge. Keep doing this for
  anything non-trivial — it has a 100% hit rate so far on this session's PRs.
- **Ask before merging, never merge your own PR** — the user has been merging every PR themselves
  after review; this hasn't changed and shouldn't be assumed to change.
- **When a design/product decision is genuinely ambiguous (not just "many valid technical
  options"), ask via `AskUserQuestion` rather than guessing** — this happened repeatedly this
  session (RM-demotion vacancy semantics, blocklist enforcement scope, overnight-shift validation
  behavior, sidebar-collapse trigger mechanism) and every time the user's answer materially changed
  what got built, confirming this is the right default for this project.

## 6. Established environment limitations (don't re-discover these)

- **No local dev database access in this environment.** The only `DATABASE_URL` configured points
  at a live/shared remote RDS instance (`hotel-crm-postgres.c5qscka2wg1e.eu-central-1.rds.amazonaws.com`).
  Never run destructive Prisma commands (`migrate dev`, `db seed`, the migration harness's `verify`/
  `down` commands) against it directly — those require a throwaway DB per the harness's own
  documented safety interlock (`MIGRATE_HARNESS_YES=1`). CI has its own ephemeral DB for the
  "Forward · Rollback · Recovery" check; rely on that for migration verification, don't try to
  replicate it locally in this environment.
- **No seed script / test credentials available**, so the live authenticated frontend cannot be
  driven end-to-end from this environment (no login possible). Verification for UI-only changes
  this session used: `tsc --noEmit`, `eslint`, `next build`, and static Playwright screenshots of
  hand-built HTML files replicating the exact Tailwind classes in isolation (NOT the real app) —
  this is a real limitation, not a shortcut, and should be disclosed in any future PR's test plan
  rather than implied to be full E2E coverage.
- **`chromium-cli` is not installed**; Playwright works via `npx playwright` but needs
  `NODE_PATH=<the npx cache dir found via find ~/.npm/_npx -iname "playwright" -type d>` to resolve
  in plain `node` scripts (CommonJS `require`, not ESM `import` — ESM resolution didn't honor
  `NODE_PATH` the same way when tried).
- **GitHub Actions billing can be exhausted mid-session** (happened once already) — if deploy/CI
  runs start failing instantly with a billing message, that's an account-level issue, not a code
  problem; it self-resolves and doesn't need a code fix.
- **RESOLVED, but the mechanism is worth knowing:** `npx jest` can fail on any suite whose import
  graph reaches `backend/src/config/env.ts` unmocked, with `TS1343: The 'import.meta' meta-property
  is only allowed when...`. Root cause (found in #354's CI debugging, after an initial wrong "it's
  pre-existing, unrelated" diagnosis that had to be retracted): **Jest in this repo never actually
  runs in native-ESM mode** — the ts-jest ESM preset only activates under
  `NODE_OPTIONS=--experimental-vm-modules`, which nothing sets, so every file compiles as CommonJS
  regardless of the inline `module: "ESNext"` tsconfig override, and `env.ts`'s literal
  `import.meta.url` is illegal syntax there. This is now fixed at the source (`env.ts` uses a
  `backendRoot()` helper that's safe under both CJS and native ESM), so it should not recur — but
  if it ever does (e.g. a new module imports something that reaches `env.ts` in a way the fix
  didn't anticipate), the fix is either mock `config/env.js` in the test (32 files already do this)
  or extend `backendRoot()`, not re-diagnose from scratch. `git stash`-based "is this pre-existing"
  checks are unreliable if the stash doesn't cleanly revert generated Prisma client output —
  verify via a real `git worktree add` checkout instead.

## 7. Quick reference: where things are

| What | Where |
|---|---|
| Employee Management module | `backend/src/modules/employee-management/{routes,controller,service,types,constants}.ts` — **this is the epicenter of the lifecycle rework** |
| Employment lifecycle transition table | `backend/src/modules/employee-management/constants.ts` (`ALLOWED_TRANSITIONS`, `assertTransition`) |
| Employment lifecycle tests | `backend/src/__tests__/employee-management.test.ts`, `employee-management-scope-authz.test.ts` |
| Roster/eligibility scope primitives | `backend/src/lib/roster-scope.ts`, `backend/src/lib/scope.ts` |
| Manager/HotelGroup vacancy model (precedent for this rework's migration style) | `backend/src/modules/crm/service.ts`, migration `20260806000000_manager_rm_vacancy_history` |
| Worker onboarding UI (status-gated buttons) | `frontend/components/employees/WorkerOnboardingCard.tsx` |
| Org chart UI (duplicates onboarding's status maps) | `frontend/app/(protected)/hotel-groups/[id]/org-chart/page.tsx` |
| Calendar grid (site of the raw-worker-ID bug, deferred item #4) | `frontend/app/(protected)/calendar/page.tsx`, `frontend/hooks/useHotels.ts` (`useUsersByIds`) |
| App shell / navbar / sidebar (site of deferred items #5, #6) | `frontend/components/layout/{AppShell,SidebarNav,NotificationsBell}.tsx` |
| Migration harness (forward/rollback/recovery proof) | `backend/scripts/migrate-harness.sh` |
| Permission matrix | `backend/src/config/constants.ts` (`ROLE_PERMISSIONS`) |
| Backend HR module (calls into employee-management) | `backend/src/modules/hr/{routes,controller,service,types}.ts` |

## 8. Immediate next action for whoever resumes

**The employment-lifecycle rework is fully shipped** — PRs #354, #355, #356, #357 are all merged
(see §§3.5–3.8). `main` is synced locally. Next:

1. **Triage the 13 deferred items in section 4** — group into the 4 batches already identified
   there (calendar/assignment status sync, dashboard/analytics visibility, missing UI controls,
   Leave & Sickness module as a new feature), plus the standalone zirove copyright/footer item.
   Each batch or item likely becomes its own PR, per this repo's established
   one-logical-change-per-PR discipline.
2. Optionally: run the full 21-scenario end-to-end verification list from the plan file
   (`~/.claude/plans/expressive-floating-koala.md`) if a real environment with DB/auth access
   becomes available — not done yet, since this session never had one (see §6's environment
   limitations).
3. Every PR gets the same bar established across #354–357: `tsc --noEmit`/`eslint` clean, the FULL
   test suite green (not just touched files — #354's CI debugging showed an unmocked import chain
   in one module can break suites in another), independent adversarial review (an Opus subagent)
   before considering it done, and the user merges — never self-merge.
4. **CI re-run discipline:** after fixing a failing CI check, re-run only that specific failed job
   rather than the whole workflow, where GitHub's re-run API allows scoping to one job.
5. **If GitHub Actions is down again** (check `https://www.githubstatus.com/api/v2/components.json`
   for the `Actions` component before assuming it's an account/billing issue — #356/#357 both hit a
   real platform-wide outage, not a config problem): full local verification substituting for CI is
   an accepted pattern in this repo now, but only merge that way with the user's explicit
   go-ahead each time, not as a standing default.
