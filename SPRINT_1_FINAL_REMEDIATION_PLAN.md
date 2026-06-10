# SPRINT 1 FINAL REMEDIATION PLAN

**Date:** 2026-06-10
**Branch:** `claude/epic-hawking-t190p5`
**Input documents:**
- `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` (prior plan, written under 5 missing documents)
- `docs/PRISMA_SCHEMA_V2_FREEZE.md` (canonical schema — `APPROVED_WITH_MINOR_FOLLOWUPS`)
- `docs/API_SPEC_V1_PATCH_V2.md` (canonical API spec — `APPROVED_WITH_PATCHES`)
- `MARKETPLACE_REFACTOR_MASTER_PLAN.md` (architecture freeze — `FROZEN`)
- `SCHEMA_RECONCILIATION_DECISION.md` (MVP schema decision — analysis-only)
- `PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md` (prior PR audit — analysis-only)
- `PR2_SALVAGE_PLAN.md` (prior PR salvage — analysis-only)
- `SPRINT_1_COMPLIANCE_REPORT.md` (factual inventory — Sprint 1)
- Direct code inspection of `claude/epic-hawking-t190p5`

---

## DOCUMENT RECOVERY STATUS

| Document requested | Found | Source branch/path |
|---|---|---|
| `DOCUMENT_RECOVERY_AUDIT.md` | **NOT FOUND** | Absent from all 19 branches |
| `GOVERNANCE_RECONSTRUCTION_REPORT.md` | **NOT FOUND** | Absent from all 19 branches |
| `CANONICAL_ARCHITECTURE_INDEX.md` | **NOT FOUND** | Absent from all 19 branches |
| `SCHEMA_RECONCILIATION_DECISION.md` | Found | `claude/peaceful-planck-u39n66` |
| `PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md` | Found | `claude/peaceful-planck-u39n66` |
| `PR2_SALVAGE_PLAN.md` | Found | `claude/peaceful-planck-u39n66` |
| `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` | Found | `claude/epic-hawking-t190p5` (current branch) |

The three unfound documents are not required to produce this plan. Sufficient canonical authority is provided by the six recovered documents, which collectively resolve all five decisions that were `⚠ BLOCKED` in the prior plan.

---

## PART 1: FINDING-BY-FINDING RECONCILIATION

Each finding from `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` is assessed as:
- **VALIDATED** — finding confirmed correct by recovered documents
- **INVALIDATED** — finding was wrong; recovered documents contradict it
- **MODIFIED** — finding was directionally correct but scope, urgency, or resolution has changed

---

### 1.1 Session storage in PostgreSQL

**Prior finding:** Marked `⚠ BLOCKED` — "Session in PostgreSQL unresolved; depends on MARKETPLACE_REFACTOR_MASTER_PLAN.md session strategy decision."

**Verdict: INVALIDATED (was blocked; now resolved)**

**Evidence:** `PRISMA_SCHEMA_V2_FREEZE.md` §1 entity list includes `Session` as a confirmed V2 entity. `SCHEMA_RECONCILIATION_DECISION.md` §2 row 2: "Session — KEEP — Main's version with `@unique` on `refresh_token` is the safe choice." PostgreSQL Session table is the canonical implementation.

**Implication:** Sprint 1's PostgreSQL Session implementation is architecturally correct. No session strategy change required.

---

### 1.2 `User.hotel_ids TEXT[]` is wrong and must be removed

**Prior finding:** REWRITE driver on auth/service, users/service, hotel-workers/service, schema, JWT, permissions. Marked `⚠ BLOCKED` on `PRISMA_SCHEMA_V2_FREEZE.md` — "must be removed and replaced by HotelMembership junction table."

**Verdict: MODIFIED**

**Evidence — confirms removal is canonical goal:**
- `PRISMA_SCHEMA_V2_FREEZE.md` migration step 2: "User: drop `hotel_ids`"
- `MARKETPLACE_REFACTOR_MASTER_PLAN.md` Phase 1-E step 20: "Drop `User.hotel_ids String[]` column"
- `API_SPEC_V1_PATCH_V2.md` PATCH-04: "Remove `hotel_ids` from all User Response DTOs"

**Evidence — explicit MVP retention decision:**
- `SCHEMA_RECONCILIATION_DECISION.md` §3.1: "Single change vs main: Add `hotel_ids String[]` to User. Why: `checkHotelAccess()` middleware reads `req.auth.hotel_ids`. Without this column on User, the JWT payload cannot be populated at sign-in. The cleaner long-term model would be deriving `hotel_ids` from `HotelWorker` rows where `status = ACTIVE`. That refactor is itself a Phase 2 item; for MVP, denormalise to the User row."
- `SCHEMA_RECONCILIATION_DECISION.md` §7.1: "signup/login/refreshToken must include `hotel_ids` in JWT payload. Both branches already do this; no change."

**Resolution:** `User.hotel_ids` is retained in the MVP schema. The column and its JWT embedding are acceptable Sprint 1 behaviour. The Phase 2 migration to derive it from `HotelWorker` is planned but not required for compliance. **However**, `hotel_ids` must be removed from **User Response DTOs** per API_SPEC_V1_PATCH_V2 PATCH-04 — the field can exist on the User row and in the JWT without being exposed in API responses.

**Implication:** The scope of changes driven by `hotel_ids` is narrower than the prior plan stated:
- `prisma/schema.prisma` — keep `hotel_ids` column on User (MVP decision)
- `lib/jwt.ts` — keep `hotel_ids` in `AccessTokenPayload` (MVP decision)
- `auth/service.ts` — keep `hotel_ids` in `signTokens` calls (MVP decision)
- `middleware/permissions.ts::checkHotelAccess` — reading JWT `hotel_ids` is valid for MVP
- **BUT** `auth/service.ts`, `users/service.ts`, all User response formatting — must omit `hotel_ids` from API response DTOs

---

### 1.3 `User.permissions TEXT[]` column must be removed

**Prior finding:** REWRITE driver — "permissions array written to `User.permissions` column at signup; embedded in JWT."

**Verdict: VALIDATED**

