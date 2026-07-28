# Module Specification: `attendance` (backend-attendance)

> Specification of ONE bounded backend capability — **Attendance Management** — implemented by
> the single module `backend-attendance`. This capability is **MID-PIVOT**. It carries labeled
> layers: `[CURRENT STATE]` — already-implemented check-in / check-out / manager-verification
> behavior, reverse-specified at code revision `cca1d29`; `[TARGET STATE]` — the confirmed
> geofenced Start/Close + coordinate-capture + 6-month-retention model that is authoritative but
> largely unbuilt; `[MIGRATION GAP]` marks the delta; `[OPEN DECISION]` marks genuine
> human-authority items. Current-state claims cite `path:line @cca1d29`. Target-state claims cite
> `CONFIRMED_REQUIREMENTS_REGISTER.md` (CONFIRMED §x) and `PIVOT_DESIGN_DOCUMENT.md` (PIVOT §x).
> This document records behavior and confirmed contract; it does not create product policy and
> does not resolve any open decision. Nothing here is frozen: G2 freeze is reserved human authority.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-ATT-001 / 0.2.1` |
| Status | `FROZEN` (Amended (Correction, v0.2.0→0.2.1) 2026-07-28, per `GD-10`/`ADR-036`) |
| Owner | `unassigned (SYNC-001, human authority required)`. No CODEOWNERS entry; MODULE_REGISTRY `owner: unassigned` (`.claude/knowledge/MODULE_REGISTRY.yaml:122`). Owner assignment is NOT invented here. |
| Authors / reviewers | Author: Module Author agent / Lead Architect (correction pass). Reviewers (first G4 round, v0.1.0): Architecture (`BLOCKED` — 2 High: unratified cross-owner-write Decision Record, unassigned ownership), Dependency (`PASS_WITH_ACTIONS`), Consistency (`PASS_WITH_ACTIONS`), Security (`FAIL` — 1 High: cross-tenant hotel-scoping), Performance (`PASS_WITH_ACTIONS`). See Review and Change Log. |
| Repository revision | Module code base described: `cca1d29bcf21f9f8b8fe0f08d61350e6e31dc205` (`cca1d29`) — confirmed unchanged through current HEAD `f39332e0be2e97d9c4f34289f4482fdad32762f9` by every G4 reviewer (`git diff cca1d29..HEAD -- backend/src/modules/attendance` is empty). Shared-file citations (`schema.prisma`, `MODULE_REGISTRY.yaml`, `DEPENDENCY_GRAPH.yaml`) refreshed against `f39332e` in this correction pass; those files drifted due to unrelated intervening work (`HOTFIX-AUTH-002`, `SPEC-QUAL-001`'s own dependency-graph sync), not any change to this module. |
| Approved by / at | FROZEN at G2 Specification Freeze on 2026-07-15 by the commissioning human via the G2 Approval Workflow. Per the approving decision, the specification is frozen independently of implementation security findings: the open security findings recorded against this module remain **implementation/release prerequisites** (must be fixed or re-reviewed before G8 Release Readiness), NOT specification-freeze blockers. No temporary Risk Assessment was created. Cross-cutting G2 blockers cleared by ADR-001..010 (ratified 2026-07-15) and the cross-owner `EXPECTED`-seed coupling disposed as superseded-by-pivot by ADR-018 (Accepted, 2026-07-15), clearing the Architecture `BLOCKED`. Security posture: the 1 High finding (cross-tenant hotel-scoping, `OQ-02`) stays OPEN as a release prerequisite, review by G8. |
| Supersedes | None. First specification for `backend-attendance` (registry `specification: UNKNOWN` prior, `MODULE_REGISTRY.yaml:128`). |

## Purpose and Scope

**Outcome:** Define the contract for the hotel's attendance-management capability across its pivot
arc. This is ONE bounded capability implemented by a single backend module; it owns the
`state-attendance` domain and the presence/verification lifecycle of a worker against a confirmed
assignment.

- `[CURRENT STATE]` (implemented @cca1d29): a **timestamp-based check-in/check-out** flow. An
  `EXPECTED` attendance row is pre-seeded (by the job-dispatch accept transaction) per assignment;
  the assigned worker **checks in** (transitioning EXPECTED -> PRESENT or LATE with a computed
  lateness); the worker later **checks out** via a client-supplied `check_out_at` timestamp
  (computing `minutes_worked`); management (admin/manager/checker) may **override** status/minutes
  and **verify** the record (`is_verified`). No geolocation is captured or enforced anywhere.
- `[TARGET STATE]` (confirmed, largely unbuilt — CONFIRMED §17/§25/§28/§37, PIVOT §4.7/§7.4/§8.3/§9.1):
  a **geofenced Start/Close** model. Location is sampled ONLY at Start/Close button press (never
  continuous); the button only functions when the device is physically within a **100 m** geofence
  of the hotel; actual coordinates are captured and stored at each clock-in/out and **hard-deleted
  after exactly 6 months** by an automatic scheduled job; the worker is shown a distance but the
  exact hotel location is not revealed; the dropped working-hours legal-limit warning is confirmed
  absent (CONFIRMED §28); notifications are push-only (CONFIRMED §18).

**In scope:**
- `backend/src/modules/attendance/{service.ts,controller.ts,routes.ts,types.ts}` — check-in,
  list, get-by-id, update (check-out / manager override / verification).
- Data contract for the Prisma `Attendance` model (`schema.prisma:376-406`) and the
  `AttendanceStatus` enum (`schema.prisma:64-72`).
- `[TARGET]` geofence gating, coordinate storage fields, and the 6-month retention job — all
  UNBUILT; specified only to the extent the confirmed authorities settle them.

**Out of scope:**
- The seeding of the `EXPECTED` row itself: authored by `backend-work-applications`
  (`work-applications/service.ts:256`), a CROSS-OWNER write into `state-attendance` (recorded as
  observed coupling + `[OPEN DECISION]` OQ-03; the seed logic is not owned by this module).
- Assignment lifecycle (`backend-assignments`), quality verification / rating (`backend-quality`),
  notification delivery mechanics (`backend-notifications`), calendar / sick-vacation
  (PIVOT §4.5), and payroll (PIVOT §4.12 — out of system). Referenced only as consumed state,
  delivery sink, or boundary.
- The geo module (a placeholder per CONFIRMED §37) — target may involve it; not specified here.

**Non-goals:** Requirements discovery, product-policy invention, code planning, independent
review, or resolving any open decision below.

## Evidence and Traceability

`[CURRENT STATE]` requirements (REQ-001..020) — reverse-specified at `cca1d29`:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-001` check-in restricted to `worker` role at route | `attendance/routes.ts:13` @cca1d29 | Code | Observed (High) |
| `REQ-002` check-in requires an existing assignment owned by the actor | `attendance/service.ts:35-41` @cca1d29 | Code | Observed (High) |
| `REQ-003` check-in requires the pre-seeded attendance row (unique `assignment_id`) | `attendance/service.ts:44-47`; `schema.prisma:378` @cca1d29 | Code | Observed (High) |
| `REQ-004` check-in allowed only from `EXPECTED` status | `attendance/service.ts:48-50` @cca1d29 | Code | Observed (High) |
| `REQ-005` lateness computed from `expected_start`; PRESENT vs LATE | `attendance/service.ts:52-61` @cca1d29 | Code | Observed (High); null-branch UNTESTED |
| `REQ-006` check-in sets `check_in_at`, `minutes_late`, `notes`; audits `CHECK_IN` | `attendance/service.ts:57-69` @cca1d29 | Code | Observed (High) |
| `REQ-007` list filters `hotel_id`/`assignment_id`/`status`/`is_verified` | `attendance/service.ts:78-83`; `types.ts:23-34` @cca1d29 | Code | Observed (High) |
| `REQ-008` non-management list scoped to own `worker_id`; management may filter `worker_id` | `attendance/service.ts:85-89` @cca1d29 | Code | Observed (High) |
| `REQ-009` offset pagination; `orderBy created_at desc`; returns `{data,total}` | `attendance/service.ts:91-101`; `controller.ts:43-56` @cca1d29 | Code | Observed (High) |
| `REQ-010` getById NotFound if absent; non-(admin/manager) non-owner Forbidden | `attendance/service.ts:104-118` @cca1d29 | Code | Observed (High); scoping UNTESTED; checker asymmetry (OQ-01) |
| `REQ-011` update NotFound if record absent | `attendance/service.ts:126-127` @cca1d29 | Code | Observed (High) |
| `REQ-012` worker update may only set `check_out_at`/`notes`; other fields -> Forbidden | `attendance/service.ts:129-143` @cca1d29 | Code | Observed (High) |
| `REQ-013` worker check-out preconditions: must have checked in; not already checked out | `attendance/service.ts:144-149` @cca1d29 | Code | Observed (High) |
| `REQ-014` `check_out_at` set; `minutes_worked` computed when `check_in_at` present | `attendance/service.ts:154-163` @cca1d29 | Code | Observed (High) |
| `REQ-015` non-worker may set `status`/`minutes_late`/`minutes_worked`; `is_verified===true` sets verifier + timestamp | `attendance/service.ts:168-177` @cca1d29 | Code | Observed (High) |
| `REQ-016` update audits `UPDATE_ATTENDANCE` | `attendance/service.ts:181-183` @cca1d29 | Code | Observed (High) |
| `REQ-017` post-update fire-and-forget notifications (non-worker): verify -> `ATTENDANCE_VERIFIED` to worker; else status `ABSENT` -> `WORKER_NO_SHOW` to `assignment.assigned_by_id` | `attendance/service.ts:185-209` @cca1d29 | Code | Observed (High); BOTH paths UNTESTED |
| `REQ-018` the `EXPECTED` row is seeded by the job-dispatch accept tx (cross-owner writer) | `work-applications/service.ts:256` @cca1d29; edge `edge-work-applications-writes-attendance` (`DEPENDENCY_GRAPH.yaml:131`) | Code + graph | Observed (High); coupling OQ-03 |
| `REQ-019` response envelope `{status,data,pagination?,meta}`; inline Zod validation (NO validation middleware) | `attendance/controller.ts:12-14,22-26,80-82` @cca1d29 | Code | Observed (High) |
| `REQ-020` all routes require `authMiddleware`; mounted at `/api/v1/attendance` | `attendance/routes.ts:8`; `routes/v1/index.ts:29` @cca1d29 | Code | Observed (High) |
| Every mutation writes an `AuditLog` via `BaseService.logAudit` | `attendance/service.ts:67,181` @cca1d29 | Code | Observed (High) |
| No event bus; notifications synchronous fire-and-forget | `attendance/service.ts:187,200`; MODULE_REGISTRY `published_events: none-observed` (`MODULE_REGISTRY.yaml:126`) | Code + registry | Observed (High) |
| Modular-monolith (ADR-003), Prisma-over-PostgreSQL (ADR-004) | PIVOT §5.1/§11, §2.1; `schema.prisma` @cca1d29 | Architecture decision | Confirmed |

