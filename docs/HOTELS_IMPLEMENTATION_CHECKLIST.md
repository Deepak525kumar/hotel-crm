# Hotels Module — Implementation Checklist

**Depends on**: Auth module (JWT middleware, RBAC middleware) — must be complete first  
**Schema**: `Hotel` model in `backend/prisma/schema.prisma` — already defined, no migration needed  
**Target path**: `backend/src/modules/crm/hotels/`

---

## Phase 0: Prerequisites

- [ ] Auth middleware (`authenticateJWT`) is implemented and tested
- [ ] RBAC middleware (`requireRole`) is implemented and tested
- [ ] Global error handler is in place (`AppError`, `NotFoundError`, `ForbiddenError`)
- [ ] Standard response shape (`{ success, data, error }`) helper is available
- [ ] Prisma client is initialized at `backend/src/lib/db.ts`
- [ ] Request ID middleware is in place (for logging)

---

## Phase 1: Validation Layer

File: `backend/src/modules/crm/hotels/validation.ts`

- [ ] Define `createHotelSchema` (Zod)
  - [ ] `name`: string, min 2, max 100, trimmed
  - [ ] `city`: string, min 2, max 100, trimmed
  - [ ] `country`: string, min 2, max 100, trimmed, default `"Germany"`
  - [ ] `address`: string, min 5, max 255, trimmed
  - [ ] `timezone`: string, IANA timezone validation, default `"Europe/Berlin"`
- [ ] Define `updateHotelSchema` (Zod)
  - [ ] All fields from create, all optional
  - [ ] `is_active`: boolean, optional
  - [ ] `.refine` — at least one field present
- [ ] Define `listHotelsQuerySchema` (Zod)
  - [ ] `limit`: coerce integer, 1–100, default 20
  - [ ] `cursor`: string optional
  - [ ] `country`: string optional
  - [ ] `is_active`: coerce boolean optional

---

## Phase 2: Types

File: `backend/src/modules/crm/hotels/types.ts`

- [ ] `HotelResponse` DTO (id, name, city, country, address, timezone, is_active, created_at, updated_at)
- [ ] `CreateHotelInput` (inferred from Zod schema)
- [ ] `UpdateHotelInput` (inferred from Zod schema)
- [ ] `ListHotelsQuery` (inferred from Zod schema)
- [ ] `PaginatedHotelsResponse` (hotels array + pagination metadata)

---

## Phase 3: Service Layer

File: `backend/src/modules/crm/hotels/service.ts`

### `listHotels(user, query)`
- [ ] If Manager: query `WHERE id IN (user.hotel_ids) AND is_active = true`
- [ ] If Admin: query with optional `country` and `is_active` filters
- [ ] Cursor-based pagination (`take: limit + 1`, detect `has_more`)
- [ ] Return `PaginatedHotelsResponse`

### `getHotel(user, hotelId)`
- [ ] `db.hotel.findUnique({ where: { id: hotelId } })`
- [ ] If null: throw `NotFoundError`
- [ ] If Manager and `hotelId` not in `user.hotel_ids`: throw `ForbiddenError`
- [ ] If Manager and `hotel.is_active === false`: throw `ForbiddenError`
- [ ] Return hotel

### `createHotel(user, data)`
- [ ] Guard: `user.role !== 'ADMIN'` → throw `ForbiddenError`
- [ ] `db.hotel.create({ data })`
- [ ] Write `AuditLog` entry (action: `CREATE`, resource_type: `HOTEL`)
- [ ] Return created hotel

### `updateHotel(user, hotelId, data)`
- [ ] `getHotel(user, hotelId)` — reuse scope guard (throws if not accessible)
- [ ] If Manager and `data.is_active !== undefined`: throw `ForbiddenError`
- [ ] Build `updateData` — strip `is_active` if actor is Manager
- [ ] Run in `db.$transaction`:
  - [ ] `db.hotel.update({ where: { id: hotelId }, data: updateData })`
  - [ ] `db.auditLog.create(...)` with `fields_changed` and `is_active` before/after if applicable
- [ ] Return updated hotel

### `getHotelOrThrow(hotelId)` (internal helper)
- [ ] `db.hotel.findUnique({ where: { id: hotelId } })`
- [ ] Throws `NotFoundError` if null

---

## Phase 4: Controller

File: `backend/src/modules/crm/hotels/controller.ts`