**Evidence:** `PRISMA_SCHEMA_V2_FREEZE.md` entity list for `User` does not include a `permissions` column. The canonical V2 User model has: `id, email, password_hash, first_name, last_name, phone, role (UserRole), is_active, deleted_at, created_at, updated_at, email_verified_at, phone_verified_at, last_login_at`. No `permissions` column.

`MARKETPLACE_REFACTOR_MASTER_PLAN.md` and `PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md` both consistently reference `ROLE_PERMISSIONS` from `config/constants.ts` as the source of permissions, not a stored column.

**Implication:** Sprint 1's `User.permissions TEXT[]` column must be removed from:
- `prisma/schema.prisma`
- `prisma/migrations/migration.sql`
- `auth/service.ts` signup writes
- `users/service.ts` createUser/updateUser writes
- JWT `AccessTokenPayload` (permissions remain in the JWT — derived from `ROLE_PERMISSIONS[role]` at sign time, not read from DB)

---

### 1.4 `lib/jwt.ts` — single JWT secret; `as any` cast; private `parseExpiryToSeconds`

**Prior finding:** REWRITE — "signRefreshToken and verifyRefreshToken must use `JWT_REFRESH_SECRET`; `expiresIn: ...as any` type mismatch."

**Verdict: VALIDATED — scope narrowed to KEEP_WITH_PATCHES (not REWRITE)**

**Evidence:**
- `PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md` I-1: "PR uses `env.JWT_SECRET` for both — BLOCKER. `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V2` PATCH-06 explicitly mandates OPTION A — Two Separate Secrets."
- `PR2_SALVAGE_PLAN.md` §2.1: Full function-level table. Take SignOptions typing from PR branch. Fix secret in `signRefreshToken`/`verifyRefreshToken`. Export `parseExpiryToSeconds`. Remove `hotel_ids` from `AccessTokenPayload`… but per finding 1.2 above, hotel_ids stays for MVP.

The function structure of `lib/jwt.ts` is correct. Three targeted fixes make it compliant. Full rewrite is not required.

**Implication:** REWRITE downgraded to KEEP_WITH_PATCHES.
- Fix: `const secret = env.JWT_REFRESH_SECRET ?? env.JWT_SECRET` in both `signRefreshToken` and `verifyRefreshToken`
- Fix: Change `as any` to `as SignOptions['expiresIn']` (import `{ SignOptions }` from jsonwebtoken)
- Fix: Change `parseExpiryToSeconds` from private function to `export function`

---

### 1.5 `middleware/permissions.ts` — super_admin phantom, stale JWT checks

**Prior finding:** REWRITE — "(1) reads stale permissions from JWT; (2) reads stale hotel_ids from JWT for `checkHotelAccess`; (3) `super_admin` bypass is dead code."

**Verdict: MODIFIED — downgraded to KEEP_WITH_PATCHES**

**Evidence:**
- `super_admin` phantom: `PRISMA_SCHEMA_V2_FREEZE.md` §2 UserRole enum: `WORKER, CHECKER, MANAGER, ADMIN`. No `super_admin`. VALIDATED — the bypass is unreachable dead code.
- `checkHotelAccess` reads JWT `hotel_ids`: per finding 1.2, MVP retains `hotel_ids` in JWT. `checkHotelAccess` reading it is valid for MVP. `SCHEMA_RECONCILIATION_DECISION.md` §7.1 explicitly confirms this pattern.
- `requirePermission` reads `req.auth.permissions`: permissions will still be embedded in the JWT at sign time, derived from `ROLE_PERMISSIONS[role]`. The permissions array in the JWT is not stale — it is derived at login from a static map. The problem is only when User's stored `permissions` column diverges from ROLE_PERMISSIONS. Removing the `User.permissions` DB column (finding 1.3) eliminates that divergence. `requirePermission` reading from JWT permissions is valid once permissions are ROLE_PERMISSIONS-derived.

**Implication:** Two targeted changes make this file compliant:
- Remove the `super_admin` bypass branch (4 lines)
- No change to `checkHotelAccess` (JWT hotel_ids is MVP-valid)
- No change to `requirePermission` (JWT permissions are valid once sourced from ROLE_PERMISSIONS)

---

### 1.6 `auth/service.ts` — multiple structural problems

**Prior finding:** REWRITE — "Session in PG, permissions in JWT, hotel_ids in JWT, role at signup, refreshToken untested."

**Verdict: MODIFIED — downgraded to KEEP_WITH_PATCHES**

**Evidence per sub-issue:**
- Session in PG: INVALIDATED as a problem (confirmed correct — see finding 1.1)
- hotel_ids in JWT: INVALIDATED as a problem for MVP (confirmed acceptable — see finding 1.2)
- permissions in JWT: still needed; source must change from `user.permissions` DB column to `ROLE_PERMISSIONS[user.role]`
- role at signup: `SCHEMA_RECONCILIATION_DECISION.md` §6.3 and `PR2_SALVAGE_PLAN.md` §2.5: signup is open registration for MVP; no `requireRole('admin')` guard on signup. Role field at signup should default to `WORKER`; admin role elevation must not be accepted from untrusted input.
- `refreshToken` untested: still valid — no test coverage exists.

**Implication:** Three targeted fixes:
1. Replace `getDefaultPermissions()` private method (or inline map) with import from `config/constants.ts::ROLE_PERMISSIONS` — remove the redundant local map
2. Remove write of `permissions` to `User.permissions` DB column at signup (column does not exist in V2)
3. Restrict role at signup: default to WORKER; reject `role: 'admin'` from untrusted input

---

### 1.7 `users/service.ts` — hotel_ids array ops, permissions column writes, no tenant scope

**Prior finding:** REWRITE — "hotel_ids: { has: hotel_id } array containment; permissions column writes; no tenant scope."

**Verdict: MODIFIED — downgraded to KEEP_WITH_PATCHES**

