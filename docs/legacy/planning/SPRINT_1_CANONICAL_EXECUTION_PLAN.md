> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# Sprint 1 — Canonical Execution Plan

**Status:** CANONICAL — supersedes the reconciled inputs listed in §7.
**Date:** 2026-06-10
**Constraint:** No architecture redesign. No new governance. Reconciliation only.

This document is the single source of truth for Sprint 1 execution. It reconciles
eight prior planning/adjudication documents into one ordered plan. Where prior
documents conflict, the resolution rule is the already-frozen authority hierarchy
(`ARCHITECTURE_CONSOLIDATION_EXECUTION_PLAN.md §6`): lower layer (closer to Prisma)
wins for entities/state; `_FREEZE > _PATCH_V2 > _PATCH_V1 > base`.

---

## 0. Authority Baseline (what is actually recovered)

Per `GOVERNANCE_RECOVERY_DELTA_REPORT.md §0.1`, the authority corpus splits cleanly:

| Document | Layer | Status |
|---|---|---|
| `docs/PRISMA_SCHEMA_V2_FREEZE.md` | L0 — domain model | ✅ Recovered, in repo |
| `MARKETPLACE_REFACTOR_MASTER_PLAN.md` | L1 — marketplace rules | ✅ Recovered, in repo |
| `docs/API_SPEC_V1_PATCH_V2.md` | L2 — interface | ✅ Recovered, in repo |
| `TESTING_MASTER_PLAN_FREEZE.md` | L4 — test gating | ✅ Recovered, FROZEN |
| `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V2.md` | L4 — deploy | ✅ Recovered, in repo |
| `WORKREQUEST_FINAL_ARCHITECTURE(.md/_PATCH_V1)` | L1 — WR lifecycle | ⚠️ On feature branch `origin/claude/amazing-hypatia-DQ2lE`, **not on main** |
| `BACKEND_EXECUTION_BLUEPRINT_V2(.md/_PATCH_V1)` | L3 — backend layout | ⚠️ On feature branch `origin/claude/optimistic-turing-wu7y5r`, **not on main** |
| `MOBILE_PRODUCT_BLUEPRINT(.md/_PATCH_V1)` | L3 — mobile surface | ⚠️ On feature branch `origin/claude/affectionate-tesla-mxsylr`, **not on main** |

**Reconciliation of the existence conflict:** `AUTHORITY_DOCUMENT_EXISTENCE_REPORT.md`
locates the three blueprint documents (with commit SHAs) on specific `origin/claude/*`
feature branches, while `GOVERNANCE_RECOVERY_DELTA_REPORT.md` reports them "NOT
RECOVERED." Both are correct at different scopes: the documents exist on unmerged
feature branches but are absent from `main` / the working corpus. They are therefore
**present but unmerged**, not lost. This is a merge action (§3 Blocker B-1), not a
recovery effort.

---

## 1. Findings Eliminated (invalidated by recovered authority)

The following findings were produced while the recovered authority documents were
believed absent. They are now **void**:

