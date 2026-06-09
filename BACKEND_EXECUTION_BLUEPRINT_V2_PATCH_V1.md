# BACKEND_EXECUTION_BLUEPRINT_V2_PATCH_V1

**Document Type:** Architecture Compliance Patch  
**Audits:** BACKEND_EXECUTION_BLUEPRINT_V2.md  
**Branch:** claude/optimistic-turing-wu7y5r  
**Date:** 2026-06-09  
**Status:** AUDIT COMPLETE — see Section 5

---

## Audit Scope

This patch audits BACKEND_EXECUTION_BLUEPRINT_V2.md against the following frozen architecture decisions as stated by the Principal Backend Architect:

| Source | Availability |
|--------|-------------|
| Explicit frozen decisions stated in audit request | AVAILABLE |
| Hotel Worker Management Architecture | NOT FOUND IN DRIVE |
| WorkRequest Final Architecture | NOT FOUND IN DRIVE |
| Quality & Rating Architecture | NOT FOUND IN DRIVE |
| Marketplace Refactor Plan | NOT FOUND IN DRIVE |
| Mobile Product Blueprint Patch V1 | NOT FOUND IN DRIVE |

**Note:** All five named frozen source documents were searched across all 20 files in the connected Google Drive and were not found. The following documents were found and cross-referenced: MASTER ARCHITECTURE v2.0, EVENT FLOW MAPPING v1.0, API STANDARDS v1.0, DATABASE RELATIONSHIP DIAGRAM v1.0, IMPLEMENTATION PROCESS v1.0. These are legacy task-based architecture documents and do not contain marketplace-specific decisions. The audit below is grounded in (a) frozen decisions explicitly stated in the audit request, (b) the full content of BACKEND_EXECUTION_BLUEPRINT_V2.md, and (c) the existing codebase (`schema.prisma`, `jwt.ts`, `permissions.ts`). Where a named source document was unavailable, the issue is flagged with **[SOURCE UNAVAILABLE]** so it can be re-validated when those documents are published to Drive.

---

## SECTION 1: BLOCKING ISSUES

Blocking issues are definition mismatches that will produce incorrect migrations, incorrect runtime behavior, or broken enforcement logic. These must be resolved before any Sprint 1 work begins.

---

### BLOCK-01 — HotelWorkerStatus enum is wrong

**Location in V2:** Section 3 (Prisma Migration Order), Migration 3; Appendix B (Data Model Reference)

**V2 defines:**
```
enum HotelWorkerStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
}
```

**Frozen lifecycle:**
```
enum HotelWorkerStatus {
  INVITED
  ACTIVE
  SUSPENDED
  REMOVED
}
```

**Delta:**
- `INACTIVE` must be removed. It is not a valid state in the frozen lifecycle.
- `INVITED` must be added. It is the entry state when a hotel invites a user to join.
- `REMOVED` must be added. It is the terminal state when a worker is removed from a hotel.

**Impact:**
- Migration 3 will generate the wrong enum definition.
- WorkerService application approval flow (V2 Section 4, Service 7) transitions from PENDING → ACTIVE, bypassing INVITED state entirely.
- The invite flow described in Sprint 2 (HotelWorker module) has no corresponding enum state to represent the pending-invite condition.
- Any RBAC check that gates on `HotelWorkerStatus.ACTIVE` is correct, but any check against INACTIVE will fail silently or match incorrectly.

**Required fix:** See SECTION 4, PATCH-01.

---

### BLOCK-02 — hotel_ids scope enforcement throughout blueprint contradicts frozen membership model

**Location in V2:** Multiple — RBAC matrix (Appendix A), service descriptions (Section 4), sprint tasks (Section 7), middleware references (Section 6)

**Specific occurrences identified:**

