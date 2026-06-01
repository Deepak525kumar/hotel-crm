# Hotels Module Design

**Module**: CRM / Hotels  
**Base Path**: `/api/v1/crm/hotels`  
**Status**: Design — MVP Phase 1  
**Date**: 2026-06-01  
**Depends on**: Auth module (JWT + RBAC middleware)

---

## 1. Hotel Entity Lifecycle

Hotels are top-level organizational units. They do not transition through states like tasks do — they are either **active** or **inactive**. Lifecycle milestones:

```
CREATED (is_active: true)
    │
    │ Admin sets is_active = false
    ▼
DEACTIVATED (is_active: false)
    │
    │ All child data is preserved (rooms, tasks, HR records)
    │ Managers lose scoped access immediately
    │ No hard delete in MVP
    ▼
(No further transitions in Phase 1)
```

### Lifecycle Rules
- Hotels are **created by admins only** — never auto-created.
- Hotels are **never hard-deleted** in Phase 1 (child data references hotel_id across 10+ tables).
- Deactivating a hotel (`is_active = false`) does not cascade-deactivate rooms or tasks — those remain queryable for historical records.
- `updated_at` is maintained automatically via Prisma `@updatedAt`.

---

## 2. Hotel CRUD Operations

### Create
- **Who**: Admin only
- **What**: Inserts a new Hotel row; `is_active` defaults to `true`
- **Side effects**: None (no notifications, no automatic room creation)
- **Idempotency**: Hotel `name` + `city` + `country` combination is not unique-constrained in schema — rely on validation to prevent obvious duplicates

### Read (List)
- **Who**: Manager (own hotels), Admin (all hotels)
- **Filtering**: Admin may filter by `country`, `is_active`; Manager list is always pre-filtered to their `hotel_ids`
- **Pagination**: Cursor-based, default page size 20

### Read (Single)
- **Who**: Manager (own hotel only), Admin (any)
- **Includes**: Basic hotel fields only — no nested rooms/tasks in this response (those have their own endpoints)

### Update
- **Who**: Manager (own hotel), Admin (any hotel)
- **Allowed fields**: `name`, `city`, `country`, `address`, `timezone`, `is_active`
- **Forbidden**: `id`, `created_at` — silently ignored if passed
- **is_active toggle**: Admin-only field; if a Manager sends `is_active`, return `403`

### Delete
- **Not supported in Phase 1.** Return `405 Method Not Allowed` with error code `METHOD_NOT_SUPPORTED`.

---

## 3. Hotel Ownership Model

The Hotel entity has **no direct owner column** in the schema. Ownership is expressed through the `User.hotel_ids` array:

```
User.hotel_ids = ["hotel-abc", "hotel-def"]
               ↕
Hotel.id       = "hotel-abc"  ← Manager has access
```

### Key Facts
- A hotel can be "owned" (managed) by **multiple managers** simultaneously (shared `hotel_ids`).
- A manager can manage **multiple hotels** (their `hotel_ids` array contains N entries).
- The Hotel table itself carries no `manager_id` FK — the join direction is on the User.
- Admins do not appear in `hotel_ids`; they have implicit access to all hotels via role check.
- When a new hotel is created, no managers are auto-assigned — admin must explicitly update the relevant User's `hotel_ids`.

### Assigning a Manager to a Hotel
This is done via the **Users/Auth module** (updating `User.hotel_ids`), not via the Hotels module. The Hotels module is read/write on hotel data only.

---

## 4. Hotel Scoping Rules

Scoping is enforced in the **authorization middleware**, applied on every request to hotel-specific endpoints.

### Rule Table

| Actor | Scope |
|-------|-------|
| Admin | All hotels, regardless of `is_active` |
| Manager | Only hotels whose `id` is in `user.hotel_ids`; `is_active` hotels only |
| Worker | No access to hotel endpoints |
| Checker | No access to hotel endpoints |

### Scope Enforcement Logic

