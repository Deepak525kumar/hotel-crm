# Hotels Module Implementation Package

**Status**: Ready for Implementation  
**Timeline**: 1 day (3-4 hours)  
**Dependencies**: Auth module must be complete  
**Database**: 23-table schema with Hotel, Room, and related tables  
**Scope**: MVP Phase 1 (Week 1, Wednesday)

---

## 1️⃣ Implementation Checklist

### Pre-Implementation Setup (30 min)
- [ ] Auth module is complete and verified
- [ ] Prisma schema (`backend/prisma/schema.prisma`) contains Hotel, Room models
- [ ] `.env` configured with DATABASE_URL pointing to DigitalOcean PostgreSQL
- [ ] `npx prisma db push` executed successfully
- [ ] `npx prisma studio` shows all 23 tables (including Hotel, Room)
- [ ] `authenticateJWT` middleware exists and working
- [ ] Error classes exist (`ForbiddenError`, `NotFoundError`, `BadRequestError`)
- [ ] Winston logger configured

### Core Implementation (2-3 hours)
- [ ] **File Structure Created**
  - [ ] `backend/src/modules/crm/` directory exists
  - [ ] `backend/src/modules/crm/hotels/` directory created
  - [ ] All 5 files created (routes, controller, service, model, types)

- [ ] **Hotel Controller (1 hour)**
  - [ ] `getHotels()` handler implemented
  - [ ] `createHotel()` handler implemented
  - [ ] `getHotel()` handler implemented
  - [ ] `updateHotel()` handler implemented
  - [ ] Error handling in place (try-catch → error middleware)
  - [ ] Response formatting (success/error JSON structure)

- [ ] **Hotel Service (1 hour)**
  - [ ] `listHotels(userId, userRole)` method implemented
  - [ ] `createHotel(data)` method implemented
  - [ ] `getHotelById(hotelId, userId, userRole)` method implemented
  - [ ] `updateHotel(hotelId, data, userId, userRole)` method implemented
  - [ ] Hotel scoping logic implemented (manager.hotel_ids enforcement)

- [ ] **Hotel Model (30 min)**
  - [ ] `findManyByUser()` query (manager scoping)
  - [ ] `findManyAll()` query (admin)
  - [ ] `findUnique()` query
  - [ ] `create()` query
  - [ ] `update()` query

- [ ] **Types & Validation (30 min)**
  - [ ] Zod schemas created (CreateHotelInput, UpdateHotelInput, HotelResponse)
  - [ ] TypeScript types defined

### Permission & Security (30 min)
- [ ] RBAC middleware checks implemented
  - [ ] Role check: MANAGER or ADMIN for all endpoints
  - [ ] Admin-only check for POST /hotels
  - [ ] Hotel scoping check for MANAGER on GET/:id, PUT/:id
- [ ] Audit logging integrated
  - [ ] Log hotel creation (POST)
  - [ ] Log hotel updates (PUT)

### Testing (1 hour)
- [ ] Unit tests written for service methods
- [ ] Integration tests written for all 4 endpoints
- [ ] Postman/curl tests for manual verification
- [ ] Edge cases tested
- [ ] RBAC enforcement verified

### Integration (30 min)
- [ ] Routes registered in `backend/src/routes/v1/index.ts`
- [ ] Module imported in main server file
- [ ] API responding on `/api/v1/crm/hotels`
- [ ] Manually tested: can create and list hotels

---

## 2️⃣ Exact File Structure

```
backend/src/modules/crm/
├── index.ts                          # Module exports (NEW - export all sub-modules)
├── routes.ts                         # All CRM routes aggregator (NEW - /hotels, /rooms, /tasks)
│
└── hotels/
    ├── types.ts                      # TypeScript interfaces + Zod schemas
    ├── model.ts                      # Prisma database queries
    ├── service.ts                    # Business logic & hotel scoping
    ├── controller.ts                 # HTTP request handlers
    └── routes.ts                     # Express route definitions

└── rooms/
    ├── types.ts
    ├── model.ts
    ├── service.ts
    ├── controller.ts
    └── routes.ts

└── tasks/
    ├── types.ts
    ├── model.ts
    ├── service.ts
    ├── controller.ts
    └── routes.ts
```

### File Templates