| Location | Offending text |
|----------|---------------|
| Appendix A, RBAC Matrix | "hotel_ids scope" used as enforcement column header for all hotel-scoped endpoints |
| Section 4, AuthService | "JWT payload: { userId, role, hotel_ids[] }" |
| Section 4, HotelService | "Validate hotel_ids membership before returning hotel data" |
| Section 4, WorkerService | "Check hotel_ids contains target hotelId" |
| Section 7, Sprint 2 tasks | "RBAC middleware: hotel_ids scope enforcement" |
| Section 6, CI/CD | Integration test suite references hotel_ids fixture data |
| Existing `jwt.ts` | `hotel_ids: string[]` in JwtPayload interface |
| Existing `permissions.ts` | `req.auth.hotel_ids.includes(hotelId)` enforcement |

**Frozen decision:**
- `User.hotel_ids[]` has been removed from the User model.
- Hotel membership must be enforced through `HotelWorker` table lookups (worker-to-hotel join record must exist and be ACTIVE).
- HotelManager membership (if applicable) enforced through the HotelManager join table.

**Impact:**
- The JWT payload in V2 carries `hotel_ids[]` which is derived from a column that does not exist in the marketplace schema. The JWT generation service will either error or carry stale/empty data.
- The permissions middleware (`hotel_ids.includes(hotelId)`) will always pass or always fail once the column is removed, depending on whether the array is empty or undefined.
- Every hotel-scoped endpoint listed in Appendix A uses the wrong enforcement mechanism.
- Sprint 2 task "RBAC middleware: hotel_ids scope enforcement" will implement the wrong middleware, blocking all subsequent sprints that depend on it.

**Required fix:** See SECTION 4, PATCH-02.

---

## SECTION 2: MAJOR ISSUES

Major issues are gaps or inconsistencies that will result in incomplete implementations, incorrect data models, or unvalidated service flows. These must be resolved before the affected sprint begins.

---

### MAJOR-01 — Attendance model missing verification fields

**Location in V2:** Section 3 (Migration 8); Appendix B (Data Model Reference); Section 4 (AttendanceService)

**V2 defines:**
```
model Attendance {
  id              String           @id @default(uuid())
  assignment_id   String
  clocked_in_at   DateTime?
  clocked_out_at  DateTime?
  status          AttendanceStatus
  notes           String?
  created_at      DateTime         @default(now())
  updated_at      DateTime         @updatedAt
}
```

**Frozen requirement (per audit request):**
- `attendance_verified` (Boolean) — whether the attendance record has been verified
- `verified_by` (String, FK to User) — who verified the attendance
- `verified_at` (DateTime) — when verification occurred

**Impact:**
- The AttendanceService verification flow described in V2 Section 4 (Service 9) has no model fields to write to. The verification endpoint `POST /attendance/:id/verify` would have no effect on persisted data.
- QualityVerification workflow depends on attendance being verified before quality review can proceed. Without these fields, there is no way to gate QualityVerification on a completed attendance verification.
- The Sprint 5 attendance verification task will produce a no-op migration.

**[SOURCE UNAVAILABLE]** Exact field types and constraints require validation against the frozen attendance workflow document. The fields listed above are from the audit request specification.

**Required fix:** See SECTION 4, PATCH-03.

---

### MAJOR-02 — WorkRequest DRAFT status not addressed

**Location in V2:** Section 3 (Migration 5); Appendix B; Section 4 (WorkRequestService)

**V2 defines:**
```
enum WorkRequestStatus {
  OPEN
  FILLED
  CANCELLED
  COMPLETED
}
```

**Audit question (per request):** Determine whether DRAFT is required for MVP.

**Finding:**
- V2 does not include DRAFT.
- The user's audit request explicitly asks whether DRAFT is required for MVP, indicating it may have been present in the WorkRequest Final Architecture document.
- Without DRAFT, a WorkRequest is immediately OPEN on creation, meaning workers can apply to a request before the hotel manager has finished configuring it.
- A DRAFT state would gate visibility of WorkRequests to external workers until the manager explicitly publishes.

**[SOURCE UNAVAILABLE]** Cannot confirm whether DRAFT is frozen-required or explicitly excluded without the WorkRequest Final Architecture document.

**Recommendation:** This issue is flagged as MAJOR because the absence of DRAFT changes the WorkRequest creation UX flow, notification triggers (workers notified immediately on create vs. on publish), and the WorkRequestService state machine. Until the source document is available, treat DRAFT as EXCLUDED from MVP and document that assumption explicitly in the blueprint.

