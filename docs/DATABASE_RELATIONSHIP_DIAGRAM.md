# Database Relationship Diagram

**Source**: Prisma Schema (backend/prisma/schema.prisma)  
**Status**: MVP Phase 1 (23 tables)  
**Database**: PostgreSQL 15 (DigitalOcean Managed)  
**ORM**: Prisma

---

## 📊 Entity Relationship Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AUTH MODULE (2)                            │
├─────────────────────────────────────────────────────────────────────┤
│ User                              Session                            │
│ • id (PK)                        • id (PK)                          │
│ • email (UNIQUE)                 • user_id (FK → User)             │
│ • password_hash                  • refresh_token                    │
│ • first_name, last_name          • expires_at                       │
│ • profile_photo_url              • created_at                       │
│ • role (WORKER|CHECKER|MANAGER|ADMIN)                              │
│ • hotel_ids (array)              └─ User has 0..N Sessions         │
│ • permissions (array)                                              │
│ • is_active, deleted_at                                            │
│ • created_at, updated_at                                           │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ owns/manages
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         CRM MODULE (5)                              │
├─────────────────────────────────────────────────────────────────────┤
│ Hotel                  Room              Task           TaskPhoto    │
│ • id (PK)            • id (PK)        • id (PK)       • id (PK)     │
│ • name               • hotel_id (FK)  • hotel_id (FK) • task_id (FK)│
│ • city, country      • number         • room_id (FK)  • url         │
│ • address            • type           • assigned_to_worker_id (FK)  │
│ • timezone           • status         • created_by_manager_id (FK)  │
│ • is_active          • notes          • description   User assigned │
│ • created_at         • created_at     • priority      can upload    │
│ • updated_at         • updated_at     • status        multiple      │
│                                       • created_at    photos per    │
│ ├─ has 0..N Rooms   └─ has 0..N Tasks│ • updated_at   task (1..N)   │
│ ├─ has 0..N Tasks   └─ has 0..N DailyOps│ • started_at  │
│ └─ has 0..N DailyOps               │ • completed_at  │
│                                    └─ Task assigned to User
│                                     └─ Task created by Manager
│                                     └─ Task has 0..N Photos
└─────────────────────────────────────────────────────────────────────┘
          │
          │ assigned_to
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       QUALITY MODULE (3)                            │
├─────────────────────────────────────────────────────────────────────┤
│ QualityVerification        Rating              WorkerOverallRating  │
│ • id (PK)                • id (PK)           • id (PK)             │
│ • task_id (FK → Task)    • task_id (FK)      • worker_id (FK)      │
│ • verified_by_id (FK)    • given_by_id (FK)  • average_rating      │
│ • score (0-100)          • given_to_id (FK)  • total_ratings       │
│ • notes                  • score (0-100)     • last_updated        │
│ • verified_at            • comment           • created_at          │
│ • created_at             • created_at        • updated_at          │
│                                                                     │
│ Task has 1..1 Verification  Task has 1..1 Rating                   │
│ Task created & verified by User (Checker)                          │
│ Rating given by Checker to assigned Worker                         │
│ Worker ratings aggregated in WorkerOverallRating                   │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ references
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        HR MODULE (7)                                │
├─────────────────────────────────────────────────────────────────────┤
│ Contract               ContractTemplate     WorkerDocument          │
│ • id (PK)            • id (PK)            • id (PK)                │
│ • worker_id (FK)     • hotel_id (FK)      • worker_id (FK)         │
│ • hotel_id (FK)      • name               • hotel_id (FK)          │
│ • template_id (FK)   • description        • document_type          │
│ • contract_number    • template_content   • document_name          │
│ • start_date         • required_fields    • document_url (encrypted)│
│ • end_date           • created_at         • document_hash          │
│ • employment_type    • updated_at         • expiry_date            │
│ • position                                • uploaded_by_id (FK)    │
│ • salary_amount      Template has 0..N   • created_at             │
│ • status (signed)    Contracts            • deleted_at (soft)      │
│ • document_url (encrypted)                                          │
│ • deleted_at (soft)  Hotel can have                                 │
│ • created_at         multiple templates   Worker has 0..N Docs     │
│ • updated_at                                                        │
│                                                                     │
│ Payroll              PayrollLineItem     RequiredDocuments         │
│ • id (PK)          • id (PK)            • id (PK)                 │
│ • worker_id (FK)   • payroll_id (FK)    • hotel_id (FK)           │
│ • hotel_id (FK)    • description        • document_type           │
│ • pay_period_start • amount             • is_required             │
│ • pay_period_end   • amount_type        • renewal_frequency       │
│ • gross_salary     • created_at         • created_at              │
│ • encrypted_data (AES-256)                                        │
│ • status (approved, paid)  Payroll has 0..N LineItems            │
│ • paid_at                                                          │
│ • created_at                                                       │
│                                                                     │
│ DataRetentionLog                                                   │
│ • id (PK)                                                          │
│ • worker_id (FK)                                                   │
│ • data_category (CONTRACT|PAYROLL|DOCUMENTS|etc)                  │
│ • hire_date                                                        │
│ • retention_end_date                                               │
│ • retention_years (3|7|1|2)                                        │
│ • status (PENDING|DELETED)                                         │
│ • deleted_at                                                       │
│ • created_at, updated_at                                           │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ manages
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     STAFFING MODULE (3)                             │
├─────────────────────────────────────────────────────────────────────┤
│ WorkRequest              WorkerAssignment        DailyOperation     │
│ • id (PK)             • id (PK)                • id (PK)           │
│ • hotel_id (FK)       • worker_id (FK)         • assignment_id (FK)│
│ • created_by_manager_id (FK)• work_request_id (FK)• room_id (FK)   │
│ • position            • assigned_at            • room_number       │
│ • workers_needed      • assigned_by_manager_id (FK) • room_type    │
│ • shift_date          • status (ASSIGNED|COMPLETED) • tasks        │
│ • shift_start_time    • started_at             • status            │
│ • shift_end_time      • completed_at           • assigned_at       │
│ • status (OPEN|FILLED)• created_at             • started_at        │
│ • filled_at                                    • completed_at      │
│ • created_at          WorkRequest has 0..N    • created_at        │
│                       Assignments                                   │
│ Manager creates work requests (1..N)                               │
│ Manager assigns workers from available pool                        │
│ UNIQUE constraint: (worker_id, status) WHERE                       │
│   status IN ('ASSIGNED', 'IN_PROGRESS')                            │
│   → Prevents double-booking                                        │
│                                                                     │
│ DailyOperation tracks actual room details                          │
│ (filled in by manager AFTER worker accepts)                        │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ notifies
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NOTIFICATIONS MODULE (1)                         │
├─────────────────────────────────────────────────────────────────────┤
│ Notification                                                        │
│ • id (PK)                                                          │
│ • user_id (FK → User)                                              │
│ • type (TASK_ASSIGNED|VERIFIED|RATED|etc)                         │
│ • title                                                            │
│ • body                                                             │
│ • data (JSON, extra context)                                       │
│ • is_read                                                          │
│ • created_at                                                       │
│                                                                     │
│ User receives 0..N Notifications (in-app, push, email)            │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ tracks access
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COMPLIANCE MODULE (2)                            │
├─────────────────────────────────────────────────────────────────────┤
│ AuditLog                              ConsentLog                    │
│ • id (PK)                           • id (PK)                      │
│ • actor_id (FK → User)              • worker_id (FK → User)        │
│ • actor_role                        • consent_type                 │
│ • action (VIEW|DOWNLOAD|DELETE)     • consent_given (boolean)      │
│ • resource_type (CONTRACT|PAYROLL)  • consent_version              │
│ • resource_id                       • ip_address                   │
│ • details (JSON)                    • user_agent                   │
│ • ip_address                        • consent_source               │
│ • timestamp                         • timestamp                    │
│ • (5-year retention, never deleted) • (5-year retention)           │
│                                                                     │
│ Every HR/payroll/contract access logged                            │
│ GDPR compliance: audit trail for sensitive data                    │
│ Consent recorded at signup with proof                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 Relationships Summary

