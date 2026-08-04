# UAT Checklist — Hotel CRM MVP

Assumes the recommended flag state for this release: `FEATURE_EMPLOYMENT_RECORD`,
`FEATURE_GD02_MATRIX`, `FEATURE_JOBDISPATCH_PHASE2` all `true`; `FEATURE_RM_ROLE` `false`.
Every row cites the exact screen/page and backend route it exercises, so a failure is
immediately actionable.

Three items below are marked **⚠ VERIFY** — discrepancies surfaced during repository
verification that were not confirmed as bugs (no reproduction attempted, per instructions not to
expand scope or fix unconfirmed issues). Treat these as required UAT test cases, not known-good
paths.

---

## Worker

| # | Workflow | Entry point | Backend route | Pass criteria |
|---|---|---|---|---|
| W1 | Login | `mobile/worker-app` `(auth)/login.tsx` | `POST /auth/login` | Valid worker credentials succeed; invalid credentials show an error, not a crash |
| W2 | Session persistence | app relaunch | `GET /auth/me` | Role and identity correct after app restart while logged in |
| W3 | Password reset | in-app link → system browser → web `/forgot-password`, `/reset-password` | `POST /auth/password-reset[/confirm]` | Email received, reset link works, new password logs in |
| W4 | Dashboard stats | `(app)/index.tsx` | `GET /analytics/my-stats` | Own stats load, no data from other workers visible |
| W5 | Browse open jobs | `(app)/marketplace.tsx` | `GET /work-requests` | List loads, matches jobs the worker is eligible for |
| W6 | Browse broadcast offers | `(app)/marketplace.tsx` | `GET /work-requests?is_broadcast=true` | Requires PHASE2 on — confirm offers appear now that it's enabled |
| W7 | View broadcast offer + eligibility | `offer/[id].tsx` | `GET /work-requests/broadcasts/:id/eligibility` | Correct eligibility reasoning shown |
| W8 | Accept broadcast offer | `offer/[id].tsx` | `POST /work-requests/broadcasts/:id/accept` | Acceptance succeeds once, second attempt (double-tap) does not double-book |
| W9 | View shifts | `(app)/shifts.tsx`, `shift/[id].tsx` | `GET /assignments`, `GET /assignments/:id` | Own shifts only, correct hotel/time |
| W10 | Attendance check-in (geo) | `shift/[id].tsx` | `POST /attendance` | Succeeds within geofence; confirm behavior outside geofence matches spec (block or flag, not silent accept) |
| W11 | Attendance check-out | `shift/[id].tsx` | `PATCH /attendance/:id` | Check-out recorded, shift state updates |
| W12 | View absences | `(app)/absences.tsx` | `GET /calendar/my-absences` | Own absence history only |
| W13 | Request absence (sick/vacation) | `(app)/absences.tsx` | `POST /calendar/my-absences` | Request created; if it auto-cancels a same-day assignment, confirm that cancellation actually happens |
| W14 | View/upload documents | `documents.tsx` | `GET/POST /documents/workers/:id/documents` | Upload succeeds; **specifically test uploading with the work-permit flag set** — a previously-known multipart coercion bug here was reported fixed in code, confirm no 422 in practice |
| W15 | Consent flow | `consent.tsx` | `GET /consent/status`, `POST /consent/request\|decisions\|withdraw` | Decline does **not** block app access anywhere (this is documented, by design, as a non-enforcing record — confirm no regression added enforcement) |
| W16 | HR contract status | `hr.tsx` | `GET /hr/workers/:id/contract-status` | Correct contract state shown |
| W17 | HR payslip request/list | `hr.tsx` | `GET /hr/payroll`, `POST /hr/payslip-requests` | Request created, appears in own list, not visible to other workers |
| W18 | Notifications inbox | `(app)/notifications.tsx` | `GET /notifications`, `POST /notifications/:id/read` | Own notifications only; mark-as-read persists |
| W19 | Push notification receipt | background | `POST /notifications/push-tokens` + real device | Trigger a push-eligible event (e.g. shift reminder) and confirm the device actually receives it — this is the first real-world test of the push credential configuration |
| W20 | ⚠ VERIFY — Ratings screen | `ratings.tsx` | `GET /analytics/leaderboard` | This endpoint is role-gated to admin/manager/regional_manager in the backend per repository evidence. Confirm whether the worker ratings screen actually works or 403s — if it 403s, this is a real defect to report, not something to fix silently during UAT |

