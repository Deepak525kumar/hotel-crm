# Event Flow Mapping

**Source**: MASTER_ARCHITECTURE_v2.0 Sections 4, 9  
**Status**: MVP Phase 1  
**Scope**: Only Phase 1 features (no chatbot, geolocation, advanced automation)

---

## 🔄 Core User Workflows

### Flow 1: Worker Task Completion

**Actors**: Manager (creator), Worker (assignee), Checker (verifier)

```
┌──────────────┐
│ MANAGER      │
└──────┬───────┘
       │ 1. POST /tasks
       │    - hotel_id, room_id, worker_id, description, priority
       ▼
┌──────────────┐         ┌─────────────────┐
│ CREATE TASK  │────────→│ Task: ASSIGNED  │
└──────────────┘         └────────┬────────┘
                                   │
                  2. Notification triggered
                     └─ APNs (iOS) or FCM (Android)
                     └─ Email notification
                     └─ In-app badge
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ WORKER           │
                          │ Receives & Views │
                          └────────┬─────────┘
                                   │
                         3. PUT /tasks/:id/complete
                            - photos[] (1..N)
                            - status: IN_PROGRESS → COMPLETED
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ PHOTO UPLOAD     │
                          │ (1..N per task)  │
                          └────────┬─────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ TASK: COMPLETED  │
                          │ + photos stored  │
                          └────────┬─────────┘
                                   │
                  4. Notification triggered
                     └─ Manager: "Task #123 completed"
                     └─ In-app badge
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ CHECKER          │
                          │ Receives work    │
                          │ to verify        │
                          └────────┬─────────┘
                                   │
                         5. POST /verifications/:task-id
                            - score (0-100)
                            - notes (optional)
                            - status: VERIFIED
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ QUALITY_VERIFIED │
                          │ RATING created   │
                          └────────┬─────────┘
                                   │
                  6. Notification triggered
                     └─ Worker: "Quality verified: X%"
                     └─ Rating recorded
                     └─ Leaderboard updated
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ TASK COMPLETE    │
                          │ Workflow Done    │
                          └──────────────────┘

Timeline: 
- Creation → Completion: Hours
- Completion → Verification: Minutes to hours
- Verification → Rating: Seconds
- Task lifecycle: 1 day (typical)
```

---

### Flow 2: Worker Assignment (Staffing)

**Actors**: Manager (requester), Worker (assignee), System (enforcer)

```
┌──────────────┐
│ MANAGER      │
│ Creates Work │
│ Request      │
└──────┬───────┘
       │ 1. POST /staffing/work-requests
       │    - hotel_id, position (cleaner/checker)
       │    - workers_needed (N)
       │    - shift_date, shift_start_time, shift_end_time
       ▼
┌──────────────────────┐
│ WORK_REQUEST created │
│ Status: OPEN         │
└──────┬───────────────┘
       │
       │ 2. GET /staffing/available-workers
       │    (filtered by hotel_id, date, not assigned)
       ▼
┌──────────────────────┐
│ AVAILABLE_WORKERS    │
│ Response with list   │
└──────┬───────────────┘
       │
       │ 3. POST /staffing/work-requests/:id/assign-workers
       │    - worker_ids[] (matches workers_needed)
       │
       │ DATABASE TRANSACTION:
       │ ├─ Lock: SELECT...FOR UPDATE on worker_assignments
       │ ├─ Check: No active assignment (ASSIGNED, IN_PROGRESS)
       │ ├─ Validate: UNIQUE constraint check
       │ ├─ Create: WorkerAssignment(s) with status: ASSIGNED
       │ ├─ Update: WorkRequest status: FILLED
       │ └─ Commit or Rollback
       ▼
┌──────────────────────┐
│ ASSIGNMENTS CREATED  │
│ Status: ASSIGNED     │
│ (1 per worker)       │
└──────┬───────────────┘
       │
       │ 4. Notifications triggered
       │    ├─ APNs/FCM: "New work request"
       │    ├─ Email: "Hotel X, Date Y, Shift Z"
       │    └─ In-app badge
       │
       │ **CRITICAL: Workers do NOT see room numbers yet**
       │ They only see: hotel, time, position, duration
       ▼
┌──────────────────────┐
│ WORKER NOTIFIED      │
│ Accepts/Declines     │
│ (manual UI action)   │
└──────┬───────────────┘
       │ (If worker declines)
       │ ├─ PUT /assignments/:id/cancel
       │ ├─ Status: CANCELLED
       │ └─ Manager reassigns or work request stays OPEN
       │
       │ (If worker accepts - manual action in manager app)
       │ ├─ Manager acknowledges acceptance
       │ └─ Proceeds to daily operations assignment
       ▼
┌──────────────────────┐
│ READY FOR DISPATCH   │
│ Manager assigns      │
│ specific rooms       │
│ (email or in-person) │
└──────────────────────┘

Concurrency Safety:
- Database constraint: UNIQUE(worker_id, status) WHERE status IN (ASSIGNED, IN_PROGRESS)
- Transaction lock: SELECT...FOR UPDATE prevents race conditions
- If manager 1 and manager 2 try to assign same worker:
  → Manager 1 succeeds, creates assignment
  → Manager 2 fails with "Worker already assigned" error
  → Automatic retry or reassign to different worker

Status Transitions:
OPEN → PARTIALLY_FILLED → FILLED (if workers_needed met)
or
OPEN → CANCELLED (manager cancels request)
```

