# ADR-019: Deterministic Repository Integrity Validation as a Reusable Consistency-Review Gate

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `GD-23` (Platform ADR ratification, Constitution §20) via the Governance Resolution workflow, Option (a): ratified as-is, since this ADR's mechanism (the repository-integrity CI gate and `.claude/tooling/` directory) was already the operating reality prior to ratification, backward-compatible, with no disclosed defect. Previously: Proposed — pending human ratification, consistent with the ADR-001..009 precedent before their 2026-07-15 ratification.
- **Date:** 2026-07-16
- **Scope:** Engineering operating system (`.claude/`) — framework 1.4.0. Also introduces one new top-level, dependency-free tool directory (`.claude/tooling/`) and one new CI job (`.github/workflows/ci.yml`, job `repository-integrity`).
- **Supersedes:** none (additive; extends the existing Consistency Review workflow rather than introducing a new gate or workflow).
- **Change class:** Non-constitutional framework addition (no `constitution/*` file's normative rules are rewritten — `REVIEW_GATES.md`'s Applicability Rules section gains one new entry, in the same additive shape as the Consistency/Security/Performance review rows already there). Recorded as a Decision Record per Constitution §6/§7 because it introduces a new framework-tooling artifact class (`ART-INTEGRITY`) and a new top-level `.claude/` directory, mirroring the ADR-010 precedent for `governance/`.

## Problem

The platform had no deterministic, tool-enforced check that cross-repository references (markdown links, ADR/specification/governance/knowledge/implementation-execution citations, cross-index paths, identity-key duplicates, and orphaned documents) actually resolve. Every prior check of this kind was performed by a human-directed Consistency Reviewer reading files by hand — reliable when run, but not mandatory, not runnable outside an AI session, and not enforced against pull requests authored without one.

This gap was not theoretical: the very first run of the tool this ADR introduces found that the 2026-07-16 "documentation structure change" (commit `e0c5e8b`) had deleted all 18 ADR files from the working tree while renaming `docs/09-decisions/` to `docs/14-governance/` (see `SIR-GLOB-021`, `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`), leaving every one of `DECISION_INDEX.md`'s 18 ADR rows, `CLAUDE.md`, `CHANGELOG.md`, `FRAMEWORK_RELEASE_NOTES.md`, and 13 rows of the governance register pointing at files that no longer existed. No review step — human or AI — had caught this before it merged.

## Decision

1. **No new workflow or gate is introduced.** Repository Integrity Validation is a mandatory, deterministic **sub-check owned by the existing Consistency Reviewer**, wherever [Consistency review applies](../../../.claude/constitution/REVIEW_GATES.md) (G4). Its result is reused by reference — never re-derived — at G6 (Documentation Validator's repository-consistency criterion) and G9 (Post-flight's final Consistency Reviewer check), per [REVIEW_GATES.md](../../../.claude/constitution/REVIEW_GATES.md) Applicability Rules and [CONTEXT_ARTIFACTS.md](../../../.claude/constitution/CONTEXT_ARTIFACTS.md) §1.3 "reference over copy."
2. **One deterministic implementation, two callers.** `.claude/tooling/repository-integrity-check.js` is a dependency-free Node script — no framework-specific runtime, so it is exactly as runnable by a human contributor or CI as by an AI session. It is invoked unchanged by:
   - the AI framework (Consistency Review, Documentation Validator, Post-flight), and
   - CI (`.github/workflows/ci.yml`, job `repository-integrity`), which runs on every pull request regardless of authorship.
   Neither caller restates the check logic (Constitution §17 "automation over coordination overhead"; §19 "update canonical source first, then dependents").
