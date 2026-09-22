# Manager App — Research and Implementation Plan

**Status:** Draft plan, awaiting owner approval. No code written.
**Scope:** A new Expo app, `mobile/manager-app`, giving `manager`, `regional_manager`
and `admin` the full surface each is authorized to hold today on the Next.js web
portal — in the apps' own UI language.
**Authored:** 2026-09-21. **Repository revision at research:** `claude/manager-app-research-plan-vs5yh0`.

---

## 1. Why this exists

The Next.js portal at `frontend/` is the *only* surface for `manager`,
`regional_manager` and `admin` (`frontend/CLAUDE.md`: "workers and checkers use
the Expo apps"). A hotel manager standing at a front desk, or a regional manager
moving between properties, currently needs a browser and a laptop-shaped screen
to approve an application, verify an attendance record, or move tomorrow's rota.

Housekeepers and checkers already have native apps. The people who supervise them
do not. This plan closes that gap.

It also settles a standing instruction that has been accumulating debt: the owner's
2026-08-12 directive in `docs/10-testing/e2e/REMAINING_WORK.md` — *"update all the ui
changes in mobile too"* — currently has no manager-side target at all, so every
manager-facing web change has been marked "not applicable, mobile has no such screen"
by default. After this app exists, that answer stops being available.

### Decisions taken by the owner (2026-09-21)

| # | Decision | Consequence |
|---|---|---|
| D-1 | **One role-gated app**, not three. `manager`, `regional_manager` and `admin` all sign into `mobile/manager-app`. | One EAS project, one Daiwi entry, one store listing. Navigation and screens gate on role **and resolved scope**, mirroring `frontend/components/layout/SidebarNav.tsx`. |
| D-2 | **A shared package, for the new app only.** `mobile/shared` is created and `manager-app` is built on it. `worker-app` and `checker-app` stay on their hand-maintained copies for now. | No migration risk to two shipped, production apps. Accepted cost: three sources of truth during the transition — §9 R-1 records how that is contained. |
| D-3 | **Every feature the role is allowed** — full parity with what each role actually sees and can do on the web today. No new authorization, no widening, nothing omitted. | `ADR-030`'s capability matrix is the scope boundary. Admin-only master data ships in the app, gated to `admin`. |

---

## 2. What already exists — do not rebuild it

| Asset | Where | Reuse verbatim |
|---|---|---|
| Design tokens | `mobile/worker-app/src/constants/theme.ts` | Colors (light/dark), `Spacing`, `Radius`, `Elevation`, `Fonts`, `BottomTabInset`, `MaxContentWidth`. Byte-identical in both apps today. |
| UI primitives | `mobile/worker-app/src/components/ui/index.tsx` | `Card`, `Button`, `ScreenHeader`, `SectionHeader`, `Badge`, `StatTile`, `EmptyState`, `ListRow`. |
| Themed text/view | `.../components/themed-text.tsx`, `themed-view.tsx` | The whole type scale lives in `themed-text.tsx:36-75`. |
| API client core | `mobile/worker-app/src/lib/api.ts` | 401 refresh with a shared in-flight promise, `SKIP_REFRESH_PATHS`, `ApiError`, `parseRetryAfter` (429), `CONSENT_REQUIRED` callback, FormData duck-typing. |
| Stores | `.../src/stores/` | `auth`, `theme`, `locale`, `notification`, `consent`, `chatbot` (zustand). |
| Storage | `.../src/lib/persistent-storage.ts` | SecureStore on native, `localStorage` on web. |
| Locale catalogues | `.../src/lib/i18n/locales/{de,en,ur,ar,fr,uk}.json` | 1160 leaf keys, six locales. |
| Push pipeline | `.../src/lib/push-notifications.ts`, `components/PushRegistration.tsx` | `getDevicePushTokenAsync()` (raw APNs/FCM, not Expo tokens); registration mounted **inside** `ConsentGate` on purpose. |
| Update gate | `.../components/UpdateChecker.tsx` | Daiwi `/install/api/latest` poll, non-dismissable update alert. |
| Screen shape | `mobile/worker-app/src/app/(app)/index.tsx` | `ThemedView > SafeAreaView > ScrollView(refreshControl)`, `FadeInUp.delay(i*80)` row entry, pull-to-refresh deliberately decoupled from SWR `isValidating` (`:78-89`). |

**Every backend endpoint the manager app needs already exists and is already
authorized.** This plan adds no new business capability. The only backend changes
are the three infrastructure items in §7 PR-0.

---

## 3. Authority — what the app may contain

`ADR-030` §3 is the capability register (C-01 … C-34) and the scope boundary for
D-3. `MANAGER_PERMISSIONS` is `Object.freeze`d at
`backend/src/config/constants.ts:123`; `REGIONAL_MANAGER` is
`[...MANAGER_PERMISSIONS, 'org_chart:read']` (`:359`). **RM = Manager + exactly one
token.** They differ otherwise only in scope breadth: `{type:'hotel'}` vs
`{type:'hotel_group'}`.

Manager/RM hold, verbatim from `constants.ts`: `hotels:read`, `hotels:operate`,
`hotel_groups:read`, `rooms:read`, `rooms:write`, `tasks:read`, `tasks:write`,
`quality:read`, `hr:read`, `hr:write`, `staffing:read`, `staffing:write`,
`notifications:read`, `analytics:read`, `users:read`, `users:write`,
`employees:read`, `employees:write`, `calendar:absence:write-own`,
`calendar:absence:write-team`, `notifications:mark-read-own`,
`assignments:status-write`, `job_requests:accept-own`,
`employees:review-queue-read`, `reports:read-team`, `reports:export-team`,
`reports:export-own`, `users:profile:write-own` (+ `org_chart:read` for RM).

They do **not** hold `quality:write`, `hotels:write`, `hotel_groups:write`,
`notifications:write`, `audit:read`, `employees:delete`,
`employees:special_category:read`, or `admin:*`.

### Three boundaries the app must not blur

1. **A manager reads quality, never writes it.** `quality:write` is Checker-only.
   The web portal gates the verification/rework card to `["admin","checker"]`
   (`frontend/app/(protected)/assignments/[id]/page.tsx:447`). The manager app shows
   inspection results and photos; it offers no "rate" or "assign rework" affordance.
2. **A manager does not log rooms.** `backend/src/modules/rooms/routes.ts:40,46,52`
   are `requireRole('worker')`. A manager enters only the aggregate
   `POST /assignments/:id/rooms-completed` count.
3. **Master data is Admin-only.** Create/edit/delete hotel or group, create an
   account, assign a role, revoke sessions, archive/restore. Under D-1 these ship
   in the app but render only for `admin`.

### Authority caveat that must be carried into implementation

`ADR-030`'s matrix is **not** wholly current. `docs/10-testing/e2e/REMAINING_WORK.md`
records ratified owner decisions ("RULE A" / "RULE B", 2026-08-12) that are
implemented in code but whose ADR amendments are still owed. Where they disagree,
**the code plus its pins is the effective authority**, not the ADR:

- `backend/src/lib/role-hierarchy.ts` — RULE A: a role may create exactly one level
  down (`manager → worker|checker`, `regional_manager → manager`). This contradicts
  `ADR-030` C-10/C-15 (Admin-only creation) in the *permissive* direction, and
  `ADR-065`'s broad grant in the *restrictive* direction.
- `backend/src/__tests__/support/capability-violations.ts` — the pins recording each
  known divergence.

**Implementation rule:** every gate in the manager app mirrors the *route* it calls,
verified against `constants.ts` and `role-hierarchy.ts` at build time — never
against this document, and never against `ADR-030` alone. A client gate is a
convenience over server-scoped data; it is never the only gate
(`frontend/CLAUDE.md`).

### One divergence to surface, not to fix

`backend/src/modules/crm/routes.ts:42,44` gate hotel create/patch as
`requireRoleFlagged(['admin','manager'], 'admin')`. With `FEATURE_GD02_MATRIX`
**off**, a `manager` may create a hotel but a `regional_manager` may not — the exact
"manager written without regional_manager" bug `backend/CLAUDE.md` says has broken
~40 sites, and here it contradicts `ADR-030` D-5. **This plan does not change it.**
It is recorded in §10 as a register entry for the owner, because changing an
authorization gate is a governance decision, not a side effect of building an app.

---

## 4. Feature inventory → app screen map

Complete. Every row is a surface a manager, RM or admin has on the web today.
Sidebar authority: `frontend/components/layout/SidebarNav.tsx:54-143`.

### 4.1 Tab bar (5 tabs, matching the existing apps' shape)

The two shipped apps each expose exactly 5 visible tabs and hide the rest behind
`href: null`. The manager app follows that, chosen by what a supervisor touches
daily rather than by the web sidebar's 18 entries:

| Tab | Route | Contents |
|---|---|---|
| **Today** | `(app)/index` | Dashboard: KPI tiles, today's coverage, pending-action cards (review queue count, unverified attendance, open requests), top-5 leaderboard. |
| **Rota** | `(app)/calendar` | The calendar — §5.1. |
| **Team** | `(app)/team` | Users list, scoped. Doubles as the entry to employment records, documents, contracts, payslips. |
| **Attendance** | `(app)/attendance` | Attendance list + verification queue. |
| **More** | `(app)/more` | A grouped menu: Assignments, Requests, Broadcasts, Review Queue, Hotels, Hotel Groups, Analytics, Leaderboard, Payslips, Notifications, Org chart (RM), Admin (admin), Settings, Profile, Assistant. |

Everything else is a stack route reachable from a tab or from `More`, exactly as
`worker-app` hides `marketplace`, `calendar` and `notifications` behind `href: null`.

### 4.2 Screen-by-screen

| # | Web surface | App route | Actions to carry over | Endpoints |
|---|---|---|---|---|
| S-01 | `/dashboard` | `(app)/index` | KPI tiles (open requests, on-time rate, quality pass rate, avg rating); top-5 leaderboard; link to analytics | `GET /analytics/stats`, `GET /analytics/leaderboard` |
| S-02 | `/analytics` | `analytics` | Hotel scope picker; 9 KPI tiles; 3 `BreakdownBar` cards (requests, assignments, attendance); top-5 leaderboard | `GET /analytics/stats?hotel_id=`, `GET /analytics/hotel-summary/:id` |
| S-03 | `/leaderboard` | `leaderboard` | Full leaderboard, hotel filter | `GET /analytics/leaderboard[/by-hotel/:id]` |
| S-04 | `/calendar` | `(app)/calendar` | §5.1 — day/week/month, add entry, mark absence, edit/cancel placement, **reschedule**, recurring ×26, shift-summary editor, range breakdown | `GET/POST /assignments/calendar-entries`, `PATCH …/:id/move`, `GET/POST /calendar/absences`, `PATCH /calendar/absences/:id/move`, `DELETE /calendar/absences/:id`, `GET/PUT /calendar/hotels/:id/shift-summaries[/:date]`, `GET /calendar/availability` |
| S-05 | `/assignments` | `assignments` | List + debounced search + status filter | `GET /assignments` |
| S-06 | `/assignments/:id` | `assignment/[id]` | Detail; reassign; cancel w/ reason; start; complete; rooms card; **read-only** quality evidence | `PATCH /assignments/:id`, `POST /assignments/:id/reassign`, `GET /rooms/for-assignment/:id`, `GET /quality/assignments/:id/checks` |
| S-07 | `/assignments/calendar-entries[/new]` | folded into S-04 | Placement list + create | `GET/POST /assignments/calendar-entries` |
| S-08 | `/requests` | `requests` | List + status filter. **Note:** the web has no nav entry for this (§8 F-1); the app gives it one. | `GET /work-requests` |
| S-09 | `/requests/new` | `requests/new` | Hotel, target role, position, headcount, date, start/end, rate, currency, description, requirements; save-draft **or** publish | `POST /work-requests` |
| S-10 | `/requests/:id` | `request/[id]` | Detail; publish; cancel w/ reason | `PATCH /work-requests/:id` |
| S-11 | `/requests/broadcasts` | `broadcasts` | List | `GET /work-requests/broadcasts` |
| S-12 | `/requests/broadcasts/new` | `broadcasts/new` | §5.2 — skill × headcount row builder (WORKER) or plain headcount (CHECKER) | `POST /work-requests/broadcasts` |
| S-13 | `/requests/broadcasts/:id` | `broadcast/[id]` | Detail; aggregate eligibility (admin/mgr/RM); manual close; accepted-workers list | `GET …/:id/eligibility`, `POST …/:id/close` |
| S-14 | `/attendance` | `(app)/attendance` | List; status filter (EXPECTED/PRESENT/LATE/PARTIAL/ABSENT/EXCUSED); verified filter | `GET /attendance` |
| S-15 | `/attendance/:id` | `attendance/[id]` | Check-in/out card; **verify + set status**; geo-verification card | `PATCH /attendance/:id`, `GET /geo/checkins` |
| S-16 | `/onboarding/review-queue` | `review-queue` | Queue; review modal; **approve → assign chain** for MANAGER/RM targets; reject w/ reason | `GET /employees/review-queue`, `POST /employees/:id/approve`, `…/assign`, `…/reject` |
| S-17 | `/users` | `(app)/team` | Search, role filter, active filter; "New user" per RULE A | `GET /users` |
| S-18 | `/users/new` | `team/new` | Role options from `creatableRolesFor`; manager needs a hotel, RM branch adds group; worker skills; **photo required** (multipart) | `POST /users` |
| S-19 | `/users/:id` | `team/[id]` | Profile; employment record; documents; contract; payslips; deactivate/reactivate; delete **only when target is PENDING** for mgr/RM; change-email (admin/RM); password-reset + revoke-sessions (admin) | `GET /users/:id`, `GET /employees/by-user/:id`, doc/HR endpoints |
| S-20 | `/users/:id/edit` | `team/[id]/edit` | Profile fields; role change **only** admin/RM, via the separate route | `PUT /users/:id`, `PUT /users/:id/role` |
| S-21 | employee lifecycle (modals) | `team/[id]/lifecycle` | submit-for-review, approve, reject, deactivate, reactivate, rehire, trigger-reonboarding | `POST /employees/:id/<transition>` |
| S-22 | documents cards | `team/[id]/documents` | Checklist, upload (camera/library/file), view, completeness | `POST/GET /documents/workers/:id/documents`, `…/completeness` |
| S-23 | contract card | `team/[id]/contract` | Status, create contract, download PDF, upload signed scan, confirm, extend, lapse | `GET/POST /hr/contracts`, `/hr/workers/:id/contract-*` |
| S-24 | `/payslips` | `payslips` | Queue; status filter; **mark fulfilled** | `GET /hr/payroll`, `POST /hr/payroll/:id/fulfil` |
| S-25 | `/hotels` | `hotels` | List; search; active filter | `GET /crm/hotels` |
| S-26 | `/hotels/:id` | `hotel/[id]` | Detail; map link; rooms-logged-today; blocklist read + add/remove; lifecycle **admin-only** | `GET /crm/hotels/:id`, `GET /rooms/for-hotels`, `GET/POST/DELETE /employees/hotels/:id/blocklist` |
| S-27 | `/hotel-groups` | `hotel-groups` | List | `GET /crm/hotel-groups` |
| S-28 | `/hotel-groups/:id` | `hotel-group/[id]` | Detail; hotels table; org-chart entry (**RM/admin**) | `GET /crm/hotel-groups/:id` |
| S-29 | `/hotel-groups/:id/org-chart` | `hotel-group/[id]/org-chart` | RM card; hotels table; employees table. **`org_chart:read` — RM/admin only** | `GET /employees/hotel-groups/:id/org-chart` |
| S-30 | `/notifications[/:id]` | `notifications`, `notification/[id]` | List; mark-all-read fan-out; detail + deep link | `GET /notifications`, `POST /notifications/:id/read` |
| S-31 | `/onboarding` | `onboarding` | The manager's **own** onboarding — only when they have a record. Subject to the same lockout. | `GET /employees/by-user/:id`, document + submit endpoints |
| S-32 | `/settings` | `settings` | Session info; theme; language; **own-data .xlsx export** | `POST /reports/export/mine` |
| S-33 | `/profile` | `profile` | Account; absences; consent; GDPR JSON export; edit profile | `PUT /auth/profile`, `POST /compliance/subject-rights-export`, `GET/POST /calendar/my-absences` |
| S-34 | `/assistant` + widget | `assistant` + `ChatLauncher` | Full chatbot, `FEATURE_CHATBOT`-gated | `/chatbot/*` |
| S-35 | `/archive` | `admin/archive` | **Admin only.** Archived hotels/groups/users, restore. | CRM + employee restore routes |
| S-36 | hotel/group create+edit | `admin/hotels/new`, `admin/hotel-groups/new` | **Admin only.** Master data. Respects `FEATURE_GD02_MATRIX` — see §3. | `POST/PATCH /crm/hotels`, `/crm/hotel-groups` |
| S-37 | *(no web UI)* | `reports` | **New surface.** `reports:read-team` / `reports:export-team` are held by manager/RM but nothing in `frontend/` calls them (§8 F-2). | `GET /reports/data?dataset=`, `POST /reports/export` |

**Not in the app, deliberately:** `/rooms` (worker-only nav and worker-only writes),
`/inspections` (checker/admin — admin reaches inspection *history* via S-35's sibling
route, but never the write path).

---

## 5. The four hard problems

### 5.1 The calendar — the one screen that cannot be ported

`frontend/app/(protected)/calendar/page.tsx` is 1,482 lines and the richest manager
surface. It uses **native HTML5 drag-and-drop** (`onDragStart`/`onDragOver`/`onDrop`,
`:591-614,:775,:851`) with two namespaced MIME types (`:529,:533`).

**HTML5 DnD does not fire on touch devices at all.** And `EditEntryModal` deliberately
omits a date field (`:1391`: *"move is what drag/drop already covers"*). So a manager
on a phone today has **no path whatsoever** to move a placement or an absence. This
is not a porting difficulty — it is a capability that is currently unreachable on
mobile and must be designed natively.

**Design:**

- **Agenda-first, not grid-first.** Default view is a vertical day agenda:
  a date strip, then placement and absence rows grouped by hotel. Week and month
  become *density* views — a 7-cell or 42-cell heat grid showing counts and coverage
  gaps, tapping a day to drop into the agenda. The 42-cell month grid with 3 stacked
  tags per cell does not reflow to 375px and is not attempted.
- **Reschedule is an explicit action, not a gesture.** Each placement row has a
  "Move" action opening a date picker → `PATCH /assignments/calendar-entries/:id/move`.
  Same for absences → `PATCH /calendar/absences/:id/move`. Long-press-drag is
  explicitly **out of scope**: it is unreliable inside a scroll view and this is a
  destructive write to a real person's rota.
- Optimistic mutate with rollback on failure, matching the web's pattern and the
  locale store's optimistic-with-rollback precedent (`stores/locale-store.ts:80-93`).
- **Recurring placement** (weekly × up to 26, `:989,:1158-1164`) fires one POST per
  occurrence. On a mobile connection that is a long-running multi-write. It gets a
  progress sheet with per-occurrence success/conflict rows, is cancellable mid-run,
  and reports a partial result honestly rather than a single success toast.
- **Shift-summary editor** (`components/calendar/ShiftSummaryPanel.tsx:131-162`) is
  four side-by-side number inputs plus notes. On mobile it becomes a stacked form in
  a bottom sheet, day-view only, write-capable roles only.
- Scope-driven filters follow `user.scope_hotel_group_id` / `scope_hotel_id`, **not
  role** (`calendar/page.tsx:131-160`): admin gets group + hotel pickers, RM gets a
  hotel picker over its own group, a hotel manager gets no picker at all.

### 5.2 Dense tables and repeatable row builders

Every list on the web is a `Table`/`TH` with no card fallback — `/users` (4 cols +
3 filters), `/attendance` (5 cols + 2 filters), `/requests` (6 cols), `/payslips`,
`/assignments`, and org-chart's two stacked tables.

All become `ListRow`-based cards: primary line, secondary line, trailing `Badge`,
chevron. Filters move into a sticky `FilterBar` that opens a bottom sheet — never
a row of inline `Select`s. The broadcast skill × headcount builder
(`broadcasts/new/page.tsx:291-324`) becomes an add/remove list of stacked rows with
a sticky footer total.

`frontend/CLAUDE.md` records the matching web lesson — a Tailwind `grid` with no
explicit column count cannot shrink, and `min-w-0` is needed on card *and* row before
`truncate` does anything. The native equivalent: every row needs `flexShrink: 1` and
`numberOfLines`, and **every screen is verified at 375px width**.

### 5.3 File in, file out

| Flow | Web mechanism | App mechanism |
|---|---|---|
| Own-data .xlsx (S-32) | Presigned S3 link in a new tab (`ExportMyDataCard.tsx:18-43`) — behaves poorly in mobile webviews | `expo-file-system` download → `Sharing.shareAsync()`. Reuse `lib/contract-download.ts`'s existing pattern. |
| GDPR JSON (S-33) | `Blob` + synthetic `<a download>` — unreliable on iOS | Write to cache dir, then share sheet. |
| Contract PDF → print → sign → scan (S-23) | `components/hr/ContractCard.tsx:154-186` assumes a printer | Download + share to view; re-upload via `expo-image-picker` (camera) or `expo-document-picker`. Camera capture of a signed page is the phone's advantage here, not its limitation. |
| Photo on user create (S-18) | File input | `usePhotoPicker` (`MAX_PHOTOS=6`, `MAX_PHOTO_BYTES=10MB`). |

**`checker-app`'s `api.ts` hardcodes `'Content-Type': 'application/json'`
(`:264`) while `worker-app` duck-types FormData (`:261-274`).** `mobile/shared` takes
**worker-app's** version. Every multipart flow above depends on it.

### 5.4 Push notifications need backend work

`PushApp` is `enum { WORKER, CHECKER }` (`backend/prisma/schema.prisma:263`). Daiwi's
`APPS` is `["WORKER","CHECKER"]` (`daiwi/src/lib/apps.ts:13`). APNs topic resolution
reads `APNS_BUNDLE_ID_WORKER` / `APNS_BUNDLE_ID_CHECKER`
(`backend/src/modules/notifications/push-provider.ts:232`).

A manager app needs all three extended — see §7 PR-0. Manager-directed
`NotificationType` values already exist and already fan out: `APPLICATION_RECEIVED`,
`WORKER_NO_SHOW`, `QUALITY_RATING_WARNING_50`, `REWORK_OVERDUE`,
`CALENDAR_ABSENCE_MARKED`, `JOB_REQUEST_CLOSED`, `HR_PAYSLIP_REQUESTED`,
`HR_PAYSLIP_REQUEST_ESCALATED`, `HR_CONTRACT_EXPIRY_REMINDER`, `ONBOARDING_SUBMITTED`,
`CONSENT_DECLINED`, `REPEATED_FAILED_LOGINS`, `USER_EMAIL_CHANGED`.

`resolvePushTapRoute()` gains a manager map — e.g. `APPLICATION_RECEIVED` →
`/review-queue`, `WORKER_NO_SHOW` → `/attendance/{id}`, `HR_PAYSLIP_REQUESTED` →
`/payslips`, `CALENDAR_ABSENCE_MARKED` → `/calendar?day=`.

---

## 6. Design-system conformance

The manager app is visually a sibling of the other two, not a new product.

**Unchanged, taken from `theme.ts` verbatim:** all 17 light and 17 dark colour
tokens (`primary` `#0F766E` light / `#0D9488` dark, `background` `#F8FAFC` / `#09090B`,
…); `Spacing {half:2, one:4, two:8, three:16, four:24, five:32, six:64}`;
`Radius {sm:6, md:10, lg:16, xl:24, full:9999}`; `Elevation {none, sm, md, lg}`;
`BottomTabInset`; `MaxContentWidth: 800`. The file's rule holds: **no screen
hardcodes a colour.**

**Typography** stays system-font via `Platform.select` — no custom font is loaded in
either app today and none is added. The `themed-text.tsx` scale is reused as-is:
`title` 48/52/600, `subtitle` 32/44/600, `default` 16/24/500, `small` 14/20/500,
`smallBold` 14/20/700, `link`/`linkPrimary` 14/30, `code` 12.

> **One deliberate exception.** `title` at 48pt suits a worker's "Good morning" home
> screen. A manager screen is dense and data-led. The manager app adds **`h1` 28/34/700**
> and **`h2` 20/26/600** to the shared scale for screen and section headings, and
> reserves `title`/`subtitle` for the dashboard hero only. This is an *addition* to
> `themed-text.tsx` in `mobile/shared`; no existing `type` value changes, so
> worker-app and checker-app are unaffected.

**Per-app brand identity** follows the established pattern: worker is blue
(`#208AEF` splash, gradient `#2E96F5`→`#0B63C5`), checker is green (`#0FA37F`,
`#14B58C`→`#0A7A5E`). Manager gets a third — proposed **indigo/slate**, splash
`#3F4D8A`, gradient `#5A6BB5`→`#2E3A6B`, adaptive background `#E8EAF5`, glyph
`clipboard` — generated by `mobile/scripts/generate-app-icons.mjs`, which already
takes a `BRANDS` entry (`:47-61`) and is the one genuinely shared file today.
*The exact hues are a proposal; the owner may pick others. Nothing else depends on them.*

### New primitives `mobile/shared` must add

The existing set has **no `Input`, no `Modal`, no `Toast`, no `Skeleton`** — inputs are
styled inline in every screen, feedback is `Alert.alert`, and the `skeleton` colour
token has no consumer. A manager app is form-heavy and list-heavy; it cannot be built
on that set.

| Primitive | Why | Notes |
|---|---|---|
| `Input` / `TextField` | S-09, S-12, S-18, S-20, shift summary, every filter | Label, error text, `accessibilityLabel`. Carries login's hard-won props: `autoCapitalize="none"`, `autoCorrect={false}`, `spellCheck={false}` (`(auth)/login.tsx:134-140` records iOS silently uppercasing a password's first character). |
| `Select` / `Picker` sheet | Status, role, hotel, group filters everywhere | Bottom sheet, not a native picker — consistent across platforms. |
| `DatePicker` | S-04 move, S-09 shift date, payslip period | Wraps the platform picker. |
| `BottomSheet` | Every modal in §4. `Modal` appears in exactly one file today (`(app)/calendar.tsx`). | |
| `Toast` | Replaces `Alert.alert` for non-blocking confirmations | `Alert` is retained for destructive confirms only. |
| `Skeleton` | Finally consumes the `skeleton` token | Dense list screens; replaces bare `ActivityIndicator`. |
| `FilterBar` | §5.2 | Sticky, shows active-filter count. |
| `DataRow` | §5.2 | The table-replacement card row. |
| `ConfirmDialog` | Cancel assignment, reject application, deactivate, delete | Requires a typed reason where the API does. |
| `ProgressSheet` | §5.1 recurring placement | Per-item result rows. |

