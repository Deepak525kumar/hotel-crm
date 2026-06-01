# RBAC & Permission Matrix

**Source**: MASTER_ARCHITECTURE_v2.0 Section 14  
**Status**: MVP Phase 1

---

## Role Definitions

### Worker
- Completes assigned tasks
- Uploads task completion photos
- Views own ratings and leaderboard rank
- Can view own contracts and documents (historical)
- Cannot create tasks or view other workers' payroll

### Checker
- Verifies task completion
- Rates worker quality (0-100)
- Views task photos
- Cannot create tasks or access HR data
- Cannot manage assignments

### Manager
- Creates and assigns tasks
- Manages workers at their hotel(s)
- Views hotel data (rooms, tasks, operations)
- Manages HR (contracts, documents, payroll)
- Creates work requests and manually assigns workers
- Views audit logs for their hotel only
- Cannot access other hotels or system settings

### Admin
- Full system access
- Can manage all hotels and users
- View system-wide audit logs
- System settings and configuration
- Cannot bypass security rules (audit logging still applies)

---

## Permission Matrix by Endpoint

### Auth Endpoints

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| POST /auth/signup | ✅ | ✅ | ✅ | ✅ | Anyone can register |
| POST /auth/login | ✅ | ✅ | ✅ | ✅ | Credentials validated |
| POST /auth/refresh | ✅ | ✅ | ✅ | ✅ | Requires valid refresh token |
| GET /auth/me | ✅ | ✅ | ✅ | ✅ | Get current user |
| PUT /auth/profile | ✅ | ✅ | ✅ | ✅ | Update own profile |

---

### Hotel Management (`/api/v1/crm/hotels`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| GET /hotels | ❌ | ❌ | ✅ * | ✅ | Manager sees own hotels only |
| POST /hotels | ❌ | ❌ | ❌ | ✅ | Admin only |
| GET /hotels/:id | ❌ | ❌ | ✅ * | ✅ | Manager sees own hotels only |
| PUT /hotels/:id | ❌ | ❌ | ✅ * | ✅ | Manager of that hotel only |

---

### Room Management (`/api/v1/crm/rooms`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| GET /hotels/:id/rooms | ✅ * | ✅ * | ✅ * | ✅ | Only for assigned hotel |
| POST /hotels/:id/rooms | ❌ | ❌ | ✅ * | ✅ | Manager of that hotel only |
| GET /rooms/:id | ✅ * | ✅ * | ✅ * | ✅ | Hotel-scoped access |
| PUT /rooms/:id | ❌ | ❌ | ✅ * | ✅ | Manager of that hotel only |

---

### Task Management (`/api/v1/crm/tasks`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| POST /tasks | ❌ | ❌ | ✅ * | ✅ | Manager creates for own hotel |
| GET /tasks | ✅ * | ✅ * | ✅ * | ✅ | Filtered by role/hotel |
| GET /tasks/:id | ✅ * | ✅ * | ✅ * | ✅ | Hotel-scoped |
| PUT /tasks/:id/complete | ✅ * | ❌ | ✅ | ✅ | Only assigned worker or manager |

---

### Quality Verification (`/api/v1/quality`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| POST /verifications | ❌ | ✅ | ❌ | ❌ | Checker only |
| POST /ratings | ❌ | ✅ | ❌ | ❌ | Checker only |
| GET /leaderboard | ✅ | ✅ | ✅ | ✅ | Public for all authenticated |

---

### HR Management

#### Contracts (`/api/v1/hr/contracts`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| GET /contracts | ✅ * | ❌ | ✅ * | ✅ | Worker: own only, Manager: own hotel |
| POST /contracts | ❌ | ❌ | ✅ * | ✅ | Manager creates for own hotel |
| GET /contracts/:id | ✅ * | ❌ | ✅ * | ✅ | Worker: own only, Manager: own hotel |
| PUT /contracts/:id | ❌ | ❌ | ✅ * | ✅ | Manager of that hotel only |

#### Documents (`/api/v1/hr/documents`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| GET /documents | ✅ * | ❌ | ✅ * | ✅ | Worker: own only, Manager: own hotel |
| POST /documents | ❌ | ❌ | ✅ * | ✅ | Manager uploads for own hotel |
| DELETE /documents/:id | ❌ | ❌ | ✅ * | ✅ | Only after retention expiry |

#### Payroll (`/api/v1/hr/payroll`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| GET /payroll | ✅ * | ❌ | ✅ * | ✅ | Worker: own only (encrypted view) |
| POST /payroll | ❌ | ❌ | ✅ * | ✅ | Manager creates for own hotel |
| GET /payroll/:id | ✅ * | ❌ | ✅ * | ✅ | Worker: own only, Manager: own hotel |

---

### Staffing (`/api/v1/staffing`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| POST /work-requests | ❌ | ❌ | ✅ * | ✅ | Manager creates for own hotel |
| GET /work-requests | ❌ | ❌ | ✅ * | ✅ | Manager: own hotel only |
| GET /available-workers | ❌ | ❌ | ✅ * | ✅ | Manager: own hotel only |
| POST /assign-workers | ❌ | ❌ | ✅ * | ✅ | Manager: own hotel only |