---

### Flow 3: HR Contract Management

**Actors**: Manager (creator), Worker (views), Admin (manages templates)

```
┌──────────────┐
│ ADMIN        │
│ or Manager   │
└──────┬───────┘
       │ 1. (One-time setup) Create contract templates
       │    POST /hr/contract-templates
       │    - name: "Standard Cleaner"
       │    - template_content (HTML with placeholders)
       │    - required_fields: {salary: required, end_date: optional}
       ▼
┌──────────────────────┐
│ TEMPLATES AVAILABLE  │
│ (reusable)           │
└──────┬───────────────┘
       │
       │ 2. POST /hr/contracts (manager)
       │    - worker_id
       │    - template_id
       │    - fill in: {salary: 2500, end_date: null}
       │    - status: draft
       ▼
┌──────────────────────┐
│ CONTRACT: DRAFT      │
│ (ready for signing)  │
└──────┬───────────────┘
       │
       │ 3. Manager sends to worker (via email/link)
       │    - PDF generated with filled data
       │    - "Please sign and return"
       ▼
┌──────────────────────┐
│ WORKER REVIEWS       │
│ Contract (PDF)       │
└──────┬───────────────┘
       │
       │ 4. Worker signs & sends back (manual process)
       │    Manager updates: status: signed, signed_at: NOW()
       │    PUT /hr/contracts/:id
       ▼
┌──────────────────────┐
│ CONTRACT: SIGNED     │
│ Stored encrypted     │
│ (encrypted_data)     │
└──────┬───────────────┘
       │
       │ 5. Auto-deletion trigger (GDPR)
       │    DataRetentionLog created:
       │    - hire_date: contract.start_date
       │    - retention_end_date: hire_date + 3 years
       │    - status: PENDING
       │
       │ Daily job checks retention_end_date:
       │ ├─ 30 days before: Send notice to manager
       │ ├─ On date: Auto-delete & mark deleted_at
       │ └─ Log deletion to AuditLog
       ▼
┌──────────────────────┐
│ CONTRACT LIFECYCLE   │
│ End (auto-deleted)   │
└──────────────────────┘

Timeline:
- Creation to signing: Days
- Active: 1+ years (employment period)
- Post-deletion: 3 years retention (tax law)
- Data deletion: Auto-executed with notice
```

---

### Flow 4: Payroll Processing

**Actors**: Manager (creates), Worker (views), Admin (audits)