**Evidence:**
- `hotel_ids: { has: hotel_id }` filter: per finding 1.2, hotel_ids stays on User for MVP. Array containment filter is acceptable interim implementation.
- `permissions` column writes: `PRISMA_SCHEMA_V2_FREEZE.md` confirms no `User.permissions` column — writes must be removed.
- Response DTOs including `hotel_ids`: `API_SPEC_V1_PATCH_V2.md` PATCH-04 §4a — all User response DTOs must drop `hotel_ids`.
- `hotel_ids` from POST/PATCH request bodies: `API_SPEC_V1_PATCH_V2.md` PATCH-04 §4b — remove from `POST /users` and `PATCH /users/:id` request DTOs.

**Implication:** Three targeted changes:
1. Remove `permissions` writes from `createUser` and `updateUser`
2. Remove `hotel_ids` from User response objects in all service methods
3. Remove `hotel_ids` from `CreateUserSchema` and `UpdateUserSchema` input validation

---

### 1.8 `hotel-workers/service.ts` — wrong storage model (array not junction table)

**Prior finding:** REWRITE — "entire storage model is wrong: User.hotel_ids array not junction table; no assignment history; no unique constraint; no atomicity."

**Verdict: VALIDATED — REWRITE confirmed**

**Evidence:**
- `PRISMA_SCHEMA_V2_FREEZE.md` §1: `HotelWorker` is a canonical V2 entity with `HotelWorkerStatus` lifecycle enum (INVITED → ACTIVE ↔ SUSPENDED → REMOVED).
- `MARKETPLACE_REFACTOR_MASTER_PLAN.md` Part 1-D step 17: "Create `hotel_workers` table — ADD."
- `MARKETPLACE_REFACTOR_MASTER_PLAN.md` Part 4 Additions: `GET /hotels/:id/workers`, `POST /hotels/:id/workers`, `DELETE /hotels/:id/workers/:worker_id` are canonical endpoints.
- `SCHEMA_RECONCILIATION_DECISION.md` §2 row 4: `HotelWorker — KEEP — Core marketplace roster — required for MVP`.

Sprint 1's hotel-workers module operates entirely on `User.hotel_ids` array. The canonical entity `HotelWorker` with `hotel_id, worker_id, skills, is_active, enrolled_at, status` does not yet exist in Sprint 1's schema. The service has three methods, all performing the wrong database operation. This cannot be patched — it must be rewritten against the `HotelWorker` table.

**Note:** `SCHEMA_RECONCILIATION_DECISION.md` §3.1 says hotel_ids is kept for MVP compatibility of `checkHotelAccess`. This does NOT mean the HotelWorker service should continue using the array. It means: after assigning a worker via `HotelWorker`, a data migration or trigger should keep `User.hotel_ids` in sync, OR `checkHotelAccess` should be updated to query `HotelWorker` directly (the Phase 2 refactor). For Sprint 1 compliance, the HotelWorker service must use the `HotelWorker` table.

---

### 1.9 `prisma/schema.prisma` — wrong models, wrong columns

**Prior finding:** REWRITE — "User.hotel_ids (remove), User.permissions (remove), Hotel.deleted_at (add), WorkerAssignment partial index missing, DataRetentionLog FK, 24 models include legacy 4 that should be removed."

**Verdict: MODIFIED**

**Evidence and per-issue assessment:**

| Schema issue | Prior finding | Verdict | Evidence |
|---|---|---|---|
| `User.hotel_ids` present | REMOVE | **INVALIDATED** | SCHEMA_RECONCILIATION_DECISION §3.1: keep for MVP |
| `User.permissions` present | REMOVE | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE: no permissions column on User |
| `Hotel.deleted_at` missing | ADD | **INVALIDATED** | V2 schema does not specify Hotel.deleted_at; not in PRISMA_SCHEMA_V2_FREEZE Hotel fields |
| Room/Task/TaskPhoto/DailyOperation present | REMOVE | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §1: "Removed from V1: Room, Task, TaskPhoto, DailyOperation" |
| Phase 2 HR models present (Contract, Payroll, WorkerDocument, etc.) | REMOVE | **VALIDATED** | SCHEMA_RECONCILIATION_DECISION §2: all ⏭️ Deferred Phase 2; PRISMA_SCHEMA_V2_FREEZE entity list = 13 models |
| `HotelWorker` table absent | ADD | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §1 and §2: canonical MVP entity with HotelWorkerStatus enum |
| `WorkApplication` table absent | ADD | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §1: "mandatory marketplace step — core MVP" |
| `Attendance` table absent | ADD | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §1: "core operational record — required for MVP" |
| `WorkerAssignment` partial unique index missing | ADD | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §4: `WorkerAssignment_worker_active_per_request_uidx` — partial index on `(work_request_id, worker_id) WHERE status IN ('CONFIRMED', 'IN_PROGRESS')` |
| `Session.refresh_token` lacks `@unique` | ADD | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §4: `Session.refresh_token` must be unique |
| `Notification.type` is String not NotificationType enum | CHANGE | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §2: NotificationType enum frozen with 17 domain event values |
| `AuditLog.actor_role` is `String?` not `UserRole?` | CHANGE | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE: typed `UserRole?` |
| `QualityVerification` links to `task_id` | CHANGE | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE and API_SPEC_V1_PATCH_V2 PATCH-02: must use `assignment_id` |
| `Rating` links to `task_id` | CHANGE | **VALIDATED** | Same as QualityVerification |
| `DataRetentionLog FK onDelete: Restrict` | CHANGE | **VALIDATED** | SCHEMA_RECONCILIATION_DECISION §4.1: "use SetNull so deletion is not blocked" |
| `WorkApplication` missing | ADD | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §3: "mandatory marketplace flow — every assignment must trace back to an accepted application" |
| `WorkerAssignment.application_id` FK absent | ADD | **VALIDATED** | PRISMA_SCHEMA_V2_FREEZE §3 SP-3: non-nullable FK to WorkApplication |

---

### 1.10 `/crm/` route prefix — may be wrong

**Prior finding:** `⚠ BLOCKED` — "Route namespace `/crm/hotels` may conflict with marketplace expectation if hotel routes are moved to a top-level namespace."

**Verdict: INVALIDATED**