**`backend/src/modules/crm/hotels/types.ts`**
```typescript
// Imports
import { z } from 'zod';

// Zod Schemas (for validation)
export const CreateHotelSchema = z.object({
  // Required fields
  // Optional fields
  // Constraints (min length, max length, etc)
});

export const UpdateHotelSchema = CreateHotelSchema.partial();

export type CreateHotelInput = z.infer<typeof CreateHotelSchema>;
export type UpdateHotelInput = z.infer<typeof UpdateHotelSchema>;

// Response DTO
export interface HotelResponse {
  id: string;
  name: string;
  city: string;
  country: string;
  address: string;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
```

**`backend/src/modules/crm/hotels/model.ts`**
```typescript
// Prisma queries - no business logic, just DB access
// Methods:
// - findManyByUser(userId: string): Promise<Hotel[]>
// - findManyAll(): Promise<Hotel[]>
// - findUniqueOrThrow(id: string): Promise<Hotel>
// - create(data: ...): Promise<Hotel>
// - update(id: string, data: ...): Promise<Hotel>
```

**`backend/src/modules/crm/hotels/service.ts`**
```typescript
// Business logic with hotel scoping
// Methods:
// - listHotels(userId: string, userRole: UserRole): Promise<Hotel[]>
// - createHotel(data: CreateHotelInput): Promise<Hotel>
// - getHotelById(hotelId: string, userId: string, userRole: UserRole): Promise<Hotel>
// - updateHotel(hotelId: string, data: UpdateHotelInput, userId: string, userRole: UserRole): Promise<Hotel>
```

**`backend/src/modules/crm/hotels/controller.ts`**
```typescript
// HTTP handlers
// Methods:
// - getHotels(req: Request, res: Response): Promise<void>
// - createHotel(req: Request, res: Response): Promise<void>
// - getHotel(req: Request, res: Response): Promise<void>
// - updateHotel(req: Request, res: Response): Promise<void>
```

**`backend/src/modules/crm/hotels/routes.ts`**
```typescript
// Express routes - define HTTP methods, paths, middleware chain
// GET    /hotels
// POST   /hotels
// GET    /hotels/:id
// PUT    /hotels/:id
```

---

## 3️⃣ Controller Responsibilities

### Controller: HTTP Request Handler (Layer: Presentation)

**Purpose**: Convert HTTP request → service call → HTTP response

**Responsibilities**:
1. Extract request data (params, body, query)
2. Pass to service layer (business logic)
3. Format response JSON (success/error)
4. Let error middleware handle exceptions

**Not Responsible For**:
- ❌ Database queries (use Service)
- ❌ Business logic (use Service)
- ❌ RBAC checks (use Middleware)
- ❌ Request validation (use Middleware + Zod)

### GET /hotels
```
1. Extract from request:
   - req.user (from authenticateJWT middleware)
   - req.user.id (userId)
   - req.user.role (userRole: WORKER|CHECKER|MANAGER|ADMIN)

2. Call service:
   hotels = await hotelService.listHotels(userId, userRole)

3. Return response:
   {
     "success": true,
     "data": hotels[],
     "error": null
   }

4. Error handling:
   throw new ForbiddenError('...')  → 403
   throw new Error('...')           → 500 (caught by error middleware)
```

### POST /hotels
```
1. Extract from request:
   - req.body: { name, city, country, address, timezone, is_active }

2. Validate:
   - Middleware validates with CreateHotelSchema

3. Call service:
   hotel = await hotelService.createHotel(body)

4. Return response (201):
   {
     "success": true,
     "data": hotel,
     "error": null
   }

5. Error handling:
   throw new BadRequestError('...')  → 400
   throw new ConflictError('...')    → 409 (if duplicate name)
   throw new ForbiddenError('...')   → 403 (non-admin)
```

### GET /hotels/:id
```
1. Extract from request:
   - req.params.id (hotelId)
   - req.user.id, req.user.role

2. Call service:
   hotel = await hotelService.getHotelById(hotelId, userId, userRole)

3. Return response (200):
   {
     "success": true,
     "data": hotel,
     "error": null
   }

4. Error handling:
   throw new NotFoundError('...')    → 404
   throw new ForbiddenError('...')   → 403 (manager without access)
```

