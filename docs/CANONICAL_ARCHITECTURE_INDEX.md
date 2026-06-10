# CANONICAL ARCHITECTURE INDEX
## Hotel CRM — Definitive Source-of-Truth Map

**Produced:** 2026-06-10  
**Produced by:** Governance Reconstruction Exercise  
**Purpose:** Resolve the false authority conflict caused by 18 planning documents residing on unmerged branches, invisible to repository audits that treated MASTER_ARCHITECTURE_v2.0 as the sole authority.

---

## 1. CRITICAL FINDING

All architecture documents created after June 1, 2026 were committed to **separate, unmerged feature branches**. They are not present on `main`. Repository audits performed against `main` correctly report MASTER_ARCHITECTURE_v2.0 as the only visible authority — but this is an artefact of branch isolation, not a genuine authority decision.

**The actual authority chain extends significantly beyond MASTER_ARCHITECTURE_v2.0.** The marketplace refactor documents (June 8–9, 2026) supersede the entity model, database schema, and module design in MASTER_ARCHITECTURE_v2.0 Section 4 and Section 7.

---

## 2. DOCUMENT HIERARCHY

```
TIER 1 — FOUNDATION (Google Drive · May 27, 2026)
══════════════════════════════════════════════════
  MASTER_ARCHITECTURE_v2.0.md              [PARTIALLY SUPERSEDED — see Tier 2]
  FINAL_DECISIONS_SUMMARY.md               [ACTIVE — process decisions still valid]
  IMPLEMENTATION_PROCESS_v1.0.md           [ACTIVE — process still valid]
  claude_context.pdf (CLAUDE_CONTEXT)      [ACTIVE — operational rules]

TIER 2 — DOMAIN ARCHITECTURE (Unmerged branches · June 8–9, 2026)
══════════════════════════════════════════════════════════════════
  MARKETPLACE_REFACTOR_MASTER_PLAN.md      [FROZEN] ← supersedes MA_v2.0 §4, §7
  WORKREQUEST_FINAL_ARCHITECTURE.md        [FROZEN] ← supersedes MA_v2.0 staffing model
  WORKREQUEST_FINAL_ARCHITECTURE_PATCH_V1  [FREEZE-READY] ← resolves 10 BLOCKERs
  QUALITY_AND_RATING_ARCHITECTURE.md       [MISSING — not found anywhere]
  QUALITY_AND_RATING_ARCH_PATCH_V1.md      [MISSING — not found anywhere]
  MOBILE_PRODUCT_BLUEPRINT.md              [DRAFT] ← supersedes MA_v2.0 §9, §10
  MOBILE_PRODUCT_BLUEPRINT_PATCH_V1.md     [PATCH APPLIED] ← marketplace alignment

TIER 3 — EXECUTION BLUEPRINTS (Unmerged branches · June 8–9, 2026)
═══════════════════════════════════════════════════════════════════
  IMPLEMENTATION_MASTER_PLAN_V2.md         [PENDING FREEZE APPROVAL]
    supersedes: IMPLEMENTATION_MASTER_PLAN.md (invalidated by architecture audit)
  BACKEND_EXECUTION_BLUEPRINT_V2.md        [IMPLEMENTATION-READY]
    supersedes: BACKEND_EXECUTION_BLUEPRINT.md (legacy task-based)
  BACKEND_EXECUTION_BLUEPRINT_V2_PATCH_V1  [AUDIT COMPLETE]

TIER 4 — SCHEMA & CONTRACTS (Unmerged branches · June 9, 2026)
════════════════════════════════════════════════════════════════
  docs/PRISMA_SCHEMA_V2_FREEZE.md          [APPROVED_WITH_MINOR_FOLLOWUPS — CANONICAL]
    note: PRISMA_SCHEMA_V2.md and PATCH_V1 exist as schema.prisma commits, not .md files
  docs/PRISMA_IMPLEMENTATION_CHECKLIST.md  [ACTIVE — deployment runbook]
  docs/API_SPEC_V1.md                      [DRAFT]
  docs/API_SPEC_V1_PATCH_V1.md             [AUDIT]
  docs/API_SPEC_V1_PATCH_V2.md             [APPROVED_WITH_PATCHES — CANONICAL]

TIER 5 — QUALITY ASSURANCE (Unmerged branch · June 9, 2026)
════════════════════════════════════════════════════════════
  TESTING_MASTER_PLAN.md                   [DRAFT]
  TESTING_MASTER_PLAN_PATCH_V1.md          [AUDIT]
  TESTING_MASTER_PLAN_PATCH_V2.md          [IMPLEMENTATION-VALID]
  TESTING_MASTER_PLAN_FREEZE.md            [APPROVED/FROZEN — CANONICAL]

TIER 6 — INFRASTRUCTURE (main branch · June 9, 2026)
════════════════════════════════════════════════════
  INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md    [PATCHED — not standalone]
  INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V1.md  [APPROVED_WITH_PATCHES — superseded]
  INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V2.md  [APPROVED — CANONICAL]
  INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_FREEZE.md    [MISSING — expected, not created]

TIER 7 — GOVERNANCE AUDIT (main branch · June 1, 2026)
════════════════════════════════════════════════════════
  DOCUMENTATION_AUDIT_REPORT.md           [STALE — predates Tier 2–5 documents]
  DOCUMENTATION_ACTION_PLAN.md            [STALE — predates Tier 2–5 documents]

ARCHIVED (Google Drive · May 27, 2026)
═══════════════════════════════════════
  API_STANDARDS_v1.0.md                   [SUPERSEDED by API_SPEC_V1_PATCH_V2]
  RBAC_PERMISSION_MATRIX_v1.0.md          [SUPERSEDED by marketplace RBAC in WORKREQUEST docs]
  DATABASE_RELATIONSHIP_DIAGRAM_v1.0.md   [SUPERSEDED by PRISMA_SCHEMA_V2_FREEZE]
  EVENT_FLOW_MAPPING_v1.0.md              [SUPERSEDED by MARKETPLACE_REFACTOR_MASTER_PLAN]
  PHASE1_KICKOFF_CHECKLIST.md             [SUPERSEDED — replaced by PRISMA_IMPLEMENTATION_CHECKLIST]

LEGACY (git _legacy/ + old Drive docs)
════════════════════════════════════════
  _legacy/reports/current-project-report.md    [ARCHIVED]
  _legacy/reports/system-readiness-report.md   [ARCHIVED]
  BACKEND_EXECUTION_BLUEPRINT.md (V1)          [SUPERSEDED by V2]
  IMPLEMENTATION_MASTER_PLAN.md (V1)           [SUPERSEDED by V2]
```