- [ ] `listHotels` handler
  - [ ] Parse query with `listHotelsQuerySchema`
  - [ ] Call `service.listHotels(req.user, query)`
  - [ ] Return `200` with paginated response
- [ ] `createHotel` handler
  - [ ] Parse body with `createHotelSchema`
  - [ ] Call `service.createHotel(req.user, body)`
  - [ ] Return `201`
- [ ] `getHotel` handler
  - [ ] Call `service.getHotel(req.user, req.params.hotel_id)`
  - [ ] Return `200`
- [ ] `updateHotel` handler
  - [ ] Parse body with `updateHotelSchema`
  - [ ] Call `service.updateHotel(req.user, req.params.hotel_id, body)`
  - [ ] Return `200`
- [ ] `deleteHotel` handler
  - [ ] Return `405` with `METHOD_NOT_SUPPORTED`

---

## Phase 5: Routes

File: `backend/src/modules/crm/hotels/routes.ts`

- [ ] `GET /` → `authenticateJWT` → `requireRole(['MANAGER','ADMIN'])` → `listHotels`
- [ ] `POST /` → `authenticateJWT` → `requireRole(['ADMIN'])` → `createHotel`
- [ ] `GET /:hotel_id` → `authenticateJWT` → `requireRole(['MANAGER','ADMIN'])` → `getHotel`
- [ ] `PUT /:hotel_id` → `authenticateJWT` → `requireRole(['MANAGER','ADMIN'])` → `updateHotel`
- [ ] `DELETE /:hotel_id` → `authenticateJWT` → `deleteHotel`
- [ ] Mount router in CRM module index at `/api/v1/crm/hotels`

---

## Phase 6: Tests

File: `backend/tests/hotels/`

### Unit Tests (`hotels.service.test.ts`)
- [ ] `listHotels` — Manager returns only scoped hotels
- [ ] `listHotels` — Manager excludes inactive hotels
- [ ] `listHotels` — Admin returns all with filters
- [ ] `getHotel` — Manager denied on foreign hotel
- [ ] `getHotel` — Manager denied on inactive hotel
- [ ] `createHotel` — Manager throws ForbiddenError
- [ ] `updateHotel` — Manager cannot set is_active
- [ ] `updateHotel` — AuditLog created in transaction

### Integration Tests (`hotels.integration.test.ts`)
- [ ] A1: No token → 401
- [ ] A2: Worker token → 403
- [ ] L1: Manager lists own hotels → 200, scoped
- [ ] L2: Manager — inactive hotels not returned
- [ ] L3: Admin lists all → 200
- [ ] L4: Admin filters by is_active
- [ ] L5: Cursor pagination — correct next page
- [ ] G1: Manager gets own hotel → 200
- [ ] G2: Manager gets foreign hotel → 403
- [ ] G3: Manager gets inactive hotel → 403
- [ ] G4: Admin gets inactive hotel → 200
- [ ] G5: Invalid hotel_id → 404
- [ ] C1: Admin creates hotel → 201
- [ ] C2: Defaults applied (country, timezone, is_active)
- [ ] C3: Manager creates → 403
- [ ] C4–C8: Validation failures → 400
- [ ] C9: AuditLog entry created after create
- [ ] U1: Manager updates name → 200
- [ ] U2: Manager sends is_active → 403
- [ ] U3: Manager updates foreign hotel → 403
- [ ] U4: Admin deactivates hotel → 200
- [ ] U5: No fields sent → 400
- [ ] U6: Hotel not found → 404
- [ ] U7: AuditLog entry with fields_changed created
- [ ] I1: DELETE → 405

---

## Phase 7: Final Checks

- [ ] All endpoints return `{ success, data, error }` shape
- [ ] All 4xx errors use error codes from `API_STANDARDS.md`
- [ ] Zod errors mapped to `INVALID_REQUEST` with `details` array
- [ ] No raw Prisma errors leak to client in production mode
- [ ] `hotel_id` param validated as non-empty string (404 on garbage input, not 500)
- [ ] Rate limiting middleware applied at CRM router level
- [ ] Response times verified < 500ms under normal load
- [ ] TypeScript compiles without errors (`tsc --noEmit`)
- [ ] No `console.log` left in production code paths (use Winston)

---

## Definition of Done

All boxes above are checked, and:
1. Integration tests pass against a real test database
2. No TypeScript errors
3. At least one manager, one admin, and one forbidden-role scenario tested per endpoint
4. AuditLog entries verified in DB assertions for create and update