### User (Central entity)
- **1..N** Sessions (JWT refresh tokens)
- **0..N** Created Tasks (manager)
- **0..N** Assigned Tasks (worker)
- **0..N** Quality Verifications (checker)
- **0..N** Ratings Given (checker)
- **0..N** Ratings Received (worker)
- **0..N** Contracts (worker or creator)
- **0..N** Documents Uploaded (manager)
- **0..N** Payroll Records (worker)
- **0..N** Work Assignments (worker)
- **0..N** Work Requests Created (manager)
- **0..N** Daily Operations Created (manager)
- **0..N** Notifications (all roles)
- **0..N** Audit Log Entries (all sensitive actions)

### Hotel (Org entity)
- **0..N** Rooms
- **0..N** Tasks
- **0..N** Daily Operations
- **0..N** Work Requests
- **0..N** Contracts
- **0..N** Worker Documents
- **0..N** Payroll Records
- **0..N** Quality Verifications
- **0..N** Ratings
- **0..N** Contract Templates

### Task (Core workflow)
- **1..1** Hotel (required)
- **1..1** Room (required)
- **1..1** Assigned Worker (required)
- **1..1** Created By Manager (required)
- **0..N** Photos (task completion)
- **0..1** Quality Verification (optional, filled in by checker)
- **0..1** Rating (optional, filled in by checker)