3. **A new artifact identity, `ART-INTEGRITY`,** is registered in `.claude/workflows/README.md`'s Artifact ID Prefixes table, following the existing `ART-*` convention, produced by the tool rather than authored per candidate.
4. **A checked-in baseline** (`.claude/tooling/repository-integrity-baseline.json`) fingerprints findings that pre-date this gate's adoption, so CI enforces zero *new* regressions immediately without being blocked by unrelated historical debt across a large legacy documentation tree — the same adoption pattern used by ESLint/Knip baseline migrations. The baseline is reviewable in every PR diff; a finding can only leave it by being fixed or by a visible, justified baseline edit (see the script's Design Note and `SIR-GLOB-020`).
5. **`orphan-document` is WARN-severity, never blocking**, because this repository's own citation convention references agents/checklists/templates/ADRs by name in prose rather than as markdown links (verified: the tool's first run flagged 50 such files, all legitimate, none actually unreferenced) — treating it as blocking would make the gate unusable without a link-graph rewrite this ADR does not undertake.
6. **A new top-level `.claude/tooling/` directory** is established for reusable, executable framework tooling — distinct from `templates/` (fixed *authored-document* shapes) and `knowledge/` (revision-bound *data*). This mirrors ADR-010's precedent of adding a bounded, explicitly-decided category rather than overloading an existing one.

## Alternatives Considered

- **A new top-level workflow (`workflows/repository-integrity.md`)** — rejected per the task's own instruction and Constitution §3.5 "single responsibility": the check is a detection mechanism for the Consistency Reviewer's existing responsibility, not a new lifecycle stage with its own entry/exit conditions.
- **Re-implement the checks separately in a GitHub Action (e.g., a marketplace link-checker) alongside the framework's own manual review** — rejected: guarantees drift between what CI enforces and what the AI framework claims to have checked, and duplicates logic the task explicitly asked to avoid duplicating.
- **Block on all findings including orphan documents** — rejected (see Decision §5): produces unactionable noise given this repository's prose-citation convention, which would train contributors to ignore the gate.
- **A YAML-parser dependency (`js-yaml`) for the cross-index check** — rejected for this revision: the knowledge-layer YAML files use a consistent, shallow `key: value` / `- id: x` shape; targeted line-regexes cover every check this ADR requires without adding a runtime dependency to a CI job that should stay minimal and fast.

## Compatibility

Strictly additive. No existing gate, finding schema, confidence rule, loop bound, or specialist boundary is changed. `REVIEW_GATES.md`'s Applicability Rules gain one entry in the same shape as the existing five. `LOOP_REGISTRY.yaml`'s `consistency-review`/`validation`/`postflight` entries gain one `produced_artifacts` item each, matching the SYNC-013 precedent for wiring the Specification Issues Register into the same two workflows.

## Migration

None required for existing knowledge or documentation artifacts. Adopting this gate required fixing the pre-existing breakage it immediately surfaced (`SIR-GLOB-021`, resolved; `SIR-GLOB-020`, baselined and tracked) — see the accompanying repository changes in this same PR.

## Reversibility

Deleting `.claude/tooling/`, the CI job, and the `REVIEW_GATES.md`/`LOOP_REGISTRY.yaml`/workflow-file references added by this change returns the platform to 1.3.0 semantics. No data is uniquely stored in the tool or baseline; every finding it reports is independently reproducible by re-running it against the same revision.

## Validation

Self-reviewed by the Lead Architect against Constitution §6/§7/§17/§19 and `REVIEW_GATES.md`'s Independent Review Protocol given this change's scope (process tooling, not product behavior touching authentication, tenant boundaries, or money — the Security Principles §11 "high-risk" list). An independent Consistency Reviewer and Security Reviewer pass was additionally run against the new script and CI workflow specifically (path handling, command construction, CI trust boundary) before this PR was opened; see the PR description for their findings and dispositions.

## Consequences

- **Positive:** closes a real, demonstrated gap (18 lost ADR files, invisible to every prior review); gives human-authored PRs the identical enforcement AI-authored ones get; adds no coordination overhead since the AI framework and CI share one implementation.
- **Negative / cost:** a new script to maintain; a baseline file that requires discipline not to silently grow (mitigated by requiring a visible diff + justification for any baseline addition, per the template's Disposition section).

## Human Decision Required

Ratify (Proposed → Accepted) this Decision Record per Constitution §20, consistent with the ADR-001..009/ADR-010 precedent.