### Accessibility and reachability

`Button` already sets `minHeight: 48`, `accessibilityRole="button"` and
`accessibilityState={{disabled, busy}}` — every new primitive matches that bar.
Primary actions sit in a sticky bottom bar within thumb reach, not in a header.
`RatingTierBadge`'s tone map (`ELITE/HIGH→success, STANDARD→neutral, LOW→warning,
PROBATION→danger`) is reused so tier colour never diverges from the other apps.

---

## 7. Implementation sequence

One PR at a time; the owner merges. Each lands on a branch cut fresh from `main`.
Gates run in full before every push (`CLAUDE.md` §Gates): lint is the one that gets
skipped and the one that fails CI.

### PR-0 — Backend and distribution groundwork

The only backend work in this plan. No new capability.

1. `PushApp` enum gains `MANAGER` (`backend/prisma/schema.prisma:263`) + migration,
   checked in per `migration-harness.yml`.
2. `APNS_BUNDLE_ID_MANAGER` read in `push-provider.ts`; error text at `:232` updated.
3. `daiwi/src/lib/apps.ts` `APPS` gains `"MANAGER"` with label and icon entries.
4. Credentials (APNs key, FCM `google-services.json`) — **owner action**, not a PR.
   Handled per `REMAINING_WORK.md`'s standing rule: real secrets, environment config
   only, never committed, never pasted into chat.

*Verify:* migration applies and rolls back; a `MANAGER` token registers and a send
resolves the right APNs topic. Per scenario 16's rule, an outbox row reading
`DELIVERED` is **not** evidence — the decisive check is the provider call.

### PR-1 — `mobile/shared`

`mobile/*` is already an npm workspace glob (root `package.json:6-10`), so
`mobile/shared` is a workspace with no root change.

Contents: `theme.ts` (verbatim + `h1`/`h2`), `polling.ts` (`POLL_INTERVAL_MS = 60_000`
— the 610-workers-×-3-requests arithmetic applies to managers too), `ui/` primitives
(existing 8 + the 10 new), `themed-text`/`themed-view`, `persistent-storage`,
api core (**worker-app's** FormData-aware `request()`), `api-error-i18n`,
`locales.ts`, the six locale JSONs, the shared stores, `use-theme`,
`use-color-scheme`, `usePhotoPicker`, `useDocumentUpload`, `BackLink`, `UserAvatar`,
`RatingTierBadge`, `ThemePicker`, `LanguagePicker`, `NotificationBell`,
`PushRegistration`, `UpdateChecker`, `ChatLauncher`, `AuthGuard`, `ConsentGate`.

`ScreenHeader` divergence (`ui/index.tsx:128` vs `:134` — worker renders
subtitle-then-title, checker the reverse) is resolved in favour of **title-then-subtitle**
and the choice recorded in the file, since the shared copy can only have one.

*Locales:* `mobile/shared` becomes the mobile-side source. Its own
`locales.test.ts` keeps the deep-equal against `frontend/lib/i18n/locales/*`.
worker-app and checker-app keep their existing tests unchanged — the triangle becomes
a square, all four still pinned to the frontend. **Adding a string still means all
catalogues or none.** New manager keys go under existing top-level namespaces
(`nav`, `users`, `calendar`, `attendance`, `analytics`, `hr`, `requests`,
`onboarding`, `hotels`, `hotelGroups`, `employees`, `lifecycle`) and must be added to
frontend + worker + checker + shared, in all six locales, or CI fails in packages the
branch never touched.

### PR-2 — App skeleton

`mobile/manager-app` from the existing apps' shape: `app.json`
(`com.fhmhotelservices.managerapp`, scheme `managerapp`, new EAS projectId),
`eas.json` (identical profiles), `babel.config.js`, `jest.config.js` two-project
setup, `eslint.config.js`, `tsconfig*.json`, `plugins/withDisableUserScriptSandboxing.js`,
a `with-metro-port` plugin pinning **8083** (worker 8081, checker 8082 — the
three-places rule from `checker-app`'s README, guarded by a `dev-server-port.test.ts`).

Root layout wraps `ThemeProvider > UpdateChecker > AuthGuard > ConsentGate > Stack`,
with `unstable_settings = { anchor: 'index', initialRouteName: 'index' }` — the comment
at `worker-app/src/app/_layout.tsx:37-40` records that omitting it silently made
`consent` the entry point. Splash hides only once `isInitialized && themeHydrated`.

**Role admission at the gate:** `app/index.tsx` redirects a signed-in `worker` or
`checker` to a "wrong app" screen naming the right one, rather than an empty
dashboard. `checker-app`'s role-gate run log (`runs/2026-08-25-checker-app-role-gate.md`)
is the precedent.

`PUSH_APP = 'MANAGER'` in `constants/app-config.ts` — documented there as the only
per-app difference in the push path.

### PR-3 … PR-13 — Screens

Each PR: screens + unit tests + component tests + locale keys in all four catalogues
× six locales. Each is independently shippable and leaves the app working.

| PR | Screens | Notes |
|---|---|---|
| PR-3 | S-01 Today, S-02 analytics, S-03 leaderboard | Establishes the screen skeleton, SWR usage, pull-to-refresh pattern, scope picker. |
| PR-4 | **S-04 calendar** | The big one. §5.1. Split into its own PR because it is the highest-risk screen and the only genuinely new interaction design. |
| PR-5 | S-05, S-06, S-07 assignments | Includes the read-only quality evidence card and the `rooms-completed` aggregate entry. |
| PR-6 | S-08–S-13 requests + broadcasts | `FEATURE_JOBDISPATCH_PHASE2`-gated; app must render sensibly with the flag off. |
| PR-7 | S-14, S-15 attendance + geo | `PATCH /attendance/:id` has **no route-level role gate** — authorization is entirely service-layer. Client gate mirrors the web's `["manager","regional_manager","admin","checker"]`. |
| PR-8 | S-16 review queue, S-21 lifecycle | The approve→assign chain for MANAGER/RM targets is two calls, not one (`ReviewQueueTable.tsx:136-152`). Partial failure must not read as success. |
| PR-9 | S-17–S-20 team, S-22 documents | RULE A creation rules; the PENDING-only delete carve-out; multipart photo. |
| PR-10 | S-23 contract, S-24 payslips | §5.3 file flows. |
| PR-11 | S-25–S-29 hotels, groups, blocklist, org chart | Org chart is RM/admin only (`org_chart:read`). |
| PR-12 | S-30 notifications, push deep links | `resolvePushTapRoute` manager map; registration inside `ConsentGate`. |
| PR-13 | S-31–S-34 own onboarding, settings, profile, assistant; S-37 reports | Onboarding lockout must be honoured — a manager whose own record is `documents`/`review`/`rejected`/`inactive` is confined to onboarding/settings/profile (`useOnboardingLockout.ts:44,71`). |

### PR-14 — Admin-only surfaces

S-35 archive, S-36 hotel/group master data, password reset, revoke sessions,
special-category and export routes. Gated to `admin`, honouring `FEATURE_GD02_MATRIX`.

### PR-15 — E2E scenarios, run log, governance sync

§8 and §10. Lands last because the scenarios must describe what actually shipped.

---

## 8. Test plan

Three layers. The first two are per-PR and block merge; the third is the durable
E2E suite.

### 8.1 Per-PR automated gates

```bash
cd mobile/manager-app && npm run typecheck && npx expo lint && npx jest --forceExit
cd mobile/shared      && npm run typecheck && npx expo lint && npx jest --forceExit
```

Plus, on any PR touching locales or shared code, the full four-package sweep — a key
added to the frontend alone fails CI in a branch that never touched mobile:

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx jest --ci && npx next build
cd mobile/worker-app  && npm run typecheck && npx expo lint && npx jest --forceExit
cd mobile/checker-app && npm run typecheck && npx expo lint && npx jest --forceExit
```

**Lint traps that have actually failed CI here** (`mobile/worker-app/CLAUDE.md`):
assigning a ref during render — move it into an effect (this reached `main` once);
and `useState` + effect for derivable state — use `useSyncExternalStore`.

**Do not edit source while jest runs.** ts-jest compiles per test file; a mid-run save
produces a `TS2339` presenting as an unrelated flake. Most of this repo's "flakes"
were this (`backend/CLAUDE.md`).

### 8.2 Unit and component tests

Mirroring the existing apps' discipline — pure logic extracted to `src/lib/*.ts` so it
runs under the fast node project, components under `jest-expo/ios`.

| Test | Asserts |
|---|---|
| `role-admission.test.ts` | `manager`, `regional_manager`, `admin` admitted; `worker`, `checker` routed to the wrong-app screen; unknown role denied. |
| `capability-map.test.ts` | Every client gate matches `ROLE_PERMISSIONS` **imported from the real `backend/src/config/constants.ts`**, not a fixture. A fabricated permission proves only that the code agrees with itself — the trap that let a tool ship requiring a token `WORKER` does not hold while 100+ tests passed. |
| `rm-parity.test.ts` | For every gate admitting `manager`, `regional_manager` is admitted too, except `org_chart:read` (RM-only). This is the executable form of the ~40-site bug. |
| `scope-filters.test.ts` | Calendar/analytics pickers derive from `scope_hotel_id`/`scope_hotel_group_id`, **not role**: admin → group+hotel pickers, RM → hotel picker, hotel manager → none. |
| `route-targets-exist.test.ts` | Ported from `checker-app` — every `router.push()` literal, template and `{pathname}` form resolves to a real route file. Written there after three dead links shipped. |
| `locales.test.ts` | Four-way: shared ↔ frontend deep-equal per locale; every `en.json` key path present in all six; `UI_LOCALES` order; RTL set `['ar','ur']`; `_meta.reviewed` true for de/en only. |
| `translation-keys-exist.test.ts` | Every statically-analysable `t('…')` key exists in `en.json`; ≥50-key canary. |
| `push-manager-routes.test.ts` | `resolvePushTapRoute` maps each manager `NotificationType` to a real route; unknown type → `/notifications`. |
| `push-consent-order.test.ts` | `PushRegistration` mounts inside `ConsentGate` — structurally prevents a 403 `CONSENT_REQUIRED` on register. |
| `onboarding-lockout.test.ts` | A manager in `documents`/`review`/`rejected`/`inactive` reaches only onboarding/settings/profile. |
| `recurring-placement.test.ts` | ×26 cap; partial failure reports per-occurrence results; cancel mid-run stops further writes. |
| `approve-assign-chain.test.ts` | MANAGER/RM approval fires approve **then** assign; a failed assign after a successful approve surfaces as partial, never success. |
| `attendance-verify-payload.test.ts` | Verify sends status + `is_verified`; the client never invents `verified_by`. |
| `quality-readonly.test.ts` | No screen renders a quality write affordance for manager/RM. |
| `rooms-write-denied.test.ts` | No room-log write path exists in this app. |
| `dev-server-port.test.ts` | Port 8083 pinned in all three places. |
| `android-fcm-config.test.ts` | `google-services.json` present and matches the package name. |
| `api-formdata.test.ts` | Multipart requests carry **no** explicit `Content-Type` — the checker-app divergence must not be inherited. |
| Component tests | `LoginInputs`, `FilterBar`, `DataRow`, `ConfirmDialog`, `ProgressSheet`, `DatePicker`, `ThemePicker`, calendar agenda row. |

### 8.3 New E2E scenarios

Thirteen new files in `docs/10-testing/e2e/scenarios/`, numbered from 23 (22 is the
current highest). Each follows the house format exactly: title, rationale citing
governing authority in backticks, a bold **Preconditions:** line, a `>` **Trap:**
blockquote, `## Step N —` sections with copy-pasteable commands and
`**PASS:** …` / `**FAIL conditions (all real past defects):**`, a
`## Pass criteria summary` checkbox list, a `## Defects this scenario has caught`
table, and a `## Knowingly untested here` section naming *what*, *why it is
acceptable*, and where partial coverage lives.

**Two rules govern all thirteen**, from the suite's own README:

- **Verify at the data layer.** A `200` is not a pass criterion. Read the row back.
- **Never substitute a direct DB write for the path under test.** If the real path
  cannot run, that is a recorded gap, never a pass.

Device steps are explicit about which are *not* HTTP — the mobile run logs
(`2026-08-25-mobile-app-flow-verification.md`) found 8 defects, 5 of them in `.tsx`
files that passed typecheck. A curl-only pass would have found none of them.

| # | File | Covers |
|---|---|---|
| 23 | `23-manager-app-auth-and-role-admission.md` | Login as manager / RM / admin on a device; token persistence across restart; 401 transparent refresh with concurrent requests (shared in-flight promise); `TOKEN_REVOKED` is non-refreshable and logs out; 429 honours `Retry-After` in both forms; a `worker` and a `checker` are refused with the wrong-app screen, not an empty dashboard; scope claims resolved at login (`scope_hotel_id` for a manager, `scope_hotel_group_id` for an RM, both null for admin); **a deactivated or archived hotel confers no scope on fresh login or stale token** (scenario 20's rule). |
| 24 | `24-manager-app-navigation-and-capability-gating.md` | Tab bar and `More` menu contents per role, side by side; RM sees exactly Manager's set **plus** org chart; every gate that admits `manager` admits `regional_manager`; no quality-write affordance anywhere; no room-log write path; admin-only surfaces (archive, master data, revoke sessions) invisible to manager/RM **and** refused server-side if reached; the onboarding lockout confines a manager with an incomplete own record. |
| 25 | `25-manager-app-calendar-and-rota.md` | Agenda/week/month; create placement; **move a placement** (the capability that does not exist on mobile today) and confirm `CalendarEntry.day` changed in Postgres; mark and move an absence; cancel a placement; recurring ×26 with a deliberate mid-run conflict, asserting partial results are reported and exactly the successful occurrences exist as rows; shift-summary save and re-read; scope-driven pickers per role; **Europe/Berlin day boundary** — a 00:00–02:00 Berlin window must not hand a night-shift manager yesterday (`CALENDAR_TIMEZONE`, `todayInCalendarTimezone`). |
| 26 | `26-manager-app-assignments-and-dispatch.md` | Assignment list, search, status filter; reassign and confirm the `previous_assignment_id` chain; cancel with reason persisted; start/complete transitions; `rooms-completed` aggregate written with the right `entered_by_id`; work request draft→publish→cancel; broadcast with a skill × headcount matrix, asserting `JobRequestSkillSlot` rows match the builder exactly; eligibility read; manual close; behaviour with `FEATURE_JOBDISPATCH_PHASE2` **off**. |
| 27 | `27-manager-app-attendance-verification.md` | Verify from the device and confirm `Attendance.is_verified`, `verified_by_id`, `verified_at` at the data layer; each status transition; a manager of hotel B cannot verify hotel A's record (this route has **no role gate** — the service is the whole gate, so cross-scope denial is the assertion that matters); geo check-in card; the unverified-queue count on Today matches the DB. |
| 28 | `28-manager-app-review-queue-and-lifecycle.md` | Queue filtered to the reviewer's **scope**, not merely gated by role — requires pending applications in **both** groups, since an empty queue proves nothing on its own; approve a worker; approve **and assign** a Manager/RM, verifying `Hotel.manager_user_id` / `HotelGroup.regional_manager_user_id` changed, not just a 200; a peer manager cannot approve a manager; reject with reason; each of the six lifecycle transitions with exactly one `EmploymentStatusHistory` row per transition; optimistic-concurrency 409 on a double-submit from two devices. |
| 29 | `29-manager-app-team-users-and-hr.md` | Scoped user list (a manager does not see peers or its RM — `users/service.ts:122`); RULE A creation limits (`manager → worker\|checker`, `RM → manager`, nobody creates an admin) verified against `role-hierarchy.ts`; a manager submitting a `role` field to `PUT /users/:id` is refused **at the route/schema boundary**, not merely by service logic; delete permitted only for a `PENDING` target; document upload from camera and file picker with a real multipart body reaching S3; contract create → download → signed re-upload → confirm; payslip fulfil with cross-group denial. |
| 30 | `30-manager-app-hotels-groups-and-org-chart.md` | Hotel and group lists scoped; blocklist add/remove verified as `EmployeeBlocklistEntry` rows; rooms-logged-today; org chart reachable for RM and admin and **refused for manager** (`org_chart:read`); admin master-data create/edit; the `FEATURE_GD02_MATRIX`-off asymmetry at `crm/routes.ts:42,44` recorded as observed behaviour, not asserted as correct — §3. |
| 31 | `31-manager-app-analytics-and-quality-read.md` | Stats and leaderboard per scope; a manager of hotel A sees no hotel B PII in the leaderboard (`SIR-ANLY-014`, `SIR-QUAL-003/004`); breakdown totals reconcile against the DB rather than merely rendering; inspection results and photos are readable; **every quality write is absent from the UI and refused by the API** for manager/RM. |
| 32 | `32-manager-app-push-and-notifications.md` | Token registers with `app: MANAGER` after the consent gate, never before; `PushToken` ownership reassignment on a shared device; a real APNs/FCM send resolving the manager bundle id — **the decisive step is not HTTP**, and a `DELIVERED` outbox row is not evidence; deep-link routing for each manager `NotificationType`; mark-all-read fan-out leaves no row unread; invalid-token pruning. |
| 33 | `33-manager-app-connectivity-and-data-cost.md` | 60s poll interval honoured, not tightened; no duplicate round trips for one screen (the chatbot probe once made availability and chips two sequential calls to the same endpoint); airplane-mode behaviour on every screen — a readable error, never a blank or a spinner that never ends; recovery on reconnect; a write attempted offline fails visibly and is not silently dropped; optimistic calendar writes roll back on failure. |
| 34 | `34-manager-app-i18n-rtl-theme-and-layout.md` | All six locales render; `ar`/`ur` RTL with the restart notice; locale change persists and syncs `preferred_language`, rolling back the UI if the server write fails; light/dark with no light flash at launch; **every screen verified at 375px with the page width measured**, not eyeballed; 48pt touch targets; transport-layer error strings — currently English in every locale (`SIR-GLOB-022`) — either fixed in shared or re-recorded as an open gap. |
| 35 | `35-manager-app-admin-surfaces.md` | Admin-only: archive and restore with no ghost assignments or dangling scope pointers (scenario 20's invariant); hotel/group create, edit, deactivate, restore; user role change; password reset; revoke sessions invalidating an active device token; special-category and subject-rights export. Each asserted **denied** for manager and RM at the API, not merely hidden in the UI. |

### 8.4 Suite maintenance, in the same pass

- Thirteen rows appended to the README scenario index
  (`docs/10-testing/e2e/README.md` §Scenario index).
- `docs/10-testing/e2e/scenarios/08-known-gaps-and-next.md` §3 currently lists
  "**Mobile apps** … against these backend changes" under *Never tested by anyone*.
  Updated to reflect what 23–35 now cover and what still is not covered.
- A run log at `docs/10-testing/e2e/runs/YYYY-MM-DD-manager-app-first-pass.md`
  using the README template verbatim. **Never edit a historical run log — append a
  new one.**
- `REMAINING_WORK.md`: the standing "update all the ui changes in mobile too"
  instruction now has a manager-side target. Items previously closed as
  "not applicable, mobile has no such screen" for manager surfaces are re-opened
  as checklist entries against this app.

---

## 9. Risks

| # | Risk | Containment |
|---|---|---|
| R-1 | **D-2 leaves three sources of truth.** `mobile/shared` and two hand-maintained copies. A fix in one can miss the others. | The four-way `locales.test.ts` pins catalogues automatically. For code, `mobile/shared`'s README names every file that is a copy of a worker-app/checker-app file, so a future migration has a checklist. The migration of the two shipped apps is a **named follow-up**, not silently deferred. |
| R-2 | **The calendar is a new interaction design, not a port** (§5.1). Highest chance of being wrong. | Its own PR (PR-4), its own scenario (25). Agenda-first so the phone-hostile grid is never on the critical path. Recommend a device walkthrough with the owner before PR-5. |
| R-3 | **A client gate drifts from its route.** The `regional_manager` omission produces no error anywhere. | `capability-map.test.ts` + `rm-parity.test.ts` import the real `constants.ts`. Scenario 24 asserts it on a device. |
| R-4 | **Push needs credentials the repo cannot hold.** | PR-0 lands the code path; the APNs key and FCM config are owner actions in environment config. Until then push is untestable and scenario 32 records that as a gap, never a pass. |
| R-5 | **`PATCH /attendance/:id`, `PATCH|DELETE /calendar/absences/:id`, `GET /geo/checkins*` have no route-level role gate** — service-layer authorization only. A mobile client is a new caller of these. | Scenario 27's cross-scope denial is the assertion; §3's rule (mirror the route, never assume) applies. |
| R-6 | **Known open scope defects could be inherited.** `SIR-AUTH-003` (manager has no enforced one-hotel scope in the request pipeline), `SIR-AUTH-021`, `SIR-ANLY-015`, `SIR-ATT-002`, `SIR-QUAL-003/004`. | The app must not *rely* on client filtering to hide out-of-scope data. Scenarios 27, 29, 31 test cross-scope denial at the API. Any new finding is appended to the register, not fixed silently. |
| R-7 | **Scope creep into authorization changes.** S-37 exposes `reports:*` endpoints that have no web UI; the `crm/routes.ts` RM omission is tempting to "fix". | D-3 is explicit: no widening. S-37 surfaces a permission the role **already holds**. The RM omission is a register entry (§10), not a code change in this plan. |
| R-8 | **Production app.** `deepcleaninghub.de` serves people working a shift tomorrow morning. | The manager app is additive — no web or backend behaviour changes except PR-0's enum. Distribution is via Daiwi (internal), where **uploading never publishes**: a build must be dragged into the iOS or Android box to promote it. |

---

## 10. Governance deltas

Per `.claude/CLAUDE.md`'s repository rules, synchronized as an exit condition rather
than left to be rediscovered.

1. **[`ADR-075` — One role-gated manager app, on a shared mobile package](../14-governance/architecture-decisions/ADR-075-one-role-gated-manager-app.md).**
   **Written 2026-09-22, status `PROPOSED`.** Records D-1, D-2, D-3, the
   agenda-first calendar (§5.1), the `h1`/`h2` type-scale addition, and the
   `PushApp.MANAGER` extension. **Flipping it to `ACCEPTED` is reserved human
   authority** (Constitution §12/§20) — the implementing session may not ratify
   its own record.
2. **Specification Issues Register** (`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`)
   — append, never delete; merge by canonical source within a section; update the
   section's `**Section last verified:**` marker; never invent an owner:
   **Recorded 2026-09-22:**
   - `SIR-CRM-020` — `crm/routes.ts:42,44` admits `['admin','manager']` under
     `FEATURE_GD02_MATRIX`-off, omitting `regional_manager` and contradicting
     `ADR-030` D-5. *security, decision-required, Medium, OPEN.*
   - `SIR-GLOB-028` — three mobile code sources after D-2; migration of worker-app
     and checker-app onto `mobile/shared` outstanding. *consistency, Low, OPEN.*
   - `SIR-ANLY-016` — the mobile `DashboardStats` described a response the endpoint
     has never returned; corrected in `mobile/shared` and pinned by a compile-time
     contract test. The two shipped apps still carry the wrong copy.
     *consistency, Medium, OPEN (residual).*
   - `SIR-GLOB-022` (existing) — re-verify: transport-layer error strings English in
     every locale. `mobile/shared` is the natural place to close it.
3. **`ADR-030` amendment remains owed** for RULE A / RULE B (§3). This plan does not
   discharge it; it depends on it and records that dependency. Already tracked as the
   first two open items in `REMAINING_WORK.md`.
4. **Gate path:** G0 pre-flight → G1.5 boundary collision (new owned artifacts:
   `mobile/shared`, `mobile/manager-app`, 13 scenario files) → G3 plan review → G4
   independent reviews (architecture, dependency, consistency incl. Repository
   Integrity Validation, security — new client of ungated routes) → G5 → G6 (QA +
   documentation validation) → G7 → G9. **G2 does not apply**: no `MODULE_SPEC.md` is
   frozen by this work.
5. **Integrity check** before claiming G4/G6/G9:
   `node .claude/tooling/repository-integrity-check.js`.

---

## 11. Open questions for the owner

Answering these does not block PR-0 or PR-1.

1. **Brand colour.** §6 proposes indigo/slate (`#3F4D8A`, `#5A6BB5`→`#2E3A6B`). Worker
   is blue, checker is green. Owner's call.
2. **App name and store identity.** "Hotel CRM Manager" is assumed, matching
   "Hotel CRM Worker" / "Hotel CRM Checker".
3. **Does the manager app replace the web portal, or sit beside it?** This plan assumes
   *beside*. If it replaces it, the phone-hostile surfaces in §5 need a stronger answer
   than "use the web for that", and the standing mobile-parity instruction reverses
   direction.
4. **S-37 reports.** `reports:read-team` / `reports:export-team` are held by manager/RM
   with no UI anywhere. Building the first surface for them on mobile is defensible but
   unusual — confirm, or defer S-37 to a later phase.
5. **`FEATURE_GD02_MATRIX` state in production.** It decides whether a manager can
   create a hotel (§3). The app's admin gating should match production, not the default.
6. **Daiwi distribution or the public stores?** Both shipped apps are Daiwi-only today.
   A manager app aimed at hotel staff may want TestFlight / Play internal testing instead.

---

## 12. Sources

Research performed against the working tree on 2026-09-21. Primary sources:
`docs/14-governance/architecture-decisions/ADR-030-manager-write-authority-capability-model.md`;
`backend/src/config/constants.ts`; `backend/src/lib/role-hierarchy.ts`;
`backend/src/lib/scope.ts`; `backend/prisma/schema.prisma`;
`frontend/components/layout/SidebarNav.tsx`; `frontend/components/auth/RoleGate.tsx`;
`frontend/app/(protected)/**`; `mobile/worker-app/src/constants/theme.ts`;
`mobile/worker-app/src/components/ui/index.tsx`; `mobile/worker-app/src/lib/api.ts`;
`mobile/*/src/__tests__/locales.test.ts`; `docs/10-testing/e2e/README.md` and
`scenarios/`; `docs/10-testing/e2e/REMAINING_WORK.md`;
`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`;
`.claude/constitution/REVIEW_GATES.md`; and each directory's `CLAUDE.md`.

Line citations in this document were correct at the revision above. This repository's
own testing rule applies to reading it: **re-check citations — paths and line numbers
drift.**