```
function assertHotelAccess(user, hotelId):
  if user.role === 'ADMIN':
    return true                          // full access

  if user.role !== 'MANAGER':
    throw ForbiddenError                 // workers, checkers denied

  if !user.hotel_ids.includes(hotelId):
    throw ForbiddenError                 // manager of different hotel

  hotel = db.Hotel.findUnique(hotelId)
  if !hotel.is_active:
    throw ForbiddenError                 // inactive hotel, manager blocked
```

### List Endpoint Scoping

```
Manager: WHERE id IN (user.hotel_ids) AND is_active = true
Admin:   WHERE 1=1  (optional filters: country, is_active)
```

---

## 5. Manager Access Rules

| Operation | Allowed | Conditions |
|-----------|---------|------------|
| `GET /hotels` | ✅ | Returns only their assigned hotels |
| `GET /hotels/:id` | ✅ | Only if hotel_id in user.hotel_ids and hotel is_active |
| `POST /hotels` | ❌ | 403 — admin only |
| `PUT /hotels/:id` | ✅ | Only fields: name, city, country, address, timezone |
| `PUT /hotels/:id` (is_active) | ❌ | 403 — cannot toggle active state |
| `DELETE /hotels/:id` | ❌ | 405 — not supported |

**Field-level restriction**: On `PUT`, the service layer strips `is_active` from the update payload if the actor is a Manager before applying to DB.

---

## 6. Admin Access Rules

| Operation | Allowed | Conditions |
|-----------|---------|------------|
| `GET /hotels` | ✅ | All hotels; optional filters |
| `GET /hotels/:id` | ✅ | Any hotel |
| `POST /hotels` | ✅ | Full create access |
| `PUT /hotels/:id` | ✅ | All fields including is_active |
| `DELETE /hotels/:id` | ❌ | 405 — not supported in Phase 1 |

Admins are still subject to audit logging. Accessing hotel data as admin is not audited (not GDPR-sensitive), but **modifying** hotels is logged.

---

## 7. API Endpoints

### Base: `GET /api/v1/crm/hotels`

List hotels accessible to the authenticated user.

**Auth**: Required (Manager, Admin)  
**Query params**:

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | integer | 20 | Max 100 |
| `cursor` | string | — | Cursor for pagination (hotel id) |
| `country` | string | — | Admin only; filter by country |
| `is_active` | boolean | — | Admin only; omit = return all |

**Response `200`**:
```json
{
  "success": true,
  "data": {
    "hotels": [
      {
        "id": "cuid",
        "name": "Hotel München Mitte",
        "city": "Munich",
        "country": "Germany",
        "address": "Bahnhofstr. 12, 80335 München",
        "timezone": "Europe/Berlin",
        "is_active": true,
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-05-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "next_cursor": "cuid_last",
      "has_more": false,
      "total": 1
    }
  },
  "error": null
}
```

---

### Base: `POST /api/v1/crm/hotels`

Create a new hotel.

**Auth**: Required (Admin only)

**Request body**:
```json
{
  "name": "Hotel München Mitte",
  "city": "Munich",
  "country": "Germany",
  "address": "Bahnhofstr. 12, 80335 München",
  "timezone": "Europe/Berlin"
}
```

**Response `201`**:
```json
{
  "success": true,
  "data": {
    "hotel": { /* full hotel object */ }
  },
  "error": null
}
```

**Errors**:
- `400 INVALID_REQUEST` — validation failure
- `403 FORBIDDEN` — not admin

---

### Base: `GET /api/v1/crm/hotels/:hotel_id`

Get a single hotel.

**Auth**: Required (Manager — own hotel; Admin — any)

**Response `200`**:
```json
{
  "success": true,
  "data": {
    "hotel": { /* full hotel object */ }
  },
  "error": null
}
```

**Errors**:
- `403 FORBIDDEN` — manager accessing another hotel
- `404 NOT_FOUND` — hotel does not exist

---

### Base: `PUT /api/v1/crm/hotels/:hotel_id`

Update hotel fields.

**Auth**: Required (Manager — own hotel, limited fields; Admin — any hotel, all fields)