| # | Voided finding | Origin document | Why void |
|---|---|---|---|
| E-1 | "Step 0 BLOCKED GATE — obtain PRISMA_SCHEMA_V2_FREEZE, API_SPEC_V1_PATCH_V2, MARKETPLACE_REFACTOR_MASTER_PLAN, SCHEMA_RECONCILIATION_DECISION, PR2_ARCHITECTURE_COMPLIANCE_AUDIT" | `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md §ESCALATION, Part 3 Step 0` | All five are present in the repo (`docs/` and root). The gate is closed. |
| E-2 | Schema decisions flagged `⚠ BLOCKED on PRISMA_SCHEMA_V2_FREEZE.md` (schema.prisma, migration, AuditLog scoping, User columns) | `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` Part 1/5 | Schema freeze is recovered; these are now actionable. |
| E-3 | JWT payload decisions flagged `⚠ BLOCKED on API_SPEC_V1_PATCH_V2.md` | `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` jwt.ts row | API spec is recovered (PATCH-04 removes `hotel_ids` from User DTOs). Now actionable. |
| E-4 | Session strategy + RBAC redesign flagged `⚠ BLOCKED on MARKETPLACE_REFACTOR_MASTER_PLAN.md` | `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` permissions.ts row | Marketplace plan is recovered. Now actionable. |
| E-5 | "Create a new `HotelMembership` junction table" | `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` Part 3 Step 1a, hotel-workers rows | `PRISMA_SCHEMA_V2_FREEZE` already defines **`HotelWorker`** as the membership entity (one of the 13 MVP models). No new table is invented; "HotelMembership" was a placeholder name coined without the schema. Membership work = use existing `HotelWorker`. |
| E-6 | Mobile compliance verdicts "INDETERMINATE — document absent" for PRISMA_SCHEMA_V2_FREEZE, API_SPEC_V1_PATCH_V2, MARKETPLACE_REFACTOR_MASTER_PLAN | `MOBILE_ARCHITECTURE_COMPLIANCE_REPORT.md §3, §5` | Three of the four targets are recovered. The "precondition FAIL" no longer applies to them; mobile is assessable against backend authority (still gated on the mobile blueprint — see B-1). |
| E-7 | Premise "six newly recovered authority documents invalidate prior governance" | `GOVERNANCE_RECOVERY_DELTA_REPORT.md §5` | Premise itself INVALIDATED — no prior governance statement is overruled by the three unmerged blueprints. Entity inventory and workflow stand as validated. |

---

## 2. Blockers Removed (superseded, no longer gating)

| # | Removed blocker | Superseded by |
|---|---|---|
| S-1 | Test-runner / password-hash governance decision (D-1/D-2) treated as an open gate | `TESTING_MASTER_PLAN_FREEZE` (FROZEN) already mandates Jest + Supertest + bcryptjs. The decision is **made**: keep Jest + bcryptjs. Switching to vitest/argon2 requires a non-existent `TESTING_MASTER_PLAN_V2` and is out of Sprint 1 scope. Stream A is unblocked for everything except argon2 (which is simply not adopted). |
| S-2 | PR #2 "split vs conflict-resolve vs merge" question | `PR2_FINAL_MERGE_DECISION.md` (FINAL): **CLOSE PR #2**, reconstruct on clean branches. Settled; not re-litigated here. |
| S-3 | "Recover missing canonical documents to repo" as a code-blocking action | `GOVERNANCE_RECOVERY_DELTA_REPORT.md §6`: the Drive-only reference docs (`MASTER_ARCHITECTURE_v2.0`, `RBAC_PERMISSION_MATRIX_v1.0`, `FINAL_DECISIONS_SUMMARY`) and the meta-index docs are governance hygiene, not code blockers for Sprint 1 backend. Demoted to non-blocking follow-up. |
| S-4 | `D-4 hotel_ids on User` treated as a decision gate | Resolved: `API_SPEC_V1_PATCH_V2 PATCH-04` removes `hotel_ids` from DTOs; `SCHEMA_RECONCILIATION_DECISION` retains the column transitionally. Canonical position: **keep the column as a backfill artifact for MVP, drop in Phase 5.** No gate. |

---

## 3. Remaining Real Blockers

Only these genuinely block work. Everything else is executable now.

