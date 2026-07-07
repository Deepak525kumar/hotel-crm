# Module Specification: `backend-notifications`

> Specification of ONE bounded capability — notification create/list/read-tracking and the
> `notification-service` in-process contract it exposes to four producer modules and three
> clients. This capability is **MID-PIVOT**. It carries two labeled layers: `[CURRENT STATE]`
> — already-implemented persist-only, IN_APP-default behavior, reverse-specified at code base
> revision `efde2a9f0393cccc2168cd1d2d89ea9cbc21033a`; and `[TARGET STATE]` — the confirmed
> push-only, multi-trigger notification model that is authoritative but almost entirely
> unbuilt at the delivery layer. `[MIGRATION GAP]` marks the delta between them. Every
> material claim is bound to source: current-state claims cite `path:line @efde2a9f`;
> target-state claims cite the confirmed authorities `PIVOT_DESIGN_DOCUMENT.md` (PIVOT §x)
> and `CONFIRMED_REQUIREMENTS_REGISTER.md` (CONFIRMED §x). This document records behavior
> and confirmed contract; it does not create product policy. All human-authority decisions
> are carried as explicit open decisions and are NOT resolved here.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-NOTIF-001 / 0.1.0` |
| Status | `REVIEW` |
| Owner | `unassigned (SYNC-001, human authority required)` |
| Authors / reviewers | Author: Module Author agent. Reviewers: pending (G4 not yet run). |
| Repository revision | `efde2a9f0393cccc2168cd1d2d89ea9cbc21033a` (current HEAD, branch `claude/notifications-spec-freeze-bpxz57`) |
| Approved by / at | Not approved. G2 freeze is reserved human authority; do NOT mark FROZEN. |
| Supersedes | None — first specification for `backend-notifications` (registry `specification: UNKNOWN` prior; `MODULE_REGISTRY.yaml:152`). |

## Purpose and Scope

**Outcome:** Define the contract for the hotel's notification capability across its full pivot
arc. This is ONE bounded capability implemented by a single backend module
(`backend-notifications`), specified together with the `Notification` Prisma model, the
`NotificationType`/`NotificationChannel` enums it exclusively owns, and the
`notification-service` in-process contract consumed by four producer modules and three
clients.

- `[CURRENT STATE]` (implemented @efde2a9f): a **persist-only, channel-agnostic-in-name**
  service. `sendNotification` writes one `Notification` row per call, always defaulting to
  channel `IN_APP` because no caller ever sets `channel` explicitly. `getNotifications` lists
  the caller's own rows (hardcoded cap 50, no pagination). `markAsRead` enforces ownership.
  `sendEmail` and `sendPushNotification` are declared but immediately `throw
  NotImplementedError` and are never called by any code path in the repository — there is
  **zero actual delivery mechanism** beyond the database row.
- `[TARGET STATE]` (confirmed, almost entirely unbuilt — CONFIRMED §18; PIVOT §4.8, §5.2,
  §9.1, §11): a **push-only** notification system (APNs for iOS, FCM for Android; no SMS, no
  self-service settings screen) that must additionally serve as the trigger point for at
  least eight new confirmed events this module currently has no `NotificationType` value for
  (failed login, rework escalation, rating warnings, consent decline, sick/vacation, contract
  expiry, broadcast job-request eligibility/fulfillment/auto-close). Rework is the one
  explicit exception requiring **both** an in-app inbox entry **and** a separate push
  notification (CONFIRMED §14) — the reconciliation of this against the system-wide
  "push-only" decision (CONFIRMED §18) is addressed under State and Lifecycle and carried as
  an open decision (`OQ-NOTIF-01`).

**In scope:**
- `backend/src/modules/notifications/{service.ts,controller.ts,routes.ts,types.ts}` and
  `backend/src/__tests__/notifications.test.ts` — full current-state behavior (create/list/
  mark-read, the two `NotImplementedError` stubs).
- The `Notification` model, `NotificationType` enum, and `NotificationChannel` enum in
  `backend/prisma/schema.prisma` — both enums are referenced **only** by this model
  (verified: repo-wide grep for `NotificationType`/`NotificationChannel` outside
  `schema.prisma` matches only `notifications/service.ts:1,11`).
- The `notification-service` contract as consumed by its four current producer modules
  (`work-requests`, `work-applications`, `attendance`, `quality`) — call sites only (the
  `type`/payload passed), not those modules' own business logic.
- Client consumption of `GET /notifications` and `POST /notifications/:id/read`:
  `frontend/lib/api.ts`, `mobile/worker-app/src/lib/api.ts`, `mobile/checker-app/src/lib/api.ts`.
- Config surface: `backend/src/config/env.ts` `APNS_*`/`FIREBASE_PROJECT_ID` declarations and
  their (non-)consumption.
- `.claude/knowledge/DEPENDENCY_GRAPH.yaml` node `backend-notifications`, the
  `notification-service` contract block, the `state-notification` state-domain block, and the
  four `calls` edges + three `consumes-api` edges targeting/from it.
- `.claude/knowledge/MODULE_REGISTRY.yaml` entry `id: backend-notifications`.

**Out of scope:**
- The internal business logic of `work-requests`, `work-applications`, `attendance`,
  `quality`, `calendar`, `hr`, `onboarding` beyond their notification call sites — these are
  specified (or pending specification) elsewhere; job-dispatch's own notification triggers
  are cross-referenced from `docs/03-modules/job-dispatch/MODULE_SPEC.md`.
- Email/SMTP payslip delivery (an HR capability, PIVOT §7.7 — a **different** delivery
  mechanism than this module's `sendEmail` stub, and out of CONFIRMED §18's push-only
  channel decision entirely since payslip email is not a "notification").
- The chatbot's GDPR subject-rights channel (PIVOT §7.1, §4.13).
- The consent-gate and retention-sweep mechanics themselves — only their notification
  *trigger points* are in-scope (e.g. "decline consent → notify manager" is in-scope as a
  target requirement; how consent state is stored is not, PIVOT §7.6, §9.3).

**Non-goals:** Requirements discovery, product-policy invention, code planning, independent
review, or resolving any open decision below.

## Evidence and Traceability

`[CURRENT STATE]` requirements (REQ-001..015) — reverse-specified at `efde2a9f`:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-001` sendNotification always persists channel=IN_APP (schema default; never set explicitly) | `notifications/service.ts:6-17`; `schema.prisma:473` @efde2a9f | Code | Observed |
| `REQ-002` getNotifications: own rows only, newest-first, hardcoded take:50, no pagination/filters | `notifications/service.ts:19-25` @efde2a9f | Code | Observed |
| `REQ-003` markAsRead: 404 if missing, 403 if non-owner, else is_read=true + read_at=now | `notifications/service.ts:27-38` @efde2a9f | Code + test | Observed; tested |
| `REQ-004` sendEmail always throws NotImplementedError | `notifications/service.ts:40-42` @efde2a9f | Code | Observed |
| `REQ-005` sendPushNotification always throws NotImplementedError | `notifications/service.ts:44-46` @efde2a9f | Code | Observed |
| `REQ-006` both routes require only authMiddleware; no route-level role restriction | `notifications/routes.ts:1-13`; `middleware/auth.ts:5-38` @efde2a9f | Code | Observed |
| `REQ-007` NotificationService never calls BaseService.logAudit; no AuditLog row for create/read | `notifications/service.ts` (absence); `lib/base-service.ts:7-31` @efde2a9f | Code (absence) | Observed |
| `REQ-008` response envelope `{status,data,meta}`; GET / has no pagination envelope | `notifications/controller.ts:10-14,24-28` @efde2a9f | Code | Observed |
| `REQ-009` NotificationPayload is TS-only, not Zod-validated; `type` is a raw cast | `notifications/types.ts:1-6`; `notifications/service.ts:9-11` @efde2a9f | Code | Observed |
| `REQ-010` hotel_id (optional FK) is never set by any of the 10 emitted notification types | `schema.prisma:470-471`; `work-requests/service.ts:241-246`; `work-applications/service.ts:103-108,194-199,299-311`; `attendance/service.ts:187-191,200-205`; `quality/service.ts:75-84,191-198` @efde2a9f | Code | Observed |
| `REQ-011` work-requests emits WORK_REQUEST_PUBLISHED to whole ACTIVE roster; fan-out awaited on request path, per-recipient failure swallowed | `work-requests/service.ts:4,222-250` @efde2a9f | Code | Observed |
| `REQ-012` work-applications emits APPLICATION_RECEIVED/REJECTED/ACCEPTED + ASSIGNMENT_CONFIRMED; all four unawaited (`void ... .catch(() => {})`) | `work-applications/service.ts:12,103-108,194-199,299-311` @efde2a9f | Code | Observed |
| `REQ-013` attendance emits ATTENDANCE_VERIFIED and WORKER_NO_SHOW; both unawaited fire-and-forget | `attendance/service.ts:4,185-209` @efde2a9f | Code | Observed |
| `REQ-014` quality emits QUALITY_VERIFICATION_SUBMITTED/REWORK_REQUIRED and RATING_RECEIVED; all three unawaited fire-and-forget; FAILED reuses SUBMITTED type | `quality/service.ts:4,72-84,191-198` @efde2a9f | Code | Observed |
| `REQ-015` markAsRead is the ONLY tested method; sendNotification/getNotifications/sendEmail/sendPushNotification have zero test coverage | `backend/src/__tests__/notifications.test.ts:1-79` @efde2a9f | Test (absence) | Observed |
| No event bus; notifications are a synchronous in-process service call | `MODULE_REGISTRY.yaml:150` (`published_events: none-observed`); `DEPENDENCY_GRAPH.yaml:410-418` @efde2a9f | Code + graph | Observed |
| sendEmail/sendPushNotification have zero call sites anywhere in the repository | repo-wide grep, no matches @efde2a9f | Code (absence) | Observed |
| Modular-monolith architecture (ADR-003) | PIVOT §5.1, §11; `backend/src/modules/*` @efde2a9f | Architecture decision | Confirmed |
| Prisma 5 ORM over PostgreSQL (ADR-004) | PIVOT §2.1, §11; `backend/prisma/schema.prisma` @efde2a9f | Architecture decision | Confirmed |