**Request body** (all fields optional):
```json
{
  "name": "Hotel München Mitte Updated",
  "city": "Munich",
  "country": "Germany",
  "address": "Maximilianstr. 1, 80539 München",
  "timezone": "Europe/Berlin",
  "is_active": false
}
```

**Response `200`**:
```json
{
  "success": true,
  "data": {
    "hotel": { /* updated hotel object */ }
  },
  "error": null
}
```

**Errors**:
- `400 INVALID_REQUEST` — validation failure
- `403 FORBIDDEN` — wrong role or attempting to set is_active as manager
- `404 NOT_FOUND` — hotel does not exist

---

## 8. Validation Rules

Implemented with **Zod** at middleware level, applied before the controller runs.

### Create Hotel Schema

```typescript
const createHotelSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .trim(),
  city: z
    .string()
    .min(2, 'City must be at least 2 characters')
    .max(100)
    .trim(),
  country: z
    .string()
    .min(2, 'Country must be at least 2 characters')
    .max(100)
    .trim()
    .default('Germany'),
  address: z
    .string()
    .min(5, 'Address must be at least 5 characters')
    .max(255)
    .trim(),
  timezone: z
    .string()
    .refine(
      (tz) => Intl.supportedValuesOf('timeZone').includes(tz),
      'Invalid IANA timezone'
    )
    .default('Europe/Berlin'),
});
```

### Update Hotel Schema

```typescript
const updateHotelSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  city: z.string().min(2).max(100).trim().optional(),
  country: z.string().min(2).max(100).trim().optional(),
  address: z.string().min(5).max(255).trim().optional(),
  timezone: z
    .string()
    .refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz), 'Invalid IANA timezone')
    .optional(),
  is_active: z.boolean().optional(), // stripped for managers in service layer
}).refine(
  (data) => Object.keys(data).length > 0,
  'At least one field must be provided'
);
```

### List Hotels Query Schema

```typescript
const listHotelsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  country: z.string().optional(),   // admin only — enforced in service
  is_active: z.coerce.boolean().optional(), // admin only — enforced in service
});
```

---

## 9. Prisma Queries Required

### List Hotels (Manager)

```typescript
const hotels = await db.hotel.findMany({
  where: {
    id: { in: user.hotel_ids },
    is_active: true,
  },
  orderBy: { created_at: 'desc' },
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});
```

### List Hotels (Admin)

```typescript
const hotels = await db.hotel.findMany({
  where: {
    ...(country ? { country } : {}),
    ...(is_active !== undefined ? { is_active } : {}),
  },
  orderBy: { created_at: 'desc' },
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});
```

### Get Hotel (Single)

```typescript
const hotel = await db.hotel.findUnique({
  where: { id: hotelId },
});

if (!hotel) throw new NotFoundError('Hotel not found');

// For managers: scope check
if (user.role === 'MANAGER') {
  if (!user.hotel_ids.includes(hotelId) || !hotel.is_active) {
    throw new ForbiddenError();
  }
}
```

### Create Hotel

```typescript
const hotel = await db.hotel.create({
  data: {
    name,
    city,
    country,
    address,
    timezone,
    // is_active defaults to true in schema
  },
});
```

### Update Hotel

```typescript
// Build update payload; strip is_active for managers
const updateData: Prisma.HotelUpdateInput = {
  ...(name ? { name } : {}),
  ...(city ? { city } : {}),
  ...(country ? { country } : {}),
  ...(address ? { address } : {}),
  ...(timezone ? { timezone } : {}),
  ...(user.role === 'ADMIN' && is_active !== undefined ? { is_active } : {}),
};

const hotel = await db.hotel.update({
  where: { id: hotelId },
  data: updateData,
});
```

### Check Hotel Exists (reusable guard)

```typescript
async function getHotelOrThrow(hotelId: string): Promise<Hotel> {
  const hotel = await db.hotel.findUnique({ where: { id: hotelId } });
  if (!hotel) throw new NotFoundError('Hotel not found');
  return hotel;
}
```

