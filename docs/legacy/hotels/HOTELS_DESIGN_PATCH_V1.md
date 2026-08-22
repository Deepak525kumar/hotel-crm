# Hotels Module Design Patch V1

**Patches**: HOTELS_MODULE_DESIGN.md, HOTELS_ENDPOINT_SPEC.md, HOTELS_IMPLEMENTATION_CHECKLIST.md  
**Status**: Approved patch — resolves C1, C3, C4, H2, H3 from HOTELS_DESIGN_REVIEW  
**Date**: 2026-06-02  
**Scope**: Additive only. No existing design decisions are reversed.

---

## Patch C1 — `requireHotelScope()` Middleware Definition

### Location

`requireHotelScope` lives in the **shared CRM middleware**, not inside the Hotels module:

```
backend/src/middleware/
└── requireHotelScope.ts    ← shared across Hotels, Rooms, Tasks, Staffing, HR
```

It is not owned by any single module. All CRM modules that accept a `:hotel_id` route parameter import it from this shared location.

---

### What It Does

`requireHotelScope` is an Express middleware function that:

1. Reads `hotel_id` from `req.params`
2. Queries the database for the hotel record
3. Checks the actor's role and hotel access
4. On success: attaches `req.hotel` for downstream use — no second DB fetch needed in the controller
5. On failure: throws the appropriate error immediately

---

### Request Flow

```
Incoming request: GET /api/v1/crm/hotels/:hotel_id
        │
        ▼
authenticateJWT
  └─ Decodes JWT, attaches req.user (includes user.hotel_ids, user.role)
        │
        ▼
requireRole(['MANAGER', 'ADMIN'])
  └─ Rejects Workers and Checkers with 403 before any DB work
        │
        ▼
requireHotelScope()
  ├─ 1. Reads hotel_id from req.params.hotel_id
  ├─ 2. Queries: db.hotel.findUnique({ where: { id: hotel_id } })
  ├─ 3. If null → throw NotFoundError (404)
  ├─ 4. If role === 'ADMIN' → attach req.hotel, call next()
  ├─ 5. If role === 'MANAGER':
  │      a. Check hotel_id in user.hotel_ids → if not: throw ForbiddenError (403)
  │      b. Check hotel.is_active === true   → if not: throw ForbiddenError (403)
  │      c. Attach req.hotel, call next()
        │
        ▼
Controller
  └─ Reads req.hotel directly — no second findUnique call
```

---

### DB Lookup Behavior

- **Always queries the database.** It does not rely solely on `user.hotel_ids` from the JWT for existence or active-state checks. The JWT tells the middleware which hotels a manager claims access to; the database confirms the hotel exists and is currently active.
- **One query per request** on `:hotel_id` routes. The result is attached to `req.hotel` so controllers and downstream service calls do not repeat the fetch.
- **Query**: `db.hotel.findUnique({ where: { id: hotel_id } })` — selects the full hotel row. No relations loaded at this stage.

---

### Inactive Hotel Behavior

| Actor | Hotel `is_active` | Result |
|-------|-------------------|--------|
| Admin | `true` | ✅ Pass — `req.hotel` attached |
| Admin | `false` | ✅ Pass — `req.hotel` attached (admin sees all) |
| Manager | `true` | ✅ Pass (if hotel_id in hotel_ids) |
| Manager | `false` | ❌ 403 FORBIDDEN — inactive hotel is invisible to manager |

A manager receives 403 for an inactive hotel regardless of whether the hotel_id is in their `hotel_ids`. The error message is identical to a foreign-hotel 403: `"You do not have access to this hotel."` — no information about why access was denied is exposed.

---

### `req.hotel` Attachment

After `requireHotelScope` passes, controllers and services can access the hotel record via `req.hotel` without an additional database query.

`req.hotel` contains the full Prisma `Hotel` object: `id`, `name`, `city`, `country`, `address`, `timezone`, `is_active`, `created_at`, `updated_at`.

The `req` type must be extended in `backend/src/types/express.d.ts`:

```
req.hotel: Hotel   // set by requireHotelScope, available in all downstream handlers
```

---

### Reuse Strategy for Downstream Modules

Every CRM module that uses a `:hotel_id` route parameter imports and applies `requireHotelScope` from the shared middleware location.