```
┌──────────────┐
│ MANAGER      │
└──────┬───────┘
       │ 1. POST /hr/payroll (monthly)
       │    - worker_id
       │    - pay_period_start, pay_period_end
       │    - gross_salary, deductions, taxes
       │    - status: draft
       ▼
┌──────────────────────┐
│ PAYROLL: DRAFT       │
│ (encrypted at-rest)  │
└──────┬───────────────┘
       │
       │ 2. PUT /hr/payroll/:id
       │    - Add line items (hours, deductions, tax)
       │    - status: calculated
       │    - Audit log: "Manager reviewed payroll"
       ▼
┌──────────────────────┐
│ PAYROLL: CALCULATED  │
│ (ready for approval) │
└──────┬───────────────┘
       │
       │ 3. PUT /hr/payroll/:id
       │    - status: approved
       │    - approved_by_manager_id
       │    - Audit log: "Manager approved payroll"
       ▼
┌──────────────────────┐
│ PAYROLL: APPROVED    │
│ (ready for payment)  │
└──────┬───────────────┘
       │
       │ 4. PUT /hr/payroll/:id
       │    - status: paid
       │    - paid_at: NOW()
       │    - Notification: "Salary paid"
       │    - Audit log: "Payroll marked paid"
       ▼
┌──────────────────────┐
│ PAYROLL: PAID        │
│ (final state)        │
│ NEVER DELETABLE      │
└──────┬───────────────┘
       │
       │ 5. Worker access (encrypted)
       │    GET /hr/payroll/:id
       │    - Decrypt in-memory
       │    - Return to user (HTTP only, secure cookie)
       │    - Audit log: "Worker viewed payroll"
       │
       │ 6. Data retention: 7 years (tax law)
       │    - Auto-delete only after 7 years
       │    - Never deletable on demand
       │    - Audit trail preserved (5 years)
       ▼
┌──────────────────────┐
│ 7-YEAR RETENTION     │
│ Then auto-deleted    │
└──────────────────────┘

Access Control:
- Manager: Can view, create, edit, approve at own hotel
- Worker: Can view own payroll only (read-only)
- Admin: Can view all, but cannot delete

Encryption:
- Stored: AES-256-GCM encrypted in DB
- Key: Environment variable (never in code)
- Decryption: In-memory only, never logged

Audit Trail:
- Every access logged to AuditLog
- Actor, action, timestamp, IP, user_agent
- Cannot be deleted (5-year retention)
```

---

### Flow 5: Quality Verification & Leaderboard

**Actors**: Checker (verifies), Worker (rates on), System (aggregates)

```
┌──────────────┐
│ CHECKER      │
│ Receives     │
│ completed    │
│ task         │
└──────┬───────┘
       │ 1. GET /tasks/:id (with photos)
       │    - View task completion photos
       │    - Review work quality
       ▼
┌──────────────────────┐
│ VIEWING TASK PHOTOS  │
│ (stored in DO Spaces,│
│  encrypted)          │
└──────┬───────────────┘
       │
       │ 2. POST /quality/verifications
       │    - task_id
       │    - score (0-100)
       │    - notes (optional)
       ▼
┌──────────────────────┐
│ VERIFICATION CREATED │
│ Score recorded       │
└──────┬───────────────┘
       │
       │ 3. POST /quality/ratings
       │    - task_id
       │    - given_to_worker_id (assigned worker)
       │    - score (0-100)
       │    - comment (optional)
       ▼
┌──────────────────────┐
│ RATING CREATED       │
│ Score & comment      │
└──────┬───────────────┘
       │
       │ 4. Auto-aggregation (synchronous)
       │    System recalculates:
       │    - WorkerOverallRating.average_rating
       │    - WorkerOverallRating.total_ratings
       │    - WorkerOverallRating.last_updated = NOW()
       ▼
┌──────────────────────┐
│ LEADERBOARD UPDATED  │
│ Worker rank changes  │
│ Real-time            │
└──────┬───────────────┘
       │
       │ 5. Notification (to worker)
       │    APNs/FCM: "You received a rating: X%"
       │    Email (optional): Rating details
       │    In-app: New rating visible
       ▼
┌──────────────────────┐
│ WORKER NOTIFIED      │
│ & Sees Rank Update   │
│ (GET /leaderboard)   │
└──────────────────────┘

Leaderboard Public:
- GET /quality/leaderboard (authenticated)
- Shows: rank, worker name, avg rating, # ratings
- Visible to all authenticated users
- Updated in real-time
- Data retention: 2 years (then auto-deleted)
```

---

### Flow 6: GDPR Data Export & Deletion

**Actors**: Worker (requests), System (executes), Manager (approves)