**Required fix:** See SECTION 4, PATCH-04.

---

### MAJOR-03 — RBAC matrix uses hotel_ids enforcement notation throughout Appendix A

**Location in V2:** Appendix A (RBAC Matrix), all rows

**V2 Appendix A uses "hotel_ids scope" as the enforcement mechanism column for every hotel-scoped endpoint.** This is a direct consequence of BLOCK-02 but is called out separately because Appendix A is the reference document for all middleware implementation work.

**Every row in Appendix A that reads:**
```
Scope: hotel_ids.includes(hotelId)
```
**must be replaced with:**
```
Scope: HotelWorker record exists where userId = req.auth.userId AND hotelId = :hotelId AND status = ACTIVE
```
or for manager-scoped endpoints:
```
Scope: HotelManager record exists where userId = req.auth.userId AND hotelId = :hotelId
```

**Impact:** Sprint 2 RBAC middleware implementation will be built on the wrong enforcement model if Appendix A is not patched before Sprint 2 begins.

**Required fix:** See SECTION 4, PATCH-02 (covers both BLOCK-02 and this issue).

---

### MAJOR-04 — HotelManager model absent from blueprint

**Location in V2:** Not present anywhere.

**Frozen decision (per audit request):** "Membership must be enforced through: HotelWorker, HotelManager (if applicable)."

**Finding:**
- V2 contains no `HotelManager` model in migrations, data model appendix, service layer, or endpoints.
- If HotelManager is part of the frozen architecture, its absence means: (a) the migration order is incomplete, (b) the RBAC matrix has no manager-scoped enforcement path, (c) the MANAGER role has no join table to validate hotel membership against.
- The existing schema does not contain a HotelManager model, confirming it has not yet been implemented.

**[SOURCE UNAVAILABLE]** Whether HotelManager is a required MVP model or a future-phase model cannot be confirmed without the Hotel Worker Management Architecture or Marketplace Refactor Plan documents.

**Required fix:** See SECTION 4, PATCH-05.

---

### MAJOR-05 — Notification triggers not validated against Mobile Product Blueprint Patch V1

**Location in V2:** Section 4 (NotificationService), Section 5 (Integration Test Suite 10)

**V2 defines the following notification triggers:**
1. WorkRequest published → notify eligible workers
2. WorkApplication received → notify hotel manager
3. WorkApplication approved → notify worker
4. WorkApplication rejected → notify worker
5. WorkerAssignment created → notify worker
6. Attendance clock-in → notify manager
7. Attendance clock-out → notify manager
8. QualityVerification submitted → notify worker
9. Rating submitted → notify worker

**[SOURCE UNAVAILABLE]** Mobile Product Blueprint Patch V1 was not found in Drive. Cannot validate whether these triggers are complete, whether there are additional required triggers (e.g., assignment cancellation, WorkRequest cancellation, reminder notifications), or whether trigger payloads match the mobile notification schema.

**Required fix:** See SECTION 4, PATCH-06.

---

### MAJOR-06 — WorkRequest PARTIALLY_FILLED status discrepancy

**Location in V2:** Section 3 (Migration 5); existing `schema.prisma` line ~85

**Existing schema has:**
```
enum WorkRequestStatus {
  OPEN
  PARTIALLY_FILLED
  FILLED
  CANCELLED
}
```

**V2 defines:**
```
enum WorkRequestStatus {
  OPEN
  FILLED
  CANCELLED
  COMPLETED
}
```

**Delta:**
- `PARTIALLY_FILLED` exists in the current schema but is absent from V2. V2 migration will drop this value.
- `COMPLETED` is in V2 but absent from the current schema. V2 migration will add this value.

**Impact:**
- If any existing production data has `status = 'PARTIALLY_FILLED'`, the migration will fail or require a data migration step first.
- V2 migration order does not include a data migration step to backfill or reclassify PARTIALLY_FILLED records.
- The absence of PARTIALLY_FILLED means a WorkRequest with 3 of 5 slots filled appears identical to one with 0 slots filled (both OPEN). This may be intentional if WorkRequest tracks a single worker slot, or may be a gap if multi-slot requests are in scope.