---

### Notifications (`/api/v1/notifications`)

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| GET / | ✅ | ✅ | ✅ | ✅ | User's own notifications |
| POST /:id/read | ✅ | ✅ | ✅ | ✅ | Mark own notification read |
| DELETE /:id | ✅ | ✅ | ✅ | ✅ | Delete own notification |

---

### Audit & Compliance

| Endpoint | Worker | Checker | Manager | Admin | Notes |
|----------|--------|---------|---------|-------|-------|
| GET /audit-log | ❌ | ❌ | ✅ * | ✅ | Manager: own hotel only, Admin: all |
| GET /account/export | ✅ | ✅ | ✅ | ✅ | User's own data export (GDPR) |
| POST /account/delete | ✅ | ✅ | ✅ | ✅ | Request account deletion |

---

## Legend

- ✅ = **Allowed**
- ❌ = **Denied (403 Forbidden)**
- ✅ * = **Allowed with scoping** (hotel-specific, own data only, etc.)

---

## Hotel Scoping Rules

### For Managers

**Rule**: A manager can only access resources (hotels, workers, tasks, payroll) that are in their assigned hotels.

```
manager.hotel_ids = ["hotel-123", "hotel-456"]

GET /hotels → Returns only hotel-123, hotel-456
GET /hotels/hotel-999 → 403 Forbidden
```

### For Workers

**Rule**: A worker can only access their own assigned tasks and data.

```
GET /contracts → Returns only own contracts
GET /contracts/other-worker-id → 403 Forbidden
```

### For Checkers

**Rule**: A checker can access tasks in any hotel (to verify quality) but cannot modify task assignments or worker data.

```
GET /tasks → All tasks (any hotel)
PUT /tasks/:id → 403 Forbidden (cannot modify)
```

---

## Permission Enforcement Points

### Authentication Middleware
```typescript
// Check JWT token validity
app.use(authenticateJWT);
```

### Authorization Middleware
```typescript
// Check user has required role
app.use('/api/v1/staffing', requireRole(['MANAGER', 'ADMIN']));

// Check hotel scoping
app.use(
  '/api/v1/crm/hotels/:hotel-id',
  requireHotelScope()
);
```

### Row-Level Security
```typescript
// Ensure user can only access own payroll
const payroll = await db.payroll.findUnique({
  where: {
    id: payrollId,
    worker_id: userId  // Only own
  }
});

if (!payroll) throw new ForbiddenError();
```

---

## Special Cases

### Payroll Access
- **Workers**: Can view own payroll (encrypted view, decrypted in-memory)
- **Managers**: Can view workers' payroll at their hotel
- **Admins**: Can view all payroll
- **Never deletable**: Payroll records cannot be deleted (tax law compliance)

### Audit Logs
- **Managers**: Can view audit logs for sensitive operations in their hotels
- **Admins**: Can view system-wide audit logs
- **Not deletable**: Audit logs never deletable (GDPR requirement, 5-year retention)

### GDPR Data Export
- **All Users**: Can request export of own data (within 30 days)
- **Returns**: Contracts, payroll, documents, ratings, consent records
- **Format**: ZIP with PDF/CSV/JSON files

### GDPR Data Deletion
- **Workers**: Can delete own profile photo anytime
- **Workers**: Can request deletion of documents (after retention period)
- **Cannot delete**: Payroll (tax law), contracts (employment law), ratings (employer data)

---

## Permission Checking Implementation

### In Controllers

```typescript
// Check role
if (!['MANAGER', 'ADMIN'].includes(user.role)) {
  throw new ForbiddenError('Only managers can create tasks');
}

// Check hotel scoping
const hotel = await db.hotels.findUnique({ where: { id: hotelId } });
if (!user.hotel_ids.includes(hotelId)) {
  throw new ForbiddenError('You do not have access to this hotel');
}

// Check resource ownership
const task = await db.tasks.findUnique({ where: { id: taskId } });
if (task.assigned_to !== user.id && user.role !== 'MANAGER') {
  throw new ForbiddenError('You can only access your own tasks');
}
```

---

## Testing Permissions

For each endpoint, test:
1. **Unauthenticated**: Returns 401
2. **Wrong role**: Returns 403
3. **Wrong hotel**: Returns 403 (for scoped endpoints)
4. **Own resource**: Returns 200 (if allowed)
5. **Other's resource**: Returns 403 (if restricted)

---

## Never Bypass These Rules

❌ **DO NOT**:
- Bypass permission middleware
- Expose payroll broadly
- Allow payroll deletion
- Store sensitive data unencrypted
- Skip audit logging for HR/payroll operations
- Allow workers to see other workers' contracts

---

## Role Migration During Employment

### Scenario: Worker becomes Manager
1. Add manager-specific hotels to user.hotel_ids
2. Change user.role to 'MANAGER'
3. Worker keeps ability to view own historical tasks (for continuity)
4. Log role change to audit_log

### Scenario: Manager becomes Worker
1. Remove all hotels from user.hotel_ids
2. Change user.role to 'WORKER'
3. Clear any manager-specific permissions
4. Log role change to audit_log
