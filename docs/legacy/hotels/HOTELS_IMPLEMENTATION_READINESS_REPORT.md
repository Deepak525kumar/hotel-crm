# Hotels Implementation Readiness Report

**Reviewer**: Principal Architect  
**Date**: 2026-06-03  
**Documents reviewed**:
- HOTELS_MODULE_DESIGN.md
- HOTELS_ENDPOINT_SPEC.md
- HOTELS_IMPLEMENTATION_CHECKLIST.md
- HOTELS_DESIGN_PATCH_V1.md

**Scope**: Final readiness gate before handoff to implementation engineer.

---

# Resolved Findings Verification

## C1 — `requireHotelScope()` Middleware Definition

**Status: RESOLVED with a residual trap (see Implementation Traps #1)**

The patch fully defines the middleware: location, request flow, DB lookup behavior, inactive hotel table, `req.hotel` attachment, Worker/Checker handling, and downstream module reuse strategy. All required elements are present.

**Residual trap**: The checklist Phase 3 service layer (`getHotel`, `updateHotel`) still instructs the engineer to call `db.hotel.findUnique()` directly — duplicating the DB fetch that `requireHotelScope` already performs. The patch adds Phase 0 and Phase 5 checklist items but does not update Phase 3. An engineer following the checklist top-to-bottom will implement a double DB fetch on every hotel route. Flagged in Implementation Traps.

**Residual trap**: The checklist Phase 5 routes do not show `requireHotelScope` in the wiring for `GET /:hotel_id` or `PUT /:hotel_id`. The patch adds a note — but the original route definitions are not crossed out. An engineer reading Phase 5 literally will wire routes without the middleware. Flagged in Implementation Traps.

---

## C3 — Manager Sending `is_active`

**Status: RESOLVED in the patch — NOT resolved in the original documents**

The patch clearly defines three cases and is internally consistent. The decision is sound.

**Critical contradiction**: HOTELS_ENDPOINT_SPEC.md was not updated. Two specific locations directly contradict the patch:

1. The field constraints table for `PUT /hotels/:hotel_id`:
   > `is_active` | boolean | ✅ | ❌ (403) | Deactivate/reactivate

   The `❌ (403)` annotation is unconditional. Per the patch, a mixed payload returns 200, not 403. An engineer building to the spec table will implement the wrong behavior for Case 1.

2. The error responses table for `PUT /hotels/:hotel_id`:
   > 403 | `FORBIDDEN` | Not manager's hotel; **manager sending is_active**

   The phrase "manager sending is_active" implies any payload containing `is_active` from a manager triggers 403. The patch restricts this to Case 2 only (is_active as the sole field).

**Critical contradiction**: HOTELS_IMPLEMENTATION_CHECKLIST.md Phase 3 `updateHotel` still contains:
> `- [ ] If Manager and data.is_active !== undefined: throw ForbiddenError`

Following this checklist item verbatim will fail test U3a (manager sends mixed payload with name + is_active → expected 200, actual 403). The patch supersedes this line but does not strike it.

An engineer handed the checklist without explicit instruction to prioritize the patch will implement the old behavior. This is the highest-risk contradiction in the document set.

---

## C4 — Hotel Creator Tracking (`created_by_admin_id`)

**Status: RESOLVED in schema definition — NOT propagated to DTO, response examples, or service task**

The schema change, FK behavior, audit implications, and migration notes are well-defined.

**Three propagation gaps**:

1. **DTO missing field**: Checklist Phase 2 `HotelResponse` DTO lists:
   `id, name, city, country, address, timezone, is_active, created_at, updated_at`
   `created_by_admin_id` is absent. An engineer building from the checklist will omit it from all responses.

2. **Response examples stale**: All example JSON responses in HOTELS_ENDPOINT_SPEC.md (GET list, GET single, POST 201) do not include `created_by_admin_id`. The patch states this field is included in GET responses. The spec examples are the ground truth an engineer codes against — they are wrong.

3. **Service create task incomplete**: Checklist Phase 3 `createHotel` says:
   > `- [ ] db.hotel.create({ data })`
   
   The `data` object spread from the validated request body will not contain `created_by_admin_id` (the patch explicitly states it must never be accepted from the request body). The field must be injected server-side by the service. This injection step is not in the checklist. An engineer will create hotels with `created_by_admin_id = null` for all API-created records.

---

## H2 — Hotel Deactivation Child Record Behavior

**Status: RESOLVED — well-defined and internally consistent**

All child entity types are covered. The no-cascade principle is clearly stated. Known gaps (orphaned open work requests, inaccessible draft contracts) are acknowledged explicitly. Reactivation behavior is defined.

The patch's deactivation tests (D1–D7) are in the patch document but are not listed in the checklist Phase 6. An engineer building only from the checklist will not see them. Flagged in Test Coverage Review.

**One scope ambiguity**: Tests D2 ("Worker completes task in deactivated hotel") and D6 ("Worker views own contract in deactivated hotel") cannot be run as Hotels module tests — they require the Tasks and HR modules to be implemented. The patch places them in the Hotels section without noting this dependency. The engineer will either skip them or discover the dependency mid-sprint.

---

## H3 — `User.hotel_ids` GIN Index Strategy

**Status: RESOLVED in the patch — CONTRADICTED by the checklist header**

The GIN index is correctly specified. The migration bundling with C4 is sensible. The `CREATE INDEX CONCURRENTLY` production note is appropriately cautious.

**Critical contradiction**: HOTELS_IMPLEMENTATION_CHECKLIST.md header states:
> `**Schema**: Hotel model in backend/prisma/schema.prisma — **already defined, no migration needed**`

This is now factually wrong. Two schema changes require migrations (C4 column, H3 index). An engineer reading the checklist header will proceed to Phase 1 without running migrations. The Prisma client will be out of sync with the schema. TypeScript will compile but runtime DB calls will fail or miss the index entirely.

---

# Remaining Risks

## R1 — Worker `hotel_ids` population is undefined

The patch defines that `requireHotelScope` applies to Workers and Checkers on Rooms module routes, using the `user.hotel_ids` check identically to the Manager path. However, `User.hotel_ids` is documented in the schema with the comment: `// Array of hotel IDs manager has access to`.

No document specifies who populates a Worker's `hotel_ids`, when it is populated, or whether it is expected to be populated at all. If Workers have empty `hotel_ids` by default, `requireHotelScope` will return 403 for all Worker room requests — blocking an access the RBAC matrix explicitly grants. This is not a Hotels module bug, but the Hotels module defines the middleware that the Rooms module will depend on, and the gap originates here.

**Accepted risk?**: Not stated anywhere. Requires explicit decision before the Rooms module is built.

---

## R2 — `total` in pagination response is unimplemented

The `GET /hotels` response example includes `"total": 3`. The Prisma query in Section 9 uses `take: limit + 1` to detect `has_more` — this does not produce a count. A separate `db.hotel.count({ where: ... })` query is needed for `total`, using the same WHERE clause as the fetch.

No checklist item, no query specification, no mention of how `total` is computed exists anywhere in the four documents. An engineer will either omit `total` (breaking the API contract), compute it incorrectly, or add a COUNT query with no performance guidance. At MVP scale this is harmless, but the field is in the contract and must be implemented somehow.

---

## R3 — Invalid cursor handling is unspecified

The `cursor` parameter accepts any string. If an expired, deleted, or malformed cursor ID is passed, Prisma's cursor query will throw a `P2025` error (record not found for cursor). This error is not mapped to a user-facing error code anywhere in the design. The global error handler must catch it — but whether it should return 400 (bad cursor), 200 with empty results, or fall back to a first-page response is not stated.

---

## R4 — `validateRequest(schema)` middleware vs. parse-in-controller inconsistency

The HOTELS_ENDPOINT_SPEC.md middleware chain shows `validateRequest(schema)` as a distinct middleware step. The checklist Phase 4 controller tasks say "Parse query with `listHotelsQuerySchema`" — validation inside the controller. These are different implementation patterns. If the engineer follows the spec, they build a generic `validateRequest` middleware (which doesn't exist yet in prerequisites). If they follow the checklist, they parse in the controller. The patterns produce the same validation outcome but different code structure.

---

## R5 — HR and Staffing module routes in reuse table don't match API_STANDARDS.md

The patch's `requireHotelScope` reuse table shows:
- `HR: /hotels/:hotel_id/contracts`
- `Staffing: /hotels/:hotel_id/work-requests`

But API_STANDARDS.md defines these modules at flat paths:
- `GET /api/v1/hr/contracts`
- `POST /api/v1/staffing/work-requests`

These are not hotel-nested routes. If the HR and Staffing modules implement flat paths (per API_STANDARDS.md), `requireHotelScope` does not apply to them at the route level. Hotel scoping for those modules is enforced differently — via `user.hotel_ids` checks inside the service layer, not via route-level middleware. The reuse table in the patch overstates where `requireHotelScope` will be wired.

This does not block the Hotels module. It creates a misleading expectation for the HR and Staffing module engineers who read the patch.

---

# Implementation Traps

These are specific failure modes that will produce bugs or wasted work if the engineer is not warned in advance.

---

## Trap 1 — Double `findUnique` on every hotel route (HIGH RISK)

The patch defines `requireHotelScope` as performing `db.hotel.findUnique()` and attaching `req.hotel`. The checklist Phase 3 `getHotel` service function independently calls `db.hotel.findUnique()` again. The checklist Phase 3 `updateHotel` calls `getHotel(user, hotelId)` — a third hit.

On a `PUT /hotels/:hotel_id`, the sequence will be:
1. `requireHotelScope` → `findUnique` → attaches `req.hotel` *(correct)*
2. `updateHotel` calls `getHotel` → `findUnique` *(redundant)*
3. `getHotel` runs scope checks again *(redundant)*

The engineer must be explicitly told: **Phase 3 service functions for hotel routes should read `req.hotel` passed in from the controller, not make their own `findUnique` calls.** The service function signatures and the checklist tasks need to reflect this, but they don't.

---

## Trap 2 — Checklist Phase 3 `updateHotel` implements old `is_active` behavior (HIGH RISK)

This is the most dangerous single line in the checklist:
> `- [ ] If Manager and data.is_active !== undefined: throw ForbiddenError`

An engineer checks this box and moves on. Test U3a ("Manager sends mixed payload → 200") will fail. The engineer will investigate and may conclude U3a is wrong, not the implementation — especially since HOTELS_ENDPOINT_SPEC.md's error table also says 403.

The patch must be treated as authoritative over this checklist item. This must be communicated explicitly to the implementing engineer before they start Phase 3.

---

## Trap 3 — `createHotel` service omits `created_by_admin_id` injection

The checklist Phase 3 `createHotel` task says `db.hotel.create({ data })` where `data` comes from the validated request body. `created_by_admin_id` is never in the request body (correctly). It must be injected as `req.user.id` by the service. The checklist doesn't mention this. Every hotel created via the API will have `created_by_admin_id = null` until someone notices and investigates.

---

## Trap 4 — Checklist header says "no migration needed"

An engineer who reads the checklist header and proceeds directly to Phase 1 (validation layer) will write Zod schemas against the current `schema.prisma`. The schema is missing `Hotel.created_by_admin_id` and `User.@@index([hotel_ids], type: Gin)`. When they reach Phase 3 and try to use `created_by_admin_id`, Prisma TypeScript types won't have it — a confusing type error with a non-obvious root cause.

**The first thing the engineer must do is run the schema migration.** The checklist header must not be taken at face value.

---

## Trap 5 — Phase 5 routes don't show `requireHotelScope` in wiring

Phase 5 route wiring:
> `GET /:hotel_id → authenticateJWT → requireRole(['MANAGER','ADMIN']) → getHotel`

The patch adds a note: "All `/:hotel_id` routes apply `requireHotelScope` after `requireRole`." But the original route lines remain as written above — without `requireHotelScope` in the chain. An engineer who ticks off the route tasks from the checklist without cross-referencing the patch will ship routes without the scope middleware. Hotel isolation will be completely broken: any authenticated manager will be able to read any hotel.

---

## Trap 6 — AuditLog for `createHotel` has no transaction wrapper

The checklist Phase 3 `createHotel` lists two sequential steps:
1. `db.hotel.create({ data })`
2. Write `AuditLog` entry

These are not wrapped in a transaction. `updateHotel` correctly uses `db.$transaction`. If the audit log insert fails after hotel creation, the hotel exists in the database with no audit record. This is inconsistent behavior: updates are atomic with their audit log; creates are not. For a non-GDPR entity this is lower risk than for payroll, but it is an inconsistency that will puzzle future engineers.

---

## Trap 7 — Zod `refine` on `updateHotelSchema` will pass for `{ "is_active": false }` payload

The refine condition is `Object.keys(data).length > 0`. When a manager sends `{ "is_active": false }`, Zod sees one key and the refine passes. The 403 comes from the service layer after stripping. The `400 INVALID_REQUEST` listed in the error table for `PUT` ("Validation fails or **no fields provided**") will NOT fire for this case — it will be a 403. This is correct per the patch but may surprise an engineer who expects Zod to catch the empty-after-stripping case.

---

# Migration Risks

## MR1 — Checklist header contradicts migration requirement (CRITICAL)

Already flagged. The header "no migration needed" is wrong. This must be corrected or prefixed with a warning before handoff.

## MR2 — `created_by_admin_id` migration touches the User model (Auth module boundary)

The patch's C4 migration requires adding a back-relation (`created_hotels Hotel[]`) to the `User` model. The `User` model is defined and owned by the Auth module. The Hotels module's migration will modify the Auth module's primary model. In a team environment, this creates a merge conflict risk if the Auth module is still being actively developed.

**Recommended action before migration**: Confirm the Auth module's `User` model is in a stable, merged state. Coordinate with the Auth module engineer before running `prisma migrate dev`.

## MR3 — GIN index syntax validation needed for installed Prisma version

The patch specifies `@@index([hotel_ids], type: Gin)` for the User model. Prisma's support for GIN index type on array columns was introduced in Prisma 4.x. If the installed Prisma version is earlier, the migration will fail with an unsupported index type error. The checklist does not include a Prisma version check.

**Recommended action**: Verify `prisma --version` before migration. If below 4.0, GIN index must be added via a raw SQL migration rather than the `@@index` syntax.

## MR4 — Migration bundling means one failure rolls back both changes

The patch recommends bundling C4 (column) and H3 (index) into a single migration. This is efficient but means a failure in either (unlikely as both are simple DDL changes) rolls back both. Given the trivial nature of both changes, this is a low-risk trade-off, but the engineer should be aware.

## MR5 — `CONCURRENTLY` note has no enforcement mechanism

The patch notes that production deployment of the GIN index should use `CREATE INDEX CONCURRENTLY`. Prisma does not generate this automatically. The note exists in the patch but there is no checklist item to inspect the generated migration SQL and amend it before production deployment. If the engineer runs `prisma migrate deploy` on a production database with significant User data without this amendment, it will take a table-level lock for the duration of the index build.

**At MVP scale (< 1,000 users)**: Lock duration is under 1 second. Acceptable risk.  
**If any data exists at launch**: Add an explicit checklist item to review migration SQL before production deployment.

---

# Cross-Module Readiness

## Rooms Module

**Not blocked, with one unresolved prerequisite.**

The Hotels module correctly defers room endpoints to the Rooms module. `requireHotelScope` is defined and handles all roles including Worker and Checker. Room access for Workers and Checkers is preserved (403 in Hotels, not blocked at the middleware level).

**Unresolved prerequisite (R1)**: The Rooms module cannot be designed until the Worker `hotel_ids` population question is answered. If Workers have empty `hotel_ids`, `requireHotelScope` will block them from rooms — contradicting the RBAC matrix. This decision does not belong to the Hotels module, but the Hotels module's middleware is the mechanism that enforces it. The Rooms module engineer needs this question answered before implementing Worker-accessible room routes.

**Admin room creation in deactivated hotel**: Patch H2 permits this. `requireHotelScope` passes for admins on inactive hotels. The Rooms module inherits this behavior automatically — no special handling needed.

## Tasks Module

**Not blocked.**

Task completion for Workers is not hotel-scoped at the route level (`PUT /tasks/:task-id/complete` — no hotel_id in path). Patch H2's decision to allow Workers to complete tasks in deactivated hotels is consistent with the current Task routing design. No Hotels module decision creates a conflict for the Tasks module.

The Tasks module must independently validate that `hotel_id` and `room_id` supplied at task creation reference active, accessible hotels and rooms. This validation is a Tasks module concern. The Hotels module provides `requireHotelScope` for hotel-nested task routes (`POST /hotels/:hotel_id/tasks`) — which will naturally enforce hotel access for task creation.

## HR Module

**Not blocked — but the patch's reuse table is misleading.**

HR endpoints (`/api/v1/hr/contracts`, `/api/v1/hr/payroll`) are flat-path, not hotel-nested. `requireHotelScope` as a route-level middleware does not apply to the HR module per the current API_STANDARDS.md path design. Hotel scoping in HR is enforced inside service functions via `user.hotel_ids` checks.

The patch's reuse table listing `HR: /hotels/:hotel_id/contracts` may cause the HR module engineer to incorrectly nest HR routes under hotels. This would be an API contract change with significant downstream impact. The HR module engineer must be directed to API_STANDARDS.md as the authoritative route design, not the patch's reuse table.

Patch H2's deactivation behavior for contracts and payroll is well-defined. Workers retain read access to their own records. Manager access is blocked. Compliance access for admins is unaffected. The HR module can be designed against these rules without ambiguity.

## Staffing Module

**Not blocked — same misleading reuse table caveat as HR.**

Staffing endpoints are flat-path per API_STANDARDS.md, not hotel-nested. The same correction applies: the patch's reuse table shows `/hotels/:hotel_id/work-requests` but the actual path is `/api/v1/staffing/work-requests`. Staffing hotel scoping is enforced via service-layer `hotel_ids` checks.

The GIN index (H3) directly benefits the Staffing module's `available-workers` query (`hotel_ids @> ARRAY[?]`). This query currently has no index. The Hotels module migration delivers this improvement. The Staffing module benefits without any changes of its own.

Orphaned open work requests on hotel deactivation are acknowledged as a known gap in Patch H2. The Staffing module engineer must be aware that they cannot assume hotel.is_active when fetching work requests by hotel_id — the hotel may have been deactivated after the request was created.

---

# Test Coverage Review

## Missing from Checklist — New test cases required

The following scenarios are not in the checklist integration tests and are not covered by any existing test label. They are not in the patch's test additions either.

| # | Scenario | Source of gap |
|---|----------|---------------|
| N1 | Checker token on `GET /hotels` → 403 | A2 only covers Worker; Checker is a distinct role |
| N2 | `created_by_admin_id` present in `GET /hotels` response | C4 field not in DTO |
| N3 | `created_by_admin_id` present in `GET /hotels/:id` response | C4 field not in DTO |
| N4 | `created_by_admin_id` populated with admin's user ID after `POST /hotels` | C4 server-side injection |
| N5 | `created_by_admin_id` not accepted in `POST /hotels` request body | C4 immutability |
| N6 | `created_by_admin_id` not changed by `PUT /hotels/:id` | C4 immutability |
| N7 | `GET /hotels?cursor=nonexistent-id` → defined behavior (not 500) | R3 cursor validation |
| N8 | `GET /hotels` response `total` count matches actual hotel count | R2 COUNT query |
| N9 | `GET /hotels?limit=20&cursor=last-hotel` returns empty with `has_more: false` | Pagination edge case |
| N10 | `DELETE /hotels/:hotel_id` with real existing hotel_id → 405 (not 403, not 404) | Existing I1 is generic |
| N11 | Concurrent `PUT /hotels/:id` from two admins — final state is one of the two valid states | Concurrency |
| N12 | `GET /hotels?is_active=false&country=Germany` as manager → returns active hotels only (both filters ignored) | H6 silent ignore |

## Patch tests not yet in checklist

The following test IDs exist in the patch but are not listed in the checklist Phase 6 integration tests. They will not be run unless the engineer reads both documents:

| Patch test | Description | Risk if missing |
|------------|-------------|-----------------|
| U3a | Manager: mixed payload with is_active → 200 | C3 bug undetected |
| U3b | Manager: only is_active → 403 | C3 bug undetected |
| U3c | Admin: mixed payload with is_active → 200, both fields updated | Regression risk |
| U3d | Admin: only is_active → 200, hotel deactivated | C3 bug undetected |
| D1 | Admin deactivates hotel, active tasks remain IN_PROGRESS | H2 assumption unverified |
| D2 | Worker completes task in deactivated hotel | H2 assumption unverified — needs Tasks module |
| D3 | Manager lists tasks in deactivated hotel → 403 | H2 assumption unverified — needs Tasks module |
| D4 | Admin deactivates hotel with OPEN work request, request remains OPEN | H2 assumption unverified — needs Staffing module |
| D5 | Manager assigns worker to OPEN request in deactivated hotel → 403 | H2 assumption unverified — needs Staffing module |
| D6 | Worker views own contract from deactivated hotel → 200 | H2 assumption unverified — needs HR module |
| D7 | Admin reactivates hotel, manager regains access | Full lifecycle verification |

**Note**: D2, D3, D4, D5, D6 cannot be executed as Hotels module tests. They are cross-module integration tests and belong in a separate test suite created when the respective downstream module is implemented. The engineer must not block Hotels module delivery waiting for these tests.

---

# Final Recommendation

## APPROVED WITH CONDITIONS

The Hotels module design is architecturally sound. The five reviewed findings (C1, C3, C4, H2, H3) are genuinely resolved at the decision level. The design decisions themselves are correct and defensible. The module can be implemented.

However, the implementation engineer will produce bugs in at least three areas if handed the documents as-is, because the patch's decisions are not fully reflected in the original checklist and endpoint spec. These are documentation sync gaps, not design flaws — but they are specific enough and high-risk enough to require remediation before handoff.

---

## Conditions for Approval

The following four conditions must be met before handing the documents to the implementing engineer. None require redesign work.

---

### Condition 1 — Deliver a one-page "Patch Override Sheet" with the engineer handoff package

The engineer must be explicitly told, in writing, that the patch supersedes the following specific items in the original documents:

| Original document | Item | Superseded by |
|-------------------|------|---------------|
| HOTELS_IMPLEMENTATION_CHECKLIST.md — header | "no migration needed" | Patch H3 + C4: two migrations required, run first |
| HOTELS_IMPLEMENTATION_CHECKLIST.md — Phase 3 updateHotel | `If Manager and data.is_active !== undefined: throw ForbiddenError` | Patch C3: only throw if is_active is the only field |
| HOTELS_IMPLEMENTATION_CHECKLIST.md — Phase 3 getHotel | `db.hotel.findUnique()` + scope check | Patch C1: read req.hotel from middleware; do not fetch again |
| HOTELS_IMPLEMENTATION_CHECKLIST.md — Phase 2 HotelResponse DTO | Field list | Add `created_by_admin_id: string \| null` |
| HOTELS_ENDPOINT_SPEC.md — PUT field constraints | `is_active ❌ (403)` for manager | Patch C3: 403 only when sole field |
| HOTELS_ENDPOINT_SPEC.md — PUT error table | "manager sending is_active" → 403 | Patch C3: mixed payload → 200 |
| HOTELS_ENDPOINT_SPEC.md — all GET/POST response examples | Hotel response JSON | Add `created_by_admin_id` field |

Without this sheet, the engineer will encounter contradictions and resolve them in favor of the checklist (the more detailed document) — which is the wrong choice in every case.

---

### Condition 2 — Run schema migrations before any implementation begins

Both migrations must be applied and verified before Phase 1 (validation layer) work starts:

1. `Hotel.created_by_admin_id` nullable column with `SetNull` FK
2. `User.@@index([hotel_ids], type: Gin)` GIN index

Verify Prisma version supports `type: Gin` syntax before generating. Coordinate with the Auth module engineer before modifying the User model.

---

### Condition 3 — Build and smoke-test `requireHotelScope` as Phase 0, not in parallel with hotel routes

`requireHotelScope` is the foundational primitive for every hotel-scoped route. It must be built, tested in isolation (the four smoke tests defined in the patch), and confirmed working before Phase 1 begins. If it is built alongside the Hotels service layer, a bug in the middleware will produce misleading failures across all route tests with no clear root cause.

---

### Condition 4 — Explicitly scope the D-series deactivation tests as cross-module

Tests D2, D3, D4, D5, D6 from the patch require the Tasks, Staffing, and HR modules to be implemented. The engineer must not treat these as Hotels module deliverables. Hotels module delivery is complete when tests A1–A4, L1–L10, G1–G7, C1–C9, U1–U12, U3a–U3d, D1, D7, and N1–N10 (above) pass. The remaining D-series tests belong to downstream module test suites.

---

## Known Risks Accepted for MVP

The following risks from the review are accepted, documented, and not blocking:

| Risk | Accepted trade-off |
|------|--------------------|
| JWT staleness (up to 1-hour revocation window) | 1-hour TTL is the system design. Accepted as-is. |
| No `deactivated_at` timestamp | `updated_at` proxies it. Audit log records it. Acceptable for Phase 1. |
| Orphaned open work requests on deactivation | Manual resolution path documented in patch. Phase 2 concern. |
| No duplicate hotel name validation | MVP has 1–5 hotels. Admin creates manually. Risk is negligible. |
| `total` pagination count requires COUNT query | Must be implemented — not yet specified. Condition N8 must be tested. |
| HR and Staffing reuse table in patch is misleading | Downstream engineers must be directed to API_STANDARDS.md for route design. |
