# Repository Integrity Validation Report: `ART-INTEGRITY-001`

Follows [`templates/REPOSITORY_INTEGRITY_VALIDATION_TEMPLATE.md`](templates/REPOSITORY_INTEGRITY_VALIDATION_TEMPLATE.md).

## Control

- **Repository revision:** `031b9387d814266dbaaf5755ee8c6a1e5c45eed0` (branch `claude/repo-integrity-validation-lxv3iw`, working tree at the time of this change set's final commit).
- **Command invoked:** `node .claude/tooling/repository-integrity-check.js --format md --out <path>`
- **Exit code:** `0`
- **Baseline file:** `.claude/tooling/repository-integrity-baseline.json` (4 entries, `generated_at: 2026-07-16`)
- **Consuming gate:** G4-consistency (this change's own Consistency Review component); reused unchanged at G6/G9 per [`constitution/REVIEW_GATES.md`](constitution/REVIEW_GATES.md) Applicability Rules.

## Before / After

The tool's **first** run against this repository (before any fix in this change set, `--no-baseline`) reported:

| | Total | Blocking |
|---|---|---|
| First run (raw, no baseline) | 813 | 779 |

That number was dominated by a backtick-path heuristic later removed as unworkably noisy for this repository's citation style (see the Framework Improvement Proposal §3). After removing that mechanism and fixing the real breakage it and the markdown-link/YAML-key checks found:

| | Total | Blocking |
|---|---|---|
| Second run (markdown-link + YAML-key mechanisms only, no baseline) | 82 | 30 |
| After fixing the 18-ADR-file loss + 2 redirect READMEs + `docs/audits/` path drift | 54 | 4 |
| **Current (with baseline)** | **55** | **0** |

## Findings Fixed in This Change Set

1. **`SIR-GLOB-021` (RESOLVED).** 18 ADR files (ADR-001..018) recovered from git history after being lost during the 2026-07-16 documentation-directory restructuring (commit `e0c5e8b`); 20+ cross-references corrected across `CLAUDE.md`, `DECISION_INDEX.md`, `CHANGELOG.md`, `FRAMEWORK_RELEASE_NOTES.md`, the governance register, `PROJECT_PROFILE.md`, `docs/14-governance/README.md`, and two module-directory redirect READMEs.
2. **`docs/audits/` → `docs/15-audits/` path drift (3 references)** corrected in the governance register and two audit-report self-citations.
3. **`backend/README.md`'s 3 distinct broken links** (`MASTER_ARCHITECTURE.md`, `API_STANDARDS.md`, `AWS_DEPLOYMENT_GUIDE.md`) — targets do not exist at the linked location and no current-doc replacement is evident; **not fixed**, deliberately baselined and tracked as `SIR-GLOB-020` (OPEN) pending a content decision outside this change's scope.

## Findings Deliberately Left Untouched (Out of Scope)

`docs/03-modules/{attendance,compliance,geo,consent,documents}/MODULE_SPEC.md` and `docs/05-execution/CHANGELOG.md` also cite the old `docs/09-decisions/` path. These are **not** link-checked as broken by the tool's own markdown-link mechanism in every case (some are backtick-only citations, out of scope per the Framework Improvement Proposal §3), and were not edited even where they are markdown links: module specifications are governed content under the Documentation Workflow's own versioning/correction-cycle discipline (Constitution §6), and `docs/05-execution/CHANGELOG.md` is an append-only historical narrative. Both are recorded as the residual share of `SIR-GLOB-021`, owned by each module's next Documentation Workflow pass, not silently fixed outside that process.

`docs/legacy/**` is excluded from link-checking entirely, per `../CLAUDE.md` Repository Rules ("treat `docs/legacy/` … as historical evidence only").

## Generated Report (current revision, with baseline applied)

<!-- BEGIN tool output: node .claude/tooling/repository-integrity-check.js --format md -->

# Repository Integrity Validation Report

Generated: 2026-07-16T11:10:07.195Z

| Total | New (blocking) | Baselined | Warn |
|---|---|---|---|
| 55 | 0 | 4 | 51 |

## Findings by check

| Check | Total | New |
|---|---|---|
| broken-relative-path | 4 | 0 |
| orphan-document | 51 | 0 |

## Warnings (non-blocking, 51)

All 51 are `orphan-document` findings — `.claude/agents/*.md`, `.claude/checklists/*.md`, two `.claude/templates/*.md`, `docs/00-foundations/*.md`, 9 `docs/03-modules/*/MODULE_SPEC.md`, and 8 `docs/14-governance/architecture-decisions/ADR-*.md`. Every one is a false positive relative to actual usage: this repository's convention references agents/checklists/templates/ADRs/module specs **by name in prose** (e.g. "per `ADR-016`", "the Consistency Reviewer") rather than as markdown links, which the tool's link-graph-based orphan detector cannot credit. This is exactly why `orphan-document` is WARN-severity, non-blocking, by design (see the tool's header comment and ADR-019 Decision §5) — spot-checked a sample of 5 and confirmed each is actively cross-referenced by name at least once.

<!-- END tool output -->

## Disposition

- New (non-baselined) blocking findings: **0**. `PASS`.
- Baselined findings (4): tracked as `SIR-GLOB-020`, OPEN, owner: human/documentation (content decision on replacement targets).
- Warn findings (51, `orphan-document`): reviewed, confirmed false-positive-by-design, no action required.

## Recommendation

**`PASS`** — zero new blocking findings; all pre-existing findings are either fixed in this change set or tracked to an owned, non-blocking register row.
