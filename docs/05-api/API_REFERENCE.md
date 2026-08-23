# HTTP API Reference

**Generated from code at `8626256` (2026-08-23).** 131 endpoints across 17 route mounts.

> **This document is derived, not authoritative.** It is produced by parsing
> `backend/src/modules/*/routes.ts`. Where it disagrees with the code, **the code is right and this
> file is stale** (`ADR-008`). The authoritative behavioural contract for each capability is its
> module specification; the named interface contracts are in
> [`.claude/knowledge/INTERFACE_INDEX.yaml`](../../.claude/knowledge/INTERFACE_INDEX.yaml).
>
> It exists because `docs/05-api/` held nothing but a `.gitkeep` while 131 endpoints shipped, and
> because `ADR-053`'s chatbot tool registry needs a single place to see the HTTP surface.

## Conventions

- **Base path.** Every route below is mounted under `/api/v1` (`backend/src/app.ts`). The paths in
  the tables already include their module mount.
- **Authentication.** `optionalAuthMiddleware` is applied to the whole v1 router;
  `authMiddleware` is applied per module inside each `routes.ts`. Assume authentication is required
  unless a module note says otherwise. Transport is dual — httpOnly cookie for web,
  `Authorization: Bearer` for mobile — see [`ADR-071`](../14-governance/architecture-decisions/ADR-071-dual-transport-authentication.md).
- **Guards column.** `requireRole(...)` = role gate; a bare token like `quality:read` =
  `requirePermission`; `checkHotelAccess` = hotel-scope check; `multipart` = accepts file upload.
  `—` means no guard beyond the module's own `authMiddleware`.
- **Envelope.** `{ status: "success", data, meta: { timestamp, request_id } }`. List endpoints
  that paginate add a top-level `pagination` sibling (`page`, `per_page`, `total`, `total_pages`,
  `has_next`, `has_prev`; default 25, max 100 — `ADR-035`).
- **Errors.** `ValidationError` → 400, `UnauthorizedError` → 401, `ForbiddenError` → 403,
  `NotFoundError` → 404, `ConflictError` → 409, via the shared error layer.
- **Versioning.** No endpoint is individually versioned. The `/api/v1` prefix is the only version
  marker, and contracts are otherwise unversioned (baseline/UNKNOWN compatibility posture).

## Mount summary

| Mount | Module | Endpoints | Specification |
|---|---|---|---|
| `/api/v1/analytics` | `analytics` | 5 | [`SPEC-ANALYTICS-001`](../03-modules/analytics/MODULE_SPEC.md) |
| `/api/v1/assignments` | `assignments` | 9 | [`SPEC-JOB-DISPATCH-001`](../03-modules/job-dispatch/MODULE_SPEC.md) |
| `/api/v1/attendance` | `attendance` | 4 | [`SPEC-ATT-001`](../03-modules/attendance/MODULE_SPEC.md) |
| `/api/v1/auth` | `auth` | 8 | [`SPEC-AUTH-001`](../03-modules/auth/MODULE_SPEC.md) |
| `/api/v1/calendar` | `calendar` | 7 | [`SPEC-CALENDAR-001`](../03-modules/calendar/MODULE_SPEC.md) |
| `/api/v1/compliance` | `compliance` | 1 | [`SPEC-COMPLIANCE-001`](../03-modules/compliance/MODULE_SPEC.md) |
| `/api/v1/consent` | `consent` | 6 | [`SPEC-CONSENT-001`](../03-modules/consent/MODULE_SPEC.md) |
| `/api/v1/crm` | `crm` | 16 | [`SPEC-CRM-001`](../03-modules/crm/MODULE_SPEC.md) |
| `/api/v1/documents` | `documents` | 6 | [`SPEC-DOCUMENTS-001`](../03-modules/documents/MODULE_SPEC.md) |
| `/api/v1/employees` | `employee-management` | 22 | [`SPEC-EMP-001`](../03-modules/employee-management/MODULE_SPEC.md) |
| `/api/v1/geo` | `geo` | 3 | [`SPEC-GEO-001`](../03-modules/geo/MODULE_SPEC.md) |
| `/api/v1/hr` | `hr` | 13 | [`SPEC-HR-001`](../03-modules/hr/MODULE_SPEC.md) |
| `/api/v1/notifications` | `notifications` | 7 | [`SPEC-NOTIF-001`](../03-modules/notifications/MODULE_SPEC.md) |
| `/api/v1/quality` | `quality` | 7 | [`SPEC-QUAL-001`](../03-modules/quality/MODULE_SPEC.md) |
| `/api/v1/retention` | `retention` | 2 | [`SPEC-RETENTION-001`](../03-modules/retention/MODULE_SPEC.md) |
| `/api/v1/users` | `users` | 7 | [`SPEC-USERS-001`](../03-modules/users/MODULE_SPEC.md) |
| `/api/v1/work-requests` | `job-requests` | 8 | [`SPEC-JOB-DISPATCH-001`](../03-modules/job-dispatch/MODULE_SPEC.md) |