---

## 10. Audit Logging Requirements

Hotels are **not GDPR-sensitive** (no personal data), so audit logging is lighter than HR/payroll. However, **state-changing operations** should be logged for operational traceability.

### What to Log

| Operation | Log? | Reason |
|-----------|------|--------|
| `GET /hotels` (list) | ❌ | Non-sensitive read |
| `GET /hotels/:id` | ❌ | Non-sensitive read |
| `POST /hotels` | ✅ | New org unit created |
| `PUT /hotels/:id` | ✅ | State change, especially is_active toggle |
| `PUT /hotels/:id` (is_active=false) | ✅ HIGH PRIORITY | Deactivating a hotel affects all users |

### AuditLog Entries

**Create Hotel**:
```json
{
  "actor_id": "admin-user-id",
  "actor_role": "ADMIN",
  "action": "CREATE",
  "resource_type": "HOTEL",
  "resource_id": "new-hotel-id",
  "details": {
    "name": "Hotel München Mitte",
    "city": "Munich"
  },
  "ip_address": "x.x.x.x"
}
```

**Update Hotel** (including deactivation):
```json
{
  "actor_id": "user-id",
  "actor_role": "ADMIN|MANAGER",
  "action": "MODIFY",
  "resource_type": "HOTEL",
  "resource_id": "hotel-id",
  "details": {
    "fields_changed": ["name", "is_active"],
    "is_active_before": true,
    "is_active_after": false
  },
  "ip_address": "x.x.x.x"
}
```

### Implementation Pattern

Audit logging happens **inside a transaction** with the hotel update, so both succeed or both fail:

```typescript
await db.$transaction(async (tx) => {
  const hotel = await tx.hotel.update({ where: { id: hotelId }, data: updateData });

  await tx.auditLog.create({
    data: {
      actor_id: user.id,
      actor_role: user.role,
      action: 'MODIFY',
      resource_type: 'HOTEL',
      resource_id: hotelId,
      details: { fields_changed: Object.keys(updateData) },
      ip_address: req.ip,
      timestamp: new Date(),
    },
  });

  return hotel;
});
```

---

## 11. Test Scenarios

All tests follow the pattern defined in `API_STANDARDS.md`: validation, auth, permission, happy path, integration.

### Auth Tests

| # | Scenario | Expected |
|---|----------|----------|
| A1 | No token on any hotel endpoint | 401 UNAUTHORIZED |
| A2 | Expired JWT token | 401 UNAUTHORIZED |
| A3 | Valid token, wrong role (Worker on GET /hotels) | 403 FORBIDDEN |
| A4 | Valid token, wrong role (Checker on POST /hotels) | 403 FORBIDDEN |

### List Hotels Tests

| # | Scenario | Expected |
|---|----------|----------|
| L1 | Manager lists hotels — returns only their assigned hotels | 200, scoped list |
| L2 | Manager lists hotels — inactive hotels excluded | 200, no inactive hotels |
| L3 | Admin lists hotels — returns all hotels | 200, all hotels |
| L4 | Admin filters by `is_active=false` | 200, only inactive |
| L5 | Admin filters by `country=Germany` | 200, filtered |
| L6 | Manager sends `country` filter | 200, filter silently ignored (not forbidden) |
| L7 | `limit=0` | 400 INVALID_REQUEST |
| L8 | `limit=101` | 400 INVALID_REQUEST |
| L9 | Cursor pagination — second page returns next batch | 200, correct slice |
| L10 | Empty result (manager has no hotels) | 200, empty array |

### Get Hotel Tests

| # | Scenario | Expected |
|---|----------|----------|
| G1 | Manager gets own hotel | 200 |
| G2 | Manager gets hotel not in hotel_ids | 403 FORBIDDEN |
| G3 | Manager gets inactive hotel in hotel_ids | 403 FORBIDDEN |
| G4 | Admin gets any hotel | 200 |
| G5 | Admin gets inactive hotel | 200 |
| G6 | Hotel ID does not exist | 404 NOT_FOUND |
| G7 | Hotel ID format invalid (not cuid) | 404 NOT_FOUND |

