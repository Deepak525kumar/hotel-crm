# ARCHITECTURE RECONCILIATION REPORT

**Date:** 2026-06-10
**Status:** FINAL
**Purpose:** Document every inter-document conflict found during the Sprint 1 remediation analysis, the resolution applied, and the authority used to resolve it.

---

## 1. AUTHORITY HIERARCHY

When canonical documents conflict, apply this precedence (highest first):

1. **SCHEMA_RECONCILIATION_DECISION.md** — explicit MVP overrides; highest authority for schema questions
2. **PRISMA_SCHEMA_V2_FREEZE.md** (APPROVED_WITH_MINOR_FOLLOWUPS) — schema ground truth
3. **API_SPEC_V1_PATCH_V2.md** (APPROVED_WITH_PATCHES) — API contract
4. **MARKETPLACE_REFACTOR_MASTER_PLAN.md** (FROZEN) — entity relationships and routing
5. **PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md** + **PR2_SALVAGE_PLAN.md** — implementation-level findings
6. **SPRINT_1_FINAL_REMEDIATION_PLAN.md** — reconciled engineering guidance

---

## 2. CONFLICT LOG

### Conflict 1: User.hotel_ids — Drop vs Keep

**Source A:** PRISMA_SCHEMA_V2_FREEZE.md, Migration Step 2
> "User: drop `hotel_ids`"

**Source B:** SCHEMA_RECONCILIATION_DECISION.md §3.1
> "MVP schema = main's V2 + `hotel_ids String[]` on User. Reason: checkHotelAccess() reads req.auth.hotel_ids."

**Source C:** API_SPEC_V1_PATCH_V2.md PATCH-04
> "Remove hotel_ids from all User Response DTOs."

**Conflict type:** Direct contradiction between V2 freeze (drop column) and MVP reconciliation (keep column).

**Resolution:**
- DB column: **KEEP** for MVP (SCHEMA_RECONCILIATION_DECISION outranks PRISMA_SCHEMA_V2_FREEZE for MVP-scoped decisions).
- JWT payload: **KEEP** hotel_ids in token for MVP (required by checkHotelAccess middleware).
- API response DTOs: **REMOVE** hotel_ids from all User response objects (PATCH-04 stands; this applies to external API output only).
- Schedule: Drop column from DB in Sprint 2 Phase 2, after HotelWorker service is the authoritative enrollment source.

**Three-way reconciliation is consistent:** column stays in DB → JWT can be populated at login → DTOs scrub it from API output. No contradiction remains.

---

### Conflict 2: User.permissions — Present vs Absent

**Source A:** Sprint 1 schema.prisma
> `permissions String[]` present on User model

**Source B:** PRISMA_SCHEMA_V2_FREEZE.md
> No `permissions` field on User model

**Source C:** Sprint 1 auth/service.ts + users/service.ts
> Writes to `user.permissions` at login and user update

**Conflict type:** Sprint 1 added a field absent from V2 canonical schema.

**Resolution:** Remove `permissions` column from User model. Remove all writes. Source of permissions truth is `ROLE_PERMISSIONS[role]` static map, populated into JWT at sign-in time. Column does not exist in V2; all writes are invalid.

Authority: PRISMA_SCHEMA_V2_FREEZE.md (absence is authoritative).

---

### Conflict 3: JWT dual secrets — Single vs Dual secret

**Source A:** Sprint 1 lib/jwt.ts
> `signRefreshToken` uses `env.JWT_SECRET` for both access and refresh tokens

**Source B:** PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md, Finding I-1 (BLOCKER)
> "jwt.ts uses JWT_SECRET for both access and refresh signing. BLOCKER — must use JWT_REFRESH_SECRET with fallback to JWT_SECRET."

**Conflict type:** Implementation diverges from security requirement.

**Resolution:** Add `JWT_REFRESH_SECRET ?? JWT_SECRET` fallback to both `signRefreshToken` and `verifyRefreshToken`. Add `JWT_REFRESH_SECRET` to `.env.example`.

Authority: PR2_ARCHITECTURE_COMPLIANCE_AUDIT BLOCKER I-1; confirmed by PR2_SALVAGE_PLAN §2.1.

---

### Conflict 4: super_admin role — Present vs Absent

**Source A:** Sprint 1 lib/permissions.ts
> `if (role === 'super_admin') return true;` bypass block present

**Source B:** PRISMA_SCHEMA_V2_FREEZE.md §Enums
> UserRole: WORKER, CHECKER, MANAGER, ADMIN — no super_admin value

**Conflict type:** Sprint 1 references a role that does not exist in V2 enum.

**Resolution:** Remove super_admin bypass block entirely. The code is dead (no user can have this role) and is a security hole (if role casing is ever wrong, arbitrary bypass could occur).

Authority: PRISMA_SCHEMA_V2_FREEZE.md (enum definition is authoritative).

---

### Conflict 5: GDPR routes location

**Source A:** Sprint 1 auth/routes.ts
> GDPR endpoints registered under auth module

**Source B:** API_SPEC_V1_PATCH_V2.md
> GDPR endpoints at `/api/v1/gdpr/*` — separate surface from auth