---

## 3. AUTHORITY TABLE

| Document | Location | Date | Status | Authority |
|---|---|---|---|---|
| MASTER_ARCHITECTURE_v2.0.md | Google Drive | 2026-05-27 | **PARTIALLY SUPERSEDED** | Foundation (Tier 1) |
| FINAL_DECISIONS_SUMMARY.md | Google Drive | 2026-05-27 | ACTIVE | Supporting (Tier 1) |
| IMPLEMENTATION_PROCESS_v1.0.md | Google Drive | 2026-05-27 | ACTIVE | Process (Tier 1) |
| claude_context.pdf | Google Drive | 2026-05-27 | ACTIVE | Operational (Tier 1) |
| MARKETPLACE_REFACTOR_MASTER_PLAN.md | branch: loving-brahmagupta | 2026-06-09 | **FROZEN** | Domain (Tier 2) |
| WORKREQUEST_FINAL_ARCHITECTURE.md | branch: amazing-hypatia | 2026-06-08 | **FROZEN** | Domain (Tier 2) |
| WORKREQUEST_FINAL_ARCHITECTURE_PATCH_V1 | branch: amazing-hypatia | 2026-06-08 | FREEZE-READY | Patch (Tier 2) |
| QUALITY_AND_RATING_ARCHITECTURE.md | **MISSING** | unknown | **UNRECOVERABLE** | Domain (Tier 2) |
| QUALITY_AND_RATING_ARCH_PATCH_V1.md | **MISSING** | unknown | **UNRECOVERABLE** | Patch (Tier 2) |
| MOBILE_PRODUCT_BLUEPRINT.md | branch: affectionate-tesla | 2026-06-09 | DRAFT + PATCHED | Domain (Tier 2) |
| MOBILE_PRODUCT_BLUEPRINT_PATCH_V1.md | branch: affectionate-tesla | 2026-06-09 | PATCH APPLIED | Patch (Tier 2) |
| IMPLEMENTATION_MASTER_PLAN_V2.md | branch: stoic-einstein | 2026-06-08 | PENDING FREEZE | Execution (Tier 3) |
| BACKEND_EXECUTION_BLUEPRINT_V2.md | branch: optimistic-turing | 2026-06-09 | **IMPLEMENTATION-READY** | Execution (Tier 3) |
| BACKEND_EXECUTION_BLUEPRINT_V2_PATCH_V1 | branch: optimistic-turing | 2026-06-09 | AUDIT COMPLETE | Patch (Tier 3) |
| PRISMA_SCHEMA_V2_FREEZE.md | branch: ecstatic-faraday | 2026-06-09 | **CANONICAL (schema)** | Schema (Tier 4) |
| PRISMA_IMPLEMENTATION_CHECKLIST.md | branch: ecstatic-faraday | 2026-06-09 | ACTIVE | Runbook (Tier 4) |
| API_SPEC_V1_PATCH_V2.md | branch: sharp-heisenberg | 2026-06-09 | **APPROVED_WITH_PATCHES** | Contract (Tier 4) |
| TESTING_MASTER_PLAN_FREEZE.md | branch: tender-franklin | 2026-06-09 | **APPROVED/FROZEN** | QA (Tier 5) |
| INFRA_AND_DEPLOYMENT_PLAN_PATCH_V2.md | main | 2026-06-09 | **APPROVED** | Infra (Tier 6) |
| DOCUMENTATION_AUDIT_REPORT.md | main | 2026-06-01 | STALE | Audit (Tier 7) |