## `/api/v1/analytics` — `analytics`

`/my-stats` is self-only for any authenticated role and deliberately does not ride `/stats`' role guard (`GD-06`).

| Method | Path | Guards | Source |
|---|---|---|---|
| `GET` | `/api/v1/analytics/leaderboard` | requireRole(admin, manager, regional_manager), analytics:read | `modules/analytics/routes.ts:16` |
| `GET` | `/api/v1/analytics/leaderboard/by-hotel/:hotel_id` | requireRole(admin, manager, regional_manager), analytics:read, checkHotelAccess | `modules/analytics/routes.ts:22` |
| `GET` | `/api/v1/analytics/stats` | requireRole(admin, manager, regional_manager), analytics:read | `modules/analytics/routes.ts:29` |
| `GET` | `/api/v1/analytics/my-stats` | — | `modules/analytics/routes.ts:37` |
| `GET` | `/api/v1/analytics/hotel-summary/:hotel_id` | requireRole(admin, manager, regional_manager), analytics:read, checkHotelAccess | `modules/analytics/routes.ts:41` |

## `/api/v1/assignments` — `assignments`

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/assignments/calendar-entries` | — | `modules/assignments/routes.ts:31` |
| `GET` | `/api/v1/assignments/calendar-entries` | — | `modules/assignments/routes.ts:49` |
| `PATCH` | `/api/v1/assignments/calendar-entries/:id/move` | — | `modules/assignments/routes.ts:65` |
| `GET` | `/api/v1/assignments` | — | `modules/assignments/routes.ts:86` |
| `GET` | `/api/v1/assignments/:id` | — | `modules/assignments/routes.ts:87` |
| `PATCH` | `/api/v1/assignments/:id` | — | `modules/assignments/routes.ts:88` |
| `POST` | `/api/v1/assignments/:id/rooms-completed` | requireRole(admin, manager, regional_manager), staffing:write | `modules/assignments/routes.ts:100` |
| `PATCH` | `/api/v1/assignments/:id/rooms-completed` | requireRole(admin, manager, regional_manager), staffing:write | `modules/assignments/routes.ts:108` |
| `POST` | `/api/v1/assignments/:id/reassign` | requireRole(admin, manager, regional_manager), staffing:write | `modules/assignments/routes.ts:122` |

## `/api/v1/attendance` — `attendance`

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/attendance` | requireRole(worker) | `modules/attendance/routes.ts:13` |
| `GET` | `/api/v1/attendance` | — | `modules/attendance/routes.ts:14` |
| `GET` | `/api/v1/attendance/:id` | — | `modules/attendance/routes.ts:15` |
| `PATCH` | `/api/v1/attendance/:id` | — | `modules/attendance/routes.ts:16` |

## `/api/v1/auth` — `auth`

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/auth/signup` | — | `modules/auth/routes.ts:7` |
| `POST` | `/api/v1/auth/login` | — | `modules/auth/routes.ts:8` |
| `POST` | `/api/v1/auth/refresh` | — | `modules/auth/routes.ts:9` |
| `POST` | `/api/v1/auth/password-reset` | — | `modules/auth/routes.ts:11` |
| `POST` | `/api/v1/auth/password-reset/confirm` | — | `modules/auth/routes.ts:12` |
| `POST` | `/api/v1/auth/logout` | — | `modules/auth/routes.ts:13` |
| `GET` | `/api/v1/auth/me` | — | `modules/auth/routes.ts:14` |
| `PUT` | `/api/v1/auth/profile` | — | `modules/auth/routes.ts:15` |

## `/api/v1/calendar` — `calendar`

| Method | Path | Guards | Source |
|---|---|---|---|
| `GET` | `/api/v1/calendar/my-absences` | — | `modules/calendar/routes.ts:13` |
| `POST` | `/api/v1/calendar/my-absences` | — | `modules/calendar/routes.ts:14` |
| `GET` | `/api/v1/calendar/absences` | requireRole(admin, manager, regional_manager) | `modules/calendar/routes.ts:21` |
| `POST` | `/api/v1/calendar/absences` | requireRole(admin, manager, regional_manager) | `modules/calendar/routes.ts:34` |
| `PATCH` | `/api/v1/calendar/absences/:id/move` | — | `modules/calendar/routes.ts:46` |
| `DELETE` | `/api/v1/calendar/absences/:id` | — | `modules/calendar/routes.ts:52` |
| `GET` | `/api/v1/calendar/availability` | — | `modules/calendar/routes.ts:66` |

## `/api/v1/compliance` — `compliance`

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/compliance/subject-rights-export` | — | `modules/compliance/routes.ts:27` |