### WorkRequest + WorkerAssignment (Staffing)
- **1..N** (WorkRequest → WorkerAssignments)
- **0..N** (Worker → WorkerAssignments, with unique constraint)
- **1..N** (WorkerAssignment → DailyOperations)

---

## 🔐 Critical Constraints

### Uniqueness
- **User**: `email` (unique)
- **Room**: `(hotel_id, number)` (unique per hotel)
- **WorkerAssignment**: `(worker_id, status)` WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
  - **Purpose**: Prevent double-booking workers

### Foreign Keys
- All tables cascade delete on parent deletion
- Hotel deleted → all its rooms, tasks, work requests deleted
- User deleted → sessions, assignments, notifications deleted

### Soft Deletes
- **User**: `deleted_at` (employees, users can be deleted)
- **Contract**: `deleted_at` (retention policies)
- **WorkerDocument**: `deleted_at` (GDPR compliance)

---

## 📋 Table Count by Module

| Module | Count | Purpose |
|--------|-------|---------|
| Auth | 2 | User credentials, JWT sessions |
| CRM | 5 | Hotels, rooms, tasks, photos, operations |
| Quality | 3 | Verification, ratings, leaderboard |
| HR | 7 | Contracts, documents, payroll, retention |
| Staffing | 3 | Work requests, assignments, operations |
| Notifications | 1 | User notifications (in-app, push, email) |
| Compliance | 2 | Audit logs, consent tracking |
| **TOTAL** | **23** | **MVP Phase 1** |

---

## 🔍 Key Queries for Implementation

### Auth Module
```sql
-- Get user with all relations
SELECT u.* FROM users u WHERE u.id = ?;

-- Get active session
SELECT * FROM sessions WHERE user_id = ? AND expires_at > NOW();

-- Check email exists
SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL;
```

### CRM Module
```sql
-- Get tasks assigned to worker
SELECT t.* FROM tasks t 
WHERE t.assigned_to_worker_id = ? 
AND t.status IN ('ASSIGNED', 'IN_PROGRESS')
ORDER BY t.created_at DESC;

-- Get all tasks for manager's hotel
SELECT t.* FROM tasks t 
JOIN hotels h ON t.hotel_id = h.id 
WHERE h.id = ANY(?) AND t.created_at >= NOW() - INTERVAL '30 days';

-- Get room occupancy
SELECT r.id, r.number, r.status, COUNT(t.id) as active_tasks
FROM rooms r 
LEFT JOIN tasks t ON r.id = t.room_id AND t.status != 'COMPLETED'
WHERE r.hotel_id = ? 
GROUP BY r.id;
```

### Quality Module
```sql
-- Get worker overall rating
SELECT wor.* FROM worker_overall_rating wor 
WHERE wor.worker_id = ? AND wor.updated_at >= NOW() - INTERVAL '30 days';

-- Get leaderboard (top 10)
SELECT wor.*, u.first_name, u.last_name
FROM worker_overall_rating wor 
JOIN users u ON wor.worker_id = u.id 
WHERE u.deleted_at IS NULL 
ORDER BY wor.average_rating DESC 
LIMIT 10;
```

