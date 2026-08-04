> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# SPRINT_STATE_RECONCILIATION.md

**Date:** 2026-06-13  
**Branch surveyed:** `main` @ `d97e0b7`  
**Authority sources:**
- `SPRINT_1_CANONICAL_EXECUTION_PLAN.md` (CANONICAL, 2026-06-10)
- `docs/API_SPEC_V1_PATCH_V2.md` (APPROVED_WITH_PATCHES, 2026-06-09)
- Live file inspection of `backend/src/`, `backend/prisma/schema.prisma`, `scripts/`, `.github/workflows/`

**Method:** Every planned task from the canonical plan's §4 (Phases 0–9) was compared
against the actual files present on `main`. Status is evidence-only — no inference.

---

## Status Legend

| Symbol | Meaning |
|---|---|
| ✅ COMPLETE | All plan criteria met by code on `main` |
| ⚠️ PARTIAL | Some criteria met, specific gaps listed |
| ❌ MISSING | No implementation found |
| 🔁 SUPERSEDED | Plan item rendered void by later merge or plan correction |

---

## Phase 0 — Pre-work

### 0-1 · Close PR #2 without merge
**Status: 🔁 SUPERSEDED**  
`fix/backend-blockers` branch does not appear in `git branch -a` output.
`PR2_FINAL_MERGE_DECISION.md` is present on `main`. The branch either was closed or was
never opened on this repo instance. No action remains.

### 0-2 · Merge B-1 documents to `main`
**Status: ❌ MISSING**  
The three authority documents required by Blocker B-1 are not present on `main`:

| Document | Required location | Found? |
|---|---|---|
| `WORKREQUEST_FINAL_ARCHITECTURE.md` + `_PATCH_V1` | repo root | No |
| `BACKEND_EXECUTION_BLUEPRINT_V2.md` + `_PATCH_V1` | repo root | No |
| `MOBILE_PRODUCT_BLUEPRINT.md` + `_PATCH_V1` | repo root | No |

**Remaining work:** Identify the current `origin/claude/amazing-hypatia-*`,
`origin/claude/optimistic-turing-*`, and `origin/claude/affectionate-tesla-*` branches
(or their successors) and merge the six documents to `main`. Document-only PRs.  
**Impact:** Blocks Phase 9 (mobile). Does not block Phases 1–5.

### 0-3 · Patch B-2 — API spec WorkRequest status enum
**Status: ⚠️ PARTIAL**  
`API_SPEC_V1_PATCH_V2.md §PATCH-05b` defines the V2 enum as `OPEN | CLOSED | CANCELLED`
(3 states). `backend/prisma/schema.prisma` line 38–44 defines `WorkRequestStatus` with
6 states: `DRAFT | OPEN | PARTIALLY_FILLED | FILLED | CANCELLED | EXPIRED`. The canonical
plan (§3 Blocker B-2) records this conflict and rules: **L0 schema governs**; the API spec
must expose the 6-state enum or a documented projection. Neither a corrected API spec patch
nor an implementation projection exists on `main`. The conflict is documented but unresolved.

**Remaining work:** Issue a PATCH-05b-correction to `docs/API_SPEC_V1_PATCH_V2.md` that
either adopts the 6-state enum for the API surface or defines an explicit projection mapping
(e.g., `PARTIALLY_FILLED | FILLED → OPEN` for external consumers). Then apply the chosen
enum to any WorkRequest endpoint validation/DTO code when those routes are implemented.

### 0-4 · Confirm test stack (Jest + bcryptjs)
**Status: ✅ COMPLETE**  
`backend/src/__tests__/` contains `auth.test.ts`, `hotel-workers.test.ts`, `hotel.test.ts`,
`rbac.test.ts`, `users.test.ts`. `backend/package.json` confirms jest + bcryptjs.
No argon2 or vitest dependency present.

---

## Phase 1 — Stream A: Auth Improvements

**Planned branch:** `feat/auth-improvements`  
**Branch exists:** No. All items below landed directly on `main` via prior PRs.

### 1-1 · `auth/validation.ts` — new file with Zod schemas
**Status: ✅ COMPLETE**  
`backend/src/modules/auth/validation.ts` exists. Exports `SignupSchema`, `LoginSchema`,
`RefreshTokenSchema`, `UpdateProfileSchema` and their inferred types. `hotel_ids` is not
present in SignupSchema (consistent with PATCH-04 direction, though the plan permitted
transitional retention — the omission is safe).