`[TARGET STATE]` requirements (TREQ-001..008) — confirmed authorities, largely unbuilt:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `TREQ-001` clock-in/out (Start/Close) function only when device within a **100 m** geofence of the hotel | CONFIRMED §17; PIVOT §4.7, §7.4, §8.3 | Confirmed authority | Target; unbuilt (MIG-GAP-01) |
| `TREQ-002` location sampled ONLY at Start/Close button press (never continuous) | CONFIRMED §17; PIVOT §4.7 | Confirmed authority | Target; unbuilt (MIG-GAP-01) |
| `TREQ-003` worker is shown a distance; exact hotel location is NOT revealed | CONFIRMED §17 | Confirmed authority | Target; unbuilt (MIG-GAP-01) |
| `TREQ-004` actual coordinates captured and stored at each clock-in/out | CONFIRMED §17; PIVOT §7.4, §9.1 | Confirmed authority | Target; unbuilt (MIG-GAP-02) |
| `TREQ-005` stored coordinates hard-deleted after exactly 6 months by an automatic scheduled job | CONFIRMED §17, §25 (Tier 1); PIVOT §4.7, §9.1 | Confirmed authority | Target; unbuilt (MIG-GAP-04) |
| `TREQ-006` outside the radius the Start/Close button is disabled -> NO clock event recorded | PIVOT §7.4, §8.3 | Confirmed authority | Target; unbuilt (MIG-GAP-01/03) |
| `TREQ-007` no working-hours legal-limit warning or block (rule DROPPED entirely) | CONFIRMED §28 | Confirmed authority | Target; already-aligned (MIG-GAP-06) |
| `TREQ-008` attendance notifications are push-only | CONFIRMED §18 | Confirmed authority | Target; unbuilt |

## Actors and Terminology

Role-token casing: the Prisma `UserRole` enum is UPPER-CASE while service/route guards compare
lower-case literals (`'admin'`,`'manager'`,`'checker'`,`'worker'`); the auth layer normalizes to
guard casing. Statements below use guard casing. "Management" here means the set the code treats as
privileged — `list`/`update`/`getById` all now treat `{admin, manager, checker}` as privileged,
consistently (`getById` aligned 2026-07-28, `OQ-01` resolved; previously `getById` narrowly excluded
`checker`).

| Term/actor | Canonical definition | Source |
|---|---|---|
| Attendance record | The 1:1 presence record for one `WorkerAssignment`; lifecycle EXPECTED -> PRESENT/LATE (check-in) with manager-set ABSENT/PARTIAL/EXCUSED overrides; carries check-in/out timestamps, lateness, minutes worked, and a manager verification flag. | `schema.prisma:376`; `attendance/service.ts` (TERMINOLOGY promotion proposed) |
| `EXPECTED` (status) | Pre-shift placeholder state; the row exists but the worker has not checked in. Seeded by the accept transaction, NOT by this module. | `schema.prisma:66`; `work-applications/service.ts:256` |
| Check-in | Worker action transitioning EXPECTED -> PRESENT or LATE, stamping `check_in_at=now` and computing `minutes_late`. `[TARGET]` becomes a geofenced "Start" gated at 100 m. | `attendance/service.ts:30-72`; PIVOT §7.4 |
| Check-out | Worker action supplying `check_out_at` (a client timestamp), computing `minutes_worked`. `[TARGET]` becomes a geofenced "Close" (geofence semantics for Close UNDER OPEN DECISION OQ-04). | `attendance/service.ts:154-163`; PIVOT §7.4 |
| Manager verification (`is_verified`) | A manager/checker/admin marking a record as verified (`is_verified=true`, `verified_by`, `verified_at`). This is a **records-review** concept and is DISTINCT from target geofence presence verification (terminology collision, OQ-09). | `attendance/service.ts:172-176`; `schema.prisma:393` (SP-7) |
| `minutes_late` / `minutes_worked` | Raw computed durations; provided for downstream assessment (Cleaners by rooms, other roles by hours — CONFIRMED §51/§52) and analytics. Attendance provides RAW minutes only; no payroll computation (PIVOT §4.12). | `attendance/service.ts:52-61,158-161` |
| Geofence Start/Close `[TARGET]` | Clock-in/out actions enabled only within a 100 m radius of the hotel; coordinates captured at press and stored with a 6-month TTL. | CONFIRMED §17; PIVOT §7.4, §8.3 |
| Geofence presence verification `[TARGET]` | Confirmation of on-site presence via the 100 m check at clock-in/out. Distinct from `is_verified` (OQ-09). | PIVOT §7.4 |
| Stored coordinates `[TARGET]` | Device latitude/longitude sampled at each clock event; personal location data; retained exactly 6 months then hard-deleted. | CONFIRMED §17, §25; PIVOT §9.1 |
| assigned_by manager | `WorkerAssignment.assigned_by_id`; recipient of the `WORKER_NO_SHOW` notification when a manager marks a record ABSENT. | `attendance/service.ts:195-205` |

## Requirements and Acceptance Criteria