---

## 4. OWNERSHIP

| Document | Owner | Approver |
|---|---|---|
| MASTER_ARCHITECTURE_v2.0 | Mayank Malhotra (Lead Dev) | Mayank, Ritik, Deepak |
| FINAL_DECISIONS_SUMMARY | Mayank Malhotra | Mayank, Ritik, Deepak |
| MARKETPLACE_REFACTOR_MASTER_PLAN | Principal Architect | Pending merge approval |
| WORKREQUEST_FINAL_ARCHITECTURE + PATCH | Principal Architect | Pending merge approval |
| PRISMA_SCHEMA_V2_FREEZE | Principal Architect | Mayank (schema sign-off) |
| BACKEND_EXECUTION_BLUEPRINT_V2 | Principal Backend Architect | Pending merge approval |
| API_SPEC_V1_PATCH_V2 | Principal Architect | Pending merge approval |
| TESTING_MASTER_PLAN_FREEZE | QA Lead | Pending merge approval |
| INFRA_AND_DEPLOYMENT_PLAN_PATCH_V2 | Infrastructure | Mayank (approved) |
| MOBILE_PRODUCT_BLUEPRINT (+ PATCH_V1) | Mobile Lead | Pending merge approval |

---

## 5. SUPERSESSION MAP

```
MASTER_ARCHITECTURE_v2.0
  │
  ├── §4  Feature Scope / Entity Model
  │       └── SUPERSEDED by MARKETPLACE_REFACTOR_MASTER_PLAN (June 9)
  │               Removed: Room, Task, TaskPhoto, DailyOperation
  │               Added:   WorkRequest, WorkApplication, WorkerAssignment,
  │                        Attendance, QualityVerification, Rating (marketplace)
  │
  ├── §7  Database Schema (12→23 tables)
  │       └── SUPERSEDED by PRISMA_SCHEMA_V2_FREEZE (June 9)
  │               Canonical schema: backend/prisma/schema.prisma (ecstatic-faraday branch)
  │               Patches SP-1..SP-9, MP-1..MP-10 applied
  │
  ├── §4  Staffing / WorkRequest module
  │       └── SUPERSEDED by WORKREQUEST_FINAL_ARCHITECTURE + PATCH_V1 (June 8)
  │               10 BLOCKERs resolved; architecture frozen
  │
  ├── §9  Mobile: single app with role switching
  │       └── EXTENDED by MOBILE_PRODUCT_BLUEPRINT + PATCH_V1 (June 9)
  │               Worker App + Checker App screen inventory defined
  │               Marketplace entity alignment confirmed
  │               (single-app decision from MA_v2.0 unchanged)
  │
  ├── §10 Mobile tech stack
  │       └── EXTENDED by MOBILE_PRODUCT_BLUEPRINT (June 9)
  │
  ├── §8  Infrastructure (Droplet, Redis, Nginx)
  │       └── EXTENDED/SUPERSEDED by INFRA_AND_DEPLOYMENT_PLAN_PATCH_V2 (June 9)
  │               Droplet topology, Nginx config, CI/CD workflows, cost model
  │
  ├── §16 API standards / RBAC
  │       └── SUPERSEDED by API_SPEC_V1_PATCH_V2 (June 9)
  │               Full REST contract replacing Drive-era API_STANDARDS_v1.0
  │
  ├── §16 GDPR framework
  │       └── REMAINS AUTHORITATIVE — no superseding document found
  │
  ├── §2  Modular Monolith decision
  │       └── REMAINS AUTHORITATIVE — confirmed by all subsequent documents
  │
  ├── §3  DigitalOcean PostgreSQL
  │       └── REMAINS AUTHORITATIVE — confirmed by PRISMA_SCHEMA_V2_FREEZE
  │
  └── §20 Scope discipline / three-place rule
          └── REMAINS AUTHORITATIVE
```