### PUT /hotels/:id
```
1. Extract from request:
   - req.params.id (hotelId)
   - req.body: { name?, city?, country?, ... } (partial)
   - req.user.id, req.user.role

2. Validate:
   - Middleware validates with UpdateHotelSchema (partial)

3. Call service:
   hotel = await hotelService.updateHotel(hotelId, body, userId, userRole)

4. Return response (200):
   {
     "success": true,
     "data": hotel,
     "error": null
   }

5. Error handling:
   throw new NotFoundError('...')    → 404
   throw new ForbiddenError('...')   → 403
   throw new BadRequestError('...')  → 400
```

### Response Format (All Endpoints)
```json
{
  "success": true,
  "data": {
    "id": "hotel-123",
    "name": "Hotel Berlin",
    "city": "Berlin",
    "country": "Germany",
    "address": "Kurfürstendamm 101, 10711 Berlin",
    "timezone": "Europe/Berlin",
    "is_active": true,
    "created_at": "2026-05-28T10:30:00Z",
    "updated_at": "2026-05-28T10:30:00Z"
  },
  "error": null
}
```

### Error Response Format
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this hotel",
    "details": null
  }
}
```

---

## 4️⃣ Service Responsibilities

### Service: Business Logic Layer (Layer: Domain)

**Purpose**: Implement business rules, hotel scoping, data transformation

**Responsibilities**:
1. Apply business logic (hotel scoping for managers)
2. Call model layer for data access
3. Transform data (DTOs, filtering)
4. Validate business constraints
5. Throw meaningful errors

**Not Responsible For**:
- ❌ HTTP handling (use Controller)
- ❌ Database queries directly (use Model)
- ❌ Request validation (use Zod + Middleware)

### listHotels(userId, userRole)
```
Logic:
1. IF userRole === 'ADMIN'
   → Return all hotels (no filtering)
   
2. IF userRole === 'MANAGER'
   → Fetch user's hotel_ids array
   → Get user from database
   → Filter hotels: user.hotel_ids.includes(hotel.id)
   → Return filtered list
   
3. IF userRole !== 'MANAGER' && userRole !== 'ADMIN'
   → Throw ForbiddenError('Workers and checkers cannot view hotels')

4. Handle empty list:
   → Return empty array (not an error)

Database Call:
- IF admin: hotelModel.findManyAll()
- IF manager: hotelModel.findManyByUser(userId)

Return Type:
- HotelResponse[]
```

### createHotel(data)
```
Logic:
1. Validate input:
   - name: required, string, 1-100 chars
   - city: required, string, 1-100 chars
   - country: optional, default "Germany", string
   - address: required, string, 1-200 chars
   - timezone: optional, default "Europe/Berlin", string
   - is_active: optional, default true, boolean

2. Check for duplicates:
   - Hotel with same name in same city?
   - If yes: throw ConflictError('Hotel already exists')

3. Create:
   hotel = await hotelModel.create(data)

4. Return:
   HotelResponse

Constraints:
- Ensure name is unique per city (business rule)
- Timezone must be valid IANA timezone string
```

### getHotelById(hotelId, userId, userRole)
```
Logic:
1. Fetch hotel:
   hotel = await hotelModel.findUniqueOrThrow(hotelId)

2. Apply hotel scoping:
   IF userRole === 'MANAGER'
   → Fetch user's hotel_ids
   → IF !user.hotel_ids.includes(hotelId)
      → throw ForbiddenError('You do not have access to this hotel')
   
   IF userRole !== 'MANAGER' && userRole !== 'ADMIN'
   → throw ForbiddenError('Workers and checkers cannot view hotels')

3. Return:
   HotelResponse

Error Cases:
- Hotel not found → NotFoundError (404)
- User not authorized → ForbiddenError (403)
```

### updateHotel(hotelId, data, userId, userRole)
```
Logic:
1. Get current hotel:
   current = await hotelModel.findUniqueOrThrow(hotelId)

2. Apply hotel scoping:
   IF userRole === 'MANAGER'
   → Fetch user's hotel_ids
   → IF !user.hotel_ids.includes(hotelId)
      → throw ForbiddenError(...)
   
   IF userRole !== 'MANAGER' && userRole !== 'ADMIN'
   → throw ForbiddenError(...)

3. Validate updated fields:
   - If name changed: check not duplicate in city
   - If timezone changed: validate IANA format

4. Merge old + new data:
   merged = { ...current, ...data }

5. Update:
   hotel = await hotelModel.update(hotelId, merged)

6. Return:
   HotelResponse

Immutable Fields (cannot change):
- id
- created_at