```
┌──────────────┐
│ WORKER       │
└──────┬───────┘
       │ 1. Worker logs in, clicks "Export My Data"
       │    POST /account/export
       │    - Triggers email with download link
       │    - Link expires in 24 hours
       ▼
┌──────────────────────┐
│ EXPORT REQUEST SENT  │
│ Processing...        │
└──────┬───────────────┘
       │
       │ 2. Background job:
       │    - user_profile.json
       │    - contracts.pdf (all signed contracts)
       │    - payroll_records.csv (all payroll)
       │    - documents.zip (all uploaded docs)
       │    - ratings_history.csv
       │    - consent_records.json
       ▼
┌──────────────────────┐
│ ZIP CREATED          │
│ Email sent to worker │
│ Link: /download/...  │
│ Expires: 24h         │
└──────┬───────────────┘
       │
       │ 3. Worker downloads ZIP
       │    - Contains all personal data
       │    - In portable format
       │    - Audit log: "Worker exported data"
       ▼
┌──────────────────────┐
│ EXPORT COMPLETE      │
│ (Worker has backup)  │
└──────┬───────────────┘

Deletion Flow:
┌──────────────┐
│ WORKER       │
└──────┬───────┘
       │ 4. Worker requests data deletion
       │    POST /account/delete?confirm=true
       │    - Can delete: profile photo
       │    - Cannot delete: payroll (7yr retention), contracts (3yr)
       │    - Payroll shows: "Required until [date]"
       ▼
┌──────────────────────┐
│ DELETION INITIATED   │
│ (what CAN delete)    │
└──────┬───────────────┘
       │
       │ 5. System action:
       │    - Delete profile_photo_url
       │    - Soft-delete allowed WorkerDocuments
       │    - Soft-delete allowed Contracts
       │    - Create DataRetentionLog for: CONTRACT, DOCUMENTS
       │    - Audit log: "Worker deleted data"
       │
       │ 6. Retention schedule:
       │    - Contracts: deleted after 3yr + 30-day notice
       │    - Documents: deleted after 1yr + 30-day notice
       │    - Payroll: NEVER deletable (tax law), 7-year retention
       │    - Ratings: deleted after 2 years
       │
       │ Note: Soft-deletes preserve audit trail
       ▼
┌──────────────────────┐
│ GDPR COMPLIANT       │
│ Data deleted/archived│
└──────────────────────┘

Compliance Checks:
✅ Consent tracking (signup with consent_log)
✅ Retention policies (auto-delete after period)
✅ Data export (within 30 days)
✅ Deletion rights (profile photo anytime)
✅ Audit logging (all access logged)
✅ Encryption (payroll, documents at-rest)
✅ DPA (signed with DigitalOcean)
```

---

### Flow 7: Notification Delivery (Multi-Channel)

**Trigger**: Any action (task created, verified, rated, etc.)

```
┌─────────────────────────┐
│ EVENT TRIGGERED         │
│ (Task completed, etc)   │
└──────┬──────────────────┘
       │
       │ 1. Notification service receives event
       │    - Event type: TASK_COMPLETED, VERIFIED, RATED
       │    - Recipient: user_id
       │    - Context: task_id, score, etc
       ▼
┌─────────────────────────┐
│ DETERMINE CHANNELS      │
│ ├─ User device OS       │
│ ├─ Push token available?│
│ └─ Email preferred?     │
└──────┬──────────────────┘
       │
       │ 2a. PUSH NOTIFICATION
       │     ├─ iOS (APNs): User has push token
       │     │  └─ POST to Apple Push Service
       │     │     Title: "Task verified"
       │     │     Body: "Your work scored 85%"
       │     │
       │     └─ Android (FCM): User has FCM token
       │        └─ POST to Firebase Cloud Messaging
       │           Title: "Task verified"
       │           Body: "Your work scored 85%"
       │
       │ 2b. EMAIL
       │     └─ SendGrid/Resend API
       │        To: user.email
       │        Subject: "Your task has been verified"
       │        Body: HTML email template
       │
       │ 2c. IN-APP NOTIFICATION
       │     └─ INSERT into notifications table
       │        - user_id, type, title, body, data (JSON)
       │        - created_at
       │        - is_read (default false)
       ▼
┌─────────────────────────┐
│ DELIVERY COMPLETE       │
│ User receives message   │
│ via all channels        │
└────────┬────────────────┘
         │
         │ 3. User interactions
         │    - Mobile: Tap notification → Open app
         │    - Web: See badge & notification list
         │    - Email: Click link
         ▼
┌─────────────────────────┐
│ USER VIEWS CONTENT      │
│ (task details, rating)  │
└──────┬──────────────────┘
       │
       │ 4. Mark as read (optional)
       │    POST /notifications/:id/read
       │    - Update: is_read = true
       │    - Timestamp read_at = NOW()
       ▼
┌─────────────────────────┐
│ NOTIFICATION LIFECYCLE  │
│ COMPLETE                │
└─────────────────────────┘

Notification Events (MVP):
1. TASK_ASSIGNED → Worker (APNs/FCM)
2. TASK_COMPLETED → Manager (in-app)
3. TASK_VERIFIED → Worker (APNs/FCM, email)
4. RATING_RECEIVED → Worker (APNs/FCM, in-app)
5. CONTRACT_EXPIRING_SOON → Manager (in-app, email)
6. DOCUMENT_UPLOADED → Manager (in-app)
7. PAYROLL_PAID → Worker (in-app, email)

Channels (Phase 1):
✅ APNs (iOS workers)
✅ FCM (Android workers)
✅ Email (all users)
✅ In-app (all users)

NOT Included (Phase 2+):
❌ SMS
❌ Slack/Teams integration
❌ Notification preferences (quiet hours)
❌ Digest emails
```