| Module | Route pattern | Uses requireHotelScope? | Role guard |
|--------|--------------|------------------------|------------|
| Hotels | `/hotels/:hotel_id` | ✅ | MANAGER, ADMIN |
| Rooms | `/hotels/:hotel_id/rooms` | ✅ | WORKER*, CHECKER*, MANAGER, ADMIN |
| Tasks | `/hotels/:hotel_id/tasks` | ✅ | MANAGER, ADMIN |
| Staffing | `/hotels/:hotel_id/work-requests` | ✅ | MANAGER, ADMIN |
| HR | `/hotels/:hotel_id/contracts` | ✅ | MANAGER, ADMIN |

**Important — Rooms module note**: Per the RBAC matrix, Workers and Checkers can access room-level endpoints for their assigned hotel. The `requireRole` guard before `requireHotelScope` must be set to `['WORKER', 'CHECKER', 'MANAGER', 'ADMIN']` on those specific routes. `requireHotelScope` handles the actual scoping check for all roles identically — the role list passed to `requireRole` is what differs per module.

This means `requireHotelScope` must handle Worker and Checker roles, not only Manager and Admin. When the actor is a Worker or Checker:

- Check `hotel_id` in `user.hotel_ids` → if not: 403
- Check `hotel.is_active === true` → if not: 403
- Attach `req.hotel`, call `next()`

The behavior is identical to the Manager path. The difference is that Workers and Checkers only reach `requireHotelScope` on routes that explicitly allow their role.

---

### Checklist Additions (Phase 0 and Phase 5)

The following tasks must be added to the implementation checklist:

**Phase 0 — Prerequisites:**
- [ ] `requireHotelScope` middleware created at `backend/src/middleware/requireHotelScope.ts`
- [ ] `req.hotel` type extension added to `backend/src/types/express.d.ts`
- [ ] Smoke test: Manager token + valid hotel_id passes middleware and `req.hotel` is populated
- [ ] Smoke test: Manager token + inactive hotel_id returns 403
- [ ] Smoke test: Manager token + foreign hotel_id returns 403
- [ ] Smoke test: Admin token + inactive hotel_id passes and `req.hotel` is populated

**Phase 5 — Routes:**
- [ ] All `/:hotel_id` routes apply `requireHotelScope` after `requireRole`
- [ ] Controllers access `req.hotel` instead of calling `findUnique` again

---

## Patch C3 — Manager Sending `is_active` in Update Payload

### Decision

**Behavior is determined by whether `is_active` is the only field in the payload or mixed with allowed fields.**

---

### Case 1: Mixed Payload — `is_active` with Allowed Fields

**Request:**
```json
PUT /api/v1/crm/hotels/:hotel_id
{
  "name": "Hotel München Mitte Updated",
  "is_active": false
}
```

**Behavior:** `is_active` is silently stripped. The allowed fields are updated normally. A `200` is returned with the updated hotel.

**Rationale:** The manager submitted a legitimate update with one unsupported field mixed in. Rejecting the entire request punishes a valid intent. The silent strip is the correct behavior here because `is_active` has no effect — the hotel state does not change, and the manager has no way to trigger an accidental deactivation regardless.

**Response:** `200` with updated hotel (name changed, `is_active` unchanged in response, which makes the strip self-evident to the client).

---

### Case 2: Payload Contains Only Forbidden Fields

**Request:**
```json
PUT /api/v1/crm/hotels/:hotel_id
{
  "is_active": false
}
```

**Behavior:** After stripping `is_active`, the effective update payload is empty. An empty update is treated as a bad request. Return `403 FORBIDDEN` with error code `FORBIDDEN` and message `"You do not have permission to update this field."`.

**Why 403 and not 400:** The payload is structurally valid (it passes Zod). The problem is not malformed data — it is that the only field the manager sent is one they are not permitted to set. The request is forbidden, not invalid.

---

### Case 3: Payload Contains No Fields At All

**Request:**
```json
PUT /api/v1/crm/hotels/:hotel_id
{}
```

**Behavior:** Zod's `.refine` check ("at least one field must be provided") catches this before the service layer. Return `400 INVALID_REQUEST`. This case is unchanged from the original design.