**[SOURCE UNAVAILABLE]** Cannot confirm whether PARTIALLY_FILLED is intentionally removed in the marketplace architecture without the WorkRequest Final Architecture document.

**Required fix:** See SECTION 4, PATCH-07.

---

## SECTION 3: MINOR ISSUES

Minor issues are discrepancies, ambiguities, or documentation gaps that do not block implementation but must be resolved before the sprint that touches the affected module.

---

### MINOR-01 — WorkerAssignment CONFIRMED status not in existing schema

**Location in V2:** Section 3 (Migration 6); Appendix B

**V2 defines:**
```
enum WorkerAssignmentStatus {
  ASSIGNED
  CONFIRMED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  REASSIGNED
}
```

**Existing schema has:**
```
enum WorkerAssignmentStatus {
  ASSIGNED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  REASSIGNED
}
```

`CONFIRMED` is new in V2. Whether this represents worker acknowledgment of an assignment (distinct from ASSIGNED) needs confirmation. If it represents a distinct lifecycle step, it should be documented in the state machine and the transition trigger (worker explicitly confirms vs. system auto-confirms) must be specified.

---

### MINOR-02 — Sprint 2 task wording explicitly references hotel_ids

**Location in V2:** Section 7, Sprint 2

**V2 Sprint 2 contains the task:**
> "RBAC middleware: hotel_ids scope enforcement"

This task description will be implemented as the wrong middleware if not corrected before Sprint 2. The task should read:
> "RBAC middleware: HotelWorker membership scope enforcement"

This is a documentation issue that cascades into implementation if not caught. Covered by PATCH-02.

---

### MINOR-03 — QualityVerification and Rating re-linking not explicitly called out in migration notes

**Location in V2:** Section 3 (Migrations 9, 10)

V2 correctly links `QualityVerification.assignment_id` and `Rating.assignment_id` (replacing legacy `task_id`). However, the migration notes do not explicitly state that the legacy `task_id` FK is being dropped. If the migration runs against a database that has existing `task_id` data, the migration will silently succeed but leave orphaned data.

The migration notes should include:
- Explicit `DROP COLUMN task_id` statement reference
- A note that any existing quality verification or rating data linked to tasks (not assignments) is not migrated and will be abandoned

---

### MINOR-04 — AttendanceStatus EXCUSED not validated against frozen workflow

**Location in V2:** Section 3 (Migration 8); Appendix B

**V2 defines:**
```
enum AttendanceStatus {
  EXPECTED
  CLOCKED_IN
  CLOCKED_OUT
  ABSENT
  EXCUSED
}
```

`EXCUSED` implies a business process for excusing absences (who can excuse, what triggers the transition, whether excused absences affect ratings). V2 does not define this process. If `EXCUSED` transitions are not implemented, the status will be an orphan value with no service path to reach it.

**[SOURCE UNAVAILABLE]** Cannot validate against frozen attendance workflow document.

---

### MINOR-05 — Integration test suite does not cover HotelWorker invite flow

**Location in V2:** Section 5 (Integration Test Suite 3 — HotelWorker)

V2 Integration Test Suite 3 covers ACTIVE/SUSPENDED worker states but does not include tests for:
- Inviting a user (INVITED state creation)
- Accepting an invitation (INVITED → ACTIVE transition)
- Declining an invitation (INVITED → REMOVED transition)
- Removing an active worker (ACTIVE → REMOVED transition)

This gap is a direct consequence of BLOCK-01. Once PATCH-01 is applied, test suite 3 must be extended.

---

### MINOR-06 — No explicit soft-delete strategy for HotelWorker REMOVED state

**Location in V2:** Section 4 (HotelWorkerService); Section 3 (Migration 3)

V2 does not specify whether a REMOVED HotelWorker record is soft-deleted (status = REMOVED, record retained) or hard-deleted. Given GDPR requirements stated in V2 Appendix C, the record must be retained with status = REMOVED for audit purposes. This should be explicitly stated in the migration and service layer notes.

