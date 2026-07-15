# Documentation Corrections Report — Package B

**Source audit:** `AUDIT-REPO-2026-07-14` (`docs/audits/REPOSITORY_SPECIFICATION_AUDIT_2026-07-14.md`)
**Package:** B — Documentation Workflow / module-author corrections
**Date:** 2026-07-15
**Session/branch:** `claude/fast-documentation-workflow-b5chdi`
**Resumed from:** Package A (Repository Synchronization, commit `e4ce0b5`), applied at HEAD `eff2ebb`'s successor state.
**Workflow authority:** `.claude/workflows/documentation.md`; `.claude/constitution/`; `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`.

## Scope discipline

Every change below traces directly to a named audit finding. No architecture change, no ownership change, no new ADR, no new specification, and no repository-synchronization (`.claude/knowledge/*.yaml`) edit was made — those remain Package A/C/D scope. Each corrected spec's own Proposed Knowledge Deltas section (already present in each document) is the authoritative record of the registry-pointer bump a future synchronization pass should apply.

---

## 1. Corrections applied

### AUDIT-H2 — `SPEC-AUTH-001` not synchronized to `ADR-016`

**File:** `docs/03-modules/auth/MODULE_SPEC.md` (`0.2.1` → `0.2.2`)

`ADR-016` (Accepted, 2026-07-14) resolved `state-audit-log`'s `authoritative_writer` from `UNKNOWN` to `backend-auth`, with `backend-compliance` as a read-only consumer. `STATE_OWNERSHIP_INDEX.yaml` and `SPEC-COMPLIANCE-001` already reflected this; `SPEC-AUTH-001`, the owning module's own specification, did not.

Corrected:
- Ownership and Boundaries' `state-audit-log` bullet: `authoritative_writer: UNKNOWN` → `authoritative_writer: backend-auth` per `ADR-016`, with a cross-reference to the new interface below.
- `RULE-AUTH-009`'s Owner/Source column: `unassigned (SYNC-001)` → `backend-auth (ADR-016)`.
- Added a `[TARGET STATE]` `IF-AUTH-GetAuditTrail / v0` paragraph to Interfaces and Contracts, disclosing the read-only `AuditLog`-query interface this module must expose to `backend-compliance` — closing `SPEC-COMPLIANCE-001`'s `OD-COMPLIANCE-004` (that document's `IF-COMPLIANCE-GetAuditTrail` counterpart, which explicitly named this gap: *"`backend-auth`'s own specification does not yet document exposing an `AuditLog`-read interface to Compliance"*).

`state-user`'s separate, still-open dual-writer gap (`OQ-AUTH-03`/`SYNC-005`) is untouched — out of this finding's scope. Security gate (`FAIL`, 1 Critical/4 High) is unaffected; `REVIEW` status and `unassigned` owner unchanged; G2 freeze remains reserved to human authority.

### AUDIT-M4 / `SIR-GLOB-018` — retention-sweep executor misnamed "Compliance"

**File:** `docs/03-modules/documents/MODULE_SPEC.md` (`0.1.2` → `0.1.3`)

`SPEC-RETENTION-001` (authored 2026-07-14) registers the daily automatic-deletion sweep mechanism, `RetentionLog`, and tier-policy engine as `backend-retention`, after its own G1.5 Boundary Collision check returned PASS. `SPEC-DOCUMENTS-001` predates that registration and still called the sweep executor "Compliance" (a conceptual, `.gitkeep`-only capability) in five places. Corrected every retention-**sweep-execution** reference to `backend-retention`/`SPEC-RETENTION-001`:

- Purpose and Scope's Out-of-scope list: split the single "Compliance" bullet into a Retention sweep-execution bullet and a narrower Compliance subject-rights/governance bullet.
- `REQ-DOC-014` and `RULE-DOC-06`: classification target executor corrected.
- Ownership and Boundaries' non-responsibilities sentence.
- The retention-sweep query-cost note (Failure/Security/Privacy/Performance) and `OD-DOC-019(b)`.

Compliance's genuinely-owned, *separate* subject-rights/export-fulfilment and special-category-governance references (`OD-DOC-012`, `RULE-DOC-10`, `IF-DOC-ExportWorkerDocuments`) were deliberately left untouched — `SPEC-RETENTION-001` itself explicitly disclaims that broader orchestration (its own §Out of Scope, line 35), so conflating the two would introduce a new inaccuracy rather than fix one.

**File:** `docs/03-modules/hr/MODULE_SPEC.md` — **verified, no defect found.**

The audit's evidence citation was `hr/MODULE_SPEC.md:339`. Direct inspection of every retention-sweep-execution mention in the current file (`RULE-HR-12`, `REQ-HR-012`, the Dependencies table's `Retention` row, "Data classification/retention," and Proposed Knowledge Deltas) shows the spec already reads "Retention module"/"Retention" throughout, never "Compliance," for sweep execution. The remaining "Compliance" mentions (lines 49, 100, 159, 213, 274, 339) concern the unrelated Konfession special-category-visibility-**policy** boundary, which is correctly Compliance/employee-management-owned — a different capability than the retention sweep. No HR edit was made; `git log` confirms the file has been unchanged since before the audit's own baseline revision, so this was not a regression introduced after the audit — most likely an imprecise citation in the audit's evidence column. `SIR-GLOB-018` is updated to record this explicitly.

### AUDIT-L4 — "Payslips module" misnamed as a standalone owner