## Checker

| # | Workflow | Entry point | Backend route | Pass criteria |
|---|---|---|---|---|
| C1 | Login/logout | `(auth)/login.tsx` | `POST /auth/login`, `POST /auth/logout` | Standard auth flow works |
| C2 | Unverified attendance queue | `(app)/index.tsx` | `GET /attendance?is_verified=false` | Shows pending items across hotels (checker is not hotel-scoped) |
| C3 | Attendance detail | `attendance/[id].tsx` | `GET /attendance/:id` | Correct detail for selected record |
| C4 | Verify attendance | `attendance/[id].tsx` | `PATCH /attendance/:id` | Marking verified removes it from the pending queue |
| C5 | Quality verification | `quality/[id].tsx` | `POST /quality/verifications` | Pass/rework/fail all record correctly |
| C6 | Worker rating | `rating/[id].tsx` | `POST /quality/ratings` | 1–5 star rating saves and is reflected on the worker's profile/leaderboard |
| C7 | Cross-hotel leaderboard | `(app)/leaderboard.tsx` | `GET /quality/leaderboard` | Checker sees data across hotels (confirmed as intended — checkers bypass hotel-membership checks) |
| C8 | Notifications + push | `(app)/notifications.tsx` | `GET /notifications`, `POST /notifications/push-tokens` | Same as W18/W19 for the checker app |

## Manager

| # | Workflow | Entry point | Backend route | Pass criteria |
|---|---|---|---|---|
| M1 | Login | web `/login` | `POST /auth/login` | Standard flow |
| M2 | Hotels list/detail | `(protected)/hotels/page.tsx` | `GET /crm/hotels[/:id]` | Manager sees only their scoped hotel(s) |
| M3 | Hotel-groups (read) | `.../hotel-groups/page.tsx` | `GET /crm/hotel-groups[/:id]` | Read access works; confirm manager **cannot** create/edit/delete a hotel now that GD02 narrows that to admin-only |
| M4 | User detail + profile edit | `.../users/[id]/page.tsx` | `GET /users/:id`, `PUT /users/:id` | Manager can edit profile fields only, not role |
| M5 | Employment record view | embedded in user detail | `GET /employees/by-user/:user_id`, `/employees/:id/profile\|skills` | Now reachable with `FEATURE_EMPLOYMENT_RECORD=true` — confirm it actually renders, this is the first live use of this flag |
| M6 | Hotel blocklist | `BlocklistWriteGate` | `GET/POST /employees/hotels/:hotel_id/blocklist` | Add/remove works, scoped to manager's hotel |
| M7 | HR contracts/payroll | `HrPayrollGate`, `DocumentsGate` | `GET/POST /hr/contracts`, `GET /hr/payroll`, `POST /hr/payroll/:id/fulfil` | Create contract, fulfil a payslip request, upload signed contract all work |
| M8 | Work request create/update | `.../requests/new/page.tsx` | `POST/PATCH /work-requests` | Standard job posting flow |
| M9 | Raise/close broadcast | `.../requests/broadcasts/*` | `POST /work-requests/broadcasts`, `.../close` | Requires PHASE2 — first live UAT of this flag on the manager side |
| M10 | Calendar direct-assignment | `.../assignments/calendar-entries/*` | `POST/GET /assignments/calendar-entries` | Requires PHASE2 — confirm entries create and list correctly |
| M11 | Assignment update / rooms-completed | `.../assignments/[id]/page.tsx` | `PATCH /assignments/:id`, `POST /assignments/:id/rooms-completed` | Standard flow |
| M12 | Geo check-ins review | `.../geo-checkins/page.tsx` | `GET /geo/checkins[/:id]` | Manager sees own-hotel check-ins only |
| M13 | Attendance verify (web) | `.../attendance/page.tsx` | `PATCH /attendance/:id` | Parity with checker-app verification |
| M14 | Analytics dashboards | `.../analytics/page.tsx` | `GET /analytics/leaderboard\|stats\|hotel-summary/:id` | Loads correctly for manager role |