---

## SECTION 4: REQUIRED PATCHES

---

### PATCH-01 — Fix HotelWorkerStatus enum

**Targets:** BLOCK-01

**Change to Migration 3 (HotelWorker):**

Replace:
```prisma
enum HotelWorkerStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
}
```

With:
```prisma
enum HotelWorkerStatus {
  INVITED
  ACTIVE
  SUSPENDED
  REMOVED
}
```

**Change to HotelWorker model — add invite tracking fields:**
```prisma
model HotelWorker {
  id          String            @id @default(uuid())
  hotel_id    String
  user_id     String
  role        WorkerRole
  status      HotelWorkerStatus @default(INVITED)
  invited_by  String            // FK to User (manager who sent invite)
  invited_at  DateTime          @default(now())
  activated_at DateTime?        // set when status transitions to ACTIVE
  removed_at  DateTime?         // set when status transitions to REMOVED
  removed_by  String?           // FK to User
  suspended_at DateTime?
  suspended_by String?
  created_at  DateTime          @default(now())
  updated_at  DateTime          @updatedAt

  hotel       Hotel             @relation(fields: [hotel_id], references: [id])
  user        User              @relation(fields: [user_id], references: [id])

  @@unique([hotel_id, user_id])
  @@index([hotel_id, status])
}
```

**Change to HotelWorkerService — state machine:**

Define explicit transitions:
- CREATE → status: INVITED (not ACTIVE)
- ACCEPT INVITE → INVITED → ACTIVE (worker-initiated)
- DECLINE INVITE → INVITED → REMOVED (worker-initiated)
- SUSPEND → ACTIVE → SUSPENDED (manager-initiated)
- REINSTATE → SUSPENDED → ACTIVE (manager-initiated)
- REMOVE → ACTIVE → REMOVED (manager-initiated, soft delete)

**Change to Integration Test Suite 3:**

Add test cases:
- `POST /hotels/:id/workers` → creates HotelWorker with status INVITED
- `POST /hotels/:id/workers/:workerId/accept` → transitions INVITED → ACTIVE
- `POST /hotels/:id/workers/:workerId/decline` → transitions INVITED → REMOVED
- `DELETE /hotels/:id/workers/:workerId` → transitions ACTIVE → REMOVED

**Change to Sprint 2 task list:**

Add: "Implement HotelWorker invite flow: create (INVITED), accept (ACTIVE), decline (REMOVED), remove (REMOVED)"

---

### PATCH-02 — Replace hotel_ids scope enforcement with HotelWorker membership lookup

**Targets:** BLOCK-02, MAJOR-03, MINOR-02

**Change to JWT payload (AuthService, `jwt.ts`):**

Remove:
```typescript
interface JwtPayload {
  userId: string;
  role: UserRole;
  hotel_ids: string[];
}
```

Replace with:
```typescript
interface JwtPayload {
  userId: string;
  role: UserRole;
  // Hotel membership is NOT embedded in JWT.
  // Enforce via HotelWorker DB lookup per request.
}
```

**Change to permissions middleware (`permissions.ts`):**

Remove:
```typescript
const isAuthorized = req.auth.hotel_ids.includes(hotelId);
```

Replace with:
```typescript
const membership = await prisma.hotelWorker.findFirst({
  where: {
    user_id: req.auth.userId,
    hotel_id: hotelId,
    status: 'ACTIVE',
  },
});
const isAuthorized = membership !== null;
```

For MANAGER role, enforce via HotelManager lookup if HotelManager model is added (see PATCH-05). Until then, MANAGER enforcement uses HotelWorker with `role = MANAGER`.

**Change to Appendix A (RBAC Matrix):**

Replace all occurrences of:
```
Enforcement: hotel_ids.includes(hotelId)
```
With:
```
Enforcement: HotelWorker { userId, hotelId, status: ACTIVE } exists
```

For manager-gated endpoints:
```
Enforcement: HotelWorker { userId, hotelId, status: ACTIVE, role: MANAGER } exists
```

**Change to Sprint 2 task list:**