Mutable Fields:
- name, city, country, address, timezone, is_active

Partial Update:
- Only provided fields are updated
- Null values not allowed (use delete endpoints for removal)
```

---

## 5️⃣ Validation Schemas Required

### Zod Schemas (in `types.ts`)

**CreateHotelSchema**
```
Fields:
- name: string, required, min 1, max 100
- address: string, required, min 1, max 200
- city: string, required, min 1, max 100
- country: string, optional, default "Germany", min 1, max 100
- timezone: string, optional, default "Europe/Berlin", valid IANA timezone
- is_active: boolean, optional, default true

Validation:
- Each field: type, constraints
- Nested validation: (if any)
- Custom validation: timezone must be valid IANA format
```

**UpdateHotelSchema**
```
- Same as CreateHotelSchema but all fields optional (partial)
- Allows updating only specific fields
- Validation rules same as create
```

**HotelResponse (TypeScript type, not Zod)**
```typescript
interface HotelResponse {
  id: string;
  name: string;
  city: string;
  country: string;
  address: string;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
```

### Validation Middleware Chain

**For POST /hotels**:
```
authenticateJWT
→ validateRequest(CreateHotelSchema)
→ requireRole(['ADMIN'])
→ controller.createHotel()
```

**For PUT /hotels/:id**:
```
authenticateJWT
→ validateRequest(UpdateHotelSchema)
→ requireRole(['MANAGER', 'ADMIN'])
→ controller.updateHotel()
```

**For GET /hotels, GET /hotels/:id**:
```
authenticateJWT
→ requireRole(['MANAGER', 'ADMIN'])
→ controller.getHotels() / controller.getHotel()
```

---

## 6️⃣ Prisma Queries Required

### Hotel Model Queries (in `model.ts`)

**findManyAll()**
```sql
-- Get all hotels (for admin)
SELECT * FROM hotels
WHERE is_active = true
ORDER BY created_at DESC;

-- Prisma:
await prisma.hotel.findMany({
  where: { is_active: true },
  orderBy: { created_at: 'desc' }
});
```

**findManyByUser(userId)**
```sql
-- Get hotels for manager (by hotel_ids array)
SELECT h.* FROM hotels h
WHERE h.id = ANY(
  SELECT hotel_ids FROM users WHERE id = ?
)
AND h.is_active = true
ORDER BY h.created_at DESC;

-- Prisma:
const user = await prisma.user.findUnique({
  where: { id: userId }
});

const hotels = await prisma.hotel.findMany({
  where: {
    id: { in: user.hotel_ids },
    is_active: true
  },
  orderBy: { created_at: 'desc' }
});
```

**findUnique(hotelId)**
```sql
-- Get single hotel by ID
SELECT * FROM hotels
WHERE id = ?;

-- Prisma:
await prisma.hotel.findUniqueOrThrow({
  where: { id: hotelId }
});
```

**create(data)**
```sql
-- Create new hotel
INSERT INTO hotels (id, name, city, country, address, timezone, is_active, created_at, updated_at)
VALUES (CUID(), ?, ?, ?, ?, ?, true, NOW(), NOW());

-- Prisma:
await prisma.hotel.create({
  data: {
    name: data.name,
    city: data.city,
    country: data.country ?? 'Germany',
    address: data.address,
    timezone: data.timezone ?? 'Europe/Berlin',
    is_active: data.is_active ?? true
  }
});
```

**update(hotelId, data)**
```sql
-- Update hotel
UPDATE hotels
SET name = ?, city = ?, country = ?, address = ?, timezone = ?, is_active = ?, updated_at = NOW()
WHERE id = ?;

-- Prisma:
await prisma.hotel.update({
  where: { id: hotelId },
  data: {
    ...data  // Only update provided fields
  }
});
```

**findByNameAndCity(name, city)**
```sql
-- Check for duplicate (before create)
SELECT * FROM hotels
WHERE name = ? AND city = ?;

-- Prisma:
await prisma.hotel.findFirst({
  where: {
    name: data.name,
    city: data.city
  }
});
```

### Query Performance Notes

**Indexes Required**:
- `hotels(is_active)` - for filtering active hotels
- `hotels(created_at)` - for ordering
- `users(id)` - primary key (already indexed)

**N+1 Query Prevention**:
- DO NOT: call findByUser, then loop hotels and fetch additional data
- DO: use include/select to fetch related data in single query

**Connection Pooling**:
- Prisma handles connection pooling
- No manual connection management needed

---

## 7️⃣ RBAC Checks Required

### Permission Matrix (from RBAC_PERMISSION_MATRIX.md)

| Endpoint | Worker | Checker | Manager | Admin | Action |
|----------|--------|---------|---------|-------|--------|
| GET /hotels | ❌ | ❌ | ✅* | ✅ | List hotels |
| POST /hotels | ❌ | ❌ | ❌ | ✅ | Create hotel |
| GET /hotels/:id | ❌ | ❌ | ✅* | ✅ | View hotel |
| PUT /hotels/:id | ❌ | ❌ | ✅* | ✅ | Update hotel |

**Legend**: 
- ✅ = Allowed
- ❌ = Forbidden (403)
- ✅* = Allowed with scoping (manager sees own only)

### Middleware Checks

**Check 1: Role-Based (Before Controller)**
```
Middleware: requireRole(['MANAGER', 'ADMIN'])

For POST /hotels:
  requireRole(['ADMIN'])

For GET /hotels, GET /hotels/:id, PUT /hotels/:id:
  requireRole(['MANAGER', 'ADMIN'])

For all others (WORKER, CHECKER):
  throw ForbiddenError('This role cannot access hotels')
```

**Check 2: Hotel Scoping (In Service)**
```
For MANAGER role:

1. Fetch user's hotel_ids array:
   user = await prisma.user.findUnique({
     where: { id: userId },
     select: { hotel_ids: true }
   });

2. Check if hotel_id in user.hotel_ids:
   if (!user.hotel_ids.includes(hotelId)) {
     throw new ForbiddenError(
       'You do not have access to this hotel'
     );
   }

For ADMIN role:
- No scoping, can access all hotels
```

**Check 3: Immutable Field Protection**
```
For PUT /hotels/:id:
  if (data.id !== undefined || data.id !== current.id) {
    throw new BadRequestError('Cannot modify hotel ID');
  }
  if (data.created_at !== undefined) {
    throw new BadRequestError('Cannot modify created_at');
  }
```

### Error Responses

**401 Unauthorized** (no/invalid JWT):
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid authentication token"
  }
}
```

**403 Forbidden** (wrong role):
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Workers and checkers cannot view hotels"
  }
}
```

**403 Forbidden** (hotel scoping violation):
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this hotel"
  }
}
```

