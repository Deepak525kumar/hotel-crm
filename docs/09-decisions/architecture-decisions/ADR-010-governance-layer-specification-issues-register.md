# ADR-010: Governance Layer for the Specification Issues Register (Platform v1.3)

- **Status:** Accepted — ratified (Proposed → Accepted) by the commissioning human on 2026-07-15 via the G2 Approval Workflow (Engineering Constitution §20), consistent with ADR-001..009.
- **Date:** 2026-07-09
- **Scope:** Engineering operating system (`.claude/`) — framework 1.3.0.
- **Supersedes:** none (additive to ADR-002 AI Engineering Platform Adoption; clarifies, does not contradict, the Knowledge Separation rule in `.claude/CLAUDE.md`).
- **Change class:** Non-constitutional framework addition (no `constitution/*` file is touched). Recorded as a Decision Record per Constitution §6 ("material architecture decisions require a Decision Record") and §7 ("new shared abstractions require architecture approval") because it introduces a new top-level `.claude/` directory and a new permanent artifact class — independent architecture review of the v1.3.0 change set (framework 1.3.0) identified the absence of this record as a blocking High finding.

## Problem

Framework 1.3.0 adds `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`, a permanent, continuously-updated cross-specification index of unresolved issues. Its own header states that its *mechanism* (schema, ID scheme, update protocol) is reusable framework policy while its *entries* are project-specific evidence — a single file mixing both categories, placed outside `.claude/knowledge/`.

`.claude/CLAUDE.md`'s existing Knowledge Separation rule states: "Repository-specific knowledge belongs exclusively in `knowledge/`... Do not mix reusable engineering policy with project-specific information." Read literally, the register's placement and self-description directly contradict this rule (independent architecture review, Finding FIND-001, High). Additionally, no Decision Record accompanied the new directory/artifact class at initial authoring (Finding FIND-002, High) — unlike the ADR-009 precedent for the smaller-scoped 1.2.0 Context Artifacts addition.

## Decision

1. **Establish `governance/` as a third top-level category**, alongside `constitution/`, `workflows/`, `agents/`, `templates/`, `checklists/`, `knowledge/`, `prompts/`, and `diagrams/`. Its defining property, distinct from `knowledge/`: `knowledge/` holds **revision-bound snapshots** of repository fact (Rule 4, "bind generated summaries to a repository revision and invalidate them when relevant files change"); `governance/` holds **continuously-live, append-only registers** that are synchronized as a mandatory step of existing workflows (Documentation, Post-flight) rather than re-derived per revision. The Specification Issues Register is the first artifact in this category.
2. **Amend `.claude/CLAUDE.md`'s Knowledge Separation section** to name this third category explicitly, so the "exclusively"/"do not mix" language no longer contradicts the register's existence. See the accompanying edit to `CLAUDE.md`.
3. **Register `SIR-<SCOPE>-<NNN>` as a permanent artifact-ID class** (`.claude/workflows/README.md`), distinct in lifecycle from per-workflow `ART-*` instance IDs: a `SIR-*` ID persists across many workflow runs until the issue it tracks resolves, rather than being scoped to one candidate version.
4. A future project adopting this framework starts with an empty `governance/SPECIFICATION_ISSUES_REGISTER.md` (schema + update protocol only, no entries) — the *mechanism* travels with the framework; the *entries* do not, consistent with Knowledge Separation's intent even though the file itself is not project-agnostic once populated.

## Alternatives Considered

- **Split into two files** (reusable schema/protocol in `.claude/templates/`; project entries in `.claude/knowledge/`) — rejected for this revision: splits one continuously-synchronized artifact across two directories with two different update cadences (per-project-session vs. per-framework-release), which the Documentation/Post-flight workflow hooks would then have to address in two places instead of one. Not precluded for a future framework revision if the register's schema stabilizes independently of project content.
- **Relocate entirely into `.claude/knowledge/`** — rejected: `knowledge/` Rule 4 binds every file there to a repository revision with explicit invalidation; the register is deliberately revision-independent (it survives and aggregates across many revisions, workflow sessions, and specification versions), so forcing it into that directory's invalidation model would misrepresent its lifecycle.
- **No Decision Record (README-note only)** — rejected per architecture review: a README paragraph is not a substitute for an approved Decision Record when a new top-level directory and permanent artifact class is introduced (Constitution §6/§7).

## Compatibility

Strictly additive. No existing `.claude/knowledge/*` file changes category or invalidation model. No gate, finding schema, confidence rule, loop bound, or specialist boundary is changed. `CLAUDE.md`'s amendment narrows an "exclusively"/"never" statement to name an explicit, bounded exception rather than removing the rule.

## Migration

None required for existing knowledge artifacts. `governance/` is populated by exactly one file today; future governance artifacts (if any) must be added by an equivalent Decision Record, not by ordinary documentation-workflow edits alone (this is the control this ADR restores per architecture review FIND-002).

## Reversibility

Deleting `.claude/governance/` and reverting the `CLAUDE.md`/`workflows/README.md` edits returns the platform to 1.2.0 semantics with no data loss beyond the register's own content (which itself only aggregates facts already present in `SYNC_STATE.yaml` and the module specifications — nothing is uniquely stored there).

## Validation

Independent architecture, dependency, consistency, security, and performance reviews were run on the v1.3.0 change set. Architecture returned FAIL on two High findings — the Knowledge Separation contradiction this ADR resolves, and this ADR's own prior absence. Both are resolved by this record and the accompanying `CLAUDE.md` amendment. Dependency, consistency, security, and performance returned PASS_WITH_ACTIONS; their actions are tracked in `.claude/knowledge/SYNC_STATE.yaml` SYNC-013 and applied in the same correction pass as this ADR.

## Consequences

- **Positive:** resolves the Knowledge Separation contradiction without relocating the register away from the location the task that commissioned it specified; gives future governance artifacts an explicit approval path instead of ad hoc directory creation.
- **Negative / cost:** introduces a third top-level category for future contributors to learn, beyond the existing `knowledge/`-vs-`.claude/` framework-vs-project distinction.

## Human Decision Required — SATISFIED

Ratify (Proposed → Accepted) this Decision Record per Constitution §20, consistent with ADR-001..009. **Ratified by the commissioning human on 2026-07-15 via the G2 Approval Workflow, together with ADR-001..009; this record now constitutes immutable framework law.**
