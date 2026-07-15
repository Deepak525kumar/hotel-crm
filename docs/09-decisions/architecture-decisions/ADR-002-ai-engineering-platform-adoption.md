# ADR-002: AI Engineering Platform Adoption

## Status

**Accepted** — 2026-07-04 (ratified 2026-07-15 by the commissioning human via the G2 Approval Workflow; see `.claude/CHANGELOG.md`)

Deciders: Authored by AI Engineering Platform; formal ratification was granted by the commissioning human on 2026-07-15 (G2 Approval Workflow; see `.claude/CHANGELOG.md`).

- Supersedes: none
- Superseded by: none

This record documents an adoption already embodied in the repository (`.claude/`); it was human-ratified on 2026-07-15 (G2 Approval Workflow).

## Context

AI-assisted development often relies on long conversational prompts, repeated manual reviews, and ad hoc coordination, which produce inconsistent and untraceable changes (`.claude/FRAMEWORK_RELEASE_NOTES.md:23-25`).

Forces:

- A repeatable, evidence-gated operating system is needed to coordinate planning, documentation, implementation, review, validation, synchronization, and release.
- Reusable engineering policy must be kept separate from repository-specific facts so the platform can be adopted by other repositories.
- Governance must be versioned and auditable.

Current-state facts:

- Version 1.0.0 of the AI Engineering Platform is released and marked **Stable**, dated 2026-07-04 (`.claude/FRAMEWORK_RELEASE_NOTES.md:1-8`; `.claude/CHANGELOG.md:16-21`).
- The platform is "intentionally designed to be reusable across software projects," separating project-specific knowledge from reusable engineering policy (`.claude/FRAMEWORK_RELEASE_NOTES.md:19`).
- The bootloader enforces Knowledge Separation: reusable policy lives in `.claude/`, repository-specific knowledge lives in `knowledge/` (`.claude/CLAUDE.md`, "Knowledge Separation").
- The platform ships a Constitution, Source of Truth policy, Review Gates, 18 agent contracts, workflows, templates, checklists, and a knowledge layer (`.claude/CHANGELOG.md:34-147`).

## Decision

The repository adopts the reusable, documentation-first, evidence-gated AI Engineering Platform (v1.0.0) housed in `.claude/` as its engineering operating system. Reusable engineering policy resides exclusively in `.claude/`; repository-specific knowledge resides exclusively in `knowledge/` (project knowledge is maintained under `.claude/knowledge/`). This ADR records the existing implemented state.

Scope: governs how engineering work is planned, documented, reviewed, validated, synchronized, and released. It does not prescribe product architecture (see ADR-003) or infrastructure (see ADR-006).

## Consequences

Positive:

- Deterministic artifacts and independent review separation replace ad hoc coordination (`.claude/CHANGELOG.md:153-158`).
- Knowledge separation lets the platform be reused by future repositories with minimal modification (`.claude/FRAMEWORK_RELEASE_NOTES.md:19`).

Negative:

- Process overhead: workflows, gates, and templates add ceremony to every engineering activity.
- Contributors must learn the platform's vocabulary and gate model.

Neutral / operational:

- Several capabilities are explicitly out of scope for v1.0.0: runtime enforcement, module ownership assignment, ADR ratification, and full dependency-graph population (`.claude/CHANGELOG.md`, Known Limitations).
- Governance changes are versioned via the platform Changelog (`.claude/CHANGELOG.md:12`).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| Adopt the AI Engineering Platform (chosen) | Structured, evidence-gated operating system in `.claude/` | Records the platform already present and released as Stable in the repository |
| Status quo / prompt-driven | Continue ad hoc conversational prompting and manual review | The platform exists precisely to replace this; it is untraceable and inconsistent (`.claude/FRAMEWORK_RELEASE_NOTES.md:23-25`) |
| Third-party process framework | Adopt an external SDLC/governance product | No evidence of one in the repository; would not provide the built-in agent + knowledge-separation model already implemented (UNKNOWN as an evaluated option) |

## Related Documents

- [Platform Release Notes](../../../.claude/FRAMEWORK_RELEASE_NOTES.md)
- [Platform Changelog](../../../.claude/CHANGELOG.md)
- [Engineering Constitution](../../../.claude/constitution/ENGINEERING_CONSTITUTION.md)
- [Bootloader / CLAUDE.md](../../../.claude/CLAUDE.md)
- [ADR-001: Documentation-First Development](ADR-001-documentation-first-development.md)
- [ADR-007: Agent-Based Engineering Workflow](ADR-007-agent-based-engineering-workflow.md)
- [ADR-008: Source of Truth Hierarchy](ADR-008-source-of-truth-hierarchy.md)

## Evidence

| Claim | Status | Source (path:line) |
|---|---|---|
| Platform v1.0.0 released, Stable, dated 2026-07-04 | Confirmed | `.claude/FRAMEWORK_RELEASE_NOTES.md:1-8`; `.claude/CHANGELOG.md:16-21` |
| Platform is intentionally reusable across projects | Confirmed | `.claude/FRAMEWORK_RELEASE_NOTES.md:19` |
| Knowledge separation: `.claude/` policy vs `knowledge/` facts | Confirmed | `.claude/CLAUDE.md` (Knowledge Separation) |
| Platform ships Constitution, agents, workflows, templates, checklists, knowledge layer | Confirmed | `.claude/CHANGELOG.md:34-147` |
| v1.0.0 known limitations (enforcement, ownership, ADR ratification, dep graph) | Confirmed | `.claude/CHANGELOG.md` (Known Limitations) |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Ownership: no accountable owner is assigned (no CODEOWNERS; `backend/package.json:23` author empty). Pending human authority.
- Ratification: this ADR was ratified (Proposed → Accepted) by the commissioning human on 2026-07-15 (G2 Approval Workflow).
- Runtime enforcement of platform policy is deferred to v1.1.0 (`.claude/CHANGELOG.md`, Next Planned Release).