---

## 8️⃣ Audit Logging Requirements

### Events to Log

**POST /hotels (Create)**
```
Event: HOTEL_CREATED
Details: {
  actor_id: user_id (admin creating),
  action: 'CREATE',
  resource_type: 'HOTEL',
  resource_id: hotel_id,
  details: {
    name: hotel.name,
    city: hotel.city,
    country: hotel.country,
    address: hotel.address,
    timezone: hotel.timezone
  },
  timestamp: NOW()
}

Log Level: INFO
```

**PUT /hotels/:id (Update)**
```
Event: HOTEL_UPDATED
Details: {
  actor_id: user_id (manager/admin updating),
  action: 'MODIFY',
  resource_type: 'HOTEL',
  resource_id: hotel_id,
  details: {
    changed_fields: {
      name: { old: 'Hotel A', new: 'Hotel B' },
      is_active: { old: true, new: false }
    }
  },
  timestamp: NOW()
}

Log Level: INFO
```

### Logging Implementation

**In Controller** (use logger from winston):
```typescript
logger.info('Hotel created', {
  actor_id: req.user.id,
  hotel_id: hotel.id,
  request_id: req.id
});

logger.warn('Hotel updated', {
  actor_id: req.user.id,
  hotel_id: hotelId,
  changes: updatedFields,
  request_id: req.id
});
```

**In Service** (optional secondary logging):
```typescript
// Log at service level for business logic events
logger.debug('Validating hotel scoping', {
  user_id: userId,
  user_role: userRole,
  hotel_id: hotelId,
  request_id: requestId
});
```

**Not Logged** (never log):
- ❌ Request body (contains user data)
- ❌ User passwords or tokens
- ❌ Full objects (log only relevant fields)

**Log Rotation**:
- Winston handles rotation (already configured)
- Logs stored in `backend/logs/` directory
- Max size: 10MB per file

---

## 9️⃣ Integration Test Scenarios