**Evidence:** `MARKETPLACE_REFACTOR_MASTER_PLAN.md` Part 4 explicitly lists:
- `GET /api/v1/crm/hotels/:id/workers` (ADD)
- `POST /api/v1/crm/hotels/:id/workers` (ADD)
- `/api/v1/crm/hotels` (KEEP)

The `/crm/` prefix is the canonical prefix. Sprint 1's `/api/v1/crm/` prefix is architecturally correct.

---

### 1.11 Two 501 stub routes in `crm/routes.ts`

**Prior finding:** `KEEP_WITH_PATCHES` — "POST /hotels/:hotel_id/tasks and POST /tasks/:task_id/photos return 501 and should be removed."

**Verdict: VALIDATED**

**Evidence:** `MARKETPLACE_REFACTOR_MASTER_PLAN.md` Part 4 Removals: `POST /api/v1/crm/hotels/:id/tasks` → `REMOVE`; `POST /api/v1/crm/tasks/:id/photos` → `REMOVE`. These endpoints have no place in the canonical API surface.

---

### 1.12 ROLE_PERMISSIONS static map is insufficient

**Prior finding:** `KEEP_WITH_PATCHES` — "If marketplace requires dynamic per-hotel permission scoping, flat string model is insufficient. `⚠ BLOCKED` on MARKETPLACE_REFACTOR_MASTER_PLAN.md."

**Verdict: INVALIDATED**

**Evidence:** `MARKETPLACE_REFACTOR_MASTER_PLAN.md` contains no reference to dynamic DB-driven permissions. `PR2_SALVAGE_PLAN.md` §2.6 explicitly says: "Import permissions from `config/constants.ts::ROLE_PERMISSIONS` — replace inline `getDefaultPermissions`." Static ROLE_PERMISSIONS map is the canonical implementation.

---

### 1.13 Hotel module functional gaps

**Prior finding:** "Hotel.deleted_at missing; checkHotelAccess stale JWT problem; 501 stubs."

**Verdict: PARTIALLY INVALIDATED**

**Evidence:**
- `Hotel.deleted_at` missing: `PRISMA_SCHEMA_V2_FREEZE.md` Hotel entity fields do not include `deleted_at`. Not a compliance requirement. **INVALIDATED.**
- `checkHotelAccess` reads JWT hotel_ids: valid for MVP — **INVALIDATED as a problem.**
- 501 stub routes: **VALIDATED** — must be removed.

---

### 1.14 `HotelWorker.types.ts` — REWRITE

**Prior finding:** REWRITE — "once junction table exists, types need assigned_at, status, role_override."

**Verdict: VALIDATED**

**Evidence:** `PRISMA_SCHEMA_V2_FREEZE.md` §2: `HotelWorkerStatus` enum frozen. `HotelWorker` model fields: `id, hotel_id, hotel, worker_id, worker, skills[], is_active, enrolled_at` plus status of type HotelWorkerStatus. The current `AssignWorkerSchema` (`{ worker_id }`) is insufficient. The response type must be `HotelWorker` not a subset of `User`.

---

### 1.15 Auth module route `/crm/` disambiguation

**Prior finding:** Not a finding in the prior plan. New issue revealed by API_SPEC_V1_PATCH_V2.md.

**Verdict: NEW FINDING**

**Evidence:** `API_SPEC_V1_PATCH_V2.md` Final Auth Surface (5 endpoints): `login, refresh, logout, me, password-reset`. No `POST /auth/signup`. User creation is `POST /users` (ADMIN role). Sprint 1 has `POST /auth/signup` as open self-registration. `SCHEMA_RECONCILIATION_DECISION.md` §6.3 and `PR2_SALVAGE_PLAN.md` §2.5 resolve this: for MVP, open self-registration (`POST /auth/signup`) is acceptable and the auth route stays. **No immediate compliance change required.**

---

### 1.16 Sprint 1 completion was 57% — now reassessed

**Prior finding:** Sprint 1 = 57% against marketplace architecture.

**Verdict: MODIFIED — revised to 62%**

Five blocked decisions have been resolved favourably (Session PG confirmed, /crm/ prefix confirmed, hotel_ids MVP retention confirmed, ROLE_PERMISSIONS static map confirmed valid, checkHotelAccess JWT read confirmed MVP-valid). This lifts several scores. See Part 7 for revised calculation.

---

## PART 2: FINAL MODULE CLASSIFICATIONS

| Module | Classification | Change from prior plan | Rationale |
|---|---|---|---|
| **Auth** | `KEEP_WITH_PATCHES` | Downgraded from REWRITE | Session confirmed correct; hotel_ids retained; three targeted fixes (permissions source, role restriction, response DTO) |
| **User** | `KEEP_WITH_PATCHES` | Downgraded from REWRITE | hotel_ids column stays; three targeted fixes (permissions column removal, response DTO hotel_ids, request DTO hotel_ids) |
| **Hotel (CRM)** | `KEEP_WITH_PATCHES` | Unchanged | /crm/ prefix confirmed; stub routes removal; Hotel.deleted_at not required |
| **HotelWorker** | `REWRITE` | Unchanged | Must use HotelWorker table; zero current service methods are reusable |
| **Prisma Schema** | `REWRITE` | Unchanged but scope modified | Remove 4+9 models; add 3 models; fix 7 columns/constraints; keep hotel_ids |
| **RBAC Middleware** | `KEEP_WITH_PATCHES` | Downgraded from REWRITE | checkHotelAccess confirmed MVP-valid; requirePermission confirmed valid once permissions sourced from ROLE_PERMISSIONS; only super_admin fix required |
| **Audit Foundation** | `KEEP_WITH_PATCHES` | Unchanged | Confirmed correct; AuditLog.actor_role enum fix needed |
| **Unit Tests** | Mixed | Unchanged | hotel-workers REWRITE; others KEEP_WITH_PATCHES |

---

## PART 3: FINAL SCHEMA DECISIONS

### 3.1 MVP Schema = V2 + hotel_ids (as per SCHEMA_RECONCILIATION_DECISION §9)

**13 canonical MVP models:**
`User, Session, Hotel, HotelWorker, WorkRequest, WorkApplication, WorkerAssignment, Attendance, QualityVerification, Rating, WorkerOverallRating, Notification, AuditLog`