`[CURRENT STATE]` requirements (all Observed @cca1d29 unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| REQ-001 | Check-in is restricted to the `worker` role at the route. | Must | Non-worker POST `/attendance` -> route-level 403 before service. | RULE-003 |
| REQ-002 | Check-in requires an existing assignment owned by the actor. | Must | Missing assignment -> NotFoundError; `assignment.worker_id != actorId` -> ForbiddenError. | RULE-003 |
| REQ-003 | Check-in requires the pre-seeded attendance row for that assignment. | Must | No row for unique `assignment_id` -> NotFoundError. | RULE-011 |
| REQ-004 | Check-in is allowed only when the row is `EXPECTED`. | Must | Status != EXPECTED -> ConflictError ("Already checked in"). | RULE-001 |
| REQ-005 | Check-in computes lateness and sets status. | Must | `minutes_late = max(0, floor((now - expected_start)/60000))`, or null if `expected_start` null; status LATE if `minutes_late>0` else PRESENT. | RULE-001, RULE-002 |
| REQ-006 | Check-in stamps `check_in_at=now`, `minutes_late`, `notes` and audits. | Must | Row updated; `notes` falls back to existing; AuditLog `CHECK_IN` written. | RULE-001, RULE-010 |
| REQ-007 | Attendance can be listed with `hotel_id`/`assignment_id`/`status`/`is_verified` filters. | Must | List returns filtered, paginated data + pagination envelope. | RULE-008 |
| REQ-008 | Non-management list is scoped to the actor's own `worker_id`; management may optionally filter `worker_id`. | Must | Role not in {admin,manager,checker} -> `where.worker_id=actor`; else optional `worker_id` filter. | RULE-008 |
| REQ-009 | List is offset-paginated, ordered `created_at desc`, returning data + total. | Must | `skip=(page-1)*per_page`, `take=per_page`; `total` from count; pagination envelope computed. | RULE-008 |
| REQ-010 | getById returns NotFound if absent and Forbidden for a non-(admin/manager/checker) non-owner. | Must | Missing -> NotFoundError; role not in {admin,manager,checker} AND not owner -> ForbiddenError. Aligned to list/update's guard 2026-07-28 (`OQ-01` resolved); previously excluded `checker`. | RULE-008 |
| REQ-011 | Update returns NotFound if the record is absent. | Must | Missing id -> NotFoundError. | — |
| REQ-012 | A worker may update only `check_out_at` and `notes`; supplying any manager field is forbidden. | Must | Non-owner worker -> Forbidden; any of status/minutes_late/minutes_worked/is_verified present -> ForbiddenError ("Workers may only set check_out_at and notes"). | RULE-004 |
| REQ-013 | Worker check-out requires prior check-in and no prior check-out. | Must | `check_in_at===null` -> ConflictError; `check_out_at!==null` -> ConflictError. | RULE-005 |
| REQ-014 | Supplying `check_out_at` stamps it and computes `minutes_worked` when checked in. | Must | `check_out_at` set; if `check_in_at` present, `minutes_worked = max(0, floor((checkOut - check_in_at)/60000))`. | RULE-006 |
| REQ-015 | A non-worker (manager/admin/checker) may set status/minutes_late/minutes_worked and verify. | Must | Fields applied; `is_verified===true` sets `is_verified`, connects `verified_by=actor`, `verified_at=now`. | RULE-007 |
| REQ-016 | Every update writes an audit row. | Must | AuditLog `UPDATE_ATTENDANCE` with `worker_id` context. | RULE-010 |
| REQ-017 | After a non-worker update, a best-effort notification may fire. | Should | `is_verified===true` -> `ATTENDANCE_VERIFIED` to `record.worker_id`; else `status==='ABSENT'` -> lookup `assignment.assigned_by_id` and send `WORKER_NO_SHOW`; both fire-and-forget, `.catch(()=>{})` swallowed. | RULE-009 |
| REQ-018 | The `EXPECTED` row is seeded externally by the job-dispatch accept transaction. | Must | Attendance row with status EXPECTED and denormalized `expected_start/end` exists prior to any check-in; created by `backend-work-applications`, not this module. | RULE-011 |
| REQ-019 | Responses use the shared envelope; validation is inline Zod (no validation middleware). | Must | `{status:'success',data,pagination?,meta:{timestamp,request_id}}`; check-in 201, others 200; `safeParse` failure -> ValidationError. | RULE-008 |
| REQ-020 | All routes require authentication and are mounted at `/api/v1/attendance`. | Must | `router.use(authMiddleware)`; mount `routes/v1/index.ts:29`. | RULE-003 |

`[TARGET STATE]` requirements (confirmed authority; unbuilt unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| TREQ-001 | Start/Close only function when the device is within 100 m of the hotel; outside -> button disabled, no clock event. | Must | BE computes device-to-hotel distance at button press; inside 100 m -> record; outside -> no attendance write. | TRULE-001 |
| TREQ-002 | Location is sampled only at Start/Close press, never continuously. | Must | No background/continuous location; a coordinate exists only per clock event. | TRULE-001, TRULE-003 |
| TREQ-003 | The worker is shown a distance but never the exact hotel coordinates. | Must | UI/API returns distance, not hotel location. | TRULE-003 |
| TREQ-004 | Actual coordinates are captured and stored at each clock-in/out. | Must | Each clock event persists device lat/long on the attendance record (new fields). | TRULE-002 |
| TREQ-005 | Stored coordinates are hard-deleted exactly 6 months after capture by an automatic scheduled job. | Must | Scheduled job removes coordinates older than 6 months; deletion is hard (not soft). | TRULE-002 |
| TREQ-006 | Outside the radius, no clock event is recorded (button inactive). | Must | Out-of-range Start/Close produces neither a status change nor a stored coordinate. | TRULE-001 |
| TREQ-007 | No working-hours legal-limit warning or block is applied. | Must | No code path warns/blocks on hours worked (rule dropped, CONFIRMED §28). | TRULE-004 |
| TREQ-008 | Attendance notifications are push-only. | Should | Notification channel is push; no email/SMS/in-app duplication mandated. | TRULE-005 |

## Business Rules

`[CURRENT STATE]` rules (RULE-001..011) — reverse-specified @cca1d29:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-001 | Check-in of an attendance row | Transition allowed only EXPECTED -> {PRESENT, LATE}; stamps `check_in_at`. Non-EXPECTED is rejected. | Non-EXPECTED -> ConflictError. `[TARGET]` check-in becomes geofenced Start (TRULE-001); the EXPECTED-gating is retained but a 100 m check is added ahead of it. | `unassigned (SYNC-001)`; `attendance/service.ts:48-61` |
| RULE-002 | Check-in with an `expected_start` | `minutes_late = max(0, floor((now - expected_start)/60000))`; null when `expected_start` is null; LATE iff `minutes_late>0`, else PRESENT. | Null-`expected_start` branch is UNTESTED. | `unassigned (SYNC-001)`; `attendance/service.ts:52-61` |
| RULE-003 | Check-in request | Actor must hold the `worker` role (route) AND own the assignment (service). | Non-worker -> 403; non-owner -> ForbiddenError. | `unassigned (SYNC-001)`; `attendance/routes.ts:13`; `service.ts:39-41` |
| RULE-004 | Worker update of an attendance row | A worker may set ONLY `check_out_at` and `notes`, and only on their own record. | Non-owner or any manager field present -> ForbiddenError. `[TARGET]` field model reworked once geofence Close + coordinates exist. | `unassigned (SYNC-001)`; `attendance/service.ts:131-143` |
| RULE-005 | Worker check-out | Requires `check_in_at != null` and `check_out_at == null`. | Otherwise ConflictError. | `unassigned (SYNC-001)`; `attendance/service.ts:144-149` |
| RULE-006 | Any `check_out_at` write | `minutes_worked = max(0, floor((check_out_at - check_in_at)/60000))` computed only when `check_in_at` present. | If not checked in, `minutes_worked` left unset. | `unassigned (SYNC-001)`; `attendance/service.ts:154-163` |
| RULE-007 | Non-worker update | May set status/minutes_late/minutes_worked; `is_verified===true` sets `is_verified`, connects `verified_by=actor`, stamps `verified_at`. | `is_verified` is only ever set true here (no un-verify path). NOTE: this is manager RECORDS verification — DISTINCT from target geofence verification (OQ-09). | `unassigned (SYNC-001)`; `attendance/service.ts:168-176` |
| RULE-008 | List / getById read access | list, update, & getById all treat {admin,manager,checker} as privileged (else forced to own `worker_id`). Management is NOT hotel-scoped. | Asymmetry between list and getById re `checker` RESOLVED 2026-07-28 (`OQ-01`; `getById` aligned to match); NO hotel-scoping on any read/verify (OQ-02) remains a separate, unresolved item. | `unassigned (SYNC-001)`; `attendance/service.ts:85-89,111-115,162` |
| RULE-009 | Any notification emission | Best-effort synchronous fire-and-forget; never participates in or rolls back the update; `.catch(()=>{})`-swallowed. Only non-worker updates emit. | Delivery failure is silent. `[TARGET]` push-only channel (CONFIRMED §18, TRULE-005). | `unassigned (SYNC-001)`; `attendance/service.ts:185-209` |
| RULE-010 | Any mutation (check-in / update) | Writes an immutable AuditLog row via `BaseService.logAudit` (`CHECK_IN` / `UPDATE_ATTENDANCE`). | — | `unassigned (SYNC-001)`; `attendance/service.ts:67,181` |
| RULE-011 | Existence of the attendance row | Attendance owns `state-attendance` but is NOT its only writer: the row is SEEDED (status EXPECTED, denormalized window) by the `backend-work-applications` accept transaction. | Cross-owner write coupling (OQ-03); architecture review independently confirmed no Decision Record or superseded-by-pivot record exists for this coupling — `BLOCKED`, human/architecture authority (FIND-ARCH-001). `[TARGET]` seeding source uncertain under the calendar model (OQ-05). | `unassigned (SYNC-001)`; `work-applications/service.ts:256`; `DEPENDENCY_GRAPH.yaml:131,477` |

`[TARGET STATE]` rules (TRULE-001..005) — confirmed authority:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| TRULE-001 | Start/Close button press | The action succeeds ONLY if device is within 100 m of the hotel; outside -> button disabled, no clock event, no stored coordinate. Radius 100 m (Zirove default; per-hotel configurable later). | Out-of-range -> no state change. | CONFIRMED §17; PIVOT §4.7, §7.4, §8.3 |
| TRULE-002 | A successful clock-in/out | Device coordinates are stored on the record and hard-deleted exactly 6 months later by an automatic scheduled job. | Hard delete, not soft. | CONFIRMED §17, §25; PIVOT §9.1 |
| TRULE-003 | Presenting location to the worker | Show distance-to-hotel only; never reveal exact hotel coordinates; sample location only at press (not continuous). | — | CONFIRMED §17; PIVOT §4.7 |
| TRULE-004 | Hours worked | No legal-limit working-hours warning or block is applied. | Rule dropped entirely. | CONFIRMED §28 |
| TRULE-005 | Any attendance notification | Delivered push-only. | — | CONFIRMED §18 |

## Ownership and Boundaries

**Module owner:** `unassigned (SYNC-001, human authority required)`. MODULE_REGISTRY records
`owner: unassigned` (`MODULE_REGISTRY.yaml:122`); no CODEOWNERS entry exists. Owner assignment is
reserved human authority and is NOT invented here. Architecture review independently confirmed this
gap `BLOCKED`s authorization of the OQ-03 Decision Record below, since an unowned module cannot
authorize a Decision Record on its own behalf (FIND-ARCH-002).

**Owned state (per DEPENDENCY_GRAPH state-domains):**
- `state-attendance` (`schema.prisma:376`, `DEPENDENCY_GRAPH.yaml:70,474`) — owned by
  `backend-attendance`; `authoritative_writer: backend-attendance` but `writers:
  [backend-attendance, backend-work-applications]` (`DEPENDENCY_GRAPH.yaml:477`).

**Consumed state (read):**
- `state-worker-assignment` (owner `backend-assignments`) — read for check-in ownership
  (`service.ts:35`) and for the `assigned_by_id` no-show lookup (`service.ts:195`); edge
  `edge-attendance-reads-worker-assignment` (`DEPENDENCY_GRAPH.yaml:189`).
- `state-audit-log` (write, cross-cutting via `BaseService.logAudit`) — audit trail.

**Permitted writes:** This module writes ONLY `state-attendance` (its own domain) and
`state-audit-log` (cross-cutting). `[CURRENT]` NOTABLE cross-owner INBOUND coupling (observed): the
`EXPECTED` attendance row is created by `backend-work-applications` inside the accept `$transaction`
(`work-applications/service.ts:256`; edge `edge-work-applications-writes-attendance`,
`DEPENDENCY_GRAPH.yaml:131`). Thus this module owns the domain but is NOT its sole writer. This is
the same class of coupling flagged as FIND-ARCH-003 for job-dispatch. Independent architecture review
of this candidate (v0.1.0) confirmed no Decision Record or superseded-by-pivot record exists for this
coupling anywhere in `docs/14-governance/architecture-decisions/`, and recommended `BLOCKED` pending
one (FIND-ARCH-001) — this does not change the disposition below, which already correctly identifies
the gap as open. `[OPEN DECISION]` OQ-03: whether this warrants a Decision Record or a
"superseded-by-pivot" record; and `[OPEN DECISION]` OQ-05: whether seeding moves out of
work-applications under the target calendar model. Recorded as observed behavior only, not endorsed.

**Boundary/non-responsibilities:** This module does NOT own: assignment lifecycle
(`backend-assignments`); quality verification or rating computation (`backend-quality`);
notification delivery mechanics (`backend-notifications` — this module only calls
`sendNotification`); calendar / sick-vacation auto-cancel (PIVOT §4.5 — attendance sees a cancelled
assignment only as one that should not expect attendance; it does NOT implement the cancel);
payroll (PIVOT §4.12 — out of system; this module provides RAW `minutes_worked`/`minutes_late`
only). `[TARGET]` it will own the geofence check, coordinate storage, and the 6-month retention job
(possibly in concert with the geo module, CONFIRMED §37); it does NOT own the hotel-coordinate
source of truth.

## Interfaces and Contracts

Base router mounts at `routes/v1/index.ts:29` (`/api/v1/attendance`). All routes require
`authMiddleware` (`routes.ts:8`). Envelope: `{ status:"success", data, pagination?,
meta:{timestamp,request_id} }`. Error types map to HTTP via the shared error layer: `ValidationError`
(400, inline Zod field details), `NotFoundError` (404), `ForbiddenError` (403), `ConflictError`
(409). Validation is performed INLINE in the controller via `safeParse` — the shared
validation-middleware is NOT used here. Compatibility vocabulary: these contracts are **unversioned**
in code (no contract version / registry entry), so their compatibility posture is recorded as
**baseline/UNKNOWN**, not "stable/additive"; any change must be assessed against a future versioned
baseline. The `routes.ts` comment cites "API_SPEC_V1_PATCH_V2 §PATCH-07" (`routes.ts:10`) — recorded
as a code annotation, not verified against that doc here.

`[CURRENT STATE]` endpoints (implemented @cca1d29):

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `POST /attendance` (unversioned) | inbound | `CheckInSchema` (assignment_id string; notes<=1000 optional) | 201 `AttendanceDto` | ValidationError, NotFoundError(assignment/record), ForbiddenError, ConflictError | `authMiddleware` + `requireRole(['worker'])` | baseline/UNKNOWN |
| `GET /attendance` (unversioned) | inbound | `ListAttendanceQuerySchema` (hotel_id?, worker_id?, assignment_id?, status?, is_verified(string->bool)?, page>=1 def 1, per_page 1..100 def 20) | 200 `AttendanceDto[]` + pagination | ValidationError | any authenticated (service-scoped, RULE-008) | baseline/UNKNOWN |
| `GET /attendance/:id` (unversioned) | inbound | path id | 200 `AttendanceDto` | NotFoundError, ForbiddenError | any authenticated (RULE-008; checker now exempt here too, aligned 2026-07-28, `OQ-01` resolved) | baseline/UNKNOWN |
| `PATCH /attendance/:id` (unversioned) | inbound | `UpdateAttendanceSchema` (check_out_at datetime?, notes<=1000?, status enum(PRESENT,ABSENT,LATE,PARTIAL,EXCUSED)?, minutes_late int>=0?, minutes_worked int>=0?, is_verified bool?).refine(>=1 key) | 200 `AttendanceDto` | ValidationError, NotFoundError, ForbiddenError, ConflictError | any authenticated; field-level access enforced IN-SERVICE (worker vs non-worker, RULE-004/007). NO route-level role guard; NO hotel-scoping (OQ-02) | baseline/UNKNOWN |

DTO shape: `AttendanceDto` (`attendance/types.ts:40-58`) — id, assignment_id, worker_id, hotel_id,
status, check_in_at?, check_out_at?, expected_start?, expected_end?, minutes_late?, minutes_worked?,
notes?, is_verified, verified_by_id?, verified_at?, created_at, updated_at. `[TARGET]` the DTO and
Update schema gain coordinate fields; Close gains a geofence gate — shapes NOT yet authored (M3).

`[TARGET STATE]` interfaces (unbuilt): geofenced Start/Close semantics (device coords at press,
100 m check, stored coords with 6-month TTL) per PIVOT §7.4/§8.3 and CONFIRMED §17. Whether Close
also requires the geofence is UNDER OPEN DECISION (OQ-04). These contracts are not specified beyond
the confirmed behavior above and will be authored at milestone M3 (Field ops, PIVOT §12).

## Events

No event bus exists (MODULE_REGISTRY `published_events: none-observed`, `MODULE_REGISTRY.yaml:126`).
`[CURRENT]` "Events" below are synchronous, best-effort, fire-and-forget calls to
`notificationService.sendNotification` — never transactional (RULE-009). Delivery failures are
`.catch(()=>{})`-swallowed. Only NON-worker updates emit.

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `ATTENDANCE_VERIFIED` | backend-attendance | non-worker update with `is_verified===true` | `service.ts:187-192` (attendance_id, assignment_id) | Verified worker (`record.worker_id`) | Fire-and-forget; not idempotent; failure swallowed; UNTESTED |
| `WORKER_NO_SHOW` | backend-attendance | non-worker update with `status==='ABSENT'` | `service.ts:200-205` (attendance_id, assignment_id, worker_id) | Assignment manager (`assignment.assigned_by_id`) | Fire-and-forget after an extra `findUnique`; failure swallowed; UNTESTED |

Declared-but-NEVER-emitted `NotificationType` values relevant to attendance (`schema.prisma:102-103`):
`CHECK_IN_REMINDER` ("sent when shift start approaches with no check-in") and `SHIFT_REMINDER`
("pre-shift reminder to worker") — NO attendance code path emits these. Recorded as observed
dead enum values (no reminder job exists in-repo).

`[TARGET]` Channel becomes push-only (CONFIRMED §18, TRULE-005). No new attendance events are
settled by the confirmed authorities; any reminder/geofence-failure notification is UNKNOWN and NOT
invented here.

## Dependencies

`[CURRENT]` existing DEPENDENCY_GRAPH edges referenced (no new backend edges proposed for current
state):

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `edge-attendance-reads-worker-assignment` (`DEPENDENCY_GRAPH.yaml:189`) | Check-in ownership check; no-show `assigned_by_id` lookup | Prisma read `state-worker-assignment` | baseline/UNKNOWN | Missing assignment -> NotFoundError (check-in) / no-show notification skipped |
| `edge-attendance-notifications` (`DEPENDENCY_GRAPH.yaml:98`) | Verify / no-show notifications | `notificationService.sendNotification` | baseline/UNKNOWN | Best-effort; swallowed (RULE-009) |
| `edge-work-applications-writes-attendance` (`DEPENDENCY_GRAPH.yaml:131`) | INBOUND cross-owner seed of the EXPECTED row | Prisma write `state-attendance` (by another owner) | baseline/UNKNOWN; coupling OQ-03 | Rolls back the accept tx on failure |
| `edge-analytics-reads-attendance` (`DEPENDENCY_GRAPH.yaml:240`) | Downstream consumer | Prisma read `state-attendance` | baseline/UNKNOWN | Consumer-side |
| `edge-quality-reads-attendance` (`DEPENDENCY_GRAPH.yaml:203-210`) | Downstream consumer — `on_time_rate` recompute (`tx.attendance.count`, filtered `status=PRESENT`) | Prisma read `state-attendance` | baseline/UNKNOWN | Consumer-side. **NEW row, added in this correction pass**: this edge and the `backend-quality` entry in `state-attendance.readers` were added to `DEPENDENCY_GRAPH.yaml` by `SPEC-QUAL-001`'s own dependency review (commit `c56ff94`, 2026-07-10) but were never disclosed here despite already being true in code at this spec's own `cca1d29` baseline — independently confirmed by this candidate's own G4 architecture and dependency reviews (FIND-ARCH-003, FIND-DEP-001). |
| `edge-frontend-attendance`, `edge-mobile-worker-attendance`, `edge-mobile-checker-attendance` (`DEPENDENCY_GRAPH.yaml:274,283,289`) | API clients of `/attendance` | HTTP (unversioned) | baseline/UNKNOWN | Client-side; breaking-change risk if endpoints change |

Shared contracts consumed: `prisma-schema` (data), `base-service` (`logAudit` -> `state-audit-log`),
`auth-middleware`, `permissions-middleware` (`requireRole`), `notification-service`. The shared
`validation-middleware` is NOT used — this module validates inline in its controller
(`controller.ts:12,34,80`).

`[TARGET]` new dependencies (unbuilt): coordinate storage fields on `Attendance` (PIVOT §9.1); an
automatic scheduled retention job for 6-month coordinate hard-delete (CONFIRMED §25, PIVOT §4.7) —
a new runtime concern; a hotel-coordinate source for the 100 m distance check; possible geo-module
involvement (CONFIRMED §37, "geo module was a placeholder"). Architecture anchors modular-monolith
(ADR-003) and Prisma-over-PostgreSQL (ADR-004) are retained.

## State and Lifecycle

`[CURRENT STATE]` `AttendanceStatus` machine (`schema.prisma:64-72`; `attendance/service.ts`):
- **Entry:** row created EXPECTED by the accept transaction (`work-applications/service.ts:256`),
  NOT by this module (RULE-011).
- **Worker check-in:** EXPECTED -> PRESENT (on time / no `expected_start`) or LATE
  (`minutes_late>0`), stamping `check_in_at` (RULE-001/002). This is the ONLY worker-driven status
  transition.
- **Worker check-out:** does NOT change status; sets `check_out_at` and computes `minutes_worked`
  (RULE-005/006).
- **Manager/checker/admin override:** may set status directly to any of
  {PRESENT, ABSENT, LATE, PARTIAL, EXCUSED} (Update schema enum, `types.ts:15`); ABSENT triggers the
  no-show notification (RULE-009). EXPECTED is NOT a settable target of the update enum.
- **Verification flag:** `is_verified` is an ORTHOGONAL boolean (not a status); set true (only) by a
  non-worker, stamping `verified_by`/`verified_at` (RULE-007). There is no un-verify path.
- **Invariants:** attendance is 1:1 with an assignment (`assignment_id @unique`,
  `schema.prisma:378`, onDelete Cascade); `worker_id`/`hotel_id` cascade from User/Hotel;
  `verified_by` SetNull.

**Concurrency:** last-write-wins. There is NO optimistic version column and NO row lock on
`Attendance` updates; two concurrent `PATCH`es race on a plain `prisma.attendance.update`
(`service.ts:179`). The only guard against duplicate check-in is the EXPECTED-status precondition
(RULE-001), which is itself a read-then-write with no transaction — a theoretical double-submit
window exists (recorded, not "fixed"). Independently confirmed by architecture and performance review
(FIND-ARCH-005, FIND-PERF-003): the codebase already uses an optimistic-lock pattern elsewhere
(`WorkRequest.version`, `schema.prisma:262`, "added for optimistic locking against slot-fill race
conditions") that `Attendance` does not adopt. Concretely reachable today via ordinary mobile-network
retry behavior (e.g. a worker double-tapping "check in" on a slow connection) — not a `[TARGET]`/unbuilt
path. Bounded to a same-actor, same-record data-integrity anomaly (duplicate `CHECK_IN` audit row,
indeterminate `check_in_at`/`minutes_late`); not a cross-actor or authorization exposure. Recorded as
`[OPEN DECISION]` OQ-12 below.

**Retention:** `[CURRENT]` rows persist indefinitely; no soft-delete, no TTL. Audit rows persist per
CONFIRMED §30. `[TARGET]` stored coordinates carry a 6-month hard-delete TTL enforced by an automatic
scheduled job (TREQ-005/TRULE-002; CONFIRMED §17, §25; PIVOT §9.1). Whether `expected_start/end`
denormalization survives the calendar model is UNKNOWN (OQ-06).

`[TARGET]` geofenced flow (PIVOT §7.4, §8.3; CONFIRMED §17): capture device coords on Start press ->
BE checks within 100 m of hotel coords -> inside: record attendance + store coords (6-month TTL);
outside: button inactive, no clock event (TRULE-001). Close semantics (whether also geofenced) are
UNDER OPEN DECISION (OQ-04). No formal automation of ABSENT/NO_SHOW is settled by the authorities
(OQ-07).

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** `[CURRENT]` conflict/validation/not-found/forbidden surface as typed
HTTP errors. Attendance mutations are single-row `update`s (no multi-statement transaction, so no
rollback semantics beyond the single write). Notification delivery failures are swallowed and never
affect the update (RULE-009) — a verified/ABSENT record can persist while its notification is
silently lost. The `WORKER_NO_SHOW` path issues an extra `findUnique` on the assignment and skips
silently if the assignment is missing.

**Trust boundaries/authorization:** `[CURRENT]` route RBAC guards only check-in (`worker`).
`PATCH /attendance/:id` and `GET` have NO route-level role guard; access is enforced IN-SERVICE.
Two current-state authorization observations (finding candidates, NOT resolved here):
- `[OPEN DECISION]` OQ-01 — read-scoping asymmetry: `list`/`update` treat `checker` as management,
  but `getById` does NOT (`service.ts:85,111`). A checker can list/patch broadly yet is Forbidden on
  a single-record GET. Intended or a defect — human decision. Independent security review confirmed
  this is fail-safe in direction (checker is denied extra access, not granted it) and rated it Low
  from a security lens, distinct from the underlying consistency question of which direction is
  intended (FIND-SEC-001).
- `[OPEN DECISION]` OQ-02 — NO hotel-scoping on management actions: any admin/manager/checker may
  verify, override status/minutes for, or list attendance of ANY hotel (`service.ts:85-89,168-177`
  contain no hotel-membership check). Cross-tenant exposure; same class as job-dispatch
  FIND-SEC-002/003. `[TARGET]` role×scope is the confirmed direction for job-dispatch (CONFIRMED
  §11/§12) but the authorities do not explicitly restate it for attendance — recorded as a
  current-state finding candidate + open decision, not invented as a requirement. **Independently
  reproduced and rated High severity by G4 security review** (FIND-SEC-002) — confirmed exploitable
  by any already-privileged (server-assigned, non-self-signup) admin/manager/checker account against
  any hotel; the shared `checkHotelAccess()` middleware would NOT close this if simply wired on, since
  that middleware's own design explicitly bypasses hotel-membership checks for these three roles
  (`permissions.ts:103-108`). Security gate recommendation for v0.1.0/v0.1.1: `FAIL`. Per Constitution
  §12/Review Gates, this blocks G2 freeze pending either a code fix or an authorized, time-bounded Risk
  Assessment — neither exists today; not resolved by this specification.

**Data classification/retention:** `[CURRENT]` attendance carries worker presence/performance data
(timestamps, lateness, minutes worked) and manager-authored `notes`; audit rows persist actor
id/role. NO location data is captured today. `[TARGET]` stored clock-in/out coordinates are
**personal location data** (GDPR-relevant); the confirmed control is a **6-month hard-delete** via
an automatic scheduled job (CONFIRMED §17, §25 Tier 1; PIVOT §9.1) and distance-not-location
exposure to the worker (TRULE-003). This is the principal privacy obligation the target introduces.

**Performance budgets/workload:** No explicit budgets or SLOs are defined in code or authority docs
(`[OPEN DECISION]` OQ-10; blocked on ownership SYNC-001) — independently confirmed by performance
review (FIND-PERF-001). Observations: list uses OFFSET pagination
with an `orderBy created_at desc` (`service.ts:96`) where `created_at` is NOT individually indexed —
may degrade on large tables (indexes present: `worker_id`, `hotel_id`, `status`, `check_in_at`,
`(worker_id,check_in_at)`, `(hotel_id,is_verified)`, `schema.prisma:400-405`). The
`(hotel_id,is_verified)` index backs the "pending verifications dashboard" query. Independent
performance review confirmed this accurate and additionally found: `page` (unlike `per_page`) is
unbounded (`types.ts:32`), and because Postgres must sort the full filtered result set before applying
OFFSET/LIMIT, an unfiltered admin/manager/checker list call sorts the FULL cross-hotel table on every
request regardless of page depth — the lack of hotel-scoping (OQ-02) widens this from a per-hotel to a
system-wide worst case (FIND-PERF-002). Zero production rows exist today (pre-launch), so this is a
forward capacity risk, not a current incident. `[TARGET]`
per-clock geofence distance computation and a periodic retention sweep add new workload; the sweep's
volume depends on clock-event rate (UNKNOWN). Single-tenant-per-client deployment (PIVOT §5.1)
suggests modest scale; no figures confirmed.

**Observability/audit:** every mutation calls `BaseService.logAudit` -> AuditLog
(`CHECK_IN`, `UPDATE_ATTENDANCE`). No metrics/tracing observed. Responses carry `request_id` in
`meta`. Independent security review found the audit rows themselves carry only a thin `details`
object (`{assignment_id}` / `{worker_id}`, `service.ts:67-69,181-183`) — `AuditLog.old_values`/
`new_values` (`schema.prisma:519-520`, designed for exactly this purpose) are never populated by this
module. A management override that changes `status`/`minutes_late`/`minutes_worked`/`is_verified`
therefore produces an audit row proving *an* update happened but not *what changed*, weakening the
audit trail's evidentiary value specifically for investigating any abuse of OQ-02 (FIND-SEC-003,
Medium; recorded as `[OPEN DECISION]` OQ-11 below).

## Rollout and Compatibility

`[CURRENT]` behavior is already deployed at `cca1d29`; the current-state layer is a reverse
specification, not a change. The `Attendance` model and `AttendanceStatus` enum are established
(SP-6 EXPECTED default, SP-7 `is_verified`, per `schema.prisma:64-72,374-405`). No feature flags
observed for this module (confirmed by repo-wide search; see FIND-ARCH-004 below).

`[TARGET]` migration strategy — a **forward build** aligned to PIVOT §12 milestone **M3 (Field
ops)**: geofence clock-in, coordinate storage, retention job. Because the system is **pre-launch
with no production attendance data**, no data migration is required to introduce coordinate fields
or the retention job. `[MIGRATION GAP]` enumeration:

| Gap ID | Current state (evidence) | Target requirement (evidence) | Phase |
|---|---|---|---|
| MIG-GAP-01 | Check-in has NO geolocation whatsoever — no coordinate capture, no radius check (`service.ts:30-72`) | Start/Close function only within a 100 m geofence; location sampled at press only; distance-not-location (CONFIRMED §17; PIVOT §4.7, §7.4, §8.3) — TREQ-001/002/003/006 | M3 |
| MIG-GAP-02 | `Attendance` model has NO coordinate fields (`schema.prisma:376-406`) | Add stored device coordinates per clock event (PIVOT §9.1) — TREQ-004 | M3 |
| MIG-GAP-03 | Check-out is a free client-supplied `check_out_at` timestamp with NO location and NO geofence (`service.ts:154-163`) | Geofenced "Close" (Close geofence semantics OQ-04) (PIVOT §7.4, §8.3) — TREQ-001/006 | M3 |
| MIG-GAP-04 | NO retention / auto-deletion job exists in-repo for attendance data | Automatic scheduled job hard-deletes coordinates after exactly 6 months (CONFIRMED §17, §25; PIVOT §9.1) — TREQ-005 | M3 |
| MIG-GAP-05 | `is_verified` denotes MANAGER records-verification (`service.ts:172-176`; `schema.prisma:393`) | Target introduces geofence PRESENCE verification (PIVOT §7.4) — a DIFFERENT concept sharing the word "verified" (terminology collision, OQ-09) — TREQ-001 | M3 (naming decision) |
| MIG-GAP-06 | NO working-hours legal-limit warning/block exists in current code | Confirmed that the working-hours warning rule is DROPPED entirely (CONFIRMED §28) — TREQ-007 | ALREADY-ALIGNED (no build needed; recorded for traceability) |

**Backward compatibility:** current `/attendance` endpoints are consumed by frontend-web,
mobile-worker, and mobile-checker (`DEPENDENCY_GRAPH.yaml:274,283,289`); adding geofence gating and
coordinate fields is a client-visible change (additive fields plus a new failure mode when out of
range). Because contracts are unversioned (baseline/UNKNOWN), any change must be assessed against a
future versioned baseline. **Rollback:** the previously-stated "feature-flag the geofence path per the
existing `FEATURE_*` convention" claim is **INCORRECT** — independently verified by architecture
review (FIND-ARCH-004): a repository-wide search finds no `FEATURE_*`/feature-flag mechanism anywhere
in `backend/src`. This unbuilt claim (inherited from `PIVOT_DESIGN_DOCUMENT.md §10`) has already been
independently falsified for four other modules (`SIR-NOTIF-003`, `SIR-AUTH-012`, CRM's `OD-CRM-14`,
Users' `ASM-USERS-01`). The actual available rollback mechanism today is a version-control
revert/redeploy of the M3 change, not a runtime flag. **Removal criteria:** none — attendance is
a core capability.

## Validation Plan

`[CURRENT STATE]` criteria (mapped to `backend/src/__tests__/attendance.test.ts` @cca1d29):

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| REQ-002/003/004 check-in guards (RULE-001/003/011) | Unit (mocked Prisma) | `attendance.test.ts:63-83` | NotFound(assignment/record); Forbidden(non-owner); Conflict(non-EXPECTED) |
| REQ-005 lateness PRESENT vs LATE (RULE-002) | Unit | `attendance.test.ts:85-105` | PRESENT when early; LATE + minutes_late>0 when late |
| REQ-005 null-`expected_start` branch (RULE-002) | Unit | — | **UNTESTED** — no test covers null expected_start -> minutes_late null |
| REQ-013 check-out preconditions (RULE-005) | Unit | `attendance.test.ts:109-123` | Conflict on no-check-in and on double check-out |
| REQ-014 minutes_worked computation (RULE-006) | Unit | `attendance.test.ts:125-137` | minutes_worked computed from check_in_at |
| REQ-012 worker blocked from verification fields (RULE-004) | Unit | `attendance.test.ts:139-146` | Forbidden when worker sets is_verified |
| REQ-015 manager verify sets verified_by (RULE-007) | Unit | `attendance.test.ts:148-158` | is_verified/verified_by/verified_at set |
| REQ-008 list scoping (RULE-008) | Unit | `attendance.test.ts:161-176` | worker forced to own worker_id; manager not scoped |
| REQ-010 getById scoping (RULE-008) | — | — | **UNTESTED** — no test for getById Forbidden/NotFound or checker asymmetry |
| REQ-017 `ATTENDANCE_VERIFIED` notification (RULE-009) | — | — | **UNTESTED** — verify-notification path not asserted |
| REQ-017 `WORKER_NO_SHOW` notification (RULE-009) | — | — | **UNTESTED** — ABSENT->no-show lookup + send not asserted |
| REQ-006/016 audit writes (RULE-010) | — | — | **UNTESTED** (audit mock present but not asserted) |

`[TARGET STATE]` criteria (to be authored at M3; recorded as expectations, not executable):
TREQ-001 geofence gating (inside 100 m records; outside produces no clock event); TREQ-004
coordinate storage per clock event; TREQ-005 6-month hard-delete job removes aged coordinates;
TREQ-003 distance-not-location exposure; TREQ-007 absence of any working-hours warning.

## Risks, Assumptions, and Open Decisions

Genuine remaining human-authority items (status OPEN).

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OQ-01 | decision | getById treats only {admin,manager} as privileged while list/update also privilege `checker` — a checker can list/patch broadly but is Forbidden on single-record GET. Intended or defect? Security review independently rated the current (fail-safe) direction Low (FIND-SEC-001). | `attendance/service.ts:85,111` @cca1d29 | human/unassigned | **RESOLVED 2026-07-28 — consistency correction, not a governance decision.** `getById` aligned to the same `{admin,manager,checker}` guard already used by `list`/`update`; no independent architecture choice existed here. Fixed directly in `attendance/service.ts:162`. |
| OQ-02 | decision | Management attendance actions (verify, status/minutes override, list) have NO hotel-scoping — any admin/manager/checker acts on ANY hotel's attendance (cross-tenant). Remediate now vs defer to target role×scope. **G4 security review independently reproduced this against live code and rated it High (FIND-SEC-002); gate recommendation `FAIL`; blocks G2 freeze per Constitution §12 pending a code fix or an authorized, time-bounded Risk Assessment — neither exists today.** | `attendance/service.ts:85-89,168-177` @cca1d29; class of FIND-SEC-002/003 | human/unassigned | **OPEN — BLOCKING (High)** |
| OQ-03 | decision | The EXPECTED row is seeded by a cross-owner write from `backend-work-applications` into `state-attendance`. Record as a Decision Record or "superseded-by-pivot"? (Same class as job-dispatch FIND-ARCH-003.) **G4 architecture review independently confirmed no such record exists anywhere in the repository and recommended `BLOCKED` pending one (FIND-ARCH-001).** | `work-applications/service.ts:256`; `DEPENDENCY_GRAPH.yaml:131,477` | human/architecture | **OPEN — BLOCKING (architecture)** |
| OQ-04 | decision | Does the target geofenced "Close" (check-out) also require the 100 m check, or does only "Start" gate? Authorities specify clock-in/out coords but the button-disable text is framed around Start. | CONFIRMED §17; PIVOT §7.4, §8.3 | human | **OPEN** |
| OQ-05 | decision | Under the target calendar model, does EXPECTED-row seeding move out of `work-applications` (which is retired in the job-dispatch pivot)? | PIVOT §5.5/§9.1 (job-dispatch); `work-applications/service.ts:256` | human/architecture | **OPEN** |
| OQ-06 | decision | Fate of `expected_start`/`expected_end` denormalization (currently sourced from WorkRequest) under the calendar-direct-assignment model. | `schema.prisma:387-389`; PIVOT §9.1 | human/architecture | **OPEN** |
| OQ-07 | decision | Is ABSENT/NO_SHOW to be automated (e.g. a reminder/auto-mark job) or remain a manual manager override? `CHECK_IN_REMINDER`/`SHIFT_REMINDER` enums are declared but never emitted. | `attendance/service.ts:193`; `schema.prisma:102-103` | human | **RESOLVED 2026-07-28 → `ADR-059` (`GD-21`).** Automated reminders and automatic ABSENT/NO_SHOW marking are ratified as the permanent target architecture, via the Platform Worker (`ADR-029`/`ADR-057`). Implementation timing, grace-period policy, and trigger conditions are explicitly NOT decided here — deferred to a future implementation decision, matching `ADR-058`'s treatment of Job Dispatch. The current manual manager-override path is unaffected; `SHIFT_REMINDER`/`CHECK_IN_REMINDER` retained as the (now-authorized) target schema surface. |
| OQ-09 | decision | Terminology collision: current `is_verified` = MANAGER records-verification; target introduces geofence PRESENCE verification. Distinct names required to avoid semantic overload. | `attendance/service.ts:172-176`; PIVOT §7.4 | human/architecture | **OPEN** |
| OQ-10 | decision | No performance SLO defined for check-in/list/verify latency or the retention-sweep window. Setting one is a human decision, blocked on ownership. Independently confirmed by G4 performance review (FIND-PERF-001). | Code/authorities define none | human/unassigned | **OPEN** |
| OQ-11 | decision | `AuditLog.old_values`/`new_values` (schema fields designed for exactly this purpose) are never populated by this module's audit writes — only a thin `{assignment_id}`/`{worker_id}` `details` object. Weakens forensic value of the audit trail, particularly for investigating any abuse of OQ-02. New finding from G4 security review (FIND-SEC-003, Medium), not self-identified at v0.1.0. | `attendance/service.ts:67-69,181-183`; `schema.prisma:519-520` | human/unassigned | **RESOLVED 2026-07-28 — platform-level consistency correction, not an attendance-specific governance decision.** The root gap was `BaseService.logAudit` itself (the shared helper used by 8+ modules) having no `old_values`/`new_values` parameters at all. Extended `BaseService.logAudit` with optional `old_values`/`new_values` parameters (backward-compatible; existing callers require no change); attendance's `checkIn`/`update` audit calls now populate them with actual before/after field state. Preserves `ADR-016`'s single-shared-writer principle — no module-specific audit bypass introduced. | 
| OQ-12 | decision | No transaction/optimistic-lock guards `checkIn`/`update` against concurrent requests on the same record (plain read-then-write, `service.ts:44-65,179`); a real double-submit window exists, reachable via ordinary mobile-network retry. **RESOLVED (governance level) `GD-10`/`ADR-036`, 2026-07-28:** optimistic concurrency is adopted as the platform standard; this race MUST be fixed, not accepted as residual risk. The concrete mechanism (a `version` column mirroring `WorkRequest`, a transactional row-level lock, or another optimistic-concurrency-consistent approach) is explicitly deferred to implementation — the implementing engineer must verify which mechanism best fits attendance's own write shape and record that choice at implementation time, rather than it being mandated here. | `attendance/service.ts:44-65,179`; `schema.prisma:262` (`WorkRequest.version` precedent); `ADR-036` | human | **RESOLVED (governance level) — must-fix + optimistic-concurrency standard set, `ADR-036`; mechanism selection deferred to implementation** |
| SYNC-001 | decision | `backend-attendance` owner is `unassigned` (MODULE_REGISTRY:122; no CODEOWNERS). Blocks accountable ownership and SLO-setting; independently confirmed by G4 architecture review to also block authorization of the OQ-03 Decision Record (FIND-ARCH-002). | `MODULE_REGISTRY.yaml:122` | human | **OPEN — BLOCKING (architecture)** |

Note on OQ numbering: this table intentionally has no `OQ-08` — confirmed by G4 consistency review
(FIND-CONS-ATT-004) that no dropped/orphaned item exists (the specification was authored in a single
commit with no prior draft history to inspect); the gap is retained rather than renumbered to avoid
invalidating existing cross-references to OQ-09/OQ-10 from this document and the Specification Issues
Register (`SIR-ATT-007`/`SIR-ATT-009`).

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| ASM-01 | assumption | Guard role tokens are lower-cased (`'admin'`,`'manager'`,`'checker'`,`'worker'`) mapped from UPPER-CASE `UserRole`; auth normalizes. | `attendance/service.ts:85,111,129`; Prisma `UserRole` | Assumption for current-state |
| ASM-02 | assumption | The 100 m radius is the confirmed Zirove default; per-hotel configurability is a LATER concern, not part of this spec's target. | CONFIRMED §17 ("configurable later") | Assumption, bounded by authority |

Note on RESOLVED-BY-TARGET: MIG-GAP-06 (working-hours enforcement) is confirmed DROPPED
(CONFIRMED §28); current code already lacks it, so the target and current state are already aligned
— recorded for traceability, not an action.

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate.

- **MODULE_REGISTRY.yaml:** set `specification` for `backend-attendance` from `UNKNOWN` ->
  `SPEC-ATT-001@0.1.1 (REVIEW)` (`MODULE_REGISTRY.yaml:128`). Do NOT alter `owner` (remains
  `unassigned`, SYNC-001).
- **DEPENDENCY_GRAPH.yaml:** **CORRECTION (v0.1.1):** v0.1.0 incorrectly stated "no NEW edges
  proposed for current state" — G4 architecture and dependency review independently found this false:
  `edge-quality-reads-attendance` (`backend-quality` reading `state-attendance` for its `on_time_rate`
  recompute) already exists in the live code at this spec's own `cca1d29` baseline and was already
  added to `DEPENDENCY_GRAPH.yaml` (`:203-210`, `state-attendance.readers` `:478`) by `SPEC-QUAL-001`'s
  own dependency review (commit `c56ff94`, 2026-07-10) — this spec simply never disclosed it
  (FIND-ARCH-003/FIND-DEP-001, corrected in the Dependencies table above). No further graph change is
  proposed by this correction pass; the graph itself was already correct, only this document was
  stale. NOTE (future, do not add yet): the target adds
  coordinate storage on `Attendance`, a new automatic 6-month retention scheduled job, a hotel-
  coordinate read for the distance check, and possible geo-module involvement (CONFIRMED §37,
  PIVOT §9.1) — these become graph edges when M3 is built. The cross-owner
  `edge-work-applications-writes-attendance` may change source if EXPECTED seeding moves (OQ-05).
- **TERMINOLOGY.md:** promote to canonical: `Attendance record`, `Check-in`, `Check-out`,
  `EXPECTED (status)`, `minutes_late`/`minutes_worked` (raw, not payroll). ADD an explicit
  disambiguation entry distinguishing **"Manager verification (`is_verified`)"** from the target
  **"Geofence presence verification"** (OQ-09). ADD target terms `Geofence Start/Close`,
  `Stored coordinates (6-month TTL)`, `Distance-not-location` — sourced to CONFIRMED §17/§25 and
  PIVOT §4.7/§7.4/§8.3/§9.1.
- **DECISION_INDEX.md:** reference ADR-003 (modular monolith) and ADR-004 (Prisma ORM) as existing
  anchors. A NEW Decision Record MAY be requested for the cross-owner EXPECTED-seed coupling
  (OQ-03) OR that coupling recorded as "superseded-by-pivot" — proposed, not created here.
- **SYNC_STATE.yaml:** none proposed by the author; the synchronization owner records spec issuance
  if/when this candidate advances.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-07 | Initial specification for `backend-attendance` at `cca1d29`. Current-state reverse spec: REQ-001..020, RULE-001..011. Target layer from confirmed authorities: TREQ-001..008, TRULE-001..005 (all cited to CONFIRMED/PIVOT). MIGRATION GAP enumeration MIG-GAP-01..06. Recorded open decisions OQ-01 (checker read asymmetry), OQ-02 (no hotel-scoping / cross-tenant), OQ-03 (cross-owner EXPECTED seed), OQ-04 (Close geofence semantics), OQ-05 (seed source under calendar), OQ-06 (expected_start/end fate), OQ-07 (ABSENT/NO_SHOW automation), OQ-09 (is_verified vs geofence verification terminology collision), OQ-10 (no SLO), SYNC-001 (owner). Flagged UNTESTED criteria: null-expected_start branch, getById scoping, ATTENDANCE_VERIFIED/WORKER_NO_SHOW notification paths, audit writes. | None — REVIEW, not approved. | None — status REVIEW, G2 freeze reserved to human. |
| 0.1.1 | 2026-07-11 | First G4 independent-review round, all five dimensions run in parallel against the immutable v0.1.0 candidate: Architecture `BLOCKED` (2 High), Dependency `PASS_WITH_ACTIONS` (1 Medium, 1 Low), Consistency `PASS_WITH_ACTIONS` (3 Medium, 1 Low), Security `FAIL` (1 High, 1 Medium, 1 Low), Performance `PASS_WITH_ACTIONS` (2 Medium, 2 Low, 1 Note). Applied every author-fixable (Medium/Low) finding; left every High finding as an open, human/architecture-authority decision (not resolved by this document). **FIND-ARCH-003/FIND-DEP-001** (merged, Medium): disclosed the previously-undocumented `backend-quality` reader of `state-attendance` — added `edge-quality-reads-attendance` to the Dependencies table and corrected the false "no new edges reflect reality" claim in Proposed Knowledge Deltas; the underlying graph was already correct (added by `SPEC-QUAL-001`'s own dependency review), only this document was stale. **FIND-ARCH-004** (Medium): corrected the false "`FEATURE_*` convention" rollback claim in Rollout and Compatibility (independently verified: zero matches repo-wide) — same falsified claim already recorded for four other modules. **FIND-ARCH-005/FIND-PERF-003** (merged, Medium/Low): detailed the self-reported concurrency gap with the `WorkRequest.version` precedent and added `[OPEN DECISION]` OQ-12. **FIND-DEP-002/FIND-CONS-ATT-002** (merged, Low/Medium): corrected 9 stale `DEPENDENCY_GRAPH.yaml` line citations (drifted when `SPEC-QUAL-001`'s dependency-graph edit inserted 8 lines above them). **FIND-CONS-ATT-001** (Medium): corrected 3 `MODULE_REGISTRY.yaml` citations that pointed at `backend-assignments`'s block instead of `backend-attendance`'s (`:110→:122`, `:114→:126`, `:116→:128`) — the `:116` citation was the literal target line named in this document's own Proposed Knowledge Deltas, so this fix was required before that delta could be safely executed. **FIND-CONS-ATT-003** (Medium): corrected 4 `schema.prisma` citations that drifted +17 lines after `HOTFIX-AUTH-002` inserted the `PasswordResetToken` model earlier in the shared schema file (unrelated to this module's own code, which is unchanged since `cca1d29`). **FIND-CONS-ATT-004** (Low): confirmed the OQ-08 numbering gap is not a dropped item; added a clarifying note rather than renumbering (avoids invalidating existing SIR cross-references). **FIND-SEC-001** (Low): added the security review's independent Low/fail-safe-direction rating to OQ-01. **FIND-SEC-002** (High, not resolved): independently reproduced OQ-02 against live code and rated it High with an explicit `FAIL` gate disposition — recorded inline on the OQ-02 row as `OPEN — BLOCKING (High)`; blocks G2 freeze pending a code fix or an authorized Risk Assessment. **FIND-SEC-003** (Medium, new): audit rows never populate `AuditLog.old_values`/`new_values` — added as new `[OPEN DECISION]` OQ-11 and disclosed in the Observability/audit paragraph. **FIND-ARCH-001** (High, not resolved): independently confirmed no Decision Record or superseded-by-pivot record exists for the OQ-03 cross-owner write anywhere in the repository — recorded inline on OQ-03/RULE-011/Ownership as `OPEN — BLOCKING (architecture)`, matching the identical code's disposition in the sibling `SPEC-JOB-DISPATCH-001` spec. **FIND-ARCH-002** (High, not resolved): independently confirmed the ownership gap (SYNC-001) additionally blocks authorization of the FIND-ARCH-001 Decision Record — recorded inline on the SYNC-001 row. **FIND-PERF-001** (Medium, not resolved beyond existing disclosure): confirmed the no-SLO gap (OQ-10) with no new authority to set one. **FIND-PERF-002** (Medium): detailed the unbounded-`page` / no-`created_at`-index finding and its amplification via OQ-02's missing hotel-scoping, added to Performance budgets/workload. **FIND-PERF-004/FIND-PERF-005** (Low/Note): no spec content change required (monitor-only; no cross-module lock-contention risk found). No REQ/TREQ/RULE/TRULE/MIG-GAP id renumbered; OQ-11/OQ-12 are new, appended (not inserted into the existing OQ-08 gap). | FIND-ARCH-001 (recorded, not resolved), FIND-ARCH-002 (recorded, not resolved), FIND-ARCH-003, FIND-ARCH-004, FIND-ARCH-005, FIND-DEP-001, FIND-DEP-002, FIND-CONS-ATT-001, FIND-CONS-ATT-002, FIND-CONS-ATT-003, FIND-CONS-ATT-004, FIND-SEC-001, FIND-SEC-002 (recorded, not resolved), FIND-SEC-003, FIND-PERF-001 (recorded, not resolved), FIND-PERF-002, FIND-PERF-003, FIND-PERF-004, FIND-PERF-005. | None — status REVIEW, G2 freeze reserved to human; architecture `BLOCKED` and security `FAIL` dispositions remain open pending human/architecture authority (SYNC-001 ownership assignment; OQ-03 Decision Record; OQ-02 fix-or-Risk-Assessment decision). |
| 0.2.0 (forward-note, recorded not versioned) | 2026-07-20 | **Forward-note per `ADR-022`** (Accepted, ratified by merge of PR #166, 2026-07-20 — retirement of `backend-hotel-workers` into Employee Management, `SPEC-EMP-001`/`backend-hr`). This module's `EXPECTED`-attendance-row seed (`OQ-05`/`RULE-011`) and its `checkHotelAccess()`-gated hotel-scoping (`OQ-02`) both currently depend, transitively, on `HotelWorker` ACTIVE-membership — the very authorization primitive `ADR-022` migrates away from in favor of the role×scope JWT model (`TREQ-008`/`REQ-USERS-022..024`). No requirement, rule, migration-gap, or open-decision content in this document is changed by this note: the migration is prerequisite-gated (EMP employment-record build, Hotel-Group model `OD-EMP-05`, role×scope JWT authz), not yet underway, and `HotelWorker`/`backend-hotel-workers` is retained unchanged as an implementation compatibility layer in the interim per `ADR-022`. This note exists so a future correction pass repoints `OQ-02`'s fix path to the JWT-scope model instead of a `checkHotelAccess()` patch, and re-examines `OQ-05`'s seed source once the employment record lands. No version bump — nonsemantic forward-note (`LOOP_CONTROL.md` §7 exemption), mirroring the `SPEC-USERS-001`/`SPEC-AUTH-001` citation-pass precedent. | None — forward-note only, no finding resolved or reopened. | — (nonsemantic annotation; no approver action required; G2 freeze status and all open decisions unaffected). |
| 0.2.1 | 2026-07-28 | **Amended (Correction), per `GD-10`/`ADR-036`** (Platform concurrency / optimistic-locking pattern, Decided via the Governance Resolution workflow). `OQ-12` (check-in/update double-submit race) marked RESOLVED at the governance level — optimistic concurrency adopted as the platform standard; this race MUST be fixed, not accepted as residual risk; the concrete mechanism (version column, transactional row-level lock, or another optimistic-concurrency-consistent approach) is explicitly deferred to implementation, to be verified and recorded when the fix is built, not mandated here. No other requirement, rule, interface, or open decision touched. FROZEN status retained. | `OQ-12` RESOLVED (governance level, `ADR-036`) | Commissioning human (2026-07-28, Governance Resolution workflow, Decision #5) |