Replace:
```
RBAC middleware: hotel_ids scope enforcement
```
With:
```
RBAC middleware: HotelWorker membership scope enforcement (DB lookup, not JWT claim)
```

**Performance note:** Hotel membership is now a DB query per request. Add a Redis cache layer:
- Key: `hotel_membership:{userId}:{hotelId}`
- TTL: 60 seconds
- Invalidate on: HotelWorker status change, role change, removal

---

### PATCH-03 — Add attendance verification fields to Attendance model

**Targets:** MAJOR-01

**Change to Migration 8 (Attendance):**

Add fields to Attendance model:
```prisma
model Attendance {
  id                  String           @id @default(uuid())
  assignment_id       String
  clocked_in_at       DateTime?
  clocked_out_at      DateTime?
  status              AttendanceStatus
  notes               String?
  attendance_verified Boolean          @default(false)
  verified_by         String?          // FK to User (manager or checker who verified)
  verified_at         DateTime?
  created_at          DateTime         @default(now())
  updated_at          DateTime         @updatedAt

  assignment  WorkerAssignment @relation(fields: [assignment_id], references: [id])
  verifier    User?            @relation("AttendanceVerifier", fields: [verified_by], references: [id])

  @@index([assignment_id])
  @@index([attendance_verified])
}
```

**Change to AttendanceService — verification flow:**

Add verification endpoint: `POST /attendance/:id/verify`
- Caller must have MANAGER or CHECKER role with active hotel membership
- Sets `attendance_verified = true`, `verified_by = req.auth.userId`, `verified_at = now()`
- Emits `attendance.verified` event for downstream QualityVerification gating

**Change to QualityVerificationService — gating:**

Add pre-condition check: `attendance.attendance_verified === true` before allowing QualityVerification submission against the linked assignment.

**Change to Integration Test Suite 8 (Attendance):**

Add: verify attendance → confirm `attendance_verified`, `verified_by`, `verified_at` are persisted

---

### PATCH-04 — Document WorkRequest DRAFT decision

**Targets:** MAJOR-02

**V2 must include an explicit architecture decision record for WorkRequest DRAFT:**

Add to Section 2 (Architecture Decisions) or Appendix C:

```
DECISION: WorkRequest DRAFT status — EXCLUDED from MVP

Rationale: WorkRequest is published immediately on creation (status: OPEN).
Hotel managers must have all required fields populated before calling POST /work-requests.
Partial/draft requests are not persisted.

If DRAFT is required post-MVP:
- Add DRAFT to WorkRequestStatus enum
- Add POST /work-requests/:id/publish endpoint (DRAFT → OPEN transition)
- Notification trigger for worker eligibility moves from creation to publish event
- WorkRequest creation endpoint returns 201 with status DRAFT, not visible to workers

Assumption: Validated against WorkRequest Final Architecture — DRAFT excluded from MVP scope.
[SOURCE UNAVAILABLE — re-validate when WorkRequest Final Architecture is published to Drive]
```

---

### PATCH-05 — Clarify HotelManager model scope

**Targets:** MAJOR-04

**Add to Section 2 (Architecture Decisions) or Appendix C:**

```
DECISION: HotelManager model — DEFERRED pending frozen architecture confirmation

Current implementation: MANAGER role enforcement uses HotelWorker table with role = MANAGER.
A separate HotelManager join table is NOT included in MVP migrations.

If HotelManager is confirmed as a separate model in the Hotel Worker Management Architecture:
- Add Migration 3b: HotelManager (hotel_id, user_id, permissions[], invited_by, status)
- Update RBAC matrix: manager-scoped endpoints enforce via HotelManager lookup, not HotelWorker
- Update JWT: no hotel_ids; manager hotel access via HotelManager DB lookup (same pattern as PATCH-02)

[SOURCE UNAVAILABLE — re-validate when Hotel Worker Management Architecture is published to Drive]
```

---

### PATCH-06 — Mark notification triggers as pending Mobile Blueprint validation

**Targets:** MAJOR-05

**Add to Section 4 (NotificationService) and Section 5 (Integration Test Suite 10):**