## `/api/v1/consent` — `consent`

Enforces the daily GDPR access gate; see `docs/04-implementation/CONSENT_GATE_ROLLOUT.md` and E2E scenario 11.

| Method | Path | Guards | Source |
|---|---|---|---|
| `GET` | `/api/v1/consent/status` | — | `modules/consent/routes.ts:18` |
| `GET` | `/api/v1/consent/gate-state` | — | `modules/consent/routes.ts:24` |
| `POST` | `/api/v1/consent/request` | — | `modules/consent/routes.ts:30` |
| `POST` | `/api/v1/consent/decisions` | — | `modules/consent/routes.ts:33` |
| `POST` | `/api/v1/consent/withdraw` | — | `modules/consent/routes.ts:36` |
| `GET` | `/api/v1/consent/audit-history` | — | `modules/consent/routes.ts:40` |

## `/api/v1/crm` — `crm`

| Method | Path | Guards | Source |
|---|---|---|---|
| `GET` | `/api/v1/crm/hotels` | requireRole(admin, manager, regional_manager, checker, worker), hotels:read | `modules/crm/routes.ts:41` |
| `POST` | `/api/v1/crm/hotels` | hotels:write | `modules/crm/routes.ts:42` |
| `GET` | `/api/v1/crm/hotels/:hotel_id` | hotels:read, checkHotelAccess | `modules/crm/routes.ts:43` |
| `PATCH` | `/api/v1/crm/hotels/:hotel_id` | hotels:write, checkHotelAccess | `modules/crm/routes.ts:44` |
| `DELETE` | `/api/v1/crm/hotels/:hotel_id` | requireRole(admin) | `modules/crm/routes.ts:45` |
| `POST` | `/api/v1/crm/hotels/:hotel_id/deactivate` | requireRole(admin) | `modules/crm/routes.ts:50` |
| `POST` | `/api/v1/crm/hotels/:hotel_id/reactivate` | requireRole(admin) | `modules/crm/routes.ts:51` |
| `POST` | `/api/v1/crm/hotels/:hotel_id/restore` | requireRole(admin) | `modules/crm/routes.ts:52` |
| `GET` | `/api/v1/crm/hotel-groups` | requireRole(admin, manager, regional_manager) | `modules/crm/routes.ts:69` |
| `POST` | `/api/v1/crm/hotel-groups` | requireRole(admin) | `modules/crm/routes.ts:75` |
| `GET` | `/api/v1/crm/hotel-groups/:hotel_group_id` | requireRole(admin, manager, regional_manager) | `modules/crm/routes.ts:76` |
| `PATCH` | `/api/v1/crm/hotel-groups/:hotel_group_id` | requireRole(admin) | `modules/crm/routes.ts:82` |
| `DELETE` | `/api/v1/crm/hotel-groups/:hotel_group_id` | requireRole(admin) | `modules/crm/routes.ts:83` |
| `POST` | `/api/v1/crm/hotel-groups/:hotel_group_id/deactivate` | requireRole(admin) | `modules/crm/routes.ts:84` |
| `POST` | `/api/v1/crm/hotel-groups/:hotel_group_id/reactivate` | requireRole(admin) | `modules/crm/routes.ts:85` |
| `POST` | `/api/v1/crm/hotel-groups/:hotel_group_id/restore` | requireRole(admin) | `modules/crm/routes.ts:86` |