### HR Module
```sql
-- Get active contracts for worker
SELECT c.* FROM contracts c 
WHERE c.worker_id = ? 
AND c.status = 'signed' 
AND (c.end_date IS NULL OR c.end_date > NOW());

-- Get payroll for period
SELECT p.*, pli.* FROM payroll p 
LEFT JOIN payroll_line_items pli ON p.id = pli.payroll_id 
WHERE p.worker_id = ? 
AND p.pay_period_start = ? 
AND p.pay_period_end = ?;

-- Find documents expiring soon
SELECT wd.* FROM worker_documents wd 
WHERE wd.hotel_id = ? 
AND wd.expiry_date <= NOW() + INTERVAL '30 days' 
AND wd.deleted_at IS NULL;
```

### Staffing Module
```sql
-- Get available workers (not assigned on date)
SELECT u.* FROM users u 
WHERE u.role IN ('WORKER', 'CHECKER') 
AND u.hotel_ids @> ARRAY[?] 
AND u.id NOT IN (
  SELECT DISTINCT wa.worker_id 
  FROM worker_assignments wa 
  WHERE wa.status IN ('ASSIGNED', 'IN_PROGRESS') 
  AND DATE(wa.assigned_at) = ?
)
AND u.deleted_at IS NULL;

-- Get active assignment for worker
SELECT wa.*, wr.*, do.* 
FROM worker_assignments wa 
JOIN work_requests wr ON wa.work_request_id = wr.id 
LEFT JOIN daily_operations do ON wa.id = do.worker_assignment_id 
WHERE wa.worker_id = ? 
AND wa.status IN ('ASSIGNED', 'IN_PROGRESS') 
LIMIT 1;

-- Check worker availability (concurrency safe)
BEGIN;
SELECT * FROM worker_assignments 
WHERE worker_id = ? AND status IN ('ASSIGNED', 'IN_PROGRESS') 
FOR UPDATE;
-- If empty, safe to assign. If not empty, reject.
COMMIT;
```

### Compliance Module
```sql
-- Get audit log for payroll access
SELECT al.* FROM audit_log al 
WHERE al.actor_id = ? 
AND al.resource_type = 'PAYROLL' 
AND al.timestamp >= NOW() - INTERVAL '5 years' 
ORDER BY al.timestamp DESC;

-- Get worker consents
SELECT cl.* FROM consent_log cl 
WHERE cl.worker_id = ? 
AND cl.timestamp >= NOW() - INTERVAL '5 years' 
ORDER BY cl.timestamp DESC;

-- Find data to delete (retention expired)
SELECT drl.* FROM data_retention_log drl 
WHERE drl.retention_end_date <= NOW() 
AND drl.status = 'PENDING';
```

---

## 🚀 Indexing Strategy

All tables have indexes on:
- Primary keys (default)
- Foreign keys (for joins)
- Filter columns (role, status, is_active, deleted_at)
- Date columns for range queries

**Special Indexes**:
- `user_assignments(worker_id, status)` – Concurrency safety
- `tasks(hotel_id, status)` – Hotel-scoped queries
- `rooms(hotel_id, number)` – Unique constraint
- `sessions(expires_at)` – Token expiry cleanup

---

## 📈 Growth Considerations

### Current (MVP)
- 23 tables
- ~500-1000 users per hotel
- 1-5 hotels
- ~5000 tasks/month

### Phase 2 Growth
- Add: `worker_locations`, `geofences`, `geofence_events`
- Add: `availability`, `schedules`, `shift_swaps`
- Add: `chat_history` (chatbot)
- Consider: Read replicas for analytics

### No Sharding Yet
- Single PostgreSQL instance sufficient for MVP
- Hotel-scoped queries naturally partition data
- Future: Horizontal shard by hotel_id if needed

---

## ✅ Implementation Notes

1. **Always use transactions** for multi-table updates (assignments, payroll)
2. **Use `SELECT...FOR UPDATE`** on worker assignments to prevent race conditions
3. **Encrypt at-rest**: Payroll data, worker documents
4. **Soft deletes**: Never hard-delete user, contract, document data
5. **Audit log everything**: HR/payroll access must be logged
6. **Index strategically**: Don't add unnecessary indexes; use EXPLAIN ANALYZE
7. **Cascade deletes**: Remove orphaned data when parent deleted