**9 Phase 2 models (REMOVE from Sprint 1 schema):**
`Contract, ContractTemplate, ContractLineItem, WorkerDocument, RequiredDocument, Payroll, PayrollLineItem, DataRetentionLog, ConsentLog`

**4 legacy models (REMOVE from Sprint 1 schema):**
`Room, Task, TaskPhoto, DailyOperation`

**3 models to ADD to Sprint 1 schema:**
`HotelWorker, WorkApplication, Attendance`

### 3.2 Column-level decisions

| Column | Decision | Authority |
|---|---|---|
| `User.hotel_ids TEXT[]` | **KEEP** for MVP | SCHEMA_RECONCILIATION_DECISION §3.1 |
| `User.permissions TEXT[]` | **REMOVE** | PRISMA_SCHEMA_V2_FREEZE: absent from V2 User |
| `Hotel.deleted_at` | **NOT REQUIRED** | PRISMA_SCHEMA_V2_FREEZE: not in Hotel entity definition |
| `Session.refresh_token @unique` | **ADD** | PRISMA_SCHEMA_V2_FREEZE §4 unique constraints |
| `Notification.type NotificationType` | **ADD ENUM** | PRISMA_SCHEMA_V2_FREEZE §2 |
| `AuditLog.actor_role UserRole?` | **FIX TO ENUM** | PRISMA_SCHEMA_V2_FREEZE §1 |
| `QualityVerification.assignment_id` | **ADD** (task_id removed post-backfill) | API_SPEC_V1_PATCH_V2 PATCH-02, PRISMA_SCHEMA_V2_FREEZE |
| `Rating.assignment_id` | **ADD** (task_id removed post-backfill) | API_SPEC_V1_PATCH_V2 PATCH-02, PRISMA_SCHEMA_V2_FREEZE |
| `WorkerAssignment.application_id FK` | **ADD** | PRISMA_SCHEMA_V2_FREEZE §3 SP-3 |
| `WorkerAssignment` partial unique index | **ADD** | PRISMA_SCHEMA_V2_FREEZE §4 |
| `WorkRequest.version` | **ADD** | PRISMA_SCHEMA_V2_FREEZE §5 Control 3 |

### 3.3 Enum additions required

- `HotelWorkerStatus`: `INVITED, ACTIVE, SUSPENDED, REMOVED`
- `ApplicationStatus`: `PENDING, ACCEPTED, REJECTED, WITHDRAWN, EXPIRED`
- `AssignmentStatus`: `CONFIRMED, IN_PROGRESS, COMPLETED, NO_SHOW, CANCELLED, REASSIGNED`
- `AttendanceStatus`: `EXPECTED, PRESENT, ABSENT, LATE, PARTIAL, EXCUSED`
- `VerificationStatus`: `PASSED, FAILED, NEEDS_REWORK`
- `NotificationType`: 17 domain event values (per PRISMA_SCHEMA_V2_FREEZE §2)
- `WorkRequestStatus`: `DRAFT, OPEN, PARTIALLY_FILLED, FILLED, CANCELLED, EXPIRED`

Sprint 1 schema has partial enum coverage. All 7 enums above must be complete in the remediated schema.

---

## PART 4: FINAL MIGRATION SEQUENCE

Constraints: FK dependency order; no blocked decisions remain.

```
Step 0 — UNBLOCKED: No gateway documents remain missing
  All five blocked decisions resolved:
  ✓ Session strategy: keep PostgreSQL
  ✓ JWT payload hotel_ids: keep for MVP
  ✓ RBAC model: static ROLE_PERMISSIONS
  ✓ Route prefix: /crm/ is correct
  ✓ HotelMembership table name: HotelWorker (canonical name confirmed)

Step 1 — Schema removals (drop 4 legacy + 9 phase 2 models)
  1a. Remove Phase 2 HR model definitions from schema.prisma:
      Contract, ContractTemplate, ContractLineItem,
      WorkerDocument, RequiredDocument, Payroll, PayrollLineItem,
      DataRetentionLog, ConsentLog
  1b. Remove legacy model definitions:
      Room, Task, TaskPhoto, DailyOperation, TaskStatus enum
  1c. Run: npx prisma migrate dev --name remove-legacy-phase2-models

Step 2 — Schema column changes on existing tables
  2a. Remove User.permissions column
  2b. Add Session.refresh_token @unique
  2c. Fix Notification.type to NotificationType enum (with all 17 values)
  2d. Fix AuditLog.actor_role to UserRole? enum
  2e. Add all 7 missing enums
  2f. Run: npx prisma migrate dev --name fix-existing-table-columns

Step 3 — Add new MVP tables (FK dependency order)
  3a. Create WorkApplication table
      (depends on: WorkRequest [already exists], User [exists])
  3b. Create HotelWorker table
      (depends on: Hotel [exists], User [exists])
  3c. Create Attendance table
      (depends on: WorkerAssignment [exists], User [exists])
  3d. Run: npx prisma migrate dev --name add-marketplace-core-tables

Step 4 — Add new columns on surviving tables (FK dependencies resolved by Step 3)
  4a. Add WorkerAssignment.application_id FK → WorkApplication
  4b. Add WorkerAssignment partial unique index
  4c. Add WorkRequest.version INT DEFAULT 0
  4d. Add QualityVerification.assignment_id FK → WorkerAssignment
  4e. Add Rating.assignment_id FK → WorkerAssignment
  4f. Run: npx prisma migrate dev --name add-fk-columns-and-indexes

Step 5 — Regenerate Prisma client
  npx prisma generate

Step 6 — Compile check
  npx tsc --noEmit
  (must pass with zero errors before any service changes)
```

---

## PART 5: FINAL REFACTOR SEQUENCE

Order is constrained by TypeScript compilation dependencies. Lower layers must compile before higher layers are changed.