## `/api/v1/documents` — `documents`

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/documents/workers/:worker_id/documents` | requireRole(admin, manager, regional_manager, worker, checker), multipart | `modules/documents/routes.ts:157` |
| `GET` | `/api/v1/documents/workers/:worker_id/documents` | requireRole(admin, manager, regional_manager, worker, checker) | `modules/documents/routes.ts:166` |
| `GET` | `/api/v1/documents/workers/:worker_id/documents/completeness` | requireRole(admin, manager, regional_manager, worker, checker) | `modules/documents/routes.ts:173` |
| `GET` | `/api/v1/documents/workers/:worker_id/documents/export` | requireRole(admin, manager, regional_manager, worker, checker) | `modules/documents/routes.ts:180` |
| `GET` | `/api/v1/documents/documents/:document_id` | requireRole(admin, manager, regional_manager, worker, checker) | `modules/documents/routes.ts:189` |
| `DELETE` | `/api/v1/documents/documents/:document_id` | requireRole(worker, checker) | `modules/documents/routes.ts:203` |

## `/api/v1/employees` — `employee-management`

Gated by `FEATURE_EMPLOYMENT_RECORD` (default **OFF**). While disabled, requests fall through to the 404 handler rather than erroring — `ADR-024` D3's "both-off = current behavior" posture.

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/employees` | requireRole(admin, regional_manager, manager), employees:write | `modules/employee-management/routes.ts:11` |
| `POST` | `/api/v1/employees/bulk-import` | requireRole(admin), employees:write | `modules/employee-management/routes.ts:12` |
| `GET` | `/api/v1/employees/review-queue` | requireRole(admin, manager, regional_manager) | `modules/employee-management/routes.ts:15` |
| `GET` | `/api/v1/employees/by-user/:user_id` | employees:read | `modules/employee-management/routes.ts:28` |
| `PATCH` | `/api/v1/employees/:employee_id` | requireRole(admin, manager, regional_manager), employees:write | `modules/employee-management/routes.ts:33` |
| `GET` | `/api/v1/employees/:employee_id/profile` | employees:read | `modules/employee-management/routes.ts:42` |
| `GET` | `/api/v1/employees/:employee_id/skills` | employees:read | `modules/employee-management/routes.ts:43` |
| `GET` | `/api/v1/employees/:employee_id/special-category/:field` | requireRole(admin), employees:special_category:read | `modules/employee-management/routes.ts:50` |
| `GET` | `/api/v1/employees/:employee_id/export` | requireRole(admin), employees:read | `modules/employee-management/routes.ts:58` |
| `POST` | `/api/v1/employees/:employee_id/submit-for-review` | requireRole(admin, manager, regional_manager, worker, checker), employees:write | `modules/employee-management/routes.ts:86` |
| `POST` | `/api/v1/employees/:employee_id/approve` | requireRole(admin, manager, regional_manager), employees:write | `modules/employee-management/routes.ts:94` |
| `POST` | `/api/v1/employees/:employee_id/assign` | requireRole(admin, manager, regional_manager), employees:write | `modules/employee-management/routes.ts:100` |
| `POST` | `/api/v1/employees/:employee_id/reject` | requireRole(admin, manager, regional_manager), employees:write | `modules/employee-management/routes.ts:106` |
| `POST` | `/api/v1/employees/:employee_id/deactivate` | requireRole(admin, manager, regional_manager), employees:write | `modules/employee-management/routes.ts:112` |
| `POST` | `/api/v1/employees/:employee_id/trigger-reonboarding` | requireRole(admin, manager, regional_manager, worker) | `modules/employee-management/routes.ts:118` |
| `POST` | `/api/v1/employees/:employee_id/reactivate` | requireRole(admin, manager, regional_manager), employees:write | `modules/employee-management/routes.ts:123` |
| `POST` | `/api/v1/employees/:employee_id/rehire` | requireRole(admin, manager, regional_manager), employees:write | `modules/employee-management/routes.ts:129` |
| `POST` | `/api/v1/employees/:employee_id/delete` | requireRole(admin), employees:delete | `modules/employee-management/routes.ts:140` |
| `POST` | `/api/v1/employees/:employee_id/restore` | requireRole(admin), employees:delete | `modules/employee-management/routes.ts:146` |
| `GET` | `/api/v1/employees/hotels/:hotel_id/blocklist` | employees:read, checkHotelAccess | `modules/employee-management/routes.ts:155` |
| `DELETE` | `/api/v1/employees/hotels/:hotel_id/blocklist/:entry_id` | requireRole(admin, manager, regional_manager), employees:write, checkHotelAccess | `modules/employee-management/routes.ts:179` |
| `GET` | `/api/v1/employees/hotel-groups/:hotel_group_id/org-chart` | org_chart:read | `modules/employee-management/routes.ts:197` |