---

### Service Layer Logic (Described, Not Code)

In the service function `updateHotel(user, hotelId, data)`:

1. If `user.role === 'MANAGER'`: remove `is_active` from the incoming `data` object before building `updateData`
2. After stripping, check if `updateData` is empty
3. If empty (all fields were stripped or none were provided): throw `ForbiddenError` — the manager sent only forbidden fields
4. If not empty: proceed with update and audit log

---

### Zod Schema Clarification

`updateHotelSchema` includes `is_active: z.boolean().optional()` as before. This is intentional — Zod does not enforce role-based field restrictions. Role-based stripping happens in the service layer. The Zod schema's job is structural validation only.

The code comment `// stripped for managers in service layer` in the original design is the correct annotation. Section 2 of the design document ("if a Manager sends `is_active`, return 403") is amended by this patch: 403 is returned only when `is_active` is the entirety of the payload, not when it is mixed with valid fields.

---

### Test Additions

| # | Scenario | Expected |
|---|----------|----------|
| U3a | Manager sends `{ "name": "X", "is_active": false }` | 200, name updated, is_active unchanged |
| U3b | Manager sends `{ "is_active": false }` only | 403 FORBIDDEN |
| U3c | Admin sends `{ "name": "X", "is_active": false }` | 200, both fields updated |
| U3d | Admin sends `{ "is_active": false }` only | 200, hotel deactivated |

---

## Patch C4 — Hotel Creator Tracking (`created_by_admin_id`)

### Decision

Add `created_by_admin_id` to the `Hotel` model in `schema.prisma`.

---

### Schema Change

The following field is added to the `Hotel` model:

```
created_by_admin_id   String?
created_by_admin      User?    @relation("created_hotels", fields: [created_by_admin_id], references: [id], onDelete: SetNull)
```

And on the `User` model, add the back-relation:

```
created_hotels   Hotel[]   @relation("created_hotels")
```

**Field type**: `String?` — nullable. This accommodates:
- Hotels created before this patch is applied (existing records, if any)
- Potential future system-created hotels (seed data, migration-created records)

In practice, all hotels created via the API will have this field populated.

---

### FK Behavior: `onDelete: SetNull`

When the admin user who created a hotel is soft-deleted or hard-deleted, `created_by_admin_id` is set to `null`. The Hotel record is preserved. Attribution is lost at the row level but remains in the `AuditLog` (where `actor_id` also becomes `null` on admin deletion, via its own `SetNull` rule).

**Rationale**: Hotels must not cascade-delete when their creator is removed. Hotels are org-level entities with many dependents. `SetNull` is the correct cascade for attribution fields that should not control lifecycle.

---

### API Behavior

- `POST /hotels` (create): The service layer sets `created_by_admin_id = req.user.id` automatically. This field is **never accepted from the request body** — it is always set server-side.
- `GET /hotels` and `GET /hotels/:id`: `created_by_admin_id` is included in the response object.
- `PUT /hotels/:id`: `created_by_admin_id` is immutable after creation. It is excluded from `updateHotelSchema` and silently ignored if sent.

---

### Audit Implications

The `AuditLog` entry for hotel creation already records `actor_id`. With `created_by_admin_id` on the Hotel row itself, there are now two places recording the creator:

| Location | Survives admin soft-delete? | Survives admin hard-delete? |
|----------|----------------------------|----------------------------|
| `Hotel.created_by_admin_id` | ✅ (SetNull, field becomes null) | ✅ (SetNull) |
| `AuditLog.actor_id` | ✅ (AuditLog has own SetNull) | ✅ (SetNull) |

Neither location guarantees attribution after admin deletion, but both independently record it while the admin exists. This is the correct and expected behavior under the existing schema design.

**No change to audit log structure is required for this patch.** The AuditLog `CREATE` entry already captures `actor_id`. The Hotel row now additionally carries `created_by_admin_id` as a denormalized convenience.

---

### Migration Notes

**This is a nullable column addition — a safe, non-breaking migration.**

- Existing rows (if any) will have `created_by_admin_id = null`
- No data backfill is possible or required — historical creation attribution is not recoverable from existing data
- The migration generates: `ALTER TABLE "Hotel" ADD COLUMN "created_by_admin_id" TEXT REFERENCES "User"("id") ON DELETE SET NULL`
- This migration can run with zero downtime (nullable column addition with no default value does not lock the table)
- After migration, all new hotels created via the API will have `created_by_admin_id` populated

