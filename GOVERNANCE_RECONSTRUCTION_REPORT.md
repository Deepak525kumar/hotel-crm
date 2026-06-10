# GOVERNANCE RECONSTRUCTION REPORT

**Date:** 2026-06-10
**Status:** FINAL
**Purpose:** Reconstruct the document governance chain after partial document loss; establish which documents were recovered, from which branches, and what decisions each resolves.

---

## 1. BACKGROUND

Sprint 1 was implemented with 5 of 6 required architecture documents believed missing. The primary salvage plan (`SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md`) listed 5 BLOCKED decisions that could not be resolved without the missing documents. This report documents the recovery effort.

---

## 2. DOCUMENT RECOVERY AUDIT

### 2.1 Documents confirmed missing (searched 19 branches)

The following documents were requested but do not exist on any branch in the repository:

| Document | Search Result |
|----------|--------------|
| DOCUMENT_RECOVERY_AUDIT.md | Not found on any of 19 branches |
| GOVERNANCE_RECONSTRUCTION_REPORT.md (prior version) | Not found |
| CANONICAL_ARCHITECTURE_INDEX.md (prior version) | Not found |

**Conclusion:** These three documents were never created or were lost before any commit. This document and its siblings (CANONICAL_ARCHITECTURE_INDEX.md, ARCHITECTURE_RECONCILIATION_REPORT.md) are the first versions.

### 2.2 Documents found on non-obvious branches

| Document | Found On | Status at Recovery |
|----------|----------|--------------------|
| SCHEMA_RECONCILIATION_DECISION.md | claude/peaceful-planck-u39n66 | FINAL |
| PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md | claude/peaceful-planck-u39n66 | FINAL |
| PR2_SALVAGE_PLAN.md | claude/peaceful-planck-u39n66 | FINAL |

### 2.3 Documents found on main branch (always present)

| Document | Location |
|----------|----------|
| docs/PRISMA_SCHEMA_V2_FREEZE.md | main |
| docs/API_SPEC_V1_PATCH_V2.md | main |
| docs/MARKETPLACE_REFACTOR_MASTER_PLAN.md | main |

---

## 3. BLOCKED DECISIONS RESOLVED BY RECOVERY

### Decision 1: Session storage strategy

**Was blocked:** Sprint 1 used PostgreSQL Session via Prisma. Canonical strategy was unknown.

**Resolved by:** PRISMA_SCHEMA_V2_FREEZE.md — Session is listed as canonical V2 entity with fields `id, user_id, refresh_token @unique, expires_at, created_at`.

**Resolution:** PostgreSQL Session via Prisma is correct. No change required.

---

### Decision 2: User.hotel_ids column retention

**Was blocked:** PRISMA_SCHEMA_V2_FREEZE migration step 2 says "drop hotel_ids". Sprint 1 kept it. API_SPEC_V1_PATCH_V2 PATCH-04 says remove from DTOs. Conflict was unresolvable without reconciliation document.

**Resolved by:** SCHEMA_RECONCILIATION_DECISION.md §3.1 — "MVP schema = main's V2 + `hotel_ids String[]` on User. Reason: checkHotelAccess() reads req.auth.hotel_ids. Without this column on User, the JWT payload cannot be populated at sign-in."

**Resolution:** Column KEEPS in DB and JWT payload for MVP. Removed from API response DTOs (PATCH-04). Column drop scheduled for Sprint 2 Phase 2.

---

### Decision 3: RBAC model — static map vs dynamic permissions

**Was blocked:** Sprint 1 used ROLE_PERMISSIONS static map. Canonical RBAC model was unknown.

**Resolved by:** PR2_SALVAGE_PLAN.md §D-3 — "ROLE_PERMISSIONS static map is confirmed valid canonical approach for MVP."

**Resolution:** Static map is canonical. Keep as-is. Remove super_admin bypass only.

---

### Decision 4: Route prefix — /crm/ correctness

**Was blocked:** Sprint 1 used /api/v1/crm/ prefix. Whether this was canonical or legacy was unknown.

**Resolved by:** MARKETPLACE_REFACTOR_MASTER_PLAN.md Part 4 — hotels endpoints listed at `/api/v1/crm/hotels`.

**Resolution:** /crm/ prefix is confirmed canonical. No change required.

---

### Decision 5: Enrollment entity name — HotelMembership vs HotelWorker

**Was blocked:** Sprint 1 had a partially-named enrollment module. Canonical V2 entity name was unknown.

**Resolved by:** PRISMA_SCHEMA_V2_FREEZE.md — model `HotelWorker` is listed with status enum `HotelWorkerStatus (INVITED/ACTIVE/SUSPENDED/REMOVED)`.

**Resolution:** `HotelWorker` is canonical. HotelWorker module must be fully rewritten against this table.

---

## 4. DECISIONS THAT REMAIN OPEN

The recovery effort resolved all 5 previously blocked decisions. Four new decisions are identified that require explicit product/architecture sign-off:

| ID | Question | Discovery source |
|----|----------|-----------------|
| D-1 | argon2 vs bcrypt | PR2_SALVAGE_PLAN §D-1 |
| D-2 | Public signup endpoint presence | API_SPEC_V1_PATCH_V2 final auth surface |
| D-3 | ADMIN bypass in checkHotelAccess | PR2_ARCHITECTURE_COMPLIANCE_AUDIT Finding 3 |
| D-4 | WorkApplication.worker_id nullability | PRISMA_SCHEMA_V2_FREEZE schema structure |

---

## 5. GOVERNANCE CHAIN — DOCUMENT CREATION TIMELINE

Based on branch and content analysis (approximate order):

1. `docs/MARKETPLACE_REFACTOR_MASTER_PLAN.md` — earliest, establishes marketplace model and routing
2. `docs/PRISMA_SCHEMA_V2_FREEZE.md` — schema freeze against marketplace model
3. `docs/API_SPEC_V1_PATCH_V2.md` — API patches against V2 schema
4. `SCHEMA_RECONCILIATION_DECISION.md` — MVP overrides reconciling V2 schema with Sprint 1 realities
5. `PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md` — compliance audit of fix/backend-blockers branch
6. `PR2_SALVAGE_PLAN.md` — salvage decisions from audit
7. `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` — Sprint 1 refactor plan (written with partial doc access)
8. `SPRINT_1_FINAL_REMEDIATION_PLAN.md` — this session's output; reconciled final plan
9. `CANONICAL_ARCHITECTURE_INDEX.md` — index of all the above (new)
10. `GOVERNANCE_RECONSTRUCTION_REPORT.md` — this document (new)
11. `ARCHITECTURE_RECONCILIATION_REPORT.md` — conflict resolution log (new)

---

## 6. BRANCH MAP

| Branch | Key Documents |
|--------|--------------|
| main | PRISMA_SCHEMA_V2_FREEZE, API_SPEC_V1_PATCH_V2, MARKETPLACE_REFACTOR_MASTER_PLAN |
| claude/peaceful-planck-u39n66 | SCHEMA_RECONCILIATION_DECISION, PR2_ARCHITECTURE_COMPLIANCE_AUDIT, PR2_SALVAGE_PLAN |
| claude/epic-hawking-t190p5 | Sprint 1 implementation + all new governance docs |