**Conflict type:** GDPR routes in wrong module.

**Resolution for Sprint 1:** Flag but defer. GDPR route relocation is Phase 2 scope. Sprint 1 remediation focuses on security and schema compliance. The routes function correctly at present; structural relocation is not a Sprint 1 blocker.

Authority: PR2_SALVAGE_PLAN classification — GDPR routes noted but not MERGE_NOW requirement.

---

### Conflict 6: Hotel module — deleted_at field

**Source A:** Sprint 1 salvage plan (prior)
> Hotel.deleted_at identified as missing; classified as architecture gap

**Source B:** SCHEMA_RECONCILIATION_DECISION.md
> "Hotel.deleted_at: not required for MVP; soft-delete via status field is sufficient"

**Conflict type:** Prior plan misidentified a non-requirement as a gap.

**Resolution:** Hotel.deleted_at is NOT required for MVP. Gap finding is INVALIDATED. Hotel module does not need changes for this reason.

Authority: SCHEMA_RECONCILIATION_DECISION.md (explicit MVP override).

---

### Conflict 7: Route prefix — /crm/ correct vs incorrect

**Source A:** Sprint 1 salvage plan (prior)
> Route prefix uncertain; potential conflict with architecture. BLOCKED.

**Source B:** MARKETPLACE_REFACTOR_MASTER_PLAN.md Part 4
> Hotels listed at `/api/v1/crm/hotels`; HotelWorker endpoints at `/api/v1/crm/hotels/:id/workers`

**Conflict type:** Prior plan blocked on information that was always available in main branch docs.

**Resolution:** /crm/ prefix is confirmed canonical. No change required to routing. Finding INVALIDATED.

Authority: MARKETPLACE_REFACTOR_MASTER_PLAN.md (FROZEN, highest routing authority).

---

### Conflict 8: ROLE_PERMISSIONS — valid vs invalid

**Source A:** Sprint 1 salvage plan (prior)
> ROLE_PERMISSIONS static map flagged as potentially incorrect. BLOCKED.

**Source B:** PR2_SALVAGE_PLAN.md §D-3
> "ROLE_PERMISSIONS static map is confirmed valid canonical approach for MVP."

**Conflict type:** Prior plan blocked on information that was available in recovered document.

**Resolution:** Static map is canonical for MVP. No change required to RBAC model. Finding INVALIDATED.

Authority: PR2_SALVAGE_PLAN.md §D-3.

---

### Conflict 9: HotelWorker service — User.hotel_ids vs HotelWorker table

**Source A:** Sprint 1 hotel-workers/service.ts
> Operates against `User.hotel_ids` array for enrollment management

**Source B:** PRISMA_SCHEMA_V2_FREEZE.md
> HotelWorker is a first-class entity with its own table, FK relationships, and status lifecycle

**Conflict type:** Sprint 1 used denormalized array as the source of truth for an entity that requires its own table.

**Resolution:** hotel-workers/service.ts must be fully rewritten against the HotelWorker table. The User.hotel_ids column is a denormalized read-cache for JWT/middleware use, not the authoritative data source for enrollment CRUD.

Authority: PRISMA_SCHEMA_V2_FREEZE.md (HotelWorker model definition).

---

## 3. CONFLICTS SUMMARY TABLE

| # | Conflict | Documents | Winner | Change Required |
|---|----------|-----------|--------|-----------------|
| 1 | hotel_ids: drop vs keep | V2 Freeze vs Reconciliation Decision | Reconciliation Decision (MVP) | Keep in DB + JWT; remove from DTOs |
| 2 | User.permissions: present vs absent | Sprint 1 vs V2 Freeze | V2 Freeze | Remove column and all writes |
| 3 | JWT single vs dual secret | Sprint 1 vs Compliance Audit | Compliance Audit | Add JWT_REFRESH_SECRET fallback |
| 4 | super_admin: present vs absent | Sprint 1 vs V2 Freeze | V2 Freeze | Remove bypass block |
| 5 | GDPR route location | Sprint 1 vs API Spec | Deferred | No Sprint 1 change |
| 6 | Hotel.deleted_at: required vs optional | Prior plan vs Reconciliation Decision | Reconciliation Decision | No change required |
| 7 | /crm/ prefix: correct vs uncertain | Prior plan vs Marketplace Plan | Marketplace Plan | No change required |
| 8 | ROLE_PERMISSIONS: valid vs uncertain | Prior plan vs Salvage Plan | Salvage Plan | No change required |
| 9 | HotelWorker source of truth | Sprint 1 vs V2 Freeze | V2 Freeze | Full service rewrite |

---

## 4. NET IMPACT ON SPRINT 1 SCOPE

| Prior classification | Count | Revised classification | Count |
|---------------------|-------|----------------------|-------|
| REWRITE | 6 modules | REWRITE | 2 modules (hotel-workers, schema) |
| KEEP_WITH_PATCHES | 4 modules | KEEP_WITH_PATCHES | 8 modules |
| BLOCKED decisions | 5 | BLOCKED decisions | 0 |

Scope reduction: ~48% fewer rewrites; ~65% fewer estimated hours (102h → 36h) after conflict resolution in favour of existing Sprint 1 choices.