| ID | Blocker | Blocks | Resolution (no redesign) |
|---|---|---|---|
| **B-1** | Three L1/L3 authority docs unmerged to `main`: `WORKREQUEST_FINAL_ARCHITECTURE`, `BACKEND_EXECUTION_BLUEPRINT_V2`, `MOBILE_PRODUCT_BLUEPRINT` (+ their PATCH_V1s) | WorkRequest **lifecycle** adjudication; backend **module-boundary** sign-off; **all mobile** implementation scope | Merge the documents from their known feature branches (§0) to `main`. Document action only — they already exist. Does **not** block Sprint 1 backend auth/schema/HotelWorker work, which is fully governed by L0/L1-marketplace/L2 (all recovered). |
| **B-2** | `WorkRequestStatus` enum conflict: schema freeze = `DRAFT→OPEN→PARTIALLY_FILLED→FILLED→CANCELLED/EXPIRED` (6 states); API spec PATCH-05 = `OPEN\|CLOSED\|CANCELLED` (3 states) | Any WorkRequest endpoint or status DTO | Per layer rule, **L0 schema freeze governs**. API spec (L2) must expose the 6-state enum or a documented projection. Correction lands as a patch to the API spec, not an inline schema edit. Does not block auth/HotelWorker. |
| **B-3** | Infra GAP-C6: `DO_SPACES_KEY`/`DO_SPACES_SECRET` not mapped to `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in `scripts/backup-db.sh` | DB backup upload to DO Spaces (FAIL) | Add the credential-mapping export block before `aws s3 cp`. Small, isolated fix. |
| **B-4** | Infra GAP-C3 (PARTIAL): production workflow and `scripts/deploy.sh` are backend-only — frontend never built/restarted on prod | Production frontend deploys (stale build) | Add frontend `npm run build` + `pm2 restart hotel-crm-web` to `deploy-production.yml` and `scripts/deploy.sh`, mirroring the already-fixed staging path. |

Infra gaps GAP-C1, C2, C4, C5 are **PASS** (`INFRASTRUCTURE_CRITICAL_FIX_VALIDATION.md`) — no action.

---

## 4. Final Implementation Order

Phases are hard-sequenced by dependency; work within a phase may be parallelised.
The order merges the auth-salvage sequence (`PR2_*`) with the Sprint-1 remediation
sequence (`SPRINT_1_SALVAGE_AND_REFACTOR_PLAN`), de-duplicated and with voided
blockers removed.

### Phase 0 — Pre-work (hours, parallelisable, no code dependency)
1. **Close PR #2** without merge, with the split-plan comment (`PR2_FINAL_MERGE_DECISION §Action 1`).
2. **Merge B-1 documents** to `main` from their feature branches (doc-only merge).
3. **Patch B-2**: re-issue API spec WorkRequest status to the 6-state enum (or documented projection). Doc-only.
4. Confirm test stack stays Jest + bcryptjs (S-1). No work, just recorded.

### Phase 1 — Stream A: Auth Improvements  *(critical path to MVP auth)*
**Branch:** `feat/auth-improvements` (from `main`). **Depends on:** Phase 0 close of PR #2 only.
Reconstruct the 7 auth files on a clean branch (never cherry-pick from `fix/backend-blockers`):
1. `auth/validation.ts` — new file; `hotel_ids` retained transitionally (S-4).
2. `lib/jwt.ts` — restore two-secret refresh (`JWT_REFRESH_SECRET ?? JWT_SECRET`); export `parseExpiryToSeconds`; keep `hotel_ids` in payload for MVP (drop in Phase 5).
3. `auth/types.ts` — `AuthResponse`→`AuthTokens`; additive fields.
4. `auth/service.ts` — reconstruct from main + PR improvements; **drop** `exportUserData` and `getDefaultPermissions`; restore `ForbiddenError` for disabled accounts, `logAudit` + IP tracking, `role.toLowerCase()` in token signing, `ROLE_PERMISSIONS` from constants; bcryptjs (S-1).
5. `auth/controller.ts` — take PR; 1-line `logout` fix (pass `req.body?.refresh_token`).
6. `auth/routes.ts` — take PR; remove signup `requireRole('admin')` guard; remove 2 GDPR routes.
7. `app.ts` — single unused-import deletion.
8. Update `./types.js`→`./validation.js` import sites. **Gate:** `tsc --noEmit` clean + auth tests pass.

### Phase 2 — Infra critical fixes  *(parallel with Phase 1; independent)*
**Branch:** `fix/infra-deploy-gaps` (from `main`).
- B-3: credential mapping in `scripts/backup-db.sh`.
- B-4: frontend build + `hotel-crm-web` restart in `deploy-production.yml` and `scripts/deploy.sh`.

### Phase 3 — HotelWorker membership alignment
**Branch:** `feat/hotelworker-v2` (from `main`). **Depends on:** Phase 1 merged.
Rewrite `modules/hotel-workers/` and the RBAC `checkHotelAccess` middleware to operate
on the existing **`HotelWorker`** entity (E-5) instead of `User.hotel_ids` array ops:
membership rows with `status`, `assigned_by`, `assigned_at`; atomic constraints;
`permissions.ts` reads role-derived permissions, not stale JWT arrays. Rewrite
`hotel-workers.test.ts`; patch `rbac.test.ts` mocks. (Replaces the old "CRM V2 rewrite"
framing — the membership table already exists in V2.)

### Phase 4 — User module alignment
**Branch:** `feat/users-v2` (from `main`). **Depends on:** Phase 3 (HotelWorker live).
Replace `hotel_ids: { has }` array filter with `HotelWorker` join; add tenant scoping
to `listUsers`; stop writing `permissions` to the `User` row. Patch `users.test.ts`.

### Phase 5 — Hotel (CRM) module patches
**Branch:** `feat/crm-patches` (from `main`). **Depends on:** Phase 1.
Add `Hotel.deleted_at` (schema freeze allows), wire `deleteHotel` to set it; remove the
two 501 stub routes; confirm `/crm/` prefix against `API_SPEC_V1_PATCH_V2`.

### Phase 6 — Phase 2 schema migration  *(post-Sprint-1 backend foundation)*
**Branch:** `feat/phase2-schema` (from `main`). **Depends on:** Phase 1 merged.
Add the 9 deferred models (`Contract`, `ContractTemplate`, `ContractLineItem`,
`WorkerDocument`, `RequiredDocument`, `Payroll`, `PayrollLineItem`, `DataRetentionLog`,
`ConsentLog`) with typed enum status fields. `ConsentLog` before first prod registration.

### Phase 7 — Stream B: GDPR module
**Branch:** `feat/gdpr-module` (from `main`). **Depends on:** Phase 1 + Phase 6.
Implement `modules/gdpr/{service,controller,routes}.ts` at canonical `/gdpr/*` paths;
`exportUserData` against V2 + Phase 2 entities only.

### Phase 8 — `hotel_ids` deprecation
**Branch:** `feat/hotel-ids-removal` (from `main`). **Depends on:** Phase 3 fully operational.
Drop `User.hotel_ids` + `User.permissions` columns and all JWT payload references;
migration window required (force re-login / JWT version field).

### Phase 9 — Mobile implementation
**Depends on:** B-1 (mobile blueprint merged). Out of Sprint 1 backend scope; remains
gated until `MOBILE_PRODUCT_BLUEPRINT` is on `main`. Mobile compliance re-assessment
(superseding the FAIL in `MOBILE_ARCHITECTURE_COMPLIANCE_REPORT`) runs after that merge.

---

## 5. Final Effort Estimate

| Phase | Scope | Effort | Gating dependency |
|---|---|---|---|
| 0 — Pre-work | Close PR #2, merge 3 docs, API-spec enum patch | 2–4 h | — |
| 1 — Auth (Stream A) | 7 files reconstructed | 6–7 h | Phase 0 |
| 2 — Infra fixes | B-3 + B-4 | 2–4 h | — |
| 3 — HotelWorker v2 | service + RBAC + tests | 8–12 h | Phase 1 |
| 4 — Users v2 | join filter + scoping + tests | 4–6 h | Phase 3 |
| 5 — CRM patches | deleted_at, stubs, prefix | 2–3 h | Phase 1 |
| 6 — Phase 2 schema | 9 models + migration | 3–5 d | Phase 1 |
| 7 — GDPR module | 3 files | 3–5 d | Phase 1 + 6 |
| 8 — hotel_ids removal | cross-cutting | 1–2 d | Phase 3 |
| 9 — Mobile | full client surface | separate sprint(s) | B-1 |

**Sprint 1 backend critical path (auth usable + infra safe):** Phase 0 → Phase 1 (+ Phase 2 in parallel) ≈ **1.5 days**.
**Sprint 1 marketplace-aligned backend (through Phase 5):** ≈ **4–6 days**.
**Through GDPR (Phases 6–7):** + **~2 sprints**.

Sprint 1 baseline completeness vs marketplace architecture was assessed at **57%**
(`SPRINT_1_SALVAGE_AND_REFACTOR_PLAN §6`); Phases 1–5 close the auth/JWT/membership/RBAC
gaps that account for the bulk of the deficit.

---

## 6. Final Branch Strategy

Rules (from `PR2_AUTH_SALVAGE_EXECUTION_PLAN §Branch rules`, retained):
- Every branch is cut from `main` HEAD when work begins. **No cherry-picks** from `fix/backend-blockers`; files are reconstructed.
- `fix/backend-blockers` is **closed without merge** once `feat/auth-improvements` opens.
- One PR per branch, each targeting `main`, each independently green (`tsc --noEmit` + tests).

| Branch | From | Phase | Opens when |
|---|---|---|---|
| `feat/auth-improvements` | `main` | 1 | After PR #2 closed |
| `fix/infra-deploy-gaps` | `main` | 2 | Immediately (parallel) |
| `feat/hotelworker-v2` | `main` | 3 | After Phase 1 merged |
| `feat/users-v2` | `main` | 4 | After Phase 3 merged |
| `feat/crm-patches` | `main` | 5 | After Phase 1 merged |
| `feat/phase2-schema` | `main` | 6 | After Phase 1 merged |
| `feat/gdpr-module` | `main` | 7 | After Phase 1 + Phase 6 merged |
| `feat/hotel-ids-removal` | `main` | 8 | After Phase 3 operational |

(Active development branch for this reconciliation work: `claude/blissful-newton-agyl3y`.)

---

## 7. Documents Now Obsolete / Superseded

| Document | Disposition | Reason |
|---|---|---|
| `SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md` | **Superseded** by this plan | Its "5 reference documents NOT FOUND" premise and the BLOCKED-GATE / HotelMembership findings (E-1…E-5) are void now that the authority docs are recovered. Its file-level inventory remains a useful appendix but is no longer the execution authority. |
| `PR2_AUTH_SALVAGE_EXECUTION_PLAN.md` | **Folded in** (Phase 1, branch rules) | Execution detail consolidated here; retain as the file-level salvage reference for `service.ts`. |
| `PR2_FINAL_MERGE_DECISION.md` | **Retained as record**, decision folded in (S-2) | The CLOSE-and-reconstruct decision is final and carried forward; the doc stands as the audit record. |
| `MOBILE_ARCHITECTURE_COMPLIANCE_REPORT.md` | **Partially superseded** (E-6) | Its FAIL was a precondition failure against docs now recovered; verdicts for the 3 recovered targets are void. A re-assessment is due after B-1 (mobile blueprint merged). |
| `AUTHORITY_DOCUMENT_EXISTENCE_REPORT.md` | **Reconciled** (§0) | Not obsolete: it supplies the branch locations/SHAs for B-1. Read together with the delta report it resolves the "found vs not recovered" conflict (present-but-unmerged). |
| `GOVERNANCE_RECOVERY_DELTA_REPORT.md` | **Retained as authority** for §1–§3 | The adjudication source for what is invalidated/validated; not superseded. |
| `ARCHITECTURE_CONSOLIDATION_EXECUTION_PLAN.md` | **Retained** | Source of the authority hierarchy + merge order used throughout; still authoritative for doc consolidation. |
| `INFRASTRUCTURE_CRITICAL_FIX_VALIDATION.md` | **Retained** | Source of truth for infra gap status (B-3, B-4); current. |

No other documents are deprecated by this plan.

---

*End of canonical plan.*
