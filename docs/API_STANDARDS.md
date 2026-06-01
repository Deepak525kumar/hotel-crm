# API Standards

**Source**: MASTER_ARCHITECTURE_v2.0 Section 16  
**Status**: MVP Phase 1

---

## Response Format

### Success Response (200/201)
```json
{
  "success": true,
  "data": { /* payload */ },
  "error": null
}
```

### Error Response (4xx/5xx)
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "User-friendly message",
    "details": {}
  }
}
```

---

## Required Practices

### 1. Validation
- **Use Zod** for all request bodies
- Validate at middleware level before controller
- Return detailed error messages for invalid fields

### 2. Authentication
- **JWT tokens** in `Authorization: Bearer <token>` header
- Access token: 1 hour expiry
- Refresh token: 7 day expiry
- Token stored in httpOnly cookie (web) or SecureStore (mobile)

### 3. Authorization (RBAC)
- **Check permissions on every endpoint**
- Use permission middleware after auth
- Enforce hotel scoping for managers
- Return 403 Forbidden if permission denied

### 4. Rate Limiting
- **100 requests/minute per IP** (basic)
- Use Redis for rate limit tracking
- Return 429 Too Many Requests when exceeded

### 5. Error Handling
- **Use custom error classes** with HTTP status codes
- Global error middleware catches all exceptions
- Log errors with request ID for debugging
- Return generic error message in production

### 6. Logging
- **Structured JSON logs** via Winston
- Include request ID in all log entries
- Log at different levels (debug, info, warn, error)
- Separate logs for errors and combined output

### 7. Security Headers
- **Helmet.js** for security headers
- HTTPS enforced (Cloudflare)
- CORS restricted to known domains
- XSS, CSRF protections enabled

---

## Common Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `INVALID_REQUEST` | 400 | Request validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Authenticated but no permission |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Resource already exists or state conflict |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Endpoint Categories

### Auth Module (`/api/v1/auth`)
- `POST /signup` - Register new user
- `POST /login` - Login with email/password
- `POST /refresh` - Refresh access token (requires refresh token)
- `POST /logout` - Logout (authenticated)
- `GET /me` - Get current user (authenticated)
- `PUT /profile` - Update profile (authenticated)

**Auth Required**: No for signup/login/refresh  
**Auth Required**: Yes for logout/me/profile

---

### CRM Module (`/api/v1/crm`)

**Hotels**
- `GET /hotels` - List user's hotels (manager: own, admin: all)
- `POST /hotels` - Create hotel (admin only)
- `GET /hotels/:hotel-id` - Get hotel details
- `PUT /hotels/:hotel-id` - Update hotel (manager of hotel)

**Rooms**
- `GET /hotels/:hotel-id/rooms` - List rooms in hotel
- `POST /hotels/:hotel-id/rooms` - Create room (manager of hotel)
- `GET /rooms/:room-id` - Get room details
- `PUT /rooms/:room-id` - Update room (manager of hotel)

**Tasks**
- `POST /hotels/:hotel-id/tasks` - Create task (manager of hotel)
- `GET /tasks` - List tasks (filtered by user role)
- `GET /tasks/:task-id` - Get task details
- `PUT /tasks/:task-id/complete` - Mark task complete with photo (assigned worker)

**Photos**
- `POST /tasks/:task-id/photos` - Upload task photo (assigned worker)
- `GET /tasks/:task-id/photos` - List task photos

**Auth Required**: Yes for all  
**Permission Rules**: Hotel-scoped access enforced

---

### Quality Module (`/api/v1/quality`)

- `POST /verifications` - Submit quality verification (checker only)
- `POST /ratings` - Rate worker (checker only)
- `GET /leaderboard` - Get worker leaderboard (all authenticated users)

**Auth Required**: Yes for all

---

### HR Module (`/api/v1/hr`)

**Contracts**
- `GET /contracts` - List contracts (manager: own hotel, admin: all)
- `POST /contracts` - Create contract (manager)
- `GET /contracts/:contract-id` - Get contract details
- `PUT /contracts/:contract-id` - Update contract (manager)

**Documents**
- `GET /documents` - List documents (manager: own hotel, admin: all)
- `POST /documents` - Upload document (manager)
- `DELETE /documents/:document-id` - Delete document (manager)

**Payroll**
- `GET /payroll` - List payroll records (manager: own hotel, admin: all)
- `POST /payroll` - Create payroll record (manager)
- `GET /payroll/:payroll-id` - Get payroll details (manager/admin, encrypted view)

**Auth Required**: Yes for all  
**Encryption**: Payroll data encrypted at-rest, decrypted in-memory

---

### Staffing Module (`/api/v1/staffing`)

- `POST /work-requests` - Create work request (manager)
- `GET /available-workers` - Get available workers (manager)
- `POST /work-requests/:id/assign-workers` - Assign workers to request (manager)
- `GET /work-requests/:id` - Get work request details
- `PUT /work-requests/:id/status` - Update status (manager)

**Auth Required**: Yes for all  
**Permission Rules**: Hotel-scoped, manager-only creation

---

### Notifications Module (`/api/v1/notifications`)

- `GET /` - List notifications (user's own)
- `POST /:id/read` - Mark notification as read
- `DELETE /:id` - Delete notification

**Auth Required**: Yes for all

---

### Calendar Module (`/api/v1/calendar`)

- `GET /hotels/:hotel-id/operations` - List daily operations
- `POST /hotels/:hotel-id/operations` - Create daily operation (manager)

**Auth Required**: Yes for all

---

## Validation Examples

### Request Body Validation (Zod)

```typescript
import { z } from 'zod';

