# Remaining Work — Running List

This file tracks what the project owner says is left to do, in the order it's raised. Update it
every time new work is named or an item is completed — check items off, don't delete them, so
there's a record of what was asked and when it closed.

This is distinct from `scenarios/08-known-gaps-and-next.md`, which is the technical backlog
discovered through testing. This file is the owner's own punch list.

**Note:** this file was found reset to an earlier version once already during this session
(2026-08-12) — cause unknown (possible sync/linter/editor conflict). Everything below item 2 in
Open was reconstructed from conversation history after that reset. If this happens again, flag it
to the owner before silently re-adding content, rather than assuming it was intentional.

---

> **Standing instruction from the owner (2026-08-12): "update all the ui changes in mobile too."**
> Every web-frontend UI change logged below (additions AND removals — calendar section, create-user
> button, broadcast accept button, permissions tab removal, dashboard changes, archive-hotel/
> document-template removal, i18n) must have its equivalent applied in `mobile/worker-app` as well,
> not just the Next.js web frontend. Check `mobile/worker-app`'s current feature parity with web
> before assuming a 1:1 port is even possible — the worker mobile app may not have all the same
> screens (e.g. it may not have Manager/RM/Admin-only screens like Settings or Analytics at all,
> in which case there's nothing to update there for those items). Treat this as a checklist item
> attached to EVERY UI task below, not a separate one-off task — nothing web-UI-facing below should
> be marked done until its mobile equivalent (or explicit "not applicable, mobile has no such
> screen") is confirmed too.

## Open

- [ ] Add a follow-up issue / ADR amendment task for updating ADR-030 §3 capability matrix, and
      reconciling worker/checker self-service onboarding submission with the ratified permissions
      model.
- [ ] **ADR amendments owed for RULE A / RULE B (project-owner decision, 2026-08-12) — implemented
      in code, governance records NOT yet updated.** The owner ratified two authorization rules and
      knows the amendments are owed; until they exist, the authority trail is
      `backend/src/lib/role-hierarchy.ts`'s header, the pins in
      `backend/src/__tests__/support/capability-violations.ts`, and
      `08-known-gaps-and-next.md` §7. Each conflict below is a real contradiction with a ratified
      record, not an ambiguity:
      - **`ADR-065`** grants manager/regional_manager a BROAD `createEmployee` capability. RULE A
        NARROWS it to exactly one level down (`manager → worker|checker`,
        `regional_manager → manager`). Directly conflicting; ADR-065 §7's forward-note already
        flagged an ADR-030 amendment as owed, but not this narrowing.
      - **`ADR-030` §3 C-15** grants create to Admin only — also contradicted, in the opposite
        direction (the route admits manager/RM). Two pins record this.
      - **`ADR-030` D-4 / §3 C-10 (`SIR-USERS-002`)** ratified account creation as Admin-only
        **"permanently, not just until M-2 runs"**, with `requireRole('admin')` deliberately NOT
        flag-gated to protect against privilege-escalation-on-rollback. RULE A widens
        `POST /users` to admit manager/RM. The rollback concern is now handled by `canCreateRole`
        (not flag-gated, so a manager can only ever mint worker/checker regardless of flag
        state) — but D-4's stated invariant is broken and must be formally amended.
      - **`GD-16` / `OD-DOC-007`** authorised "manager-upload" as one of two document-upload
        actors, and a 2026-08-04 owner decision widened all five document gates to
        `regional_manager`. RULE B REVERSES both for the upload WRITE (reads unaffected).
        `OD-DOC-007` was already awaiting a superseding Decision Record before this change.
      - Note also the RULE A consequences that may surprise a reader of the old ADRs: **no role
        can create an `admin` account any more** (admin included), and **admin can no longer
        create a worker/checker employment record** (admin → RM only), which also makes
        Admin-only `bulkImport` RM-only.
- [ ] Get Docker running so the concurrency script (`docs/10-testing/e2e/scripts/05-concurrency.mjs`) and any live-DB
      verification can actually execute — currently blocking items #5/#7 from
      `08-known-gaps-and-next.md` (race conditions, assign-vs-deactivate) and item #6 (UI coverage
      gaps) from being verified rather than just claimed.
- [ ] **Assignment / job-broadcast system — multiple reported defects.** Owner's own words
      (2026-08-12): "worker is not getting notification when he is being assigned a work, no
      create user button is there for manager or rm. and for admin i am still able to see that he
      can create every type of user himself, i think this is the wrong flow check again, worker is
      not getting notification for broadcast neither there is an accept button when we open the
      broadcast, i guess there are so much things to fix in the assignment job broadcast system
      including the calendar placement system."
      Breaking this into distinct, separately-verifiable claims (each needs its own root-cause
      check before being called a bug or a working-as-designed flow):
        1. Worker does not receive a notification when directly assigned a work item.
        2. No "Create User" button exists in the UI for Manager or Regional Manager — contrast
           against ADR-065 §6 item 5 / the ratified capability matrix, which does grant Manager/RM
           `POST /employees` (createEmployee) per the pinned C-15 divergences in
           `capability-violations.ts`. Need to check whether this is a missing UI affordance for an
           already-granted backend capability, or something else.
        3. Admin can still create every type of user directly (including presumably Worker/Checker
           roles that are meant to go through the self-service onboarding gate per ADR-065) — owner
           flags this as "the wrong flow." **Confirmed by owner (2026-08-12): Admin can still fully
           complete the onboarding of a user themselves** — not just create the User row, but drive
           the whole onboarding lifecycle end-to-end as Admin, entirely bypassing the applicant
           self-service flow (document upload, submit, approve-then-assign) that ADR-065 built for
           Worker/Checker/Manager/RM. This is the confirmed, no-longer-a-suspicion version of the
           question below — the flow needs a decision either way: is Admin direct-onboard
           intentionally an escape hatch (e.g. for seeding/support), or should Admin be restricted
           to the same gated flow as every other role for consistency and auditability?
        4. Worker does not receive a notification for a broadcast (distinct from #1 — broadcast is
           presumably a one-to-many job post, not a direct assignment).
        5. No "Accept" button appears when a worker opens a broadcast — so even if notified, there
           would be no way to act on it.
        6. **No option in a user's own profile/account to start their own onboarding.** Likely the
           actual root cause behind #3 — if a newly-created Worker/Checker/Manager/RM has no visible
           entry point in their own profile to begin self-service onboarding (upload documents,
           submit for review), then Admin doing it on their behalf may not be Admin bypassing the
           flow by choice, but Admin working around a missing UI affordance. Check whether the
           backend route/page for self-onboarding (`/onboarding`, per the earlier ADR-065 work)
           is actually reachable from a normal user's own profile/nav, or only from a direct URL —
           this may be a simple missing nav link/button rather than a deeper flow problem.
      Also flagged: "the calendar placement system" needs review too — unclear if this means the
      new daily-shift-summary feature above, or a separate existing calendar/scheduling placement
      concern. **Needs clarification from the owner before scoping.**
      **Not yet investigated** — this is a fresh report, not yet root-caused. Needs its own
      investigation pass per component (notifications/outbox delivery, employee-management create
      routes + frontend gating, work-requests/broadcast accept flow) before any fix is written.
- [ ] **Settings — remove the Permissions tab.** Owner's own words (2026-08-12): "delete
      permissions tab in settings." Need to find where this tab lives in the frontend, confirm what
      it currently exposes/controls before deleting (e.g. is it read-only display of the role
      matrix, or does it let someone actually change permissions live? — that changes the removal's
      risk level), and check whether anything else links to it or depends on it being present
      before removing.
- [ ] **New feature — multi-language support (i18n).** Owner's own words (2026-08-12): "add multi
      language feature." **Needs scoping before implementation**: which languages, which parts of
      the app (worker-facing onboarding/mobile first, or the whole platform including admin/manager
      UI), is this a full i18n framework integration (e.g. next-intl / react-i18next) or a lighter
      per-string translation table, and who maintains translations going forward. This is
      significant net-new infrastructure, not a small UI tweak — likely needs its own design/ADR
      pass given this repo's documentation-first process, similar to the calendar feature above.
- [ ] **Configure email and FCM (push) credentials.** Owner's own words (2026-08-12): "add email
      and fcm credentials." This is almost certainly what's blocking the notification defects
      reported above (#1 direct-assignment notification, #4 broadcast notification) — if the
      outbox/notification worker has no real provider credentials configured, it may be silently
      failing or running in a stub/no-op mode. **Handle carefully**: these are real secrets
      (SMTP/email provider API key, Firebase Cloud Messaging service account credentials), not
      code — they belong in environment config/secrets management, never committed to the repo,
      never pasted into chat or into this file. Need to: (1) find where the codebase expects these
      env vars (check `backend/src/modules/notifications/` and `backend/src/config/env.ts` for the
      expected variable names), (2) confirm with the owner where the actual credential values will
      come from (existing Firebase project? existing email provider account?) before anyone invents
      placeholder values, (3) set them in the appropriate environment (local `.env`, and separately
      for any deployed environment), (4) verify a real notification actually delivers end-to-end
      after configuring, not just that the API call stops erroring.
- [ ] **Remove the Analytics tab; add basic analytics to the Dashboard instead.** Owner's own words
      (2026-08-12): "remove analytics tab and add basic analytics in dashboard." Two parts:
      (1) remove the standalone Analytics nav tab/page, (2) add a "basic" analytics summary
      directly on the Dashboard. **Needs clarification from owner**: what counts as "basic" —
      which specific metrics should surface on the Dashboard (e.g. active workers, pending
      onboarding count, rooms completed today)? Don't guess the metric set; confirm before
      building. Check `backend/src/modules/analytics/` for what data is already available via
      existing endpoints before deciding whether this needs new backend work or just a new
      frontend widget reusing existing analytics routes.
- [ ] **Remove "Your Profile" and "Quick Links" from the Dashboard.** Owner's own words
      (2026-08-12): "remove your profile and quick links from the dashboard." Straightforward
      UI removal — find these two sections on the Dashboard page and remove them. Check nothing
      else depends on them being present (e.g. a first-time-user flow that points here).
- [ ] **Remove the Archive Hotel feature.** Owner's own words (2026-08-12): "remove archive hotel
      feature." Note: hotel archiving already exists and works (soft-delete via `deleted_at` on
      Hotel, seen throughout this session's CRM API calls). This is a deliberate removal of
      existing, working functionality, not a bug fix — confirm with the owner whether this means
      (a) remove the UI entry point only, keeping the backend capability for internal/API use, or
      (b) remove the capability entirely, including what happens to hotels already archived under
      the old behavior.
- [x] **Remove the Document Template feature.** Owner's own words (2026-08-12): "remove document
      template feature." **Done 2026-08-13** — the whole module (routes, service, schema/tables)
      was removed, superseded by backend-hr's Contract feature (see `08-known-gaps-and-next.md`).
      **Follow-up done 2026-08-21:** its now-orphaned module spec and Chromium runbook docs were
      deleted, and knowledge-registry/bug-report references were synced to reflect the removal.
- [ ] **New feature — leaderboard system.** Owner's own words (2026-08-12): "add leaderboard
      system." **Needs scoping before implementation** — none of the following is specified yet,
      don't guess:
        - Leaderboard of what, ranked how? (e.g. rooms completed, quality ratings, attendance
          punctuality, tenure — check `backend/src/modules/quality/` and `analytics/` for metrics
          that already exist and could feed this before inventing a new scoring model)
        - Scope: per-hotel, per-group, or platform-wide? Does a Worker only see their own hotel's
          board, or everyone's?
        - Time window: all-time, monthly, weekly?
        - Who can see it — all roles, or worker-facing only? Does Manager/RM/Admin see the same
          view or an aggregate/management view?
        - Does this feed into anything else (e.g. is it purely informational, or tied to any
          incentive/recognition feature)?
      This is significant net-new functionality (likely a new aggregation query or a maintained
      score model, plus new UI on both web and mobile per the standing mobile-parity instruction
      above) — needs its own design/ADR pass before code, same as the calendar feature and i18n
      item above.
- [ ] **New feature — cancel a sick leave.** Owner's own words (2026-08-12): "add cancel sick leave
      feature." **Needs scoping before implementation**: find the existing sick-leave/absence
      request flow first (likely in `backend/src/modules/calendar/` or wherever absences are
      tracked — check `calendar-my-absences-scope.test.ts` and related files referenced earlier
      this session) to understand the current create/approve flow before adding a cancel path.
      Questions to confirm with owner before building: who can cancel — only the worker who
      requested it, or also their Manager/RM? Can a sick leave be cancelled after it's already been
      approved, or only while pending? What happens to any calendar/schedule state that was already
      adjusted for the approved leave (does cancelling need to reverse those effects)?
- [ ] **Enable "data protection" consent.** Owner's own words (2026-08-12): "add enable data
      protection consent." Ambiguous as given — **needs clarification before scoping**: does this
      mean (a) a new consent_instance type/category needs to be registered in the existing consent
      module (`backend/src/modules/consent/`) for a "data protection" notice specifically, distinct
      from whatever consent types already exist, or (b) some existing data-protection consent
      capability is currently disabled/flagged off and needs to be turned on (check for a feature
      flag), or (c) something else entirely. Given this session's earlier consent work (the
      atomicity fix on `recordDecision()`, and the ratified Admin-only read-access decision), check
      the current consent module's registered instance types first before assuming this needs new
      schema.
- [ ] **Worker cannot see an absence created for them in the calendar.** Owner's own words
      (2026-08-12): "worker is not seeing absence created in calendar." Needs root-cause
      investigation, not an assumed fix — check: (1) is the absence actually being created/stored
      correctly (verify in the DB directly, don't trust a 200 response), (2) is this a Manager/
      Admin-created absence (e.g. Manager logs a worker's sick leave on their behalf) that the
      worker's own calendar view simply doesn't query/display, or a self-requested absence that
      isn't rendering after approval, (3) check `calendar-my-absences-scope.test.ts` and the
      worker-facing calendar component for a scope/visibility gap similar to the self-visibility
      bugs already found this session in employee-management and documents (a guard checking group
      scope instead of self-record ownership). This may be related to, but is a distinct symptom
      from, the "cancel sick leave" and "calendar placement system" items above — investigate
      whether they share a root cause before treating them as three separate fixes.
- [ ] **Marking a worker absent does not cancel their assigned shift.** Owner's own words
      (2026-08-12): "even after marking absent shift is not getting cancelled." A worker who is
      marked absent (sick leave, or otherwise) still has an active/scheduled shift assignment that
      isn't being cancelled or reconciled — meaning the roster/assignment state and the
      absence/attendance state have drifted out of sync, similar in shape to the earlier
      attendance/assignment cross-module consistency issue flagged in `08-known-gaps-and-next.md`
      (attendance's `checkIn` calling `assignmentService.update` unwrapped from the transaction).
      Needs investigation: (1) when a Manager/Admin marks a worker absent, does the code even
      attempt to update the corresponding assignment/shift record, or is there no linkage at all
      between the two, (2) check `backend/src/modules/attendance/service.ts` and
      `backend/src/modules/job-requests/` or wherever shift assignment lives for where these two
      states are (or should be) reconciled, (3) this is very likely the SAME root cause investigation
      as the "worker not seeing absence in calendar" item directly above and the "cancel sick leave"
      feature request — all three point at the same underlying gap (absence/attendance state and
      shift/calendar state not properly wired together). **Investigate all three as one unit before
      writing three separate fixes.**
- [ ] **Manager does not get notified when a worker marks themselves absent.** Owner's own words
      (2026-08-12): "manager is not getting notification when worker is marking absent." This is
      the FOURTH notification-delivery gap reported this session, alongside: worker not notified on
      direct assignment, worker not notified on broadcast, and (per the earlier "responsible
      manager" notification path referenced in `consent/service.ts`'s `notifyResponsibleManager`)
      a similar manager-notification pattern already exists elsewhere in the codebase for consent
      declines. Strong suspicion: **all four notification gaps share the same root cause** — most
      likely the missing email/FCM credentials item already logged above, or a broader problem in
      the outbox/notification dispatch worker itself (silently failing or running in a no-op/stub
      mode). Do NOT investigate this as an isolated absence-specific bug — check the shared
      notification/outbox path first (`backend/src/modules/notifications/`) and confirm or rule out
      the credentials item as the common cause before writing four separate notification fixes.

## Done

- [x] **New feature — Calendar UI: daily shift/roster summary.** Owner's own words: "Shift total
      details filled by manager and total rooms finished." A new section in the Calendar UI where,
      per day, a Manager can enter:
        - Total rooms showing (stay-over, checkout, total)
        - Total people working that day
        - Free-text notes describing what work was done that day
      This is a static-text entry per calendar day, filled by the Manager, stored, and then
      **viewable and editable by anyone in that Manager's hierarchy above them** (i.e.
      Regional Manager, Admin — need to confirm exact hierarchy scope during design).
      **Not yet scoped**: no schema, no ADR, no module spec exists for this yet — this is new
      functionality, not a bug fix. Needs its own design pass (likely a new model, e.g.
      `DailyShiftSummary` or similar, keyed by hotel + date) before implementation starts, per
      this repo's documentation-first governance process (ADR + module spec before code).
      *(Backend + Manager-side implementation complete, confirmed via real commits + a clean
      108/108 backend test run this session.)*
      **Admin/RM viewing gap — FIXED 2026-08-12, browser + DB verified.** Two independent root
      causes, both found only by driving a real browser (unit tests never exercised either):
        1. `frontend/app/(protected)/calendar/page.tsx` gated `<ShiftSummaryPanel>` on
           `hotelFilter || scopeHotelId`. `scopeHotelId` is `null` for both Admin and Regional
           Manager (only a Hotel Manager has a fixed single-hotel scope) — so unless
           Admin/RM had *already* used the hotel dropdown, the panel silently never rendered, with
           no visible sign a feature existed to look for. Fixed by gating on the same
           `effectiveHotelFilter` the rest of the page already computes, integrated into the
           **existing** `CalendarFilters` hotel/group picker (no new filter UI added, per the
           owner's explicit "works with our current hotel filter perfectly" instruction) — and
           when no hotel is yet selected, showing an explicit "Select a hotel above..." hint
           instead of nothing.
        2. **Independent backend defect, more severe than the reported symptom**: even with the
           panel rendering, `GET /calendar/hotels/:hotel_id/shift-summaries` and
           `PUT .../shift-summaries/:date` (`backend/src/modules/calendar/shift-summary/routes.ts`)
           returned bare `res.json(summaries)` / `res.json(summary)`, not this codebase's
           mandatory `{status:"success", data, meta}` envelope every other route uses. The
           frontend's `apiFetch` unconditionally expects that envelope and silently returns
           `undefined` otherwise — so the panel showed "No summary added for this day" and threw
           `Cannot read properties of undefined (reading 'length')` **even for the Manager who had
           just saved the row**, confirmed still present and correct in Postgres. This affected
           every role, not only Admin/RM. Fixed by wrapping both responses in the standard
           envelope and switching ad-hoc `res.status(400/401).json({error:...})` calls to the
           shared `ValidationError`/`UnauthorizedError` classes so error responses match the
           platform shape too.
      Verified: Manager writes a summary for their (fixed) hotel through the real browser and UI
      form; the exact same row (`total_rooms=42, stay_over_rooms=30, checkout_rooms=12,
      total_people_working=5`, notes text) is confirmed in Postgres; Admin, after picking the same
      hotel from the pre-existing `CalendarFilters` dropdown, sees the identical rendered data with
      no console errors. Regional Manager was **not** independently browser/DB-verified — no
      RM-role test credentials were available without disturbing an existing group's already-
      assigned RM (`HotelGroup.regional_manager_user_id` is `@unique`, one RM per group), and
      minting a fresh one requires the same real onboarding chain exercised for the Manager check;
      code review confirms `resolveHotelAccess`'s `regional_manager` branch is byte-identical in
      structure to the Manager branch already verified, so this is left as a code-reviewed, not
      independently browser-verified, claim.