### 1-2 · `lib/jwt.ts` — two-secret refresh, export `parseExpiryToSeconds`, keep `hotel_ids` in payload
**Status: ✅ COMPLETE**  
- `signRefreshToken` uses `env.JWT_REFRESH_SECRET ?? env.JWT_SECRET` (line 34).
- `parseExpiryToSeconds` is exported (line 95).
- `AccessTokenPayload` retains `hotel_ids: string[]` (line 10).
- No duplicate export keyword present (`fix/jwt-double-export` merged as PR #33).

### 1-3 · `auth/types.ts` — `AuthResponse` → `AuthTokens`; additive fields
**Status: ⚠️ PARTIAL**  
`auth/types.ts` defines both `AuthTokens` (lines 15–19) and `AuthResponse` (lines 21–26).
The plan required renaming `AuthResponse` to `AuthTokens` as the primary tokens type.
Instead both coexist: `AuthTokens` is defined but `AuthResponse` is retained and actively
used throughout `auth/service.ts`. This is a naming inconsistency rather than a functional
bug but deviates from the plan spec.

**Remaining work:** Remove the `AuthResponse` composite type or clearly alias it. Ensure
`auth/service.ts` method return types reference `AuthTokens` where only tokens are returned
(e.g., `refreshToken` method returns `Pick<AuthResponse, ...>` which should be `AuthTokens`).

### 1-4 · `auth/service.ts` — reconstructed per plan spec
**Status: ✅ COMPLETE**  
All plan-required criteria verified:
- `exportUserData` and `getDefaultPermissions`: absent (correctly dropped).
- `ForbiddenError` thrown for disabled accounts: line 82 (`throw new ForbiddenError('Account is disabled')`).
- `logAudit` + IP tracking: present at lines 54, 106, 177, 227.
- `role.toLowerCase()` in token signing: present at lines 41, 93, 149.
- `ROLE_PERMISSIONS` from constants: imported and used (lines 10, 23).
- bcryptjs: imported (line 1), `BCRYPT_ROUNDS` used (line 21).

### 1-5 · `auth/controller.ts` — logout passes `req.body?.refresh_token`
**Status: ✅ COMPLETE**  
`auth/controller.ts` line: `const refreshToken = req.body?.refresh_token as string | undefined`
followed by `authService.logout(req.auth.userId, refreshToken)`. Matches plan requirement.

### 1-6 · `auth/routes.ts` — no signup `requireRole('admin')` guard; no 2 GDPR routes
**Status: ⚠️ PARTIAL**  
- `POST /signup` has no `requireRole` guard: ✅ correct.
- GDPR routes absent from `auth/routes.ts`: ✅ correct.
- **Gap:** `POST /auth/password-reset` required by `API_SPEC_V1_PATCH_V2.md` Final API
  Surface §Auth (5 endpoints) is not present in `auth/routes.ts`. Route is completely
  absent — no controller method, no route registration.

**Remaining work:** Implement `POST /auth/password-reset` endpoint (controller method +
service method + route registration). No schema migration required; `User` model has
`password_hash` already.

### 1-7 · `app.ts` — single unused-import deletion
**Status: ✅ COMPLETE**  
`backend/src/app.ts` is minimal (2-line change per PR diff). No unused imports visible.

### 1-8 · `./types.js` → `./validation.js` import sites updated
**Status: ✅ COMPLETE**  
`auth/service.ts` line 9 imports from `'./validation.js'`. `auth/controller.ts` line 3
imports from `'./validation.js'`. No remaining `./types.js` import in auth module.

**Phase 1 overall: ⚠️ PARTIAL — two gaps: AuthTokens/AuthResponse naming, missing `POST /auth/password-reset`.**

---

## Phase 2 — Infra Critical Fixes

**Planned branch:** `fix/infra-deploy-gaps`  
**Branch exists:** No. Items landed on `main` via prior PRs.

### 2-1 · B-3 — Credential mapping in `scripts/backup-db.sh`
**Status: ✅ COMPLETE**  
`scripts/backup-db.sh` lines 19–20:
```
export AWS_ACCESS_KEY_ID="$DO_SPACES_KEY"
export AWS_SECRET_ACCESS_KEY="$DO_SPACES_SECRET"
```
Mapping is present before the `aws s3 cp` call at line 31. GAP-C6 is closed.

### 2-2 · B-4 — Frontend build + `hotel-crm-web` restart in prod deploy
**Status: ✅ COMPLETE**  
`.github/workflows/deploy-production.yml` SSH script (lines ~38–49) includes:
```
cd frontend
npm ci --omit=dev
npm run build
...
pm2 restart hotel-crm-web --update-env
```
`scripts/deploy.sh` lines 49–58 also include frontend build and `pm2 restart hotel-crm-web`.
GAP-C4 is closed in both deploy paths.

**Phase 2 overall: ✅ COMPLETE.**

---

## Phase 3 — HotelWorker Membership Alignment

**Planned branch:** `feat/hotelworker-v2`  
**Branch exists:** No. **Status: ❌ MISSING — not started.**

### 3-1 · Rewrite `modules/hotel-workers/` to operate on `HotelWorker` entity rows
**Status: ❌ MISSING**  
`hotel-workers/service.ts` still operates entirely on `User.hotel_ids`:
- `listHotelWorkers`: queries `prisma.user` with `hotel_ids: { has: hotelId }` (line 14).
  Returns User fields, not HotelWorker join table fields.
- `assignWorker`: checks `worker.hotel_ids.includes(hotelId)` (line 67), writes via
  `hotel_ids: { push: hotelId }` (line 73). Does not create a `HotelWorker` row.
- `removeWorker`: reads `worker.hotel_ids` (line 98), filters array (line 102), writes
  `data: { hotel_ids: updatedIds }` (line 106). Does not delete/update a `HotelWorker` row.

The `HotelWorker` model exists in `schema.prisma` (line 205) with the correct fields
(`status`, `invited_at`, `joined_at`, `left_at`, `hourly_rate`, `@@unique([hotel_id, worker_id])`).
It is entirely unused by the service.

**Response DTO mismatch:** `API_SPEC_V1_PATCH_V2 §PATCH-05e` specifies the HotelWorker
response as `{ id, hotel_id, worker_id, role, start_date, end_date, is_active, created_at }`.
Current service returns User shape: `{ id, email, first_name, last_name, role, hotel_ids, is_active }`.
`start_date` / `end_date` / `is_active` (as membership field) are not returned.

**Note:** `HotelWorker.status` in schema uses `HotelWorkerStatus` enum
(`INVITED | ACTIVE | INACTIVE | REMOVED`), not the boolean `is_active` that the API spec
projects. This is an additional field-level mapping that must be resolved during Phase 3.

### 3-2 · Rewrite `checkHotelAccess` to query `HotelWorker` membership rows
**Status: ❌ MISSING**  
`middleware/permissions.ts` `checkHotelAccess()` (line 94) still reads
`req.auth.hotel_ids.includes(hotelId)` (line 120). No database lookup against `HotelWorker`
is performed. `ADMIN` bypass is present (line 98) but `MANAGER` is not bypassed — the plan
and `API_SPEC_V1_PATCH_V2 §PATCH-04c` require ADMIN and MANAGER to bypass the membership
check.

### 3-3 · Rewrite `hotel-workers.test.ts`; patch `rbac.test.ts` mocks
**Status: ❌ MISSING**  
`backend/src/__tests__/hotel-workers.test.ts` exists but tests the legacy
`User.hotel_ids`-based behaviour. It will need full rewrite once service is replaced.
`rbac.test.ts` mocks reference `hotel_ids` arrays.

**Remaining work (Phase 3 in full):**
1. Rewrite `hotel-workers/service.ts`: `listHotelWorkers` → `prisma.hotelWorker.findMany({ where: { hotel_id, status: 'ACTIVE' } })` with User join. `assignWorker` → `prisma.hotelWorker.create(...)`. `removeWorker` → `prisma.hotelWorker.update({ data: { status: 'REMOVED', left_at: now() } })`.
2. Align response DTO to spec shape (`id`, `hotel_id`, `worker_id`, `role`, `start_date` mapped from `invited_at`/`joined_at`, `end_date` from `left_at`, `is_active` derived from `status === 'ACTIVE'`).
3. Rewrite `checkHotelAccess()` to `prisma.hotelWorker.findFirst({ where: { worker_id, hotel_id, status: 'ACTIVE' } })`; add MANAGER bypass alongside existing ADMIN bypass.
4. Rewrite `hotel-workers.test.ts`; update `rbac.test.ts` mock shapes.

---

## Phase 4 — User Module Alignment

**Planned branch:** `feat/users-v2`  
**Branch exists:** No. **Status: ❌ MISSING — not started.**

### 4-1 · Replace `hotel_ids: { has }` filter with `HotelWorker` join in `listUsers`
**Status: ❌ MISSING**  
`users/service.ts` line 16: `if (hotel_id) where['hotel_ids'] = { has: hotel_id }`.

### 4-2 · Tenant scoping for `listUsers`
**Status: ❌ MISSING**  
`listUsers` applies no hotel-scoped tenant filter for non-ADMIN callers. A MANAGER can
retrieve all users across all hotels.

### 4-3 · Stop writing `permissions` to `User` row
**Status: ❌ MISSING**  
`users/service.ts` line 103–104: `hotel_ids: data.hotel_ids ?? []` and
`permissions: permissions ?? []` are written on user creation. Line 143–144: `hotel_ids`
and `permissions` are writable via `updateUser`. Per PATCH-04, `hotel_ids` must be removed
from create/update DTOs; `permissions` column should be derived from role, not stored per
the marketplace refactor intent.

### 4-4 · Stop returning `hotel_ids` in User response DTOs
**Status: ❌ MISSING**  
`users/service.ts` selects `hotel_ids: true` (lines 38, 73, 113, 154) in all user queries.
`PATCH-04` requires `hotel_ids` dropped from all User response DTOs.

### 4-5 · Patch `users.test.ts`
**Status: ❌ MISSING** (depends on above changes).

**Remaining work:** Implement all four items above in `feat/users-v2` after Phase 3 merges.

---

## Phase 5 — Hotel (CRM) Module Patches

**Planned branch:** `feat/crm-patches`  
**Branch exists:** No. **Status: ⚠️ PARTIAL.**

### 5-1 · Add `Hotel.deleted_at` to schema
**Status: ❌ MISSING**  
`backend/prisma/schema.prisma` `model Hotel` (lines 175–200) has no `deleted_at` field.
`User` model has `deleted_at DateTime?` (line 131) but `Hotel` does not.
The canonical plan (§4 Phase 5) explicitly requires adding this field.

**Remaining work:** Add `deleted_at DateTime?` to the `Hotel` model in `schema.prisma`;
generate and run migration.

### 5-2 · Wire `deleteHotel` to set `deleted_at`
**Status: ❌ MISSING**  
`crm/service.ts` `deleteHotel` (line 104–110) performs a soft-delete via
`data: { is_active: false }` — it does **not** set `deleted_at`. This deviates from the
plan's explicit requirement and from the GDPR pattern used for `User`.

**Remaining work:** After 5-1, change `deleteHotel` to
`data: { is_active: false, deleted_at: new Date() }`.

### 5-3 · Remove the two 501 stub routes
**Status: ❌ MISSING**  
`crm/routes.ts` lines 24–29 register two stub routes that return 501:
```
POST /hotels/:hotel_id/tasks    → crmController.uploadPhoto (501)
POST /tasks/:task_id/photos     → crmController.uploadPhoto (501)
```
The `Task` entity is removed in the marketplace refactor (`API_SPEC_V1_PATCH_V2 §PATCH-02`).
These routes expose a removed entity and must be deleted. The `uploadPhoto` controller
method (crm/controller.ts line 158) must also be removed.

**Remaining work:** Delete both route registrations from `crm/routes.ts`; remove
`uploadPhoto` from `crm/controller.ts`.

### 5-4 · Confirm `/crm/` prefix against `API_SPEC_V1_PATCH_V2`
**Status: ⚠️ PARTIAL**  
`routes/v1/index.ts` line 21: `router.use('/crm', crmRoutes)` — prefix is `/api/v1/crm`.
However, `API_SPEC_V1_PATCH_V2` Final API Surface lists Hotel endpoints as
`/hotels`, `/hotels/:id` (i.e., under `/api/v1/hotels`, not `/api/v1/crm/hotels`).
The current implementation nests hotels under `/crm/hotels` — this is a route prefix
mismatch with the spec.

**Additional gap — Room endpoints not removed:**  
`API_SPEC_V1_PATCH_V2 §PATCH-01` removes `GET/POST/PATCH /hotels/:id/rooms`.
`crm/routes.ts` lines 17–21 still register four room routes:
```
GET  /hotels/:hotel_id/rooms
POST /hotels/:hotel_id/rooms
GET  /hotels/:hotel_id/rooms/:room_id
PUT  /hotels/:hotel_id/rooms/:room_id
```
These must be removed.

**Additional gap — PUT vs PATCH:**  
`crm/routes.ts` line 14 uses `router.put('/hotels/:hotel_id', ...)`. The API spec
mandates `PATCH /hotels/:id`. Verb mismatch.

**Additional gap — CHECKER RBAC on hotel routes:**  
`API_SPEC_V1_PATCH_V2 §PATCH-07a/b` removes CHECKER from `GET /hotels`, `POST /hotels`,
`PATCH /hotels/:id`. Current `crm/routes.ts` line 11 (`GET /hotels`) uses only
`requirePermission('hotels:read')` — no role restriction. CHECKER role carries
`hotels:read` permission (per `constants.ts`) so CHECKERs can currently list hotels.
`requireRole(['admin', 'manager'])` must be added to `GET /hotels`.

**Phase 5 overall: ⚠️ PARTIAL — only the `deleteHotel` method infrastructure (is_active soft-delete) exists. All five plan requirements have gaps.**

---

## Phase 6 — Phase 2 Schema Migration

**Planned branch:** `feat/phase2-schema`  
**Status: ❌ MISSING — not started.**

The 9 deferred models (`Contract`, `ContractTemplate`, `ContractLineItem`,
`WorkerDocument`, `RequiredDocument`, `Payroll`, `PayrollLineItem`, `DataRetentionLog`,
`ConsentLog`) are absent from `backend/prisma/schema.prisma`.

**Note:** `V2_marketplace_migration_plan.sql` exists in
`backend/prisma/migrations/` but is a planning document, not an applied Prisma migration.
It has no `migration_lock.toml` entry.

---

## Phase 7 — GDPR Module

**Planned branch:** `feat/gdpr-module`  
**Status: ❌ MISSING — not started.**

`backend/src/modules/` contains no `gdpr/` directory. `API_SPEC_V1_PATCH_V2` Final
API Surface lists 5 GDPR endpoints under `/gdpr/*`. None are registered in
`routes/v1/index.ts`.

**Dependency:** Blocked on Phase 1 (done) + Phase 6 (not started).

---

## Phase 8 — `hotel_ids` Deprecation

**Planned branch:** `feat/hotel-ids-removal`  
**Status: ❌ MISSING — not started.**

`User.hotel_ids String[]` column is present in schema (line ~128). All references in
auth/service, users/service, hotel-workers/service, permissions middleware continue to
read and write it. Full removal requires Phase 3 to be operational first.

---

## Phase 9 — Mobile Implementation

**Status: ❌ MISSING — explicitly gated on B-1 (Phase 0-2).**

`mobile/checker-app/` and `mobile/worker-app/` directories exist with scaffolding
(login screen, auth store, API client). This is skeleton code only — no implementation
of the marketplace flow. Gated on `MOBILE_PRODUCT_BLUEPRINT` reaching `main`.

---

## Cross-Cutting API Spec Gaps (from `API_SPEC_V1_PATCH_V2`)

These gaps are not phase-specific but affect the current `main` implementation:

| Gap | Spec reference | Current state | File |
|---|---|---|---|
| `POST /work-requests/:id/assign` still exists (direct assign, bypasses pipeline) | PATCH-03 removes it | Not yet implemented at all — WorkRequest module is absent from routes | `routes/v1/index.ts` (no work-requests route) |
| `task_id` in QualityVerification / Rating DTOs | PATCH-02 replaces with `worker_assignment_id` | No QV or Rating module implemented | — |
| `daily_operations[]` in WorkerAssignment response | PATCH-05a removes it | No Assignment module implemented | — |
| `application_id` missing from Assignment response | PATCH-05a adds it | No Assignment module implemented | — |
| Notification types `TASK_ASSIGNED`, `TASK_COMPLETED` | PATCH-06 removes them; adds `ASSIGNMENT_COMPLETED`, `CONTRACT_EXPIRING`, `DOCUMENT_UPLOADED` | `NotificationType` enum in schema.prisma does not match — schema has `WORK_REQUEST_CANCELLED`, `ASSIGNMENT_CANCELLED` but no `CONTRACT_EXPIRING` or `DOCUMENT_UPLOADED` | `backend/prisma/schema.prisma` lines ~85–110 |
| `POST /work-requests/:id/apply` RBAC — ADMIN + WORKER only | PATCH-07 | No WorkRequest module implemented | — |
| `POST /work-requests` RBAC — ADMIN + MANAGER only (no CHECKER) | PATCH-07f | No WorkRequest module implemented | — |

---

## Summary Table

| Phase | Description | Status | Branch |
|---|---|---|---|
| 0-1 | Close PR #2 | 🔁 SUPERSEDED | — |
| 0-2 | Merge B-1 documents | ❌ MISSING | — |
| 0-3 | Patch B-2 WorkRequest enum conflict | ⚠️ PARTIAL | — |
| 0-4 | Confirm Jest + bcryptjs | ✅ COMPLETE | — |
| 1-1 | auth/validation.ts | ✅ COMPLETE | landed on main |
| 1-2 | lib/jwt.ts two-secret + parseExpiryToSeconds | ✅ COMPLETE | landed on main |
| 1-3 | auth/types.ts AuthTokens rename | ⚠️ PARTIAL | — |
| 1-4 | auth/service.ts reconstruction | ✅ COMPLETE | landed on main |
| 1-5 | auth/controller.ts logout fix | ✅ COMPLETE | landed on main |
| 1-6 | auth/routes.ts (no admin guard, no GDPR; missing password-reset) | ⚠️ PARTIAL | — |
| 1-7 | app.ts cleanup | ✅ COMPLETE | landed on main |
| 1-8 | Import site updates | ✅ COMPLETE | landed on main |
| 2-1 | B-3 backup-db.sh credential mapping | ✅ COMPLETE | landed on main |
| 2-2 | B-4 frontend build in prod deploy | ✅ COMPLETE | landed on main |
| 3 | HotelWorker v2 (service + RBAC + tests) | ❌ MISSING | `feat/hotelworker-v2` not created |
| 4 | Users v2 (join filter, scoping, hotel_ids removal) | ❌ MISSING | `feat/users-v2` not created |
| 5-1 | Hotel.deleted_at in schema | ❌ MISSING | — |
| 5-2 | deleteHotel sets deleted_at | ❌ MISSING | — |
| 5-3 | Remove 501 stub routes (tasks, photos) | ❌ MISSING | — |
| 5-4 | /crm/ prefix, PATCH verb, CHECKER RBAC, room routes removed | ⚠️ PARTIAL | — |
| 6 | Phase 2 schema (9 deferred models) | ❌ MISSING | `feat/phase2-schema` not created |
| 7 | GDPR module | ❌ MISSING | `feat/gdpr-module` not created |
| 8 | hotel_ids column removal | ❌ MISSING | `feat/hotel-ids-removal` not created |
| 9 | Mobile implementation | ❌ MISSING | gated on B-1 |

---

## Recommended Immediate Next Actions

Listed in dependency order per the canonical plan:

1. **Create `feat/auth-improvements`** (or land fixes directly): close the two Phase 1
   gaps — rename `AuthResponse`/`AuthTokens` usage in `auth/service.ts`, add
   `POST /auth/password-reset` route.

2. **Create `feat/hotelworker-v2`** (depends on Phase 1 merged): full rewrite of
   `hotel-workers/service.ts` and `permissions.ts:checkHotelAccess` against the
   `HotelWorker` entity. This is the largest single gap and is on the critical path for
   PATCH-04 compliance.

3. **Create `feat/crm-patches`** (depends on Phase 1, parallel with Phase 3): add
   `Hotel.deleted_at` to schema, fix `deleteHotel`, remove 501 stubs, remove Room routes,
   fix PATCH verb, add `requireRole(['admin','manager'])` to `GET /hotels`.

4. **Resolve 0-3 (B-2 enum conflict)**: issue the API spec correction doc before
   WorkRequest endpoint implementation begins.

5. **Resolve 0-2 (B-1 document merge)**: locate and merge the three blueprint documents
   to unblock mobile assessment.

---

*End of reconciliation.*