### Create Hotel Tests

| # | Scenario | Expected |
|---|----------|----------|
| C1 | Admin creates hotel with all valid fields | 201, hotel returned |
| C2 | Admin creates hotel — defaults applied (country, timezone, is_active) | 201, defaults present |
| C3 | Manager attempts to create hotel | 403 FORBIDDEN |
| C4 | Missing required field `name` | 400 INVALID_REQUEST |
| C5 | Missing required field `address` | 400 INVALID_REQUEST |
| C6 | Invalid timezone string | 400 INVALID_REQUEST |
| C7 | Name too short (< 2 chars) | 400 INVALID_REQUEST |
| C8 | Name too long (> 100 chars) | 400 INVALID_REQUEST |
| C9 | Create hotel — AuditLog entry created | DB assertion |

### Update Hotel Tests

| # | Scenario | Expected |
|---|----------|----------|
| U1 | Manager updates name of own hotel | 200, updated |
| U2 | Manager updates address of own hotel | 200, updated |
| U3 | Manager sends `is_active: false` | 403 FORBIDDEN |
| U4 | Manager updates hotel not in hotel_ids | 403 FORBIDDEN |
| U5 | Admin updates any hotel — all fields | 200, updated |
| U6 | Admin deactivates hotel (`is_active: false`) | 200, hotel deactivated |
| U7 | Admin reactivates hotel (`is_active: true`) | 200, hotel reactivated |
| U8 | Update with no fields provided | 400 INVALID_REQUEST |
| U9 | Hotel ID does not exist | 404 NOT_FOUND |
| U10 | Invalid timezone in update | 400 INVALID_REQUEST |
| U11 | Update hotel — AuditLog entry created | DB assertion |
| U12 | Deactivate hotel — AuditLog records before/after is_active | DB assertion |

### Integration / Cross-Module Tests

| # | Scenario | Expected |
|---|----------|----------|
| I1 | Manager assigned to hotel via User.hotel_ids can immediately access it | 200 |
| I2 | Manager removed from hotel_ids can no longer access it | 403 |
| I3 | Admin deactivates hotel — manager's subsequent request blocked | 403 |
| I4 | Hotel with rooms/tasks deactivated — child data still queryable for admin | 200 on child endpoints |
| I5 | Concurrent admin updates to same hotel — last-write-wins (no transaction conflict expected) | 200 both, final state reflects last write |

---

## Appendix A: File Structure

```
backend/src/modules/crm/
├── hotels/
│   ├── controller.ts    — Route handlers (thin, delegates to service)
│   ├── service.ts       — Business logic, scoping, audit logging
│   ├── routes.ts        — Express router, middleware wiring
│   ├── validation.ts    — Zod schemas (createHotelSchema, updateHotelSchema, etc.)
│   └── types.ts         — TypeScript types for Hotel DTOs
```

---

## Appendix B: Error Code Reference

| Code | HTTP | When |
|------|------|------|
| `INVALID_REQUEST` | 400 | Zod validation fails |
| `UNAUTHORIZED` | 401 | No/invalid JWT |
| `FORBIDDEN` | 403 | Wrong role or hotel not in scope |
| `NOT_FOUND` | 404 | Hotel ID doesn't exist |
| `METHOD_NOT_SUPPORTED` | 405 | DELETE attempted |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

---

## Appendix C: Performance Notes

- `hotel_ids` on User is a `String[]` (PostgreSQL array). Querying `WHERE id IN (hotel_ids)` uses the `@@index([is_active])` and PK index — acceptable for MVP with ≤10 hotels per manager.
- All hotel list queries are bounded by `limit` (max 100).
- Hotel update uses `findUnique` + `update` — two queries. Could be `upsert` but explicit is safer here.
- No caching in Phase 1 — hotel data changes rarely enough that cache invalidation complexity isn't warranted.