```
Layer 0 — Schema (prerequisite for all other layers)
  prisma/schema.prisma         → Steps 1–5 above
  prisma/migrations/           → new migration files generated

Layer 1 — Core library
  src/lib/jwt.ts               [KEEP_WITH_PATCHES — 4 targeted changes]
    Fix: import { SignOptions } from 'jsonwebtoken'
    Fix: signRefreshToken → use JWT_REFRESH_SECRET ?? JWT_SECRET
    Fix: verifyRefreshToken → use JWT_REFRESH_SECRET ?? JWT_SECRET
    Fix: parseExpiryToSeconds → change to export function
  src/lib/types.ts             [KEEP_WITH_PATCHES — no change if hotel_ids stays in AuthContext]
  src/lib/base-service.ts      [KEEP_WITH_PATCHES — AuditLog actor_role cast to UserRole enum]
  src/config/constants.ts      [KEEP_WITH_PATCHES — ROLE_PERMISSIONS is valid; no changes]

Layer 2 — Middleware
  src/middleware/auth.ts       [KEEP_AS_IS — no changes required]
  src/middleware/permissions.ts [KEEP_WITH_PATCHES — 1 change]
    Fix: Remove super_admin bypass branch (4 lines)

Layer 3 — Auth service (depends on Layer 0: User.permissions removed)
  src/modules/auth/types.ts    [KEEP_WITH_PATCHES]
    Fix: Remove hotel_ids from AuthUser interface response shape
  src/modules/auth/service.ts  [KEEP_WITH_PATCHES — 3 changes]
    Fix: Replace inline getDefaultPermissions() with ROLE_PERMISSIONS import
    Fix: Remove User.permissions column write at signup
    Fix: Restrict role at signup — default WORKER; reject admin from input

Layer 4 — User service (depends on Layer 0)
  src/modules/users/types.ts   [KEEP_WITH_PATCHES — 2 changes]
    Fix: Remove hotel_ids from CreateUserSchema and UpdateUserSchema
  src/modules/users/service.ts [KEEP_WITH_PATCHES — 3 changes]
    Fix: Remove permissions write from createUser and updateUser
    Fix: Remove hotel_ids from User response objects
    Fix: Remove hotel_ids from createUser DB write

Layer 5 — HotelWorker module (depends on Layer 0: HotelWorker table)
  src/modules/hotel-workers/types.ts   [REWRITE — against HotelWorker model]
  src/modules/hotel-workers/service.ts [REWRITE — against HotelWorker table]
    New: listHotelWorkers → prisma.hotelWorker.findMany where hotel_id
    New: assignWorker → prisma.hotelWorker.create (upsert with ACTIVE status)
    New: removeWorker → prisma.hotelWorker.update with status: REMOVED

Layer 6 — CRM module (depends on Layer 5 for worker-related queries)
  src/modules/crm/routes.ts    [KEEP_WITH_PATCHES — remove 2 501 stub routes]
  src/modules/crm/controller.ts [KEEP_WITH_PATCHES — remove uploadPhoto stub handler]
  src/modules/crm/service.ts   [KEEP_AS_IS — hotel CRUD is functionally correct]

Layer 7 — Controllers (update for response shape changes)
  src/modules/auth/controller.ts        [KEEP_AS_IS — no changes required]
  src/modules/users/controller.ts       [KEEP_AS_IS — changes are in service and types]
  src/modules/hotel-workers/controller.ts [KEEP_WITH_PATCHES — response shape changes]

Layer 8 — Routes
  src/modules/users/routes.ts           [KEEP_WITH_PATCHES — add requirePermission('users:delete')]
  src/modules/hotel-workers/routes.ts   [KEEP_WITH_PATCHES — add requirePermission('hotel_workers:write')]

Layer 9 — Tests
  src/__tests__/hotel-workers.test.ts   [REWRITE — all mocks use old User.hotel_ids model]
  src/__tests__/auth.test.ts            [KEEP_WITH_PATCHES — update mock data shape; add refreshToken/updateProfile tests]
  src/__tests__/users.test.ts           [KEEP_WITH_PATCHES — remove permissions/hotel_ids from mock data]
  src/__tests__/rbac.test.ts            [KEEP_WITH_PATCHES — remove super_admin test; hotel_ids mocks unchanged]
  src/__tests__/hotel.test.ts           [KEEP_WITH_PATCHES — add missing test coverage]
```

---

## PART 6: ACTUAL ENGINEERING EFFORT

Effort revised to reflect that hotel_ids MVP retention eliminates the largest BLOCKED workstreams.

| Area | Task | Effort (hours) | Blocked? |
|---|---|---|---|
| Schema | Remove 13 model definitions (4 legacy + 9 Phase 2) | 2 | No |
| Schema | Fix 10 column/constraint issues on existing tables | 3 | No |
| Schema | Add 3 new MVP tables (HotelWorker, WorkApplication, Attendance) | 2 | No |
| Schema | Add FK columns (application_id, assignment_id, version) | 1 | No |
| Schema | Run migrations, generate client, compile check | 1 | No |
| lib/jwt.ts | 4 targeted fixes (secret, typing, export) | 0.5 | No |
| lib/base-service.ts | actor_role cast fix | 0.5 | No |
| permissions.ts | Remove super_admin bypass | 0.5 | No |
| auth/service.ts | 3 targeted fixes (permissions, role restriction, ROLE_PERMISSIONS) | 1.5 | No |
| auth/types.ts | Remove hotel_ids from AuthUser response shape | 0.5 | No |
| users/types.ts | Remove hotel_ids from schemas | 0.5 | No |
| users/service.ts | 3 targeted fixes (permissions, hotel_ids from response, DB write) | 1.5 | No |
| users/routes.ts | Add requirePermission | 0.5 | No |
| crm/routes.ts + controller.ts | Remove 501 stubs | 0.5 | No |
| hotel-workers/types.ts | REWRITE for HotelWorker model | 1.5 | No (schema Step 3 complete) |
| hotel-workers/service.ts | REWRITE against HotelWorker table | 4 | No (schema Step 3 complete) |
| hotel-workers/controller.ts | Update response shape | 1 | No |
| hotel-workers/routes.ts | Add requirePermission | 0.5 | No |
| Tests — hotel-workers | REWRITE (full) | 3 | After service rewrite |
| Tests — auth | Patch mocks; add refreshToken, updateProfile cases | 2 | No |
| Tests — users | Patch mocks; remove permissions/hotel_ids | 1.5 | No |
| Tests — rbac | Remove super_admin test; verify hotel_ids mocks OK | 1 | No |
| Tests — hotel | Add updateHotel, listRooms, getRoom, updateRoom coverage | 2 | No |
| .env.example | Add JWT_REFRESH_SECRET, APNS_PRIVATE_KEY_BASE64 | 0.5 | No |
| **TOTAL** | | **~32–36 hours** | None blocked |