### Test Setup
```typescript
// Test file: backend/src/modules/crm/hotels/hotels.spec.ts

// Setup:
// 1. Create test database (or use test container)
// 2. Seed: admin user, manager user, 1 hotel
// 3. Create: test client (axios/supertest)
// 4. Teardown: clear tables after each test
```

### Test Scenarios

**Scenario 1: Admin Creates Hotel**
```
Given: Admin user is authenticated
When: POST /hotels with valid data
  {
    "name": "Hotel Munich",
    "city": "Munich",
    "country": "Germany",
    "address": "Marienplatz 1, 80331 Munich",
    "timezone": "Europe/Berlin",
    "is_active": true
  }
Then:
  - Status: 201 Created
  - Response has hotel_id
  - Hotel saved in database
  - Audit log created: HOTEL_CREATED
```

**Scenario 2: Manager Creates Hotel (Should Fail)**
```
Given: Manager user is authenticated
When: POST /hotels with valid data
Then:
  - Status: 403 Forbidden
  - Error code: FORBIDDEN
  - Message: "Only admins can create hotels"
  - No hotel created
```

**Scenario 3: Admin Lists All Hotels**
```
Given: Admin user is authenticated
  AND: Database has 3 hotels
When: GET /hotels
Then:
  - Status: 200 OK
  - Response has all 3 hotels
  - Hotels ordered by created_at DESC
```

**Scenario 4: Manager Lists Own Hotels**
```
Given: Manager user is authenticated
  AND: Manager has hotel_ids = ['hotel-1', 'hotel-2']
  AND: Database has 5 hotels total
When: GET /hotels
Then:
  - Status: 200 OK
  - Response has 2 hotels (only own)
  - Cannot see other manager's hotels
```

**Scenario 5: Manager Cannot See Other Hotel**
```
Given: Manager user has hotel_ids = ['hotel-1']
When: GET /hotels/hotel-5 (other manager's hotel)
Then:
  - Status: 403 Forbidden
  - Error: "You do not have access to this hotel"
```

**Scenario 6: Manager Updates Own Hotel**
```
Given: Manager with hotel_ids = ['hotel-1']
When: PUT /hotels/hotel-1
  {
    "name": "Hotel Berlin Updated",
    "is_active": false
  }
Then:
  - Status: 200 OK
  - Hotel updated in database
  - Audit log: HOTEL_UPDATED
  - Only changed fields updated (name, is_active)
```

**Scenario 7: Invalid Request (Validation)**
```
Given: Any authenticated user
When: POST /hotels with invalid data
  {
    "name": ""  (empty, should be min 1)
  }
Then:
  - Status: 400 Bad Request
  - Error code: INVALID_REQUEST
  - Details: [{ field: "name", message: "Required" }]
```

**Scenario 8: Duplicate Hotel**
```
Given: Hotel "Hotel A" in "Berlin" exists
When: POST /hotels
  {
    "name": "Hotel A",
    "city": "Berlin"
  }
Then:
  - Status: 409 Conflict
  - Error: "Hotel with this name already exists in this city"
```

**Scenario 9: Worker Cannot Access Hotels**
```
Given: Worker user is authenticated
When: GET /hotels
Then:
  - Status: 403 Forbidden
  - Error: "Workers cannot access hotel management"
```

**Scenario 10: Checker Cannot Access Hotels**
```
Given: Checker user is authenticated
When: GET /hotels
Then:
  - Status: 403 Forbidden
  - Error: "Checkers cannot access hotel management"
```

**Scenario 11: Unauthenticated Request**
```
Given: No authentication token
When: GET /hotels
Then:
  - Status: 401 Unauthorized
  - Error: "Missing or invalid authentication token"
```

**Scenario 12: Invalid Hotel ID (Not UUID)**
```
Given: Manager user is authenticated
When: GET /hotels/invalid-id (not a valid UUID)
Then:
  - Status: 400 Bad Request
  - Error: "Invalid hotel ID format"
```

**Scenario 13: Hotel Not Found**
```
Given: Manager user is authenticated
When: GET /hotels/00000000-0000-0000-0000-000000000000 (non-existent UUID)
Then:
  - Status: 404 Not Found
  - Error: "Hotel not found"
```