**Quality & Rating module:**  
`QUALITY_AND_RATING_ARCHITECTURE.md` and its patch are **MISSING**. The quality module is partially covered by PRISMA_SCHEMA_V2_FREEZE (QualityVerification, Rating tables) and TESTING_MASTER_PLAN_FREEZE (QA test coverage), but no domain architecture document exists. This is a genuine gap.

---

## 6. REQUIRED READ ORDER

To understand the complete authoritative architecture, documents must be read in this sequence. Reading MASTER_ARCHITECTURE_v2.0 alone is insufficient.

```
Step 1 — Foundation
  Google Drive: MASTER_ARCHITECTURE_v2.0.md
  Google Drive: FINAL_DECISIONS_SUMMARY.md
  Google Drive: claude_context.pdf

Step 2 — Marketplace Refactor (supersedes MA_v2.0 §4 entity model)
  branch loving-brahmagupta: MARKETPLACE_REFACTOR_MASTER_PLAN.md

Step 3 — Domain Architecture
  branch amazing-hypatia:    WORKREQUEST_FINAL_ARCHITECTURE.md
  branch amazing-hypatia:    WORKREQUEST_FINAL_ARCHITECTURE_PATCH_V1.md
  [MISSING]:                 QUALITY_AND_RATING_ARCHITECTURE.md ← GAP

Step 4 — Canonical Schema
  branch ecstatic-faraday:   docs/PRISMA_SCHEMA_V2_FREEZE.md
  branch ecstatic-faraday:   docs/PRISMA_IMPLEMENTATION_CHECKLIST.md

Step 5 — Execution
  branch stoic-einstein:     IMPLEMENTATION_MASTER_PLAN_V2.md (pending freeze)
  branch optimistic-turing:  BACKEND_EXECUTION_BLUEPRINT_V2.md
  branch optimistic-turing:  BACKEND_EXECUTION_BLUEPRINT_V2_PATCH_V1.md

Step 6 — API Contracts
  branch sharp-heisenberg:   docs/API_SPEC_V1.md
  branch sharp-heisenberg:   docs/API_SPEC_V1_PATCH_V2.md  ← canonical

Step 7 — Mobile
  branch affectionate-tesla: MOBILE_PRODUCT_BLUEPRINT.md
  branch affectionate-tesla: MOBILE_PRODUCT_BLUEPRINT_PATCH_V1.md

Step 8 — Infrastructure
  main:                      INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md
  main:                      INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V2.md  ← canonical

Step 9 — Testing
  branch tender-franklin:    TESTING_MASTER_PLAN_FREEZE.md  ← canonical
```

---

## 7. BRANCH-TO-DOCUMENT MAP

| Remote Branch | Key Documents | Merge Status |
|---|---|---|
| `main` | INFRA_PLAN, PATCH_V1, PATCH_V2 | **MERGED** |
| `claude/amazing-hypatia-DQ2lE` | WORKREQUEST_FINAL_ARCHITECTURE + PATCH_V1 | **UNMERGED** |
| `claude/affectionate-tesla-mxsylr` | MOBILE_PRODUCT_BLUEPRINT + PATCH_V1 | **UNMERGED** |
| `claude/loving-brahmagupta-n70p9z` | MARKETPLACE_REFACTOR_MASTER_PLAN | **UNMERGED** |
| `claude/optimistic-turing-wu7y5r` | BACKEND_EXECUTION_BLUEPRINT_V2 + PATCH_V1 | **UNMERGED** |
| `claude/ecstatic-faraday-vg0n4d` | PRISMA_SCHEMA_V2_FREEZE, PRISMA_IMPLEMENTATION_CHECKLIST | **UNMERGED** |
| `claude/sharp-heisenberg-2j4xxa` | API_SPEC_V1 + PATCH_V1 + PATCH_V2 | **UNMERGED** |
| `claude/tender-franklin-i5viku` | TESTING_MASTER_PLAN + PATCHES + FREEZE | **UNMERGED** |
| `claude/stoic-einstein-v8jJ7` | IMPLEMENTATION_MASTER_PLAN + V2 | **UNMERGED** |
| `claude/wonderful-ptolemy-3i8ty7` | BACKEND_EXECUTION_BLUEPRINT (V1 — legacy) | **UNMERGED** |
| `fix/backend-blockers` | Misc backend + docs implementation | **UNMERGED** |
| `docs/documentation-audit-and-governance` | No new architecture docs | **UNMERGED** |

