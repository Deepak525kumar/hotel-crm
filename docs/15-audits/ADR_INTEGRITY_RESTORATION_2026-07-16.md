# ADR Corpus Integrity Restoration Report

- **Report ID:** INTEGRITY-ADR-2026-07-16
- **Date:** 2026-07-16
- **Workflow:** Repository Integrity Restoration
- **Scope:** ADR corpus restoration after the `documentation structure change` restructure (commit `e0c5e8b`)
- **Objective:** Restore repository integrity only — no architecture, ADR content, specification, or implementation-planning changes.

## 1. Problem

Commit `e0c5e8b` ("documentation structure change") restructured `docs/` and, in the process, **deleted the entire ADR corpus** (`ADR-001` … `ADR-018`, plus `.gitkeep`) from `docs/09-decisions/architecture-decisions/` instead of moving it. In its place it left:

- `docs/14-governance/architecture-decisions/MIGRATION_NOTICE.md` — a manual "please migrate these yourself" notice.
- `scripts/rename_docs_dirs.sh` — a dry-run directory-rename helper whose `docs/09-decisions → docs/14-governance/architecture-decisions` move was never applied to the ADR files.

Result: 18 accepted Decision Records were absent from the worktree while ~60 references across knowledge indexes, module specs, the governance register, and the framework bootloader still pointed at the deleted `docs/09-decisions/architecture-decisions/` path. `DECISION_INDEX.md` linked entirely to non-existent files.

## 2. Canonical Location

`docs/14-governance/architecture-decisions/` — established by the restructure as the governance home for ADRs (`docs/14-governance/README.md`) and confirmed as the designated decision area. It sits at the same directory depth (3 levels below repo root) as the old location, so ADR-internal `../../../` links remain valid unchanged.

## 3. Actions Taken

### 3.1 Restored ADR corpus (git history authoritative)
All 18 ADRs were restored from the pre-deletion revision `e0c5e8b^` into the canonical location, preserving filenames, numbering, and content:

| Verification | Result |
|---|---|
| Files restored | 18 (`ADR-001` … `ADR-018`) |
| Byte-for-byte identical to `e0c5e8b^` (git blob hash) | 18 / 18 identical, 0 mismatched |
| Filenames / numbering preserved | Yes |
| Content preserved | Yes (hash-verified) |
| ADR-internal `../../../` links (to `.claude/`, `README.md`, `backend/`, etc.) | Resolve — same directory depth, verified against worktree |

### 3.2 Updated every repository reference
All references of the form `docs/09-decisions/architecture-decisions/…` were re-pointed to `docs/14-governance/architecture-decisions/…` across:

- `.claude/knowledge/DECISION_INDEX.md` (18 ADR source links)
- `.claude/knowledge/PROJECT_PROFILE.md`, `.claude/knowledge/SYNC_STATE.yaml`
- `.claude/CLAUDE.md` (bootloader ADR-010 reference), `.claude/CHANGELOG.md`, `.claude/FRAMEWORK_RELEASE_NOTES.md`
- `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`, `.claude/EXECUTION_POLICY_PROPOSAL.md`
- Module docs: `attendance`, `compliance`, `geo`, `consent`, `documents` (`MODULE_SPEC.md`), `contracts`, `hotels` (`README.md`)
- `docs/14-governance/README.md` (removed stale "migrate them here" guidance)

Historical narration that correctly describes the *past* move (`docs/05-execution/CHANGELOG.md`, "prior `docs/09-decisions/` → `docs/14-governance/` restructuring") was intentionally left unchanged. **Note (2026-07-27):** `docs/05-execution/CHANGELOG.md` was subsequently deleted as part of the `docs/05-execution/` consolidation into `EXECUTION_DASHBOARD.md`/`RELEASE_STATUS.md`; this audit report is frozen historical evidence of the state at the time it was written and its citation is not updated — the deleted file's content remains recoverable via `git log`/`git show`.

### 3.3 Repaired DECISION_INDEX and broken ADR references
`DECISION_INDEX.md` now links to the 18 restored files at the canonical path; all Pending-Decision-Record evidence links that cited the old path were repaired.

### 3.4 Removed obsolete migration artifacts (superseded by the completed restoration)
- `docs/14-governance/architecture-decisions/MIGRATION_NOTICE.md` — the migration it described is now complete.
- `scripts/rename_docs_dirs.sh` — every source directory it referenced has already been moved; the script is fully inert. No repository file references it.

## 4. Validation

| Check | Result |
|---|---|
| ADR files present at canonical path | 18 / 18 |
| Restored content identical to git history | 18 / 18 (blob-hash verified) |
| Remaining `09-decisions/architecture-decisions` references in repo | 0 |
| ADR path references resolving to an existing file | 45 / 45 real links resolve |
| Dangling references to removed artifacts (`MIGRATION_NOTICE`, `rename_docs_dirs.sh`) | 0 |
| Repo-wide relative markdown link scan — ADR / governance links | 0 broken |

### Known, out-of-scope (pre-existing) items — not introduced by this restoration
- `docs/03-modules/compliance/MODULE_SPEC.md`: `ADR-016-...md` is prose shorthand (an elided filename in a table cell), not a live link.
- `.claude/EXECUTION_POLICY_PROPOSAL.md`: references a **planned, not-yet-authored** `ADR-017-execution-policy-model-effort-deployment.md`. Its directory prefix was corrected to the canonical location; authoring the file itself is implementation-planning work, deliberately outside this integrity-only scope. (Note: a separate numbering question — the proposal's `ADR-017` label vs. the restored `ADR-017-state-user-ownership-auth-writer.md` — is a pre-existing planning matter, not a restoration action.)
- 28 broken relative links inside `docs/legacy/**` and `backend/README.md` point at unrelated documents (`MASTER_ARCHITECTURE.md`, `API_STANDARDS.md`, …); they pre-date and are unaffected by this work. `docs/legacy/` is historical evidence only per the Engineering Constitution.

## 5. Objective Conformance

- Architecture: unchanged.
- ADR content: unchanged (byte-identical restoration).
- Specifications: unchanged (only stale ADR path prefixes corrected).
- Implementation planning: unchanged.
- Implementation work: none performed.

Repository integrity restored: the ADR corpus is present at its canonical location, every live reference resolves, and obsolete migration scaffolding is removed.