### Test Data Setup
```typescript
// Seed data for tests
const testData = {
  admin: {
    id: 'user-admin-1',
    email: 'admin@test.com',
    role: 'ADMIN',
    hotel_ids: [] // Admins don't need hotel_ids
  },
  manager1: {
    id: 'user-mgr-1',
    email: 'manager1@test.com',
    role: 'MANAGER',
    hotel_ids: ['hotel-1', 'hotel-2']
  },
  manager2: {
    id: 'user-mgr-2',
    email: 'manager2@test.com',
    role: 'MANAGER',
    hotel_ids: ['hotel-3']
  },
  worker: {
    id: 'user-worker-1',
    email: 'worker@test.com',
    role: 'WORKER',
    hotel_ids: []
  },
  hotels: [
    {
      id: 'hotel-1',
      name: 'Hotel Berlin',
      city: 'Berlin',
      country: 'Germany',
      address: 'Kurfürstendamm 101',
      timezone: 'Europe/Berlin',
      is_active: true
    }
    // ... more hotels
  ]
};
```

---

## 🔟 Risks and Edge Cases

### Risk 1: Hotel Scoping Bypass
**Risk**: Manager accessing hotel they don't own
**Mitigation**:
- ✅ Check `user.hotel_ids.includes(hotelId)` in Service layer
- ✅ Never trust client to specify which hotels to return
- ✅ Test: manager can't GET /hotels/other-hotel

**Detection**:
- [ ] Audit log shows unauthorized attempts
- [ ] Monitoring alerts on 403 spikes

---

### Risk 2: Duplicate Hotel Creation
**Risk**: Two admins create same hotel simultaneously
**Mitigation**:
- ✅ Check if hotel exists before create: `findFirst({name, city})`
- ✅ Database unique constraint on (name, city) pair
- ✅ Return 409 Conflict if duplicate

**Implementation**:
```
Before CREATE:
  existing = findFirst({name, city})
  if (existing) throw ConflictError()

Database constraint:
  CREATE UNIQUE INDEX hotels_name_city
  ON hotels(name, city)
```

---

### Risk 3: Invalid Timezone String
**Risk**: Admin enters invalid timezone (e.g., "Invalid/Zone")
**Mitigation**:
- ✅ Validate against IANA timezone list in Zod schema
- ✅ Use library: `Intl.DateTimeFormat().resolvedOptions().timeZone` to validate
- ✅ Return 400 Bad Request if invalid

---

### Risk 4: Partial Update Conflicts
**Risk**: Manager updates field that was just updated by another manager
**Mitigation**:
- ✅ Use optimistic locking (version field) - consider for Phase 2
- ✅ For MVP: Merge strategy (last-write-wins) acceptable
- ✅ Audit log shows who made changes when

---

### Risk 5: Soft Delete Edge Case
**Risk**: Hotel marked is_active=false but still appears in lists
**Mitigation**:
- ✅ Always filter `WHERE is_active = true` in queries
- ✅ Do NOT hard-delete (keep data for audit trail)
- ✅ Use `is_active` flag consistently

**Query Pattern**:
```sql
SELECT * FROM hotels
WHERE is_active = true
ORDER BY created_at DESC;
```

---

### Edge Case 1: Empty Hotel List
**Case**: Manager has no hotels assigned
**Behavior**:
- Return empty array `[]` (not an error)
- Response: `{ success: true, data: [], error: null }`
- HTTP: 200 OK

**Test**:
```
Given: New manager with hotel_ids = []
When: GET /hotels
Then: data = []
```

---

### Edge Case 2: Very Long Hotel Name
**Case**: Admin enters hotel name with 500 characters
**Behavior**:
- Zod validation rejects (max 100 chars)
- Return 400 Bad Request
- Message: "Name must be 100 characters or less"

---

### Edge Case 3: Special Characters in Name
**Case**: Hotel name "Hôtel München & Co."
**Behavior**:
- Allowed (special characters valid in strings)
- Stored as-is in database
- Returned in JSON (properly escaped)

**Test**:
```json
POST /hotels
{
  "name": "Hôtel München & Co."
}
→ 201 Created
→ Response has "Hôtel München & Co."
```

---

### Edge Case 4: Null/Undefined Fields
**Case**: Manager sends `PUT /hotels/:id { timezone: null }`
**Behavior**:
- Reject (null not allowed, use omit instead)
- Return 400 Bad Request
- Message: "Timezone cannot be null (omit field to keep unchanged)"