## Admin

| # | Workflow | Entry point | Backend route | Pass criteria |
|---|---|---|---|---|
| A1 | Create user | `.../users/new` | `POST /users` | New user created with correct role |
| A2 | Assign/change role | `.../users/[id]/page.tsx` | `PUT /users/:id/role` | Role change takes effect immediately (existing session may need to re-auth — confirm expected behavior) |
| A3 | Deactivate/delete user | same | `DELETE /users/:id` | User can no longer log in |
| A4 | Revoke all sessions | same | `POST /users/:id/revoke-sessions` | All of that user's active tokens are invalidated |
| A5 | Create/edit/delete hotel | `.../hotels/new\|edit` | `POST/PATCH/DELETE /crm/hotels[/:id]` | Confirm this is admin-only now that `FEATURE_GD02_MATRIX=true` narrows it from admin+manager |
| A6 | Create/edit/delete hotel group | `.../hotel-groups/new\|edit` | `POST/PATCH/DELETE /crm/hotel-groups[/:id]` | Standard CRUD |
| A7 | Worker onboarding / employee create / bulk import | `WorkerOnboardingGate` | `POST /employees`, `.../lifecycle-signal`, `/bulk-import` | First live UAT of `FEATURE_EMPLOYMENT_RECORD` on the write path — confirm lifecycle transitions (INACTIVE→UNDER_REVIEW→ACTIVE) work end to end |
| A8 | Subject-rights export | compliance module | `POST /compliance/subject-rights-export` | Export completes, fans out to documents/consent/audit-trail sources correctly |
| A9 | Notification outbox admin | no UI — API only | `GET/POST/DELETE /notifications/outbox/*` | Confirm an admin can retrieve metrics and dead-letter list via direct API call (no frontend page exists for this — expected, not a defect) |
| A10 | ⚠ VERIFY — Retention audit-log access control | no dedicated page | `GET /retention/audit-log`, `/eligibility` | Repository evidence indicates this route currently has **no role gate at all** — confirm whether a non-admin can reach it. If so, this is a real access-control gap to report, not to silently patch during UAT. |

## Regional Manager

**Not part of this release** — `FEATURE_RM_ROLE` stays off (see Release Execution Plan §2), not
because client support is missing (frontend and both mobile apps already handle
`regional_manager` correctly, per ADR-030 PR-3, confirmed shipped) but because its promotion
script has no demote path. No UAT is required for this role this cycle. If a future release
enables it, this section can mostly reuse what's already built — re-check
`backend/src/scripts/run-regional-manager-promotion.ts` for a demote path before promoting any
real account, and additionally test the RM-specific org-chart route
(`GET /employees/hotel-groups/:hotel_group_id/org-chart`), which has no dedicated frontend page
yet (API-only today).

## Cross-role

| # | Workflow | Pass criteria |
|---|---|---|
| X1 | Login (all four roles) | Correct role-based landing screen/page for each |
| X2 | Password reset (all roles) | Works identically regardless of role |
| X3 | Push registration + receipt | Confirmed separately per app in W19/C8 — also confirm a **denied** push permission does not block login or any other flow (documented as graceful degradation in code; confirm in practice) |
| X4 | ⚠ VERIFY — Regional Manager UI gating | N/A this release (role disabled) — no test needed until `FEATURE_RM_ROLE` ships |

---

## Sign-off

- [ ] All rows above executed against staging with the recommended flag configuration
- [ ] All ⚠ VERIFY rows have a definitive pass/fail result, not "assumed fine"
- [ ] Any failure is filed as a defect with the exact row ID (e.g. "W20 failed") for traceability
- [ ] Re-run the full checklist against production after deploy, not just staging
