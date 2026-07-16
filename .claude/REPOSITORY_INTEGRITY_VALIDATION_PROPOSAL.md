# Framework Improvement Proposal: Repository Integrity Validation

**Status:** Implemented in this change set (framework 1.4.0). Pending human ratification of the accompanying [ADR-019](../docs/14-governance/architecture-decisions/ADR-019-repository-integrity-validation-gate.md).
**Date:** 2026-07-16
**Author:** Lead Architect (session)

## Objective

Integrate deterministic Repository Integrity Validation into the existing framework as a mandatory gate for all applicable workflows, and enforce it automatically in CI — independent of AI execution — so human- and AI-authored pull requests get identical enforcement, without duplicating logic between the framework and CI.

## 1. Canonical Integration Point

**Decision: extend the existing Consistency Review workflow. No new top-level workflow or gate.**

Evidence for this choice:

- [`workflows/consistency-review.md`](workflows/consistency-review.md) already owns exactly this responsibility: its cross-reference-resolution branch already compares "candidate vs referenced artifacts," its Consistency Reviewer agent contract already lists "verify references resolve" and "detect duplicate authorities" as responsibilities, and its checklist ([`checklists/consistency.md`](checklists/consistency.md) `CS-08`) already states "all links, IDs, paths, and cross-references resolve to the intended active artifact." Every one of the eleven requested deterministic checks is a formalization of a responsibility this workflow already claims — the gap was that it was performed by hand, optionally, and only inside an AI session.
- [`constitution/REVIEW_GATES.md`](constitution/REVIEW_GATES.md)'s Consistency review applicability rule ("all documentation, specification, terminology, shared rule, or cross-module changes") is already the broadest-applicability review in the platform — broader than architecture, dependency, security, or performance review. Attaching the new check here means it inherits maximal applicability for free.
- G6 (Documentation Validator) and G9 (Post-flight's final Consistency Reviewer check) both already **consume** Consistency Review's output rather than re-deriving it. Making Repository Integrity Validation a sub-check of Consistency Review means G6 and G9 automatically inherit it by the same reuse-by-reference mechanism already in place ([`constitution/CONTEXT_ARTIFACTS.md`](constitution/CONTEXT_ARTIFACTS.md) §1.3) — no separate wiring needed at those two gates beyond citing the artifact.

This satisfies "documentation, implementation, synchronization, governance, and audit workflows automatically inherit the validation instead of duplicating it": none of those workflows were touched, because every one of them that needs consistency-review evidence already asks for it, and now gets Repository Integrity Validation for free as part of it.

## 2. Reused Infrastructure

Nothing new was introduced beyond what the checks required:

- **Artifact model:** one new `ART-INTEGRITY` prefix, added to the existing table in [`workflows/README.md`](workflows/README.md), following the same shape as every other `ART-*` prefix.
- **Finding schema:** none needed — the tool's findings are deterministic pass/fail facts (a path resolves or it does not), not judgment calls requiring [`constitution/REVIEWER_FINDINGS.md`](constitution/REVIEWER_FINDINGS.md)'s confidence/severity apparatus. The Consistency Reviewer translates a blocking tool finding into a canonical finding only when human judgment about disposition is required (e.g., routing `SIR-GLOB-020` to a Risk-Assessment-style follow-up).
- **Loop model:** no new loop type. Repository Integrity Validation runs inside Consistency Review's existing Critic loop ([`constitution/LOOP_CONTROL.md`](constitution/LOOP_CONTROL.md) §1); its retry/escalation/confidence policy is unchanged.
- **Governance register:** the existing [`governance/SPECIFICATION_ISSUES_REGISTER.md`](governance/SPECIFICATION_ISSUES_REGISTER.md) mechanism (append/resolve/merge by canonical source ID) is reused unchanged to track every finding the tool cannot auto-fix (`SIR-GLOB-020`, `SIR-GLOB-021`).
- **CI:** the existing `.github/workflows/ci.yml` gained one new job rather than a second workflow file, so pull requests get exactly one more required check, not a second CI system to maintain.

## 3. Deterministic Checks

Implemented in `.claude/tooling/repository-integrity-check.js` (see its header comment for the authoritative, current list):

| Requested check | Implementation |
|---|---|
| Broken markdown links | `[text](path)` targets resolved relative to the source file, existence-checked |
| Broken relative paths | the subset of the above using explicit `./`, `../`, or `/` syntax |
| Broken ADR references | link targets under `.../architecture-decisions/ADR-*` |
| Broken specification references | link targets under `docs/03-modules/` |
| Broken governance references | link targets under `.claude/governance/` |
| Broken knowledge references | link targets under `.claude/knowledge/` |
| Broken implementation/execution references | link targets under `docs/04-implementation/` or `docs/05-execution/` |
| Cross-index consistency | path-shaped values under known keys (`source`, `path`, `file`, `ref`, …) in `.claude/knowledge/*.yaml` |
| Invalid repository paths | subsumed by every check above — every category is exactly "this path does not exist" |
| Duplicate authorities | two ADR files claiming the same `ADR-<n>`; two YAML list entries in one index sharing the same `id`/`module` value |
| Missing canonical references | a `MODULE_REGISTRY.yaml` module citing a `SPEC-*` id absent from `SPECIFICATION_INDEX.yaml` |
| Orphan documents | active docs with zero inbound reference from any scanned link or YAML path (WARN-severity — see the tool's Design Note for why this one check is deliberately non-blocking in this repository) |

**One check was tried and deliberately dropped:** a generic backtick-quoted-path scanner (for citations like `` `path/to/file.md` `` outside markdown-link syntax). Its first run produced 700+ findings, nearly all false positives — this repository's governance prose both (a) uses short, non-resolvable shorthand fragments like `` `analytics/service.ts` `` inside sentences, and (b) wraps full markdown-link targets in backticks as link *text*, which the naïve scanner re-matched as a second, independent citation. Rather than ship a noisy check that would train reviewers to ignore findings, it was removed; the markdown-link and YAML-key mechanisms alone still caught every genuine break found during adoption (see the Validation Report).

## 4. CI Automation

`.github/workflows/ci.yml` gained a `repository-integrity` job: checkout, Node setup (no dependency install — the script is dependency-free), run the script, publish its Markdown report to the job summary and as a build artifact. The job fails (non-zero exit) exactly when a new, non-baselined blocking finding exists — the same pass/fail condition the AI framework's Consistency Reviewer evaluates, because both call the same script. There is exactly one implementation; this is what "avoid duplicated logic between the framework and GitHub Actions" required.

## 5. Baseline Adoption

This repository had substantial pre-existing documentation drift. Rather than block every future PR on debt unrelated to it, or silently skip enforcement, adoption follows the same baseline pattern used by ESLint/Knip when introducing a strict rule into a legacy codebase: `.claude/tooling/repository-integrity-baseline.json` fingerprints findings present at adoption time; only new or changed findings fail CI. Every baselined finding is tracked to a governance-register row (`SIR-GLOB-020`) so it remains visible and ownable rather than permanently hidden.

## 6. An Incidental Discovery

The tool's first run against this repository did not find hypothetical gaps — it found a live one. A same-day "documentation structure change" (commit `e0c5e8b`) had deleted all 18 ADR files while renaming their containing directory, breaking 20+ cross-references across `CLAUDE.md`, the decision index, the changelog, the release notes, and the governance register, with a `MIGRATION_NOTICE.md` left in place explicitly asking for confirmation to complete a copy step that was never carried out. No prior review — human or AI — had caught this at authoring time. It was fixed independently in this change set; a second, parallel session (PR #152) found and fixed the identical defect first and more completely (also correcting module-spec citations this change deferred, and replacing the migration notice with a proper incident report, `docs/15-audits/ADR_INTEGRITY_RESTORATION_2026-07-16.md`). The two restorations were reconciled cleanly at merge time — see the Validation Report and `SIR-GLOB-021`. This convergence is itself the concrete argument for the gate existing at all: it would have caught this at PR time, before merge, rather than as two independent incidental discoveries during unrelated framework tasks.

## Deliverables

- Framework improvement: this document, [ADR-019](../docs/14-governance/architecture-decisions/ADR-019-repository-integrity-validation-gate.md), and the edits to `constitution/REVIEW_GATES.md`, `workflows/consistency-review.md`, `workflows/validation.md`, `workflows/postflight.md`, `knowledge/LOOP_REGISTRY.yaml`, `workflows/README.md`, `checklists/consistency.md`, `agents/consistency-reviewer.md`, `templates/REPOSITORY_INTEGRITY_VALIDATION_TEMPLATE.md`.
- Repository Integrity Validation implementation: `.claude/tooling/repository-integrity-check.js`, `.claude/tooling/repository-integrity.config.json`, `.claude/tooling/repository-integrity-baseline.json`.
- GitHub Actions integration: `.github/workflows/ci.yml` job `repository-integrity`.
- Validation report: [`REPOSITORY_INTEGRITY_VALIDATION_REPORT.md`](REPOSITORY_INTEGRITY_VALIDATION_REPORT.md).
- Pull request: see the PR this change ships in.