**Test**:
```
PUT /hotels/hotel-1
{ "timezone": null }
→ 400 Bad Request
→ Hotel not updated
```

---

### Edge Case 5: Timezone Across Daylight Savings
**Case**: Hotel in Berlin, daylight savings change
**Behavior**:
- Timezone string "Europe/Berlin" handles DST automatically
- Use only standard IANA timezone identifiers
- Never use hardcoded UTC offsets (e.g., UTC+2)

---

### Edge Case 6: Manager Loses Hotel Access
**Case**: Admin removes hotel from manager's hotel_ids
**Behavior**:
- Manager can no longer access that hotel
- Old data still in database (audit trail preserved)
- Rooms, tasks, etc. still exist but inaccessible to manager

**Test**:
```
1. Manager has hotel_ids = ['hotel-1']
2. Admin removes hotel-1
3. Manager: GET /hotels/hotel-1 → 403 Forbidden
```

---

### Edge Case 7: Concurrent Writes
**Case**: Two managers update same hotel simultaneously
**Behavior**:
- Last-write-wins strategy
- Both writes succeed, second overwrites first
- Audit log shows both changes
- No data loss, but timing-dependent results

**Solution for Future (Phase 2)**:
- Add version field (optimistic locking)
- Return 409 Conflict if version mismatch
- Require client to retry with fresh data

---

### Edge Case 8: Renamed Hotel
**Case**: Manager renames hotel from "Hotel A" to "Hotel B"
**Behavior**:
- Update succeeds
- Check for duplicate name + city
- If duplicate: 409 Conflict

---

### Edge Case 9: Deactivating Active Hotel
**Case**: Manager sets is_active=false while rooms/tasks exist
**Behavior**:
- Update succeeds (is_active = false)
- Rooms/tasks still exist in database
- Hotel no longer appears in lists (WHERE is_active = true)
- Consistency check: rooms without active hotel (acceptable for MVP)

**Future Consideration (Phase 2)**:
- Validate: cannot deactivate hotel if has active tasks
- Cascade deactivation: mark all child resources inactive

---

### Performance Edge Case: Many Hotels
**Case**: Admin has 10,000 hotels
**Behavior**:
- GET /hotels returns large JSON (slow)
- Solution: Pagination (Phase 2)
- For MVP: Assume <100 hotels per user

**Optimization for MVP**:
- Add index on `is_active` (already planned)
- Order by `created_at DESC` (already done)
- Limit results in application code if needed

---

## 📋 Pre-Implementation Verification Checklist

Before starting Hotels implementation, verify:

- [ ] ✅ Auth module is complete and tested
- [ ] ✅ Prisma schema contains Hotel, Room, Task, User models
- [ ] ✅ Database migration applied: `npx prisma db push`
- [ ] ✅ Error classes exist: `ForbiddenError`, `NotFoundError`, `BadRequestError`, `ConflictError`
- [ ] ✅ Logger (Winston) configured
- [ ] ✅ Authentication middleware: `authenticateJWT` working
- [ ] ✅ Request validation middleware: `validateRequest(schema)` working
- [ ] ✅ Role middleware: `requireRole(roles)` working
- [ ] ✅ Test framework set up (Jest, Supertest)
- [ ] ✅ API server running on port 3001
- [ ] ✅ Routes can be tested with Postman/curl

---

## 📝 Implementation Timeline

**Total Effort**: 3-4 hours (can be done in 1 day)

| Phase | Time | Tasks |
|-------|------|-------|
| Setup | 30 min | File structure, Prisma verification |
| Core | 1.5h | Controller, Service, Model implementation |
| Validation | 30 min | Zod schemas, error handling |
| RBAC | 30 min | Permission checks, hotel scoping |
| Testing | 1h | Unit + integration tests |
| **Total** | **3.5h** | **Ready for deployment** |

---

## ✅ Success Criteria

**Implementation Complete When**:
- ✅ All 4 endpoints respond correctly
- ✅ All 10 test scenarios pass
- ✅ Hotel scoping enforced (manager can't see other hotels)
- ✅ RBAC working (roles properly restricted)
- ✅ Audit logs created for create/update
- ✅ Error handling comprehensive (400, 401, 403, 404, 409)
- ✅ Can manually create, read, update hotels via API
- ✅ Database queries performant (<100ms)
- ✅ Code follows project patterns (from Auth module)

**Ready for Next Module (Rooms)**: Yes → All criteria met