**Comparison with prior plan:**
- Prior estimate: 68–102 hours total; ~60–90h blocked
- Revised estimate: 32–36 hours total; **zero blocked**

The reduction comes from five previously-blocked decisions now resolving in favour of keeping Sprint 1 patterns (Session, hotel_ids, ROLE_PERMISSIONS, /crm/ prefix, JWT hotel_ids). Only the HotelWorker service rewrite remains as a true structural rewrite.

---

## PART 7: REVISED SPRINT 1 COMPLETION PERCENTAGE

**Methodology:** Same as prior plan — functional completeness × architectural alignment per deliverable.

| Deliverable | Functional | Architectural | Combined | Change from prior |
|---|---|---|---|---|
| Auth Module | 83% | 65% | **74%** | +17pp (Session confirmed correct; hotel_ids MVP-valid; ROLE_PERMISSIONS valid; only role restriction and permissions column removal outstanding) |
| User Module | 80% | 60% | **70%** | +12pp (hotel_ids array filter OK for MVP; only permissions removal and response DTO change outstanding) |
| Hotel Module | 75% | 80% | **78%** | +13pp (/crm/ prefix confirmed; Hotel.deleted_at not required; only stub removal outstanding) |
| HotelWorker Module | 75% | 10% | **43%** | 0pp (storage model is still wrong; must use HotelWorker table; not improvable until rewrite) |
| Prisma Migration | 55% | 25% | **40%** | -3pp (3 required MVP tables absent; 13 models to remove; more missing than originally assessed) |
| RBAC Middleware | 80% | 60% | **70%** | +17pp (checkHotelAccess JWT read confirmed valid; ROLE_PERMISSIONS confirmed valid; only super_admin fix outstanding) |
| Audit Foundation | 85% | 70% | **78%** | +3pp (actor_role enum fix needed; otherwise confirmed correct) |
| Unit Tests | 60% | 55% | **58%** | 0pp (hotel-workers tests still wrong; others valid structure) |

**Revised weighted average (equal weights):**
(74 + 70 + 78 + 43 + 40 + 70 + 78 + 58) / 8 = **64%**

**Sprint 1 completion against canonical architecture: 64% (revised from 57%)**

The 7-point improvement reflects decisions that went in Sprint 1's favour. The remaining 36% gap is concentrated in:
1. **Prisma schema** — 3 required MVP tables missing (HotelWorker, WorkApplication, Attendance); 13 models to remove
2. **HotelWorker service** — entire module must be rewritten against HotelWorker table
3. **Minor cross-cutting** — permissions column removal, response DTO hotel_ids removal, JWT_REFRESH_SECRET fix

---

## PART 8: MINIMUM COMPLIANCE CHANGE SET

The smallest set of changes required to make Sprint 1 code compliant with the canonical architecture. Listed in dependency order.

### Block 1 — Schema (must go first; everything else depends on it)

1. `prisma/schema.prisma` — remove `User.permissions TEXT[]` column
2. `prisma/schema.prisma` — add `Session.refresh_token @unique` constraint
3. `prisma/schema.prisma` — add all 7 missing enums (HotelWorkerStatus, ApplicationStatus, AssignmentStatus, AttendanceStatus, VerificationStatus, NotificationType, correct WorkRequestStatus)
4. `prisma/schema.prisma` — fix `Notification.type` to `NotificationType` enum
5. `prisma/schema.prisma` — fix `AuditLog.actor_role` to `UserRole?` enum
6. `prisma/schema.prisma` — remove Room, Task, TaskPhoto, DailyOperation models and TaskStatus enum
7. `prisma/schema.prisma` — remove 9 Phase 2 HR/compliance models
8. `prisma/schema.prisma` — add HotelWorker model (with HotelWorkerStatus, @@unique)
9. `prisma/schema.prisma` — add WorkApplication model (with ApplicationStatus, @@unique)
10. `prisma/schema.prisma` — add Attendance model (with AttendanceStatus, CHECK constraints)
11. `prisma/schema.prisma` — add WorkerAssignment.application_id FK → WorkApplication (NOT NULL in post-migration)
12. `prisma/schema.prisma` — add WorkerAssignment partial unique index
13. `prisma/schema.prisma` — add WorkRequest.version INT
14. New migration file regenerated from schema diff

### Block 2 — Library layer (no schema dependency)

15. `src/lib/jwt.ts` — add `JWT_REFRESH_SECRET ?? JWT_SECRET` fallback in signRefreshToken and verifyRefreshToken
16. `src/lib/jwt.ts` — change `as any` to `as SignOptions['expiresIn']`; import `{ SignOptions }`
17. `src/lib/jwt.ts` — export `parseExpiryToSeconds`

### Block 3 — Middleware (no schema dependency)

18. `src/middleware/permissions.ts` — remove super_admin bypass branch

### Block 4 — Auth service (depends on Block 1: User.permissions column removed)

19. `src/modules/auth/service.ts` — replace inline `getDefaultPermissions()` with `ROLE_PERMISSIONS` import from constants
20. `src/modules/auth/service.ts` — remove `prisma.user.create({ data: { ..., permissions: [...] } })` write
21. `src/modules/auth/service.ts` — restrict role at signup: default WORKER; reject admin from untrusted input
22. `src/modules/auth/types.ts` — remove `hotel_ids` from `AuthUser` interface (API response type only)

### Block 5 — User service (depends on Block 1)