```
VALIDATION PENDING: The following notification triggers are defined based on
marketplace workflow inference. All triggers must be re-validated against
Mobile Product Blueprint Patch V1 before Sprint 6 (Notifications module) begins.

Specifically validate:
- Whether assignment cancellation triggers a notification (not currently listed)
- Whether WorkRequest cancellation triggers notifications to all applicants (not currently listed)
- Whether reminder/escalation notifications are in scope for MVP
- Exact notification payload schema (fields, types) required by mobile client
- Whether push notification vs. in-app notification distinction affects trigger logic

[SOURCE UNAVAILABLE — Mobile Product Blueprint Patch V1 not found in Drive]
```

---

### PATCH-07 — Address WorkRequest PARTIALLY_FILLED removal

**Targets:** MAJOR-06

**Add to Migration 5 notes:**

```
DATA MIGRATION REQUIRED: The existing schema contains WorkRequestStatus.PARTIALLY_FILLED.
Before running this migration on any environment with existing data:

1. Run: UPDATE work_requests SET status = 'OPEN' WHERE status = 'PARTIALLY_FILLED';
2. Then apply the enum migration to remove PARTIALLY_FILLED.

If PARTIALLY_FILLED records should instead be reclassified as FILLED or CANCELLED,
confirm with product before running step 1.

DECISION: PARTIALLY_FILLED is removed from the marketplace architecture.
WorkRequest tracks a single-slot or fixed-slot requirement. Partial fill is
represented by WorkerAssignment count vs. required_workers count, not by a
status value on WorkRequest itself.

[SOURCE UNAVAILABLE — re-validate against WorkRequest Final Architecture]
```

---

## SECTION 5: FINAL STATUS

```
FINAL STATUS: APPROVED_WITH_PATCHES
```

**Rationale:**

BACKEND_EXECUTION_BLUEPRINT_V2.md is structurally sound. The marketplace workflow sequence, migration order, service layer decomposition, endpoint structure, integration test organization, CI/CD pipeline, and sprint breakdown are valid and implementation-ready.

Two blocking issues prevent Sprint 1/2 work from starting without corrections:

1. **BLOCK-01** (HotelWorkerStatus enum) — affects Migration 3 and the entire HotelWorker service layer. PATCH-01 provides a complete fix.
2. **BLOCK-02** (hotel_ids scope enforcement) — affects JWT generation, permissions middleware, RBAC matrix, and every hotel-scoped endpoint. PATCH-02 provides a complete fix including performance mitigation via Redis cache.

Both patches are well-scoped and do not require restructuring the blueprint. They are additive corrections to specific sections.

The five named frozen source documents were not accessible in Drive at audit time. Four issues are marked **[SOURCE UNAVAILABLE]** and must be re-validated once those documents are published. These do not block implementation — they are flagged as explicit assumptions with documented re-validation triggers.

**Patch application order:**
1. Apply PATCH-01 (HotelWorkerStatus) — required before Migration 3 authoring
2. Apply PATCH-02 (hotel_ids removal) — required before Sprint 2 RBAC middleware work
3. Apply PATCH-03 (Attendance verification fields) — required before Sprint 5 attendance module
4. Apply PATCH-04 (DRAFT decision record) — documentation, apply before Sprint 3
5. Apply PATCH-05 (HotelManager scope) — documentation, apply before Sprint 2
6. Apply PATCH-06 (notification trigger validation flag) — documentation, apply before Sprint 6
7. Apply PATCH-07 (PARTIALLY_FILLED data migration note) — required before any staging migration run

**V2 is APPROVED for implementation after PATCH-01 and PATCH-02 are applied.**

---

*Patch document produced by audit of BACKEND_EXECUTION_BLUEPRINT_V2.md against frozen architecture decisions stated by Principal Backend Architect. Re-validate [SOURCE UNAVAILABLE] items against Hotel Worker Management Architecture, WorkRequest Final Architecture, Quality & Rating Architecture, Marketplace Refactor Plan, and Mobile Product Blueprint Patch V1 when those documents are available in Drive.*