## `/api/v1/geo` — `geo`

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/geo/checkins` | — | `modules/geo/routes.ts:19` |
| `GET` | `/api/v1/geo/checkins` | — | `modules/geo/routes.ts:26` |
| `GET` | `/api/v1/geo/checkins/:checkin_id` | — | `modules/geo/routes.ts:27` |

## `/api/v1/hr` — `hr`

| Method | Path | Guards | Source |
|---|---|---|---|
| `GET` | `/api/v1/hr/contracts` | requireRole(admin, manager, regional_manager), hr:read | `modules/hr/routes.ts:143` |
| `POST` | `/api/v1/hr/contracts` | requireRole(admin, manager, regional_manager), hr:write | `modules/hr/routes.ts:146` |
| `GET` | `/api/v1/hr/payroll` | requireRole(admin, manager, regional_manager, worker, checker) | `modules/hr/routes.ts:159` |
| `POST` | `/api/v1/hr/payroll` | requireRole(admin, manager, regional_manager), hr:write | `modules/hr/routes.ts:162` |
| `POST` | `/api/v1/hr/payroll/:request_id/fulfil` | requireRole(admin, manager, regional_manager), hr:write | `modules/hr/routes.ts:178` |
| `POST` | `/api/v1/hr/payslip-requests` | requireRole(worker, checker), hr:payslip:request | `modules/hr/routes.ts:188` |
| `GET` | `/api/v1/hr/workers/:worker_id/contract-status` | requireRole(admin, manager, regional_manager, worker, checker) | `modules/hr/routes.ts:203` |
| `GET` | `/api/v1/hr/workers/:worker_id/contract-download` | requireRole(admin, manager, regional_manager, worker, checker) | `modules/hr/routes.ts:216` |
| `POST` | `/api/v1/hr/workers/:worker_id/contract-scan` | requireRole(admin, manager, regional_manager), hr:write, multipart | `modules/hr/routes.ts:227` |
| `POST` | `/api/v1/hr/workers/:worker_id/contract-confirm` | requireRole(admin, manager, regional_manager), hr:write | `modules/hr/routes.ts:238` |
| `POST` | `/api/v1/hr/workers/:worker_id/contract-extend` | requireRole(admin, manager, regional_manager), hr:write | `modules/hr/routes.ts:249` |
| `POST` | `/api/v1/hr/workers/:worker_id/contract-lapse` | requireRole(admin, manager, regional_manager), hr:write | `modules/hr/routes.ts:256` |
| `POST` | `/api/v1/hr/workers/:worker_id/documents` | requireRole(admin, manager, regional_manager), hr:write, multipart | `modules/hr/routes.ts:266` |

## `/api/v1/notifications` — `notifications`

The `/outbox/*` routes are operational surfaces for the transactional outbox (`ADR-029`) and are `admin`-only. `requeue` and `discard` are irreversible with respect to side effects.

| Method | Path | Guards | Source |
|---|---|---|---|
| `GET` | `/api/v1/notifications/outbox/metrics` | requireRole(admin) | `modules/notifications/routes.ts:20` |
| `GET` | `/api/v1/notifications/outbox/dead-letters` | requireRole(admin) | `modules/notifications/routes.ts:21` |
| `POST` | `/api/v1/notifications/outbox/dead-letters/:outbox_id/requeue` | requireRole(admin) | `modules/notifications/routes.ts:22` |
| `DELETE` | `/api/v1/notifications/outbox/dead-letters/:outbox_id` | requireRole(admin) | `modules/notifications/routes.ts:23` |
| `GET` | `/api/v1/notifications` | — | `modules/notifications/routes.ts:25` |
| `POST` | `/api/v1/notifications/:notification_id/read` | — | `modules/notifications/routes.ts:26` |
| `POST` | `/api/v1/notifications/push-tokens` | — | `modules/notifications/routes.ts:29` |

## `/api/v1/quality` — `quality`

`/verifications` accepts a photo *with* the rating (CRR §15). `/rework/:assignment_id/complete` is worker-initiated and deliberately not gated as a checker action (CRR §14).

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/quality/verifications` | quality:write | `modules/quality/routes.ts:34` |
| `GET` | `/api/v1/quality/verifications/:verification_id/photos` | quality:read | `modules/quality/routes.ts:46` |
| `POST` | `/api/v1/quality/rework` | quality:write | `modules/quality/routes.ts:51` |
| `POST` | `/api/v1/quality/rework/:assignment_id/complete` | — | `modules/quality/routes.ts:58` |
| `POST` | `/api/v1/quality/ratings` | quality:write | `modules/quality/routes.ts:63` |
| `GET` | `/api/v1/quality/leaderboard` | quality:read | `modules/quality/routes.ts:66` |
| `GET` | `/api/v1/quality/leaderboard/by-hotel/:hotel_id` | quality:read, checkHotelAccess | `modules/quality/routes.ts:69` |

## `/api/v1/retention` — `retention`

| Method | Path | Guards | Source |
|---|---|---|---|
| `GET` | `/api/v1/retention/audit-log` | requireRole(admin) | `modules/retention/routes.ts:15` |
| `GET` | `/api/v1/retention/eligibility` | — | `modules/retention/routes.ts:19` |

## `/api/v1/users` — `users`

| Method | Path | Guards | Source |
|---|---|---|---|
| `GET` | `/api/v1/users` | users:read | `modules/users/routes.ts:11` |
| `POST` | `/api/v1/users` | requireRole(admin, manager, regional_manager), users:write | `modules/users/routes.ts:43` |
| `GET` | `/api/v1/users/:user_id` | users:read | `modules/users/routes.ts:44` |
| `PUT` | `/api/v1/users/:user_id` | requireRole(admin, manager, regional_manager), users:write | `modules/users/routes.ts:48` |
| `PUT` | `/api/v1/users/:user_id/role` | requireRole(admin, regional_manager) | `modules/users/routes.ts:52` |
| `POST` | `/api/v1/users/:user_id/revoke-sessions` | requireRole(admin) | `modules/users/routes.ts:57` |
| `DELETE` | `/api/v1/users/:user_id` | requireRole(admin) | `modules/users/routes.ts:58` |

## `/api/v1/work-requests` — `job-requests`

**The mount is `/work-requests`, not `/job-requests`.** The module directory was renamed by Epic 9 PR 9.4; the route path was deliberately kept because it is a public API contract (`TREQ-013`). Broadcast routes are gated by `FEATURE_JOBDISPATCH_PHASE2`.

| Method | Path | Guards | Source |
|---|---|---|---|
| `POST` | `/api/v1/work-requests/broadcasts` | — | `modules/job-requests/routes.ts:33` |
| `GET` | `/api/v1/work-requests/broadcasts/:id/eligibility` | — | `modules/job-requests/routes.ts:58` |
| `POST` | `/api/v1/work-requests/broadcasts/:id/accept` | — | `modules/job-requests/routes.ts:72` |
| `POST` | `/api/v1/work-requests/broadcasts/:id/close` | — | `modules/job-requests/routes.ts:84` |
| `POST` | `/api/v1/work-requests` | requireRole(admin, manager, regional_manager), staffing:write | `modules/job-requests/routes.ts:113` |
| `GET` | `/api/v1/work-requests` | — | `modules/job-requests/routes.ts:114` |
| `GET` | `/api/v1/work-requests/:id` | — | `modules/job-requests/routes.ts:115` |
| `PATCH` | `/api/v1/work-requests/:id` | requireRole(admin, manager, regional_manager), staffing:write | `modules/job-requests/routes.ts:116` |

## Not in this document

- **Request and response body shapes.** Validation is performed inline in each controller via Zod
  `safeParse`; the schemas in `modules/*/types.ts` are the contract. Reproducing them here would
  create a second source of truth that drifts.
- **The Platform Worker.** `backend/src/worker.ts` runs the outbox drain and scheduled jobs
  (`ADR-029`). It has no HTTP surface and appears nowhere above.
- **In-process interfaces.** `IF-NOTIF-Enqueue` and `IF-NOTIF-SendNotification` are module-to-module
  calls, not endpoints — the outbox single-commit guarantee depends on sharing the caller's
  transaction. See `INTERFACE_INDEX.yaml`.

## Regenerating

This file was produced by parsing every `router.<method>('<path>', ...)` in
`backend/src/modules/*/routes.ts` and resolving each module's mount from
`backend/src/routes/v1/index.ts`. Re-derive it against code rather than editing it by hand when the
surface changes; `.claude/knowledge/API_INDEX.yaml` holds the mount-level view and should be
rebound in the same pass.
