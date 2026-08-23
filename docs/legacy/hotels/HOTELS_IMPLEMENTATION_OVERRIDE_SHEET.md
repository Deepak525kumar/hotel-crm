# Hotels Implementation Override Sheet

**Read this before opening any other Hotels document.**

This sheet lists every place where HOTELS_DESIGN_PATCH_V1.md supersedes the original design documents. Where a conflict exists between the patch and an original document, **the patch wins**.

---

## Before You Write Any Code

Run migrations first. The checklist header says "no migration needed" — this is wrong.

Two schema changes are required:

1. `Hotel.created_by_admin_id` — nullable FK column with `onDelete: SetNull`
2. `User.@@index([hotel_ids], type: Gin)` — GIN index on the hotel_ids array

Apply both changes to `schema.prisma` and run a single migration before starting Phase 1:

```
npx prisma migrate dev --name add_hotel_created_by_and_gin_index
```

Verify Prisma version supports `type: Gin` syntax before generating. If below Prisma 4.x, the GIN index must be added via raw SQL in the migration file.

Do not proceed to Phase 1 until `prisma generate` completes without errors and the Prisma client reflects both changes.

---

## Before You Build Routes

Build and smoke-test `requireHotelScope` as a Phase 0 deliverable — not in parallel with hotel routes.

Location: `backend/src/middleware/requireHotelScope.ts`

The four smoke tests that must pass before Phase 1 begins:

| Test | Expected |
|------|----------|
| Manager token + valid active hotel_id | Passes, `req.hotel` populated |
| Manager token + inactive hotel_id | 403 |
| Manager token + hotel_id not in `user.hotel_ids` | 403 |
| Admin token + inactive hotel_id | Passes, `req.hotel` populated |

---

## Overrides — Read These Before Implementing Each Phase

---

### Phase 2 — Types (`hotels/types.ts`)

**Original checklist** `HotelResponse` DTO field list:
> id, name, city, country, address, timezone, is_active, created_at, updated_at

**Override**: Add `created_by_admin_id: string | null` to the DTO.

Every GET response — list and single — must include this field. The response examples in HOTELS_ENDPOINT_SPEC.md do not show it. The spec examples are stale. Build to the DTO, not the examples.

---

### Phase 3 — Service Layer (`hotels/service.ts`)

**Three overrides apply to this phase.**

---

#### Override 1 — `getHotel` and `updateHotel` must NOT call `findUnique`

**Original checklist** `getHotel`:
> `db.hotel.findUnique({ where: { id: hotelId } })`  
> If null: throw NotFoundError  
> If Manager and hotelId not in user.hotel_ids: throw ForbiddenError  
> If Manager and hotel.is_active === false: throw ForbiddenError

**Override**: `requireHotelScope` middleware already performs this lookup and attaches the result to `req.hotel`. Controllers must pass `req.hotel` into the service — the service must not re-fetch.

The NotFoundError and ForbiddenError checks listed above are also already handled by the middleware. Do not duplicate them in the service layer.

**Original checklist** `updateHotel`:
> `getHotel(user, hotelId)` — reuse scope guard

**Override**: Same as above. Do not call `getHotel` from `updateHotel`. Read `req.hotel` from the controller and pass it in.

---

#### Override 2 — `updateHotel` is_active behavior has three cases, not one

**Original checklist** `updateHotel`:
> `If Manager and data.is_active !== undefined: throw ForbiddenError`

**Override — do not implement the line above.** The correct behavior has three cases:

| Payload | Actor | Behavior |
|---------|-------|----------|
| `{ "name": "X", "is_active": false }` | Manager | Strip `is_active`, update `name`, return `200` |
| `{ "is_active": false }` | Manager | Strip `is_active`, effective payload is empty, throw `ForbiddenError` (403) |
| `{}` | Anyone | Zod `.refine` fires before service layer, return `400 INVALID_REQUEST` |

The service logic is:
1. If actor is Manager: remove `is_active` from incoming data
2. After removing: if payload is now empty, throw `ForbiddenError`
3. If payload is not empty: proceed with update and audit log

---

#### Override 3 — `createHotel` must inject `created_by_admin_id` server-side

**Original checklist** `createHotel`:
> `db.hotel.create({ data })`

**Override**: `created_by_admin_id` must be set by the service, not by the request body. The field must never be accepted from the client.

The create call must explicitly set `created_by_admin_id: user.id` in the data object alongside the validated request fields.

---

### Phase 5 — Routes (`hotels/routes.ts`)

**Original checklist** for `/:hotel_id` routes:
> `GET /:hotel_id → authenticateJWT → requireRole(['MANAGER','ADMIN']) → getHotel`  
> `PUT /:hotel_id → authenticateJWT → requireRole(['MANAGER','ADMIN']) → updateHotel`