**File:** `docs/03-modules/employee-management/MODULE_SPEC.md` (`0.1.0` → `0.1.1`)

`ADR-014` (Accepted, 2026-07-13) settled `backend-hr`/`SPEC-HR-001` as the payslip-request capability's canonical and exclusive owner; no standalone Payslips module exists or is proposed. The Out of Scope list's payslip-request bullet, and a Dependencies-table row labeled "Payslips," both named it as if it were a peer owning module. Corrected both to attribute the capability to `backend-hr`/`SPEC-HR-001` per `ADR-014`, explicitly noting `docs/03-modules/payslips/` remains a non-owning placeholder; renamed the Dependencies row to "HR (Payslips, `ADR-014`)" for consistency with the sibling "Contracts"/"Documents" referenced-elsewhere framing.

### AUDIT-L3 — Onboarding Document Control lags its own body

**File:** `docs/03-modules/onboarding/MODULE_SPEC.md` (`1.1` → `1.2`)

The document's body (§20 OPQ-3, Index of Cross-Module References) already cites and correctly applies `ADR-015` (Accepted, 2026-07-13; Consent standalone bounded context), but §22 Change Log stopped at v1.1/2026-07-12 with no `ADR-015` row. Added the missing Change Log row recording the `ADR-015` correction (consent-requirement sub-question resolved; chatbot-persistence sub-question remains open, `SIR-CHAT-008`, unaffected). Updated the footer Document version/Last updated/Authority to `1.2` / `2026-07-15` / `ADR-013, ADR-015`. No body text changed — only the changelog's own completeness gap.

---

## 2. Mapping: correction → originating audit finding

| Audit finding | Register ID | File(s) corrected | Version | Status after this pass |
|---|---|---|---|---|
| AUDIT-H2 | half-tracked via `OD-COMPLIANCE-004` | `docs/03-modules/auth/MODULE_SPEC.md` | 0.2.1 → 0.2.2 | Cleared |
| AUDIT-M4 | `SIR-GLOB-018` | `docs/03-modules/documents/MODULE_SPEC.md` | 0.1.2 → 0.1.3 | Cleared (Documents); HR verified no defect |
| AUDIT-L4 | untracked (NEW) | `docs/03-modules/employee-management/MODULE_SPEC.md` | 0.1.0 → 0.1.1 | Cleared |
| AUDIT-L3 | untracked (NEW) | `docs/03-modules/onboarding/MODULE_SPEC.md` | 1.1 → 1.2 | Cleared |

Governance register changes (both required by the Documentation Workflow's own exit condition, not new scope):
- `SIR-GLOB-018` updated in place: `OPEN` → `RESOLVED` (Documents corrected; HR re-verified with no defect).
- `## Module: Auth` and `## Module: Documents` "Section last verified" markers updated (prepended, history preserved).
- One `## Change Log` row appended recording this session.

No other `SIR-*` row was touched. Package C (register citation repair, new module sections) was deliberately not performed here.

---

## 3. Remaining documentation issues (not in this pass's scope)

From `AUDIT-REPO-2026-07-14`, still open after Packages A and B:

- **Package C** (register hygiene, not yet run): `AUDIT-M5` (`SIR-USERS-004` citation drift), `AUDIT-M6` (missing `## Module: Employee Management / Calendar / Onboarding` register sections).
- **Package D** (reserved human authority, cannot be cleared by any agent): owner assignment (`SIR-GLOB-001`/`SYNC-001`), `state-user` dual-writer decision (`SIR-GLOB-006` residual), accept-transaction coupling Decision Record (`SIR-GLOB-003`/`SIR-JOBD-003`), platform ADR-001..010 ratification (`SIR-GLOB-008`), and disposition of the live Critical/High security findings (`AUDIT-C1`/`AUDIT-C2`, Appendix table).
- **`OD-COMPLIANCE-004`** (in `SPEC-COMPLIANCE-001`, not a Package B target this session) still reads as open in its own document — its blocking condition ("`SPEC-AUTH-001` does not yet document exposing an `AuditLog`-read interface") is now factually satisfied by this pass's `IF-AUTH-GetAuditTrail` addition, but closing `OD-COMPLIANCE-004`'s own row requires editing `SPEC-COMPLIANCE-001`, which was not in this session's Targets list. Flagged for a future Compliance-module documentation pass.
- Registry/index pointer bumps (`MODULE_REGISTRY.yaml` `backend-auth`→`0.2.2`, `backend-documents`→`0.1.3`) proposed in each corrected spec's own Proposed Knowledge Deltas section, not applied here (repository-synchronization scope, Package A-class).

---

## 4. Readiness assessment for Package C (SIR Synchronization)

**Ready to proceed.** Package B's own governance-register touches (the `SIR-GLOB-018` resolution and the two "Section last verified" updates) were completed as an in-scope exit condition of this Documentation Workflow pass, not deferred. They do not overlap or conflict with Package C's remaining scope:

- `AUDIT-M5` (`SIR-USERS-004` citation repair) is independent of every file this pass touched.
- `AUDIT-M6` (new `## Module: Employee Management / Calendar / Onboarding` sections) can proceed immediately — the employee-management and onboarding specs this pass corrected are now internally consistent, giving Package C accurate source text to draw `OD-EMP-*`/`OPQ-*` items from when it authors those sections' `SIR-EMP-*`/`SIR-ONB-*` rows.

No blocking condition exists. Recommended order per the audit's own §4: Package C steps 9–10 next, then escalate Package D to the human approver.