---

## 8. GAP REGISTER

| Missing Document | Expected Location | Last Known Reference | Recovery Action |
|---|---|---|---|
| QUALITY_AND_RATING_ARCHITECTURE.md | repo root or `docs/` | INFRA_PLAN_PATCH_V1 audit scope | **CREATE — no recovery possible** |
| QUALITY_AND_RATING_ARCH_PATCH_V1.md | repo root or `docs/` | same | **CREATE — no recovery possible** |
| PRISMA_SCHEMA_V2.md | `docs/` or root | commit d2aacfc (ecstatic-faraday) | NOTE: V2 schema exists as `backend/prisma/schema.prisma` on ecstatic-faraday branch — the .md document was never created; the freeze doc (PRISMA_SCHEMA_V2_FREEZE.md) is the governance record |
| PRISMA_SCHEMA_V2_PATCH_V1.md | `docs/` or root | commit a8b4f4a (ecstatic-faraday) | NOTE: patches SP-1..SP-9, MP-1..MP-10 were applied directly to schema.prisma; the FREEZE doc records them — no separate .md needed |
| INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_FREEZE.md | repo root | INFRA_PLAN_PATCH_V2 (freeze implied) | **CREATE** — PATCH_V2 is effectively the freeze; promote PATCH_V2 to freeze status or create wrapper doc |

---

## 9. SYNCHRONISATION ACTIONS REQUIRED

### Priority 0 — Merge unmerged branches to `main`
All Tier 2–5 documents must be merged to `main` or a `docs/` consolidation branch so they are visible to repository audits. Each branch should be merged via PR with a documentation-only commit:

```
PR 1: merge claude/amazing-hypatia-DQ2lE      → WORKREQUEST architecture
PR 2: merge claude/affectionate-tesla-mxsylr  → MOBILE blueprint
PR 3: merge claude/loving-brahmagupta-n70p9z  → MARKETPLACE refactor plan
PR 4: merge claude/optimistic-turing-wu7y5r   → BACKEND blueprint V2
PR 5: merge claude/ecstatic-faraday-vg0n4d    → PRISMA freeze + checklist
PR 6: merge claude/sharp-heisenberg-2j4xxa    → API spec
PR 7: merge claude/tender-franklin-i5viku     → TESTING freeze
PR 8: merge claude/stoic-einstein-v8jJ7       → IMPLEMENTATION MASTER PLAN V2
```

### Priority 1 — Create missing documents
- `QUALITY_AND_RATING_ARCHITECTURE.md` — define QualityVerification + Rating domain architecture
- `QUALITY_AND_RATING_ARCHITECTURE_PATCH_V1.md` — consistency audit against marketplace schema
- `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_FREEZE.md` — promote PATCH_V2 status to frozen

### Priority 2 — Sync Google Drive documents to repo
- `MASTER_ARCHITECTURE_v2.0.md` — commit to `docs/` with supersession notice
- `FINAL_DECISIONS_SUMMARY.md` — commit to `docs/`
- `IMPLEMENTATION_PROCESS_v1.0.md` — commit to `docs/`

### Priority 3 — Mark stale documents
- `DOCUMENTATION_AUDIT_REPORT.md` — add header: "STALE — predates Tier 2–5 documents"
- `DOCUMENTATION_ACTION_PLAN.md` — add header: "STALE — superseded by this index"
- Google Drive: API_STANDARDS_v1.0, RBAC_PERMISSION_MATRIX_v1.0, DATABASE_RELATIONSHIP_DIAGRAM_v1.0, EVENT_FLOW_MAPPING_v1.0 — mark as superseded