**Checklist addition (Phase 0):**
- [ ] `created_by_admin_id` column added to Hotel model in `schema.prisma`
- [ ] Back-relation `created_hotels` added to User model
- [ ] Migration generated and reviewed: `npx prisma migrate dev --name add_hotel_created_by`
- [ ] Verify existing Hotel rows have `created_by_admin_id = null` after migration

---

## Patch H2 — Hotel Deactivation Child Record Behavior

### Principle

Hotel deactivation is a **soft administrative action**. It changes the hotel's visibility and access state. It does not change the state of any child record. No cascade state changes occur on deactivation.

All child records retain their current state. Historical integrity is preserved. The system does not infer intent from deactivation — it only changes access.

---

### Defined Behavior Per Child Entity

#### Rooms

- **State after deactivation**: Unchanged. Rooms retain their current `status` (clean, dirty, occupied, maintenance).
- **Access after deactivation**: Managers lose access to room endpoints for the deactivated hotel (blocked by `requireHotelScope`). Admins retain full access.
- **Mutability after deactivation**: No new rooms can be created in a deactivated hotel. The Rooms module's `POST /hotels/:hotel_id/rooms` route passes through `requireHotelScope`, which blocks managers on inactive hotels. Admins can still create rooms (this supports reactivation preparation workflows).

#### Active Tasks (`ASSIGNED`, `IN_PROGRESS`)

- **State after deactivation**: Unchanged. Tasks remain in their current status.
- **Worker access**: Workers assigned to tasks in a deactivated hotel retain access to their specific assigned tasks. A worker mid-task (`IN_PROGRESS`) is not blocked from completing it. Task completion is a worker-scoped operation, not hotel-scoped.
- **Manager access**: The managing hotel's managers lose access to task management endpoints for that hotel. They cannot create new tasks, view task lists, or update task status through hotel-scoped routes.
- **Rationale**: Blocking a worker from completing a task they are physically performing is operationally harmful. Workers do not navigate through the hotel list to access their tasks — they navigate through their personal task list, which is not hotel-scoped in the same way.
- **Resolution of orphaned active tasks**: If active tasks remain in a deactivated hotel, they age out naturally. No automated cancellation occurs. If the hotel is later reactivated, those tasks remain accessible.

#### Completed Tasks

- **State after deactivation**: Unchanged. Historical record preserved.
- **Access**: Admins retain full access. Managers lose access via hotel-scoped routes. Quality verification and ratings data are unaffected.

#### Open Work Requests (`OPEN`, `PARTIALLY_FILLED`)

- **State after deactivation**: Remain in their current status. **No automatic cancellation.**
- **Operational impact**: Workers who have been notified of an open work request for a deactivated hotel will still see the notification. The Staffing module must handle deactivated-hotel work requests gracefully (e.g., not surface them in active assignment flows).
- **Manager access**: Managers lose access to staffing endpoints for the deactivated hotel and cannot assign new workers.
- **Known gap**: This creates orphaned open work requests that managers can no longer act on. This is accepted as MVP behavior. Resolution path: admin can reactivate the hotel, the responsible manager cancels the request, then the hotel is deactivated again. A proper "deactivation pre-flight check" is a Phase 2 concern.

#### Filled / Completed Work Requests

- **State after deactivation**: Unchanged. Historical record preserved.

#### Active Worker Assignments (`ASSIGNED`, `IN_PROGRESS`)

- **State after deactivation**: Unchanged. Workers retain their assignment.
- **Worker access**: Same as active tasks — workers can complete their current assignment. The assignment itself is not hotel-scoped from the worker's perspective.

#### Contracts (`draft`, `active`, `signed`)

- **State after deactivation**: Unchanged. Contracts in any status are not affected.
- **Manager access**: Managers lose access to HR contract endpoints for the deactivated hotel. A `draft` contract a manager was working on becomes inaccessible to them until the hotel is reactivated.
- **Worker access**: Workers retain read-only access to their own contracts regardless of hotel status (worker-scoped, not hotel-scoped).
- **Known gap**: A draft contract in progress becomes manager-inaccessible on deactivation. This is accepted. If a hotel deactivation is imminent, the admin should communicate to the manager to finalize or discard drafts first.