const createTaskSchema = z.object({
  hotel_id: z.string().uuid('Invalid hotel ID'),
  room_id: z.string().uuid('Invalid room ID'),
  title: z.string().min(3, 'Title required'),
  description: z.string().optional(),
  assigned_to: z.string().uuid('Invalid worker ID'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});

// Validate in controller
const validated = createTaskSchema.parse(req.body);
```

### Error Response Example

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      },
      {
        "field": "password",
        "message": "Password must be at least 8 characters"
      }
    ]
  }
}
```

---

## Database Locks (Concurrency)

For sensitive operations (worker assignment, payroll), use database locks:

```typescript
async function assignWorker(workRequestId, workerId, managerId) {
  return await db.$transaction(async (tx) => {
    // Lock worker's current assignments
    const existingAssignment = await tx.workerAssignments.findFirst({
      where: {
        worker_id: workerId,
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] }
      }
    });

    if (existingAssignment) {
      throw new Error('Worker already assigned');
    }

    // Create new assignment
    return await tx.workerAssignments.create({
      data: {
        worker_id: workerId,
        work_request_id: workRequestId,
        assigned_by_manager_id: managerId,
        status: 'ASSIGNED',
        assigned_at: new Date()
      }
    });
  });
}
```

---

## Testing Standards

All endpoints must have:
1. **Validation tests**: Invalid input rejected
2. **Auth tests**: Unauthenticated requests rejected
3. **Permission tests**: Unauthorized requests forbidden
4. **Happy path tests**: Valid requests succeed
5. **Integration tests**: End-to-end with database

---

## Performance Targets (MVP)

- API response: < 500ms
- Database query: < 100ms (with indexes)
- File upload: < 5 seconds
- Cache hit rate: > 80% for frequently accessed data

---

## Monitoring

- **Sentry**: Error tracking and alerting
- **Winston**: Structured logging
- **Request logging**: UUID per request for tracing
- **Health check**: `GET /health` returns 200 OK

---

## GDPR Compliance

For sensitive endpoints (payroll, documents, HR):
- Log every access to audit_log table
- Include actor, action, resource, timestamp
- Encrypt payroll data at rest
- Support data export and deletion