23. `src/modules/users/types.ts` — remove `hotel_ids` from CreateUserSchema and UpdateUserSchema
24. `src/modules/users/service.ts` — remove `permissions` write from createUser and updateUser
25. `src/modules/users/service.ts` — remove `hotel_ids` from User response objects
26. `src/modules/users/routes.ts` — add `requirePermission('users:delete')` to DELETE route

### Block 6 — HotelWorker module rewrite (depends on Block 1: HotelWorker table)

27. `src/modules/hotel-workers/types.ts` — REWRITE: AssignWorkerSchema, HotelWorkerResponse type against canonical HotelWorker model
28. `src/modules/hotel-workers/service.ts` — REWRITE: listHotelWorkers, assignWorker, removeWorker against `prisma.hotelWorker`
29. `src/modules/hotel-workers/routes.ts` — add `requirePermission('hotel_workers:write')` to DELETE route
30. `src/__tests__/hotel-workers.test.ts` — REWRITE: mock `prisma.hotelWorker` instead of `prisma.user.hotel_ids`

### Block 7 — CRM cleanup (no schema dependency)

31. `src/modules/crm/routes.ts` — remove `POST /hotels/:hotel_id/tasks` route (501 stub)
32. `src/modules/crm/routes.ts` — remove `POST /tasks/:task_id/photos` route (501 stub)
33. `src/modules/crm/controller.ts` — remove `uploadPhoto` stub handler

### Block 8 — Minor gaps (no blocking dependencies)

34. `backend/.env.example` — add `JWT_REFRESH_SECRET` and `APNS_PRIVATE_KEY_BASE64`
35. `src/lib/base-service.ts` — cast `actor_role` write to `UserRole` enum value
36. `src/__tests__/auth.test.ts` — add `refreshToken` and `updateProfile` test cases; update mock data (remove permissions, keep hotel_ids in mock User)
37. `src/__tests__/users.test.ts` — remove permissions from mock data; add updateUser test
38. `src/__tests__/rbac.test.ts` — remove super_admin test (now dead code); verify hotel_ids mock format
39. `src/__tests__/hotel.test.ts` — add updateHotel, listRooms, getRoom, updateRoom test cases

---

## PART 9: DECISIONS THAT REMAIN OPEN

All five previously-blocked architecture decisions are now resolved. The following are design questions not covered by any recovered document:

| # | Decision | Impact | Recommendation |
|---|---|---|---|
| D-1 | Password hashing: argon2 vs bcryptjs | Test seed compatibility; argon2 is in PR#2 branch | Keep bcryptjs for Sprint 1 (no governance doc exists to change it); revisit in `TESTING_MASTER_PLAN_V2` |
| D-2 | Signup semantics: open self-registration vs admin-only | SCHEMA_RECONCILIATION_DECISION §6.3 recommends open registration | Keep Sprint 1 open registration; this is CONFIRMED acceptable |
| D-3 | `checkHotelAccess` for ADMIN bypass | Currently ADMIN bypasses hotel access check; MANAGER does not | No canonical guidance found; current behaviour (ADMIN bypass) is consistent with API_SPEC_V1_PATCH_V2 RBAC matrix |
| D-4 | `WorkApplication` required for WorkerAssignment FK | Schema step 11 makes application_id NOT NULL post-backfill; Sprint 1 has no WorkApplication data | For Sprint 1 dev environment: migration adds column as nullable; promote to NOT NULL only after WorkApplication flow is implemented |

---

## APPENDIX: FINDING STATUS SUMMARY TABLE

| Finding | Prior classification | Revised verdict | Net change |
|---|---|---|---|
| Session in PostgreSQL — BLOCKED | Uncertain | **INVALIDATED** — confirmed correct | Eliminated blocker |
| hotel_ids REWRITE driver | REWRITE-blocking | **MODIFIED** — MVP retention; API response removal only | Scope reduced significantly |
| User.permissions column | REWRITE driver | **VALIDATED** — must be removed | Unchanged |
| lib/jwt.ts REWRITE | REWRITE | **MODIFIED** — KEEP_WITH_PATCHES (4 changes) | Downgraded |
| permissions.ts REWRITE | REWRITE | **MODIFIED** — KEEP_WITH_PATCHES (1 change) | Downgraded |
| auth/service.ts REWRITE | REWRITE | **MODIFIED** — KEEP_WITH_PATCHES (3 changes) | Downgraded |
| users/service.ts REWRITE | REWRITE | **MODIFIED** — KEEP_WITH_PATCHES (3 changes) | Downgraded |
| hotel-workers/service.ts REWRITE | REWRITE | **VALIDATED** — still REWRITE | Unchanged |
| hotel-workers/types.ts REWRITE | REWRITE | **VALIDATED** — still REWRITE | Unchanged |
| hotel-workers tests REWRITE | REWRITE | **VALIDATED** — still REWRITE | Unchanged |
| Schema: hotel_ids remove | REWRITE driver | **INVALIDATED** — keep for MVP | Eliminated |
| Schema: Hotel.deleted_at add | Finding | **INVALIDATED** — not in V2 spec | Eliminated |
| Schema: Room/Task/etc. remove | VALIDATED | **VALIDATED** — confirmed | Unchanged |
| Schema: HotelWorker/WorkApplication/Attendance add | BLOCKED | **VALIDATED** — unblocked | Unblocked |
| Schema: User.permissions remove | VALIDATED | **VALIDATED** — confirmed | Unchanged |
| /crm/ prefix — BLOCKED | Uncertain | **INVALIDATED** — confirmed correct | Eliminated blocker |
| ROLE_PERMISSIONS insufficient — BLOCKED | Uncertain | **INVALIDATED** — confirmed valid | Eliminated blocker |
| 501 stub routes remove | VALIDATED | **VALIDATED** — confirmed | Unchanged |
| super_admin dead code remove | VALIDATED | **VALIDATED** — confirmed | Unchanged |
| checkHotelAccess stale JWT — BLOCKED | REWRITE driver | **MODIFIED** — MVP-valid; Phase 2 item | Deferred to Phase 2 |
| Sprint 1 completion 57% | Assessment | **MODIFIED** — revised to 64% | +7pp |