---

## 🔐 Cross-Cutting Concerns

### Error Handling
```
Every workflow must handle:
1. Authentication failure → 401 Unauthorized
2. Permission denied → 403 Forbidden
3. Resource not found → 404 Not Found
4. Validation error → 400 Bad Request
5. Conflict (race condition) → 409 Conflict
6. Server error → 500 Internal Server Error

Example:
POST /staffing/work-requests/:id/assign-workers
- Worker already assigned → 409 Conflict
  "Worker already assigned. Available after: [date]"
- Hotel not found → 404 Not Found
- Manager not for this hotel → 403 Forbidden
```

### Audit Logging
```
Log ALL sensitive operations:
- Contract creation/update/delete
- Payroll creation/view/modification
- Document upload/download/delete
- Worker assignment changes
- Quality verification
- Data export requests

Log includes:
- actor_id (who did it)
- action (VIEW, DOWNLOAD, DELETE, etc)
- resource_type (CONTRACT, PAYROLL, etc)
- resource_id (which contract, etc)
- timestamp
- ip_address
- (5-year retention, never deleted)
```

### Concurrency Safety
```
Critical operations use database transactions:

1. Worker Assignment
   BEGIN TRANSACTION
   SELECT * FROM worker_assignments 
   WHERE worker_id = ? FOR UPDATE  ← Lock
   IF exists active assignment THEN ROLLBACK
   INSERT new assignment
   COMMIT

2. Payroll Changes
   BEGIN TRANSACTION
   UPDATE payroll SET status = 'approved'
   INSERT audit_log
   COMMIT

3. Task Completion
   BEGIN TRANSACTION
   UPDATE task SET status = 'COMPLETED'
   CREATE quality_verification
   RECALCULATE worker_overall_rating
   INSERT notification
   COMMIT
```

---

## 📊 Event Summary Table

| Event | Trigger | Recipient | Channels | Action |
|-------|---------|-----------|----------|--------|
| TASK_ASSIGNED | Manager creates | Worker | APNs/FCM | Task appears in list |
| TASK_COMPLETED | Worker uploads | Manager | In-app | Verification needed |
| VERIFIED | Checker submits | Worker | APNs/FCM | Rating notification |
| RATING_RECEIVED | Rating created | Worker | In-app | Leaderboard updates |
| WORK_REQUEST_OPEN | Manager creates | Available workers | APNs/FCM | Shift offered |
| ASSIGNMENT_CREATED | Manager assigns | Worker | APNs/FCM | Work assigned |
| CONTRACT_CREATED | Manager creates | Worker | Email | Sign contract |
| PAYROLL_PAID | Manager marks | Worker | In-app | Salary notification |
| DATA_EXPORT_READY | Worker requests | Worker | Email | Download link |
| DOCUMENT_EXPIRING | Cron job | Manager | In-app | Renewal notice |

---

## 🚀 Implementation Notes

1. **Transactions**: Always use for multi-table updates
2. **Concurrency**: Use `SELECT...FOR UPDATE` on shared resources
3. **Async**: Notifications sent async (don't block API)
4. **Idempotence**: Notification service must handle duplicates
5. **Audit Trail**: Log every sensitive action
6. **Error Recovery**: Implement retry logic for failed notifications
7. **Testing**: Test each workflow with all error cases