**Override**: `requireHotelScope` must be inserted after `requireRole` and before the controller on all routes that contain `:hotel_id` in the path.

Correct chain for `/:hotel_id` routes:
```
authenticateJWT
  → requireRole([...])
  → requireHotelScope()
  → controller
```

The controller receives `req.hotel` already populated. It passes `req.hotel` to the service. No `findUnique` in the service.

---

### Phase 6 — Tests

**Four test IDs in the checklist are wrong or incomplete.**

| Checklist test | Problem | Correct behavior |
|----------------|---------|-----------------|
| `U2: Manager sends is_active → 403` | Incomplete — only covers Case 2 | Split into U3a and U3b below |
| `C9: AuditLog entry created after create` | createHotel has no transaction — audit log insert can fail silently | Verify audit log is written; consider wrapping in transaction for consistency |

**Add the following tests** (from patch, not in checklist):

| ID | Scenario | Expected |
|----|----------|----------|
| U3a | Manager sends `{ "name": "X", "is_active": false }` | 200, name updated, is_active unchanged in response |
| U3b | Manager sends `{ "is_active": false }` only | 403 FORBIDDEN |
| U3c | Admin sends `{ "name": "X", "is_active": false }` | 200, both fields updated |
| U3d | Admin sends `{ "is_active": false }` only | 200, hotel deactivated |
| N1 | Checker token on `GET /hotels` | 403 FORBIDDEN |
| N2 | `GET /hotels` response includes `created_by_admin_id` | Field present in all hotel objects |
| N3 | `POST /hotels` → `created_by_admin_id` matches admin's user ID | DB assertion |
| N4 | `POST /hotels` with `created_by_admin_id` in body → field ignored | Response reflects server-set value |
| N5 | `PUT /hotels/:id` does not change `created_by_admin_id` | DB assertion, field unchanged |
| D1 | Admin deactivates hotel with active tasks — tasks remain IN_PROGRESS | DB assertion, task status unchanged |
| D7 | Admin reactivates hotel — manager's next request succeeds | 200 |

**The following tests cannot be run as Hotels module tests.** They require Tasks, Staffing, and HR modules to be implemented. Do not block Hotels module delivery waiting for them. Add them to the respective downstream module test suites:

| ID | Requires |
|----|----------|
| D2 — Worker completes task in deactivated hotel | Tasks module |
| D3 — Manager lists tasks in deactivated hotel → 403 | Tasks module |
| D4 — Admin deactivates hotel with OPEN work request, status unchanged | Staffing module |
| D5 — Manager assigns worker to request in deactivated hotel → 403 | Staffing module |
| D6 — Worker views own contract from deactivated hotel → 200 | HR module |

---

## API Spec Corrections

The following items in HOTELS_ENDPOINT_SPEC.md are stale. Do not build to these — build to the descriptions in this sheet and HOTELS_DESIGN_PATCH_V1.md.

| Location in spec | Stale content | Correct behavior |
|------------------|---------------|-----------------|
| PUT field constraints table — `is_active` row | `❌ (403)` for Manager | 403 only when sole field (see Override 2 above) |
| PUT error table | "manager sending is_active" → 403 | 403 only when sole field |
| All GET/POST response JSON examples | Missing `created_by_admin_id` | Field must be present in all hotel response objects |

---

## Definition of Done — Hotels Module

The Hotels module is complete when all of the following pass:

- [ ] Schema migrations applied, `prisma generate` clean
- [ ] `requireHotelScope` smoke tests pass (4 cases above)
- [ ] All checklist tests pass (A1–A4, L1–L10, G1–G7, C1–C9, U1–U12)
- [ ] Patch tests U3a, U3b, U3c, U3d pass
- [ ] Additional tests N1–N5, D1, D7 pass
- [ ] `created_by_admin_id` present in all GET responses and set correctly on create
- [ ] No `findUnique` inside `getHotel` or `updateHotel` service functions
- [ ] `requireHotelScope` wired on all `/:hotel_id` routes
- [ ] TypeScript compiles without errors
- [ ] No raw Prisma errors exposed to clients

---

## Document Reading Order

Read in this order. Later documents supersede earlier ones where conflicts exist.

1. `HOTELS_MODULE_DESIGN.md` — entity model, ownership, scoping decisions
2. `HOTELS_ENDPOINT_SPEC.md` — request/response contracts (note stale items above)
3. `HOTELS_DESIGN_PATCH_V1.md` — all five resolved findings; authoritative on C1, C3, C4, H2, H3
4. `HOTELS_IMPLEMENTATION_CHECKLIST.md` — implementation tasks (note overrides above)
5. **This sheet** — read before starting any phase