#### Payroll Records

- **State after deactivation**: Unchanged. Payroll in any status (`draft`, `calculated`, `approved`, `paid`) is unaffected.
- **Manager access**: Managers lose access to HR payroll endpoints for the deactivated hotel.
- **Worker access**: Workers retain read-only access to their own payroll records (worker-scoped).
- **Compliance note**: Payroll records are never deletable and must remain accessible to admins regardless of hotel state. This is unaffected by deactivation.

#### Worker Documents

- **State after deactivation**: Unchanged.
- **Access**: Admins retain full access. Managers lose access. Workers retain access to their own documents.

#### Daily Operations (`DailyOperation` records)

- **State after deactivation**: Unchanged. Historical records preserved.
- **Active operations** (`ASSIGNED`, `IN_PROGRESS`): Workers with an active daily operation retain access to complete it. Same rationale as active tasks.

---

### Summary Table

| Child Entity | State Change on Deactivation | Manager Access | Worker Access | Admin Access |
|--------------|------------------------------|----------------|---------------|--------------|
| Rooms | None | ❌ Blocked | ❌ N/A | ✅ |
| Active Tasks | None | ❌ Blocked | ✅ Own tasks | ✅ |
| Completed Tasks | None | ❌ Blocked | ✅ Own tasks | ✅ |
| Open Work Requests | None (orphaned) | ❌ Blocked | ❌ N/A | ✅ |
| Active Assignments | None | ❌ Blocked | ✅ Own assignment | ✅ |
| Draft Contracts | None (inaccessible to manager) | ❌ Blocked | ✅ Own contracts | ✅ |
| Active Contracts | None | ❌ Blocked | ✅ Own contracts | ✅ |
| Payroll Records | None | ❌ Blocked | ✅ Own payroll | ✅ |
| Worker Documents | None | ❌ Blocked | ✅ Own documents | ✅ |

---

### Reactivation Behavior

All deactivation effects are reversed on reactivation (`is_active` set back to `true`):

- Managers with the hotel in their `hotel_ids` regain access immediately (on their next request — subject to JWT staleness window per review finding C2, which remains an accepted known risk)
- All child records are accessible again in their preserved state
- Open work requests become actionable again
- No state reconstruction is required — nothing changed, access is simply restored

---

### Test Additions

| # | Scenario | Expected |
|---|----------|----------|
| D1 | Admin deactivates hotel with active tasks — tasks remain IN_PROGRESS | DB assertion, task status unchanged |
| D2 | Worker with active task in deactivated hotel completes task | 200, task marked COMPLETED |
| D3 | Manager attempts to list tasks in deactivated hotel | 403 via requireHotelScope |
| D4 | Admin deactivates hotel with OPEN work request — request remains OPEN | DB assertion, status unchanged |
| D5 | Manager attempts to assign worker to OPEN request in deactivated hotel | 403 via requireHotelScope |
| D6 | Worker views own contract from deactivated hotel | 200 (worker-scoped, not hotel-scoped) |
| D7 | Admin reactivates hotel — manager immediately regains access | 200 on next request |

---

## Patch H3 — `User.hotel_ids` GIN Index Strategy

### Decision

Add a GIN index on `User.hotel_ids` in `schema.prisma`.

---

### Index Definition

The following index is added to the `User` model:

```
@@index([hotel_ids], type: Gin)
```

This enables efficient execution of the reverse lookup query pattern:

```
WHERE 'hotel-id' = ANY(hotel_ids)
```

Without this index, that query performs a sequential scan of the entire User table. With a GIN index on an array column, PostgreSQL can use a bitmap index scan — dramatically faster as the User table grows.

---

### Why This Index Is Needed Now

The forward query — "which hotels does manager X manage?" — already performs well: it uses the Hotel table's primary key index with a bounded `IN (hotel_ids)` clause. The manager's `hotel_ids` array bounds the query naturally.

The reverse query — "which managers manage hotel X?" — has no natural bound. It must scan every user to check if hotel X appears in their `hotel_ids` array. This reverse lookup is required by:

- **Deactivation notifications**: When an admin deactivates a hotel, the system needs to identify which managers are affected
- **Admin dashboards**: Listing managers assigned to a hotel
- **Staffing module**: Finding managers responsible for approvals at a given hotel
- **Future HR escalations**: Routing HR actions to the correct manager when the primary manager is unavailable

These queries do not exist in the Hotels module today, but they will be written when downstream modules are built. Adding the index before data exists costs nothing and prevents a future slow-query incident.

---

### Query Patterns This Index Supports

| Query pattern | Index used |
|---------------|------------|
| `WHERE id IN (hotel_ids_array)` — forward lookup | Hotel PK index (unchanged) |
| `WHERE 'hotel-id' = ANY(hotel_ids)` — reverse lookup | GIN index on hotel_ids ✅ |
| `WHERE hotel_ids @> ARRAY['hotel-id']` — contains operator | GIN index on hotel_ids ✅ |
| `WHERE hotel_ids = '{}'` — empty array | GIN index on hotel_ids ✅ |

The Staffing module's `available-workers` query already uses `hotel_ids @> ARRAY[?]` per `DATABASE_RELATIONSHIP_DIAGRAM.md`. That query currently has no GIN index to use. This patch fixes that.

---

### Migration Notes

**This is a new index on an existing column — a safe, non-breaking migration.**

- Generates: `CREATE INDEX ON "User" USING GIN ("hotel_ids")`
- For a table with thousands of rows, GIN index creation requires a full table scan to build. In production, use `CREATE INDEX CONCURRENTLY` to avoid table locking. Prisma does not generate `CONCURRENTLY` by default — the migration SQL must be reviewed and the statement amended before running against a production database.
- At MVP scale (< 1,000 users), this migration is instantaneous and the `CONCURRENTLY` precaution is theoretical. It is still good practice to note it.
- This migration can be bundled with the `created_by_admin_id` column migration (Patch C4) into a single migration file.

**Checklist addition (Phase 0):**
- [ ] GIN index added to User model in `schema.prisma`: `@@index([hotel_ids], type: Gin)`
- [ ] Migration generated and reviewed: `npx prisma migrate dev --name add_hotel_ids_gin_index_and_created_by`
- [ ] Confirm via `EXPLAIN ANALYZE` that reverse lookup `WHERE 'test-id' = ANY(hotel_ids)` uses GIN index after migration
- [ ] Note for production deployment: amend generated SQL to use `CREATE INDEX CONCURRENTLY` if user table has significant data

---

## Patch Summary

| Issue | Resolution | Schema change | Migration required | Checklist impact |
|-------|------------|---------------|--------------------|------------------|
| C1 — `requireHotelScope` undefined | Defined: shared middleware, DB-queried, attaches `req.hotel`, reuse strategy for all modules | No | No | Phase 0 + Phase 5 additions |
| C3 — Manager `is_active` behavior | Strip silently on mixed payload → 200; only `is_active` → 403 | No | No | Test additions U3a–U3d |
| C4 — No hotel creator tracking | `created_by_admin_id String?` added to Hotel, `SetNull` on admin delete | Yes | Yes | Phase 0 migration task |
| H2 — Deactivation child behavior | Defined per entity: no cascade state change, access blocked via scope, orphaned open requests accepted | No | No | Test additions D1–D7 |
| H3 — No GIN index on hotel_ids | `@@index([hotel_ids], type: Gin)` added to User model | Yes | Yes (bundle with C4) | Phase 0 migration task |

---

## Implementation Order

These patches introduce two dependencies that affect the implementation sequence:

1. **Schema migrations must run before any service code is written.** Both the `created_by_admin_id` column (C4) and the GIN index (H3) are schema-level changes. Bundle them into a single migration and run it first. Attempting to implement the Hotels service layer against an outdated schema will require rollback.

2. **`requireHotelScope` must be built and smoke-tested before Phase 1 validation work begins.** It is listed as a Phase 0 prerequisite. If it is built concurrently with the Hotels service layer, there is no stable foundation to test against.

3. **C3 behavior (strip vs. 403) is a service-layer decision with no schema dependency.** It can be implemented in Phase 3 (service layer) independently.