`[TARGET STATE]` requirements (TREQ-001..012) — confirmed authorities, almost entirely unbuilt:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `TREQ-001` repeated failed login attempts notify the responsible manager; no lockout, no rate-limit | CONFIRMED §2; PIVOT §4.1 | Confirmed authority | Target; unbuilt (MIG-GAP-01) |
| `TREQ-002` rework assignment notifies the worker via BOTH a stored, readable in-app inbox entry AND a separate push notification | CONFIRMED §14; PIVOT §4.6, §7.5, §9.1 | Confirmed authority | Target; unbuilt (MIG-GAP-02) |
| `TREQ-003` rework not completed within 20 minutes escalates to BOTH Manager and Checker | CONFIRMED §14; PIVOT §5.6, §7.5 | Confirmed authority | Target; unbuilt (MIG-GAP-03) |
| `TREQ-004` rating <70 notifies worker (first warning); <50 notifies worker (second warning) AND manager; no further automated action | CONFIRMED §16; PIVOT §4.6, §7.5 | Confirmed authority | Target; unbuilt (MIG-GAP-04); cross-ref `docs/03-modules/quality/MODULE_SPEC.md:457` MIG-GAP-04 |
| `TREQ-005` declining the daily GDPR consent gate blocks access AND notifies the manager | CONFIRMED §18, §24; PIVOT §4.8, §7.6 | Confirmed authority | Target; unbuilt (MIG-GAP-05) |
| `TREQ-006` marking a day sick or vacation notifies the manager (informational, no approval) | CONFIRMED §22; PIVOT §4.5, §7.2 | Confirmed authority | Target; unbuilt (MIG-GAP-06) |
| `TREQ-007` scheduled job reminds the responsible manager before the 1-year contract end and again before the 2-year end; none once permanent | CONFIRMED §9; PIVOT §5.6, §9.1 | Confirmed authority | Target; unbuilt (MIG-GAP-07) |
| `TREQ-008` broadcast job request notifies ONLY workers with matching skill who are free that day ("job available") | CONFIRMED §13; PIVOT §4.4, §5.5, §7.3, Section 6 diagram | Confirmed authority | Target; unbuilt (MIG-GAP-08); cross-ref `docs/03-modules/job-dispatch/MODULE_SPEC.md` TREQ-003 |
| `TREQ-009` when a broadcast skill's slots fill, later responders get an explicit "requirement fulfilled" notification (not silence, not an error) | CONFIRMED §13; PIVOT §4.4, §7.3, Section 8.2 sequence diagram | Confirmed authority | Target; unbuilt (MIG-GAP-09); cross-ref job-dispatch TREQ-005 |
| `TREQ-010` unfilled broadcast job request auto-closes after 6h (or manual close) and notifies the manager | CONFIRMED §13; PIVOT §4.4, §5.6, Section 6 diagram (`AC --> PG`) | Confirmed authority | Target; unbuilt (MIG-GAP-10); cross-ref job-dispatch TREQ-006 |
| `TREQ-011` delivery channel is push-only, system-wide; no SMS; no self-service notification-settings screen | CONFIRMED §18; PIVOT §4.8, §5.2, §11 | Confirmed authority | Target; unbuilt (MIG-GAP-11) |
| `TREQ-012` `Notification` model is retained; `NotificationChannel` is narrowed in practice to `{IN_APP, PUSH}` for this capability (author's reconciliation — see State and Lifecycle, `OQ-NOTIF-01`) | PIVOT §9.1 ("Notification: Keep; push-only channel"); CONFIRMED §14, §18 | Confirmed authority + author inference | Target; interpretation OPEN |

`[FACTUAL MISMATCH — flagged, not resolved]`: PIVOT §10 ("Rollback, flags, risk") states feature
flags gate each new module "the `FEATURE_*` env convention already exists in the codebase."
Repo-wide grep (`backend/src`, `frontend`, `mobile`, all `.env*`/`.json`/`.ts`) found **zero**
matches for `FEATURE_` anywhere in actual source or config — the only occurrences repository-wide
are in other modules' own `MODULE_SPEC.md`/`PIVOT_DESIGN_DOCUMENT.md` prose repeating this same
claim (`docs/03-modules/{calendar,job-dispatch,employee-management,crm}/MODULE_SPEC.md`,
`docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md:431`). This module's target rollout (TREQ-011/012)
would, per PIVOT §10, be gated by this convention; since it does not exist, "feature-flagged
partial deploy" for the push-delivery build-out has no existing mechanism to attach to. Recorded
as evidence, not silently accepted — see Risks/Open Decisions `OQ-NOTIF-03`.

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| Notification | A single persisted event record (`Notification` row): recipient (`user_id`), optional `hotel_id`, `type` (category), `channel` (delivery surface, default `IN_APP`), title/message, optional deep-link `data`, read state. `[TARGET]` retained; channel narrows toward push (TREQ-011/012). | `schema.prisma:466-488` |
| NotificationType | Enum of 16 notification categories; 10 are emitted by current code, 6 are declared-but-never-emitted marketplace-era values. `[TARGET]` requires ≥8 new values for confirmed triggers with no current representation (see MIGRATION GAP enumeration). | `schema.prisma:89-111` |
| NotificationChannel | Enum `{IN_APP, EMAIL, PUSH, SMS}`. `[CURRENT]` only `IN_APP` (the schema default) is ever actually persisted — no caller sets it. `[TARGET]` narrows to push-only delivery (CONFIRMED §18), with `IN_APP` retained as the inbox-persistence substrate (author's reconciliation, `OQ-NOTIF-01`). | `schema.prisma:80-85` |
| notification-service | The in-process TypeScript contract (`notificationService.sendNotification/getNotifications/markAsRead/sendEmail/sendPushNotification`) imported directly by producer modules — not an HTTP or event-bus contract. | `notifications/service.ts:1-49`; `MODULE_REGISTRY.yaml:317-322` |
| Producer module | Any backend module that calls `notificationService.sendNotification` to originate a notification. `[CURRENT]` exactly four: `work-requests`, `work-applications`, `attendance`, `quality`. `[TARGET]` will grow to include auth (failed login), calendar/sick-vacation, consent-gate, hr/contracts, and job-dispatch's broadcast flow — none of which exist as producers today. | `DEPENDENCY_GRAPH.yaml:78-112` |
| Inbox | `[TARGET]` the stored, readable list of a worker's `IN_APP` notification rows, explicitly required (in addition to push) for rework per CONFIRMED §14. Current code's `GET /notifications` already serves this function for every notification type, incidentally. | CONFIRMED §14; `notifications/service.ts:19-25` |
| Push-only | `[TARGET]` CONFIRMED §18's system-wide decision that email and SMS are excluded as notification delivery channels; APNs (iOS) / FCM (Android) are the external delivery mechanisms. | CONFIRMED §18; PIVOT §4.8, §5.2 |
| Recipient scoping | The `user_id` a notification targets; `[CURRENT]` chosen entirely by the calling producer module (e.g. "every ACTIVE roster worker," "the request's `created_by_id`," "the assignment's `assigned_by_id`") — this module performs no recipient computation of its own. | `work-requests/service.ts:233-236`; `attendance/service.ts:195-198` |

## Requirements and Acceptance Criteria

`[CURRENT STATE]` requirements (all Observed @efde2a9f unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| REQ-001 | A created notification always persists with channel=IN_APP. | Must | Any `sendNotification` call, regardless of `type`, results in a row with `channel="IN_APP"` (schema default, never overridden). | RULE-002 |
| REQ-002 | Listing notifications returns only the caller's own rows, newest-first, capped at 50, unfiltered. | Must | `GET /notifications` returns ≤50 rows where `user_id`=caller, ordered `created_at desc`; no way to request page 2 or filter by type/read state. | RULE-006 |
| REQ-003 | Marking a notification read enforces strict ownership. | Must | Unknown id → 404 NotFoundError; id belongs to another user → 403 ForbiddenError; owner → 200 with `is_read=true`, `read_at=now`. | RULE-001 |
| REQ-004 | Email delivery is unimplemented. | Must (gap) | Any call to `sendEmail` → NotImplementedError (501); zero call sites exist. | — |
| REQ-005 | Push delivery is unimplemented. | Must (gap) | Any call to `sendPushNotification` → NotImplementedError (501); zero call sites exist. | — |
| REQ-006 | Both HTTP endpoints require only authentication, no role check. | Must | Any authenticated user of any role (`worker`/`checker`/`manager`/`admin`) can call `GET /notifications` and `POST /:id/read`; only ownership (REQ-003) further restricts the latter. | RULE-004 |
| REQ-007 | Notification mutations are not audited. | Should (gap) | Neither `sendNotification` nor `markAsRead` produces an `AuditLog` row, unlike every producer module's own mutations. | RULE-005 |
| REQ-008 | List responses carry no pagination envelope. | Should (gap) | `GET /notifications` response `data` is a bare array; no `pagination` key despite being list-shaped and capped. | — |
| REQ-009 | The notification payload is not runtime-validated by this module. | Should (gap) | `sendNotification`'s `type` field is a TypeScript-only cast (`payload.type as NotificationType`); an invalid string from a caller is only rejected at the Prisma/DB enum-column layer, not by this module's own logic. | RULE-007 |
| REQ-010 | `hotel_id` is never populated. | Should (gap) | Every current call site across all four producers omits `hotel_id`; the column is always null in practice. | — |
| REQ-011 | Publishing a work request notifies the entire ACTIVE roster. | Must | `WORK_REQUEST_PUBLISHED` is sent to every `HotelWorker` with `status=ACTIVE` on the request's hotel; fan-out is awaited (`Promise.all`) on the publish request path; each recipient's delivery failure is independently swallowed. | RULE-003 |
| REQ-012 | Application lifecycle events notify the relevant party. | Must | Apply → creator gets `APPLICATION_RECEIVED`; reject → applicant gets `APPLICATION_REJECTED`; accept (post-commit) → applicant gets both `APPLICATION_ACCEPTED` and `ASSIGNMENT_CONFIRMED`. All four are unawaited fire-and-forget. | RULE-003 |
| REQ-013 | Attendance verification/no-show events notify the relevant party. | Must | Manager-verified attendance → worker gets `ATTENDANCE_VERIFIED`; ABSENT status → the assignment's `assigned_by_id` gets `WORKER_NO_SHOW` (resolved via an unawaited nested Prisma lookup). Both fire-and-forget. | RULE-003 |
| REQ-014 | Quality verification/rating events notify the worker. | Must | Verification PASSED/FAILED → `QUALITY_VERIFICATION_SUBMITTED`; NEEDS_REWORK → `REWORK_REQUIRED` (FAILED reuses the SUBMITTED type — no dedicated FAILED type exists); rating create (post-commit) → `RATING_RECEIVED`. All three fire-and-forget. | RULE-003 |
| REQ-015 | Test coverage is limited to `markAsRead`. | Should (gap) | The single test file exercises only the three `markAsRead` branches (404/403/success); `sendNotification`, `getNotifications`, `sendEmail`, `sendPushNotification` have zero asserting tests. | — |

`[TARGET STATE]` requirements (confirmed authority; unbuilt unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| TREQ-001 | Repeated failed login attempts notify the manager; no lockout/rate-limit is introduced as a side effect. | Must | N consecutive failed logins for a worker → the responsible manager receives a notification; the worker's account is never locked and no rate-limit blocks further attempts. | TRULE-004 |
| TREQ-002 | Rework assignment delivers BOTH an in-app inbox entry AND a separate push notification to the worker. | Must | On rework assignment, exactly one `IN_APP`-persisted row exists AND one push delivery is attempted; absence of either is a defect. | TRULE-002 |
| TREQ-003 | Incomplete rework after 20 minutes escalates to Manager AND Checker. | Must | A scheduled timer fires 20 minutes after rework assignment; if not marked done, both the Manager and the Checker receive a notification. | TRULE-001 |
| TREQ-004 | Rating-threshold crossings notify worker (and manager at the second tier). | Must | Rating drop below 70 → worker notified (first warning); below 50 → worker notified (second warning) AND manager notified; no further automated consequence. | TRULE-004 |
| TREQ-005 | Declining the daily consent gate notifies the manager (in addition to blocking access). | Must | A decline event → the responsible manager receives a notification; access is blocked for that calendar day (consent-gate mechanics themselves out of scope). | TRULE-004 |
| TREQ-006 | Sick/vacation marking notifies the manager. | Must | A worker's sick/vacation flag for a current/future day → the responsible manager receives a notification; no approval gate. | TRULE-004 |
| TREQ-007 | Contract-expiry reminders notify the responsible manager. | Must | A daily scheduled job notifies the manager before the 1-year contract end and again before a 1-year extension's end; no reminder once permanent. | TRULE-001 |
| TREQ-008 | Broadcast job requests notify only eligible workers. | Must | Only workers with the matching skill who are free that day receive the "job available" notification; ineligible workers receive nothing. | TRULE-003 |
| TREQ-009 | Post-fill broadcast responders receive an explicit "requirement fulfilled" message. | Must | A response after a skill's slots are full → sender gets a distinct, named notification, not silence and not an HTTP error. | TRULE-003 |
| TREQ-010 | Broadcast auto-close notifies the manager. | Must | 6h after creation (or manual close), an unfilled job request closes and the manager is notified. | TRULE-001 |
| TREQ-011 | All new and existing notification delivery is push-only. | Must | No notification is delivered via email or SMS; APNs/FCM is the sole external delivery mechanism; no self-service settings screen is built. | TRULE-005 |
| TREQ-012 | `NotificationChannel` usage narrows to `{IN_APP, PUSH}` in practice for this capability. | Should | New code paths never set `channel=EMAIL` or `channel=SMS` on a `Notification` row (author's reconciliation of TREQ-002/011; `OQ-NOTIF-01`). | TRULE-002, TRULE-005 |

## Business Rules

`[CURRENT STATE]` rules (RULE-001..007):

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-001 | markAsRead invoked with (notification_id, caller user_id) | Notification must exist (else 404) and `user_id` must equal caller (else 403); on pass, `is_read=true`, `read_at=now`. | No re-read guard — marking an already-read notification read again succeeds idempotently (observed: no `is_read` precondition in the query). | `unassigned (SYNC-001)`; `notifications/service.ts:27-38` |
| RULE-002 | Any `sendNotification` call | The created row's `channel` is always the Prisma column default `IN_APP`; no caller path can set `EMAIL`/`PUSH`/`SMS` today because `create.data` never includes `channel`. | `[TARGET]` this becomes the reconciliation point for push-only delivery (TRULE-002/005; `OQ-NOTIF-01`). | `unassigned (SYNC-001)`; `notifications/service.ts:8-16`; `schema.prisma:473` |
| RULE-003 | Any notification emission by a producer module | Delivery is best-effort, fire-and-forget; it never participates in or rolls back the originating transaction. Three of the four producers (`work-applications`, `attendance`, `quality`) use unawaited `void ... .catch(() => {})`; `work-requests`' roster fan-out is *awaited* on the request path (via `Promise.all`) but each individual recipient's rejection is independently `.catch`-swallowed, so publish latency is O(roster) even though a delivery failure never surfaces as an error (cross-ref job-dispatch RULE-012, FIND-PERF-001). | Delivery failure is silent in all four cases; only the awaited roster fan-out affects latency. | `unassigned (SYNC-001)`; `work-requests/service.ts:238-249`; `work-applications/service.ts:103,194,299,306`; `attendance/service.ts:187,200`; `quality/service.ts:75,191` |
| RULE-004 | Any request to `GET /notifications` or `POST /:id/read` | Authentication (any valid JWT) is the only route-level gate; there is no `requireRole` middleware on this router. | `POST /:id/read` is further restricted at the service layer by ownership (RULE-001); `GET /` has no further restriction beyond the `WHERE user_id=caller` clause baked into the query. | `unassigned (SYNC-001)`; `notifications/routes.ts:1-13` |
| RULE-005 | Any `NotificationService` mutation | No `AuditLog` row is written for notification creation or read-state changes. | `BaseService.logAudit` exists and is used by every producer module for its OWN mutation, but `NotificationService` (which extends `BaseService`) never calls it. | `unassigned (SYNC-001)`; `notifications/service.ts` (absence); `lib/base-service.ts:7-31` |
| RULE-006 | `getNotifications` invocation | Always returns at most the 50 most recent rows for the caller; no `page`/`per_page`/`cursor` parameter exists. | A user with >50 notifications cannot retrieve older ones via this endpoint. | `unassigned (SYNC-001)`; `notifications/service.ts:19-25` |
| RULE-007 | `sendNotification` payload | `type` is accepted as a plain string and cast (`as NotificationType`); this module performs no explicit enum-membership check before the Prisma write. | An invalid `type` string fails only at the Prisma enum-column constraint (a raw DB error), not as a typed `ValidationError` from this module. | `unassigned (SYNC-001)`; `notifications/service.ts:9-11`; `notifications/types.ts:1-6` |

`[TARGET STATE]` rules (TRULE-001..005) — confirmed authority:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| TRULE-001 | A manager-facing trigger fires (contract expiry, broadcast auto-close, 20-min rework escalation) | The manager (and, for rework escalation, also the checker) receives a notification; the system takes no further automated action beyond notifying. | "Notify and stop" is the confirmed pattern for every manager-facing target trigger in this register — no auto-suspension, no auto-lockout, no auto-cancel beyond what's separately confirmed (e.g. sick/vacation auto-cancels the assignment itself, TREQ-009 of job-dispatch — a different module's action, not this module's). | CONFIRMED §2, §9, §13, §16, §22; PIVOT §5.6 |
| TRULE-002 | Rework is assigned to a worker | Both an `IN_APP`-persisted inbox row AND a push delivery occur for the same triggering event. | This is the one explicit multi-channel carve-out in the confirmed register; see `OQ-NOTIF-01` for whether it generalizes. | CONFIRMED §14 |
| TRULE-003 | Broadcast job-request lifecycle event (eligible-worker notify, post-fill responder, auto-close) | Recipient computation (skill match ∧ free that day; already-notified-and-late) is performed by the broadcast/job-dispatch producer, NOT by this module; this module only delivers to the list it is handed. | This module's contract must accept a pre-computed recipient list/id, not a "notify hotel X's roster" instruction, for broadcast triggers (contrast with REQ-011's current whole-roster pattern). | CONFIRMED §13; PIVOT §5.5, §7.3 |
| TRULE-004 | Any notification delivery | Channel is push (APNs/FCM); no email, no SMS. | Rework additionally requires the in-app inbox entry (TRULE-002). Payslip email (HR, PIVOT §7.7) is a distinct delivery mechanism, not a "notification" under this rule. | CONFIRMED §18; PIVOT §4.8, §5.2, §11 |
| TRULE-005 | System-wide channel policy | `NotificationChannel` values `EMAIL`/`SMS` are not part of this capability's target delivery surface. | Whether the enum values are removed from the schema or simply never used going forward is undecided — see `OQ-NOTIF-01`. | Author's reconciliation of CONFIRMED §14/§18; PIVOT §9.1 |

## Ownership and Boundaries

**Module owner:** `unassigned (SYNC-001, human authority required)`. No CODEOWNERS file exists
and `backend/package.json` author is empty; owner assignment is reserved human authority and is
NOT invented here (`MODULE_REGISTRY.yaml:146`).

**Owned state:**
- `state-notification` (`Notification` model, `schema.prisma:466-488`) — sole owner
  `backend-notifications` per `MODULE_REGISTRY.yaml:74` and `DEPENDENCY_GRAPH.yaml:74,491-497`.
  The graph note is explicit and independently corroborated by code inspection: "Only
  notifications writes/reads directly; other modules produce notifications through the
  notification-service `calls` contract, not by touching this state"
  (`DEPENDENCY_GRAPH.yaml:496-497`) — no other module's `service.ts` imports `Notification`
  from `@prisma/client` or calls `prisma.notification.*` directly (verified alongside the
  producer call-site greps above).
- `NotificationType` enum (`schema.prisma:89-111`) and `NotificationChannel` enum
  (`schema.prisma:80-85`) — referenced only by the `Notification` model; functionally owned by
  this module even though the dependency graph does not model bare Prisma enums as separate
  state-domains.

**Consumed state:** None. `sendNotification` accepts `userId` as an opaque parameter from the
caller and performs no existence check against `state-user` before writing
(`notifications/service.ts:7-17`) — the `user_id` foreign key
(`user User @relation(fields:[user_id],...,onDelete: Cascade)`, `schema.prisma:468-469`) is
**required** and non-nullable, so an invalid/deleted `userId` would raise an unhandled Prisma
foreign-key-constraint error rather than a typed `NotFoundError`. Because every current call
site is fire-and-forget with `.catch(() => {})` (RULE-003), such a failure is **silently and
completely swallowed** by the calling producer — this is a current-state defect surfaced by
this spec, not previously recorded in the dependency graph. `hotel_id` is an optional,
`onDelete: SetNull` FK to `state-hotel` and is never populated (REQ-010), so no meaningful
`state-hotel` read/consistency dependency exists in practice today.

**Permitted writes:** This module writes only its own owned state (`state-notification`); unlike
`backend-work-applications` in the job-dispatch capability, there is **no** cross-owner write
coupling — `NotificationService`'s Prisma calls touch only `this.prisma.notification.*`.

**Boundary/non-responsibilities:** This module does not decide WHEN or WHOM to notify — that
trigger-point decision (event, recipient, message copy) belongs entirely to each producer
module; this module is a pure sink for the `sendNotification` call. It does not implement actual
push/email delivery (both are `NotImplementedError` stubs, REQ-004/005). It does not compute
broadcast eligibility (job-dispatch's responsibility, TRULE-003). It does not own the
consent-gate, retention-sweep, or contract-lifecycle mechanics — only their notification trigger
points are in-scope (task framing; PIVOT §7.6, §7.7, §9.3). It does not write `AuditLog`
(RULE-005, a gap, not a designed boundary).

## Interfaces and Contracts

Base router mounts at `backend/src/routes/v1/index.ts:32` (`/notifications`). All routes require
`authMiddleware` (`routes.ts:6`). Envelope: `{ status:"success", data, meta:{timestamp,
request_id} }` (no `pagination` key, REQ-008). Error types map to HTTP via the shared error
layer: `UnauthorizedError` (401), `NotFoundError` (404), `ForbiddenError` (403),
`NotImplementedError` (501) — all defined in `backend/src/lib/errors.ts:29-90`. Compatibility
vocabulary (consistent with job-dispatch spec): these contracts are **unversioned** in code, so
compatibility posture is **baseline/UNKNOWN**, not "Additive/Stable."

`[CURRENT STATE]` endpoints and the in-process contract (implemented @efde2a9f):

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `notificationService.sendNotification(userId, payload)` (unversioned, in-process) | inbound (TS import, no HTTP boundary) | `userId: string`; `NotificationPayload {type, title, message, data?}` (`notifications/types.ts:1-6`) | Created `Notification` row | Unhandled Prisma FK-constraint error if `userId` invalid (not caught by this module; see Ownership) | N/A — caller already authenticated via its own route; no auth boundary crossed here | baseline/UNKNOWN |
| `GET /notifications` (unversioned) | inbound | none (no query schema; params ignored) | 200, bare array ≤50 `Notification` rows, newest-first | `UnauthorizedError` (401) if unauthenticated | `authMiddleware` only (any role) | baseline/UNKNOWN |
| `POST /notifications/:notification_id/read` (unversioned) | inbound | path `notification_id` | 200, updated `Notification` row | `UnauthorizedError` (401), `NotFoundError` (404), `ForbiddenError` (403, non-owner) | `authMiddleware` + service-level ownership check (RULE-001) | baseline/UNKNOWN |
| `notificationService.sendEmail(email, subject, body)` (unversioned, in-process, unimplemented) | inbound | 3 strings | never returns | Always `NotImplementedError` (501) | N/A | baseline/UNKNOWN; dead code — zero call sites |
| `notificationService.sendPushNotification(userId, title, body)` (unversioned, in-process, unimplemented) | inbound | 3 strings | never returns | Always `NotImplementedError` (501) | N/A | baseline/UNKNOWN; dead code — zero call sites |

DTO shape: `NotificationPayload` (`notifications/types.ts:1-6`); the returned `Notification` row
shape is the raw Prisma model (`schema.prisma:466-488`), mirrored client-side as `Notification`
in `frontend/lib/types.ts:341-356`.

`[TARGET STATE]` interfaces (unbuilt; shapes not yet authored): a functioning
`sendPushNotification` implementation (APNs/FCM), and new `sendNotification` call sites from
producers that do not exist today (auth/failed-login, calendar/sick-vacation, consent-gate,
hr/contract-expiry, job-dispatch/broadcast). Their exact payload/DTO shapes are not specified
here beyond the confirmed behavior in Requirements/Rules; they will be authored when the
corresponding milestone begins (PIVOT §12: M1 for auth/failed-login and envelope work, M2 for
broadcast, M3 for rework/warnings, M4 for consent/contract-expiry).

## Events

No event bus exists (`MODULE_REGISTRY.yaml:150-151`: `published_events: none-observed`,
`consumed_events: none-observed`; `DEPENDENCY_GRAPH.yaml:410-418`, verified by repo-wide grep for
`EventEmitter/emit/on/amqp/kafka/redis/bull/pubsub/subscribe` returning only unrelated Node
process signals). `[CURRENT]` "Events" below are synchronous, best-effort, fire-and-forget calls
INTO `notificationService.sendNotification` from four producer modules — this module is a
terminal sink, not a publisher; it never itself calls another module.

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `WORK_REQUEST_PUBLISHED` | backend-work-requests | DRAFT→OPEN publish commit | `work-requests/service.ts:240-246` (work_request_id, hotel_id) | Each ACTIVE roster worker | Awaited fan-out (`Promise.all`); per-recipient failure swallowed; not idempotent |
| `APPLICATION_RECEIVED` | backend-work-applications | apply() success | `work-applications/service.ts:103-108` (application_id, work_request_id) | Request creator | Unawaited; failure swallowed |
| `APPLICATION_REJECTED` | backend-work-applications | reject update | `work-applications/service.ts:194-199` (application_id, work_request_id, rejection_reason) | Applicant worker | Unawaited; failure swallowed |
| `APPLICATION_ACCEPTED` | backend-work-applications | approve tx post-commit | `work-applications/service.ts:299-304` (application_id, work_request_id) | Applicant worker | Post-commit; unawaited; failure swallowed |
| `ASSIGNMENT_CONFIRMED` | backend-work-applications | approve tx post-commit | `work-applications/service.ts:306-311` (assignment_id, work_request_id) | Applicant worker | Post-commit; unawaited; failure swallowed |
| `ATTENDANCE_VERIFIED` | backend-attendance | manager sets `is_verified=true` | `attendance/service.ts:187-191` (attendance_id, assignment_id) | Verified worker | Unawaited; failure swallowed |
| `WORKER_NO_SHOW` | backend-attendance | manager sets `status=ABSENT` | `attendance/service.ts:200-205` (attendance_id, assignment_id, worker_id) | Assignment's `assigned_by_id` (looked up via unawaited nested query) | Unawaited; failure swallowed; recipient lookup itself can silently no-op if assignment missing |
| `QUALITY_VERIFICATION_SUBMITTED` | backend-quality | verification create, PASSED or FAILED | `quality/service.ts:75-84` (verification_id, assignment_id, score, status) | Assessed worker | Unawaited; failure swallowed; FAILED reuses this type (no dedicated type) |
| `REWORK_REQUIRED` | backend-quality | verification create, NEEDS_REWORK | `quality/service.ts:75-84` | Assessed worker | Unawaited; failure swallowed |
| `RATING_RECEIVED` | backend-quality | rating create, post-tx-commit | `quality/service.ts:191-198` (rating_id, assignment_id, score) | Rated worker | Post-commit; unawaited; failure swallowed |

Declared-but-NEVER-emitted `NotificationType` values (`schema.prisma:89-111`): `WORK_REQUEST_CANCELLED`,
`WORK_REQUEST_EXPIRING_SOON`, `APPLICATION_WITHDRAWN`, `ASSIGNMENT_CANCELLED`, `SHIFT_REMINDER`,
`CHECK_IN_REMINDER` — no code path emits these (cross-ref job-dispatch spec, same finding,
`docs/03-modules/job-dispatch/MODULE_SPEC.md:351-354`).

`[TARGET]` new notification triggers with NO existing `NotificationType` representation
(unbuilt, one row per confirmed authority citation; see also Evidence and Traceability TREQ-001..010):
failed-login-alert (CONFIRMED §2), rework-escalation (CONFIRMED §14), rating-warning ×2 tiers
(CONFIRMED §16), consent-decline (CONFIRMED §18/§24), sick/vacation (CONFIRMED §22),
contract-expiry-reminder (CONFIRMED §9), broadcast-job-available / requirement-fulfilled /
auto-close-notify-manager (CONFIRMED §13). This is a **16-value enum with zero values covering
any of 8 confirmed target trigger categories** — a materially incomplete enum for the target
system, not a minor gap.

## Dependencies

`[CURRENT]` existing DEPENDENCY_GRAPH edges referenced (no new backend edges proposed by this
spec beyond the terminology/graph promotions in Proposed Knowledge Deltas):

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `edge-work-requests-notifications` | Roster publish fan-out | `notification-service` | baseline/UNKNOWN | Best-effort; swallowed (RULE-003) |
| `edge-work-applications-notifications` | Apply/reject/accept notifications | `notification-service` | baseline/UNKNOWN | Best-effort; swallowed (RULE-003) |
| `edge-attendance-notifications` | Verify/no-show notifications | `notification-service` | baseline/UNKNOWN | Best-effort; swallowed (RULE-003) |
| `edge-quality-notifications` | Verification/rating notifications | `notification-service` | baseline/UNKNOWN | Best-effort; swallowed (RULE-003) |
| `edge-frontend-notifications` | Web app lists/marks-read | `GET /notifications`, `POST /:id/read` | baseline/UNKNOWN | Client-side error surfacing only |
| `edge-mobile-worker-notifications` | Employee App lists/marks-read | `GET /notifications`, `POST /:id/read` | baseline/UNKNOWN | Client-side error surfacing only |
| `edge-mobile-checker-notifications` | Checker App lists/marks-read | `GET /notifications`, `POST /:id/read` | baseline/UNKNOWN | Client-side error surfacing only |

`[CURRENT]` client consumers (verified):
- `frontend-web` — `notificationsApi.list`/`markAsRead` (`frontend/lib/api.ts:321-329`).
- `mobile-worker` — `api.notifications.list`/`markRead` (`mobile/worker-app/src/lib/api.ts:218-221`).
- `mobile-checker` — `api.notifications.list`/`markAsRead` (`mobile/checker-app/src/lib/api.ts:211-214`).

`[CURRENT]` external/config dependency (declared, unwired — verified independently):
- APNs (`APNS_PRIVATE_KEY_BASE64` `env.ts:24`; `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_BUNDLE_ID`
  `env.ts:47-49`) and FCM (`FIREBASE_PROJECT_ID` `env.ts:50`) are declared as optional Zod
  fields in `backend/src/config/env.ts` but are **consumed nowhere else** — repo-wide grep for
  each of the five variable names outside `env.ts` returned zero matches. This independently
  corroborates the task's own check: the credentials exist in config shape only; no client
  library, no push-sending code, no reference of any kind. `sendPushNotification`
  (`service.ts:44-46`) does not read any of them — it throws unconditionally before ever
  touching config.
- `REDIS_URL` (`env.ts:15`) is likewise declared-optional and unused (`DEPENDENCY_GRAPH.yaml:414`,
  independently verified) — relevant because PIVOT's target broadcast slot-lock (a job-dispatch
  concern, not this module's) and the notification-adjacent scheduled jobs (rework timer,
  contract-expiry reminder, job-request auto-close, PIVOT §5.6) are all expected to run on
  Redis-backed BullMQ, which has zero runtime footprint today.

`[TARGET]` new dependencies (unbuilt):
- **APNs/FCM client libraries** — to replace the `sendPushNotification` stub (PIVOT §5.2, §11).
- **Scheduled-job runtime** (node-cron / BullMQ on Redis) — for the rework 20-minute timer and
  contract-expiry-reminder job that both notify through this module (PIVOT §5.6). Neither job
  exists in the repository today.
- **New producer call sites** in modules that do not currently import `notificationService`:
  `auth` (failed-login), `calendar` (sick/vacation — module currently a stub per
  `MODULE_REGISTRY.yaml:39`, `lifecycle: stub`), a consent-gate module (does not exist yet),
  `hr` (contract-expiry — module currently `active-no-tests`, no contract model exists yet),
  and job-dispatch's broadcast flow (`work-requests`/successor, per job-dispatch spec TREQ-002/003).

## State and Lifecycle

`[CURRENT STATE]` `Notification` row lifecycle (`schema.prisma:466-488`;
`notifications/service.ts`):
- Entry: created only via `sendNotification`; no direct-create path exists elsewhere.
- `is_read`: `false` at creation → `true` via `markAsRead` (one-way; no "mark unread" path
  exists in code, though nothing in the schema prevents it).
- `channel`: fixed at creation to the Prisma default `IN_APP`; never changes post-creation
  (no update path touches it).
- `sent_at`/`expires_at`: both columns exist in the schema (`schema.prisma:479-480`) but
  **neither is ever set by any code path** — `sendNotification`'s `create.data` omits both,
  so they are always `null`. This is a further current-state gap: the schema anticipates a
  "sent" timestamp (implying an async send step distinct from creation) that does not exist
  in the current synchronous, delivery-less implementation.
- No soft-delete, no archival, no retention sweep exists for `Notification` rows today.

**`[MIGRATION GAP]` and reconciliation — push-only (CONFIRMED §18) vs. rework's "in-app inbox
AND push" (CONFIRMED §14):** The confirmed register states, system-wide, "Push notifications
only" (§18) while also stating, specifically for rework, that the worker is notified "via
in-app inbox AND a separate push notification (BOTH channels, not one instead of the other)"
(§14). These are not textually reconciled by either authority document. The author's reasoned
interpretation, offered here and **not** treated as settled: the existing `NotificationType`
architecture already treats `IN_APP` (a persisted `Notification` row, i.e. the inbox) as the
system of record that both `GET /notifications` and all three client apps already depend on
(Dependencies, above) — it is not a competing "delivery channel" in the same sense as
email/SMS/push, but the durable list itself. Under this reading, "push-only" (§18) means: of
the *dispatch* channels — email, SMS, push — only push is being built out for actual device
delivery; the in-app inbox (the `Notification` row) continues to be written for every
notification regardless, as it already is today for 100% of current notifications (REQ-001).
§14's explicit "BOTH channels" callout for rework would then be emphasis on a
safety/time-sensitive flow rather than a genuinely unique architecture, since under this
reading every notification already gets both. This interpretation is offered because it is the
minimal-change reading consistent with current code (which already always persists IN_APP) and
because removing in-app persistence system-wide would break the already-shipped
`GET /notifications` contract all three clients depend on with no PIVOT/CONFIRMED text
authorizing that removal. **It is carried as an explicit open decision (`OQ-NOTIF-01`) and is
NOT resolved by this document** — an equally defensible reading is that §14's carve-out exists
*because* the general rule is push-only-with-no-persistence, and rework is the sole exception
requiring inbox persistence.

**Concurrency:** No optimistic locking, no version field, and no concurrent-write scenario is
observed on `Notification` — each row is written once and updated at most once (`markAsRead`).
No concurrency risk is identified in current or target behavior.

**Retention/migration:** `[CURRENT]` rows persist indefinitely; no soft-delete, no TTL. `[TARGET]`
CONFIRMED §25 defines exactly three GDPR retention tiers (shift coordinates 6 months, general
personal/profile data 5 years, payroll/tax-adjacent fields 6 years) — **`Notification` rows are
not explicitly named under any of the three tiers by either authority document.** Whether
notification rows fall under the 5-year "general data" tier by default, need their own retention
policy, or are exempt is UNSTATED and carried as an open decision (`OQ-NOTIF-02`), not assumed.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** `[CURRENT]` `markAsRead` failures surface as typed HTTP errors
(404/403). `sendNotification` failures (including the unhandled FK-constraint scenario under
Ownership) are swallowed by every calling producer's `.catch(() => {})` — a failed notification
create is **completely invisible** system-wide: no log, no metric, no audit row (RULE-005), no
error surfaced to the end user or to the producer's own response. `sendEmail`/
`sendPushNotification` fail closed (always throw) but are never called, so this is currently
inert. `[TARGET]` a functioning push path introduces a genuinely new failure mode (APNs/FCM
network/credential failure) that the current fire-and-forget swallow pattern would also hide
unless explicitly changed — this spec does not invent a resolution; see `OQ-NOTIF-04`.

**Trust boundaries/authorization:** `[CURRENT]` `GET /notifications` and `POST /:id/read` require
only authentication, no role (REQ-006/RULE-004); this is a comparatively low-risk gap versus
job-dispatch's `PATCH /assignments/:id` finding (FIND-SEC-001 in that spec) because the service
layer's ownership check (RULE-001) and the `WHERE user_id=caller` list scoping already prevent
cross-user data access — the absence of role-gating here does not currently permit any
authenticated user to read or mark-read another user's notifications. The in-process
`sendNotification` contract crosses no HTTP/auth boundary; any code with access to the module
import can create a notification addressed to any `userId`, with no authorization check inside
this module (authorization for "may producer X notify user Y" is implicitly delegated to each
producer's own authz, e.g. work-requests only notifies its own roster). `[TARGET]` no new
authorization model is specified by either authority for this module beyond the general
role×scope model (job-dispatch spec TREQ-008); whether producer-to-notification authorization
needs an explicit check is UNSTATED (`OQ-NOTIF-05`).

**Data classification/retention:** Notification `message`/`title`/`data` fields can carry
worker-facing operational detail (rejection reasons, scores, rating warnings) but no
special-category data (Konfession, disability, health — CONFIRMED §27) is observed in any
current payload. `[TARGET]` if failed-login, consent-decline, or rating-warning notifications
ever embed special-category-adjacent detail, CONFIRMED §27's restricted-visibility/audit-logged
handling would apply — no current evidence that they do, and this spec does not assume they
will. Retention is UNSTATED per `OQ-NOTIF-02` above.

**Performance budgets/workload:** No explicit SLO exists in code or the authority documents for
notification delivery latency (consistent with job-dispatch spec's finding of no SLOs anywhere
in this codebase). The one identified latency-relevant behavior: `work-requests`' roster
fan-out is awaited on the publish request path (`Promise.all`, REQ-011) — cost is O(roster size)
per publish, same finding as job-dispatch spec's FIND-PERF-001, cited here because it is this
module's `sendNotification` being called in that loop. `getNotifications`'s hardcoded `take:50`
bounds list-query cost regardless of a user's total notification count; there is no index
citation needed beyond the existing `@@index([user_id, is_read])` "hot path: unread notification
badge count" (`schema.prisma:487`), which is well-suited to the current query pattern.

**Observability/audit:** No `AuditLog` entry for any notification lifecycle event (REQ-007,
RULE-005) — this is the module's most significant observability gap: neither notification
creation, delivery-failure, nor read-state changes leave any queryable trail beyond the
`Notification` row itself. No metrics/tracing observed. Responses carry `request_id` in `meta`
(`controller.ts:13,27`).

## Rollout and Compatibility

`[CURRENT]` Behavior is already deployed at `efde2a9f`; the current-state layer is a reverse
specification, not a change. `Notification` model/enums are established by the schema's ongoing
patch series (SP-8 comments at `schema.prisma:87,465` — "type promoted from String to
NotificationType enum"). No feature flags observed for this module (see the `FEATURE_*`
factual-mismatch note under Evidence and Traceability).

`[TARGET]` Migration strategy (PIVOT §10) — a **forward refactor**, not a dual-running
migration, consistent with the rest of the pivot (system is pre-launch, no production employee
data):
- **Phase 1 — Foundation realignment:** none of this module's specific target work is listed as
  Phase 1 in PIVOT §10's own phase breakdown; Phase 1 covers Regional Manager role/scope,
  envelope refactor, and `WorkApplication` removal only. This module's target triggers are
  distributed across M2–M4 per the milestone table (PIVOT §12): job-dispatch broadcast
  notifications at M2, rework-escalation/warning notifications at M3 (alongside quality's own
  MIG-GAP-05), consent/contract-expiry/failed-login notifications at M1 (failed-login, since
  auth/RBAC work is M1) and M4 (consent, contract-expiry, alongside onboarding/GDPR work).
- **Feature-flagged:** PIVOT §10 states each new module is gated by "the existing `FEATURE_*`
  env convention" — this convention **does not exist in the repository** (see the factual
  mismatch note above); this module's push-delivery build-out therefore has no existing
  mechanism to attach a flag to, pending a human decision on how to introduce one (`OQ-NOTIF-03`).
- **Backward compatibility:** the current `GET /notifications`/`POST /:id/read` contracts and
  the `Notification` row shape are additive-compatible with every confirmed target trigger — no
  removal is required of anything this module currently exposes; only `NotificationType` enum
  growth (additive) and a functioning push-delivery implementation (currently absent, not a
  behavior change to remove) are needed.
- **Rollback:** because target work here is additive (new enum values, new producer call sites,
  a new delivery implementation) and pre-launch, rollback = redeploy the prior build; no data
  migration risk exists on this module's own state.

### `[MIGRATION GAP]` enumeration (current code vs target authority)

| Gap ID | Current state (evidence) | Target requirement (evidence) | Milestone |
|---|---|---|---|
| MIG-GAP-01 | No failed-login tracking anywhere in the backend (verified: zero matches for `failed_login`/`login_attempt` across `backend/src`); no matching `NotificationType` | Repeated failed logins notify the manager (CONFIRMED §2; PIVOT §4.1) — TREQ-001 | M1 |
| MIG-GAP-02 | `REWORK_REQUIRED` fires only on a quality-verification NEEDS_REWORK outcome, IN_APP only (`quality/service.ts:75-84`); no dual-channel delivery exists | Rework assignment delivers BOTH in-app inbox AND push (CONFIRMED §14) — TREQ-002 | M3 |
| MIG-GAP-03 | No scheduled-job runtime exists (no node-cron/BullMQ found; Redis declared-unused, `env.ts:15`) | 20-minute rework-incomplete escalation to Manager+Checker (CONFIRMED §14; PIVOT §5.6) — TREQ-003 | M3 |
| MIG-GAP-04 | No `WARNING`-family `NotificationType`; no rating-threshold notification logic anywhere (also independently flagged by `docs/03-modules/quality/MODULE_SPEC.md:457` MIG-GAP-04) | Rating <70 (worker) and <50 (worker + manager) warnings (CONFIRMED §16) — TREQ-004 | M3 |
| MIG-GAP-05 | No consent-gate module/model exists (task-scoped as out-of-scope mechanics; trigger point only) | Consent decline notifies manager (CONFIRMED §18, §24) — TREQ-005 | M4 |
| MIG-GAP-06 | `calendar` module is a registered stub (`MODULE_REGISTRY.yaml:39`, `lifecycle: stub`); no sick/vacation flag or notification exists | Sick/vacation marking notifies manager (CONFIRMED §22) — TREQ-006 | M2 |
| MIG-GAP-07 | No `Contract` model exists (verified: zero schema matches for `Contract`/`ContractStatus`); no contract-expiry job | Scheduled reminder before 1yr/2yr contract end (CONFIRMED §9) — TREQ-007 | M4 |
| MIG-GAP-08 | `WORK_REQUEST_PUBLISHED` fans out to the ENTIRE ACTIVE roster (REQ-011), not an eligibility-filtered subset | Broadcast notifies only matching-skill ∧ free-that-day workers (CONFIRMED §13) — TREQ-008; cross-ref job-dispatch TREQ-003 | M2 |
| MIG-GAP-09 | No "requirement fulfilled" notification concept exists anywhere in code | Post-fill late responders get an explicit message (CONFIRMED §13) — TREQ-009; cross-ref job-dispatch TREQ-005 | M2 |
| MIG-GAP-10 | `WorkRequest.EXPIRED` is set by an external job absent from the repo (job-dispatch spec REQ-013); no manager-notify-on-close behavior exists | 6h auto-close notifies manager (CONFIRMED §13; PIVOT §5.6) — TREQ-010; cross-ref job-dispatch TREQ-006 | M2 |
| MIG-GAP-11 | `sendPushNotification` unconditionally throws `NotImplementedError`; APNs/FCM credentials declared-unwired (`env.ts:24,47-50`, independently verified zero consumers) | Push-only delivery is the sole confirmed channel (CONFIRMED §18) — TREQ-011 | M1 (per PIVOT §12, notification-adjacent envelope work is M1-scoped; push implementation itself is not explicitly milestone-pinned by either authority — flagged as `OQ-NOTIF-06`) |
| MIG-GAP-12 | `sendEmail` unconditionally throws `NotImplementedError`; zero call sites | CONFIRMED §18 explicitly excludes email/SMS as notification channels — `sendEmail`'s intended role (if any) is UNSTATED by either authority; may be permanently dead code or repurposed for a non-notification use (e.g. is distinct from HR's separate SMTP payslip mechanism, PIVOT §7.7) | Unscheduled — open decision `OQ-NOTIF-07` |

## Validation Plan

`[CURRENT STATE]` criteria:

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| REQ-003 markAsRead ownership (RULE-001) | Unit | `notifications.test.ts:50-77` | 404/403/success asserted — **already covered** |
| REQ-001 default channel always IN_APP | Unit (to add) | mocked Prisma create | assert `create.data.channel` is either absent (relies on DB default) or explicitly `'IN_APP'` | **CURRENTLY UNTESTED** |
| REQ-002 list cap/ordering/scoping | Unit (to add) | mocked Prisma findMany | assert `where.user_id`, `orderBy`, `take:50` | **CURRENTLY UNTESTED** |
| REQ-004/005 stub errors | Unit (to add) | direct call | assert `NotImplementedError` thrown | **CURRENTLY UNTESTED** |
| REQ-006 no role gate | Integration (to add) | any authenticated role | both endpoints respond (not 403) for every role | **CURRENTLY UNTESTED** |
| REQ-007 no audit row | Integration (to add) | spy on `logAudit`/`AuditLog.create` | assert NOT called across create/read-mark | **CURRENTLY UNTESTED** |
| REQ-011/012/013/014 producer call-site payload shape | Covered indirectly in each producer's own test suite (job-dispatch, attendance, quality specs) | producer test files | cross-reference only — not owned by this module's test file |

`[TARGET STATE]` criteria (to be authored when the corresponding milestone begins; recorded as
expectations, not yet executable): TREQ-001 failed-login-notify-manager; TREQ-002 dual-channel
rework delivery (both IN_APP row AND push attempt observed for one trigger); TREQ-003 20-minute
escalation timer fires and targets both Manager and Checker; TREQ-004 rating-threshold
notifications at both tiers; TREQ-005/006/007 manager-notify triggers for consent-decline,
sick/vacation, contract-expiry; TREQ-008/009/010 broadcast eligibility-filtered notify,
"requirement fulfilled," and auto-close-notify-manager; TREQ-011 push delivery actually reaches
a device (or a mocked APNs/FCM client) in at least one integration test. Success gates per PIVOT
§10/§12 milestone table.

## Risks, Assumptions, and Open Decisions

Genuine remaining human-authority items (status OPEN).

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OQ-NOTIF-01 | decision | Reconciliation of "push notifications only" (CONFIRMED §18) vs. rework's explicit "in-app inbox AND push, BOTH channels" (CONFIRMED §14) is the author's inference (State and Lifecycle), not a settled authority statement. Two readings are equally defensible: (a) every notification keeps its IN_APP row and gains push, with §14 merely emphasizing this for a safety-critical flow; or (b) push-only is the general rule and §14 is a sole, narrow exception requiring IN_APP persistence ONLY for rework. This determines whether `NotificationChannel.EMAIL`/`SMS` are simply unused or should be removed from the schema, and whether every new target trigger (TREQ-001,004,005,006,007,008,009,010) gets an inbox row or push-only delivery. | `schema.prisma:80-85`; CONFIRMED §14, §18; PIVOT §4.8, §9.1 | human/unassigned | **OPEN** |
| OQ-NOTIF-02 | decision | `Notification` rows are not named under any of CONFIRMED §25's three GDPR retention tiers (6mo shift-coords / 5yr general / 6yr payroll-tax). Whether notifications default to the 5-year general tier, need a bespoke shorter retention (they are ephemeral/operational, unlike a profile record), or are exempt entirely is unstated. | CONFIRMED §25 (silent on this model); `schema.prisma:466-488` (no `deleted_at`/TTL field) | human/unassigned | **OPEN** |
| OQ-NOTIF-03 | decision | PIVOT §10 states each new module is gated by "the existing `FEATURE_*` env convention... already exists in the codebase." Repo-wide grep found zero matches anywhere in actual source/config (only in other module specs' prose repeating the same claim). This module's target push-delivery rollout has no existing flag mechanism to attach to per PIVOT's own stated strategy. | PIVOT §10:431; repo-wide grep, no matches | human/unassigned | **OPEN — factual mismatch, not silently accepted** |
| OQ-NOTIF-04 | decision | The current fire-and-forget `.catch(() => {})` pattern silently swallows ALL notification-send failures (including, currently, an unhandled Prisma FK-constraint error if a producer passes an invalid `userId` — see Ownership and Boundaries). Whether this swallow-everything pattern is acceptable once a real push-delivery mechanism exists (where delivery failures become more frequent and more consequential — e.g. a manager never learning about a failed-login alert) is a human product/reliability decision, not resolved here. | `notifications/service.ts:7-17` (no try/catch); all 4 producer call sites (`.catch(() => {})`) | human/unassigned | **OPEN** |
| OQ-NOTIF-05 | decision | The in-process `sendNotification` contract performs no authorization check on "may producer X address a notification to user Y" — this is currently implicitly delegated to each producer's own authz logic. Whether an explicit cross-module authorization boundary is warranted (especially once more producers, e.g. auth/failed-login, gain the ability to notify arbitrary users) is unresolved by either authority. | `notifications/service.ts:7-17` (no check); job-dispatch spec's own role×scope model (TREQ-008) does not name this module | human/unassigned | **OPEN** |
| OQ-NOTIF-06 | decision | Neither PIVOT nor CONFIRMED explicitly milestone-pins the push-delivery IMPLEMENTATION itself (as opposed to the individual trigger features that depend on it); PIVOT §12's M1 covers RBAC/scope/envelope/WorkApplication-removal only, with push-adjacent trigger work spread across M2-M4. It is unclear whether a working APNs/FCM integration is expected to land once (early, so all subsequent triggers can use it) or incrementally per-trigger. | PIVOT §12 (milestone table, no explicit push-implementation row); PIVOT §5.2 (APNs/FCM listed as an external dependency with no phase assignment) | human/unassigned | **OPEN** |
| OQ-NOTIF-07 | decision | `sendEmail`'s intended target role, if any, is unstated. CONFIRMED §18 excludes email as a *notification* channel, but HR's separate payslip-email flow (PIVOT §7.7) uses SMTP for a non-notification purpose. Whether `sendEmail` on `NotificationService` is dead code to be deleted, or is intended to be repurposed/relocated for the payslip flow, is undecided. | `notifications/service.ts:40-42` (zero call sites); PIVOT §7.7 (separate SMTP payslip mechanism, not attributed to this module) | human/unassigned | **OPEN** |
| SYNC-001 | decision | Module owner is `unassigned` (no CODEOWNERS; empty package author) — blocks accountable ownership and SLO-setting, consistent with every other spec in this repository. | `MODULE_REGISTRY.yaml:146` | human | **OPEN** (cross-repository, not unique to this module) |

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| ASM-NOTIF-01 | assumption | The four current producer modules (`work-requests`, `work-applications`, `attendance`, `quality`) remain the module's ONLY producers until at least M2 of the pivot roadmap (PIVOT §12); no additional current-state producer exists that this spec's evidence gathering missed (verified via `DEPENDENCY_GRAPH.yaml`'s four `calls` edges into `backend-notifications`, matching the four `dependencies: [backend-notifications]` entries in `MODULE_REGISTRY.yaml`). | `DEPENDENCY_GRAPH.yaml:78-112`; `MODULE_REGISTRY.yaml:77,89,113,125` | Current-state assumption; target adds producers per MIGRATION GAP table |
| ASM-NOTIF-02 | assumption | `hr` and `calendar` are the most likely home modules for, respectively, contract-expiry-reminder (TREQ-007) and sick/vacation-notify (TREQ-006) producer logic, based on their existing `MODULE_REGISTRY.yaml` registration and PIVOT §9.1/§9.3's model placement — neither module currently implements this logic, and no authority document names the exact producer module. | `MODULE_REGISTRY.yaml:131-141` (hr, `active-no-tests`), `:39` (calendar, `stub`); PIVOT §9.1, §9.3 | Inference, not confirmed |

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate.

- **MODULE_REGISTRY.yaml:** set `specification` for `backend-notifications`
  (`MODULE_REGISTRY.yaml:152`) from `UNKNOWN` → `SPEC-NOTIF-001@0.1.0 (REVIEW)`. Do not alter
  `owner` (remains `unassigned`, SYNC-001).
- **DEPENDENCY_GRAPH.yaml (proposed):**
  - PROMOTE the bare Prisma enums `NotificationType` (`schema.prisma:89-111`) and
    `NotificationChannel` (`schema.prisma:80-85`) into the graph's `contracts` or a new
    lightweight `enum` kind, tagged `owner: backend-notifications`, since both are referenced
    exclusively by `state-notification` and are the primary target-vs-current gap surface
    identified by this spec (16 declared values, 8+ confirmed target categories entirely
    unrepresented).
  - NOTE (future, do not add yet): once M1-M4 land per the roadmap, new `calls` edges into
    `backend-notifications` will be needed from `backend-auth` (failed-login), `backend-calendar`
    (sick/vacation, once it exits `lifecycle: stub`), a not-yet-registered consent-gate module,
    `backend-hr` (contract-expiry), and the job-dispatch capability's broadcast producer
    (TREQ-006 of `SPEC-JOB-DISPATCH-001`). Not added now because none of these producer call
    sites exist in code yet (MIGRATION GAP table).
- **TERMINOLOGY.md:** promote to canonical: `Notification`, `NotificationType`,
  `NotificationChannel`, `notification-service`, `Producer module`, `Inbox`, `Push-only`,
  `Recipient scoping` — sourced to `schema.prisma:80-111,466-488` and CONFIRMED §14/§18; PIVOT
  §4.8/§5.2/§9.1.
- **DECISION_INDEX.md:** reference ADR-003 (modular monolith, PIVOT §5.1/§11) and ADR-004
  (Prisma ORM, PIVOT §2.1/§11) as existing anchors (consistent with job-dispatch spec's own
  citation of the same two ADRs). A NEW Decision Record MAY be requested by architecture/human
  for `OQ-NOTIF-01` (the push-only vs. dual-channel reconciliation), since it materially affects
  the schema (`NotificationChannel` enum shape) and every future producer's contract — proposed,
  not created here.
- **SYNC_STATE.yaml:** none proposed by the author; the synchronization owner records spec
  issuance if/when this candidate advances.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-07 | Initial current-state reverse specification at `efde2a9f`, paired with target-state requirements drawn from CONFIRMED §2/§9/§13/§14/§16/§18/§22 and PIVOT §4.8/§5.2/§5.6/§6/§7.3/§7.5/§9.1. REQ-001..015, RULE-001..007 (current); TREQ-001..012, TRULE-001..005 (target). MIGRATION GAP enumeration MIG-GAP-01..12. Identified and independently verified: zero APNs/FCM/REDIS_URL consumers outside `env.ts`; zero `sendEmail`/`sendPushNotification` call sites repository-wide; zero `FEATURE_*` matches repository-wide (factual mismatch vs. PIVOT §10's claim); zero failed-login-tracking code; zero `Contract`/`ConsentLog` schema presence. Carried 7 genuine open decisions (`OQ-NOTIF-01..07`) plus `SYNC-001`; explicitly did not resolve the push-only vs. dual-channel tension, instead offering a labeled, non-authoritative reconciliation. | None — first version, no prior findings to resolve. | None — status REVIEW, G2 freeze reserved to human. |
