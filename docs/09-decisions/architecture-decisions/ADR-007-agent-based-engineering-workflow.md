# ADR-007: Agent-Based Engineering Workflow

## Status

**Accepted** — 2026-07-04 (ratified 2026-07-15 by the commissioning human via the G2 Approval Workflow; see `.claude/CHANGELOG.md`)

Deciders: Authored by AI Engineering Platform; formal ratification was granted by the commissioning human on 2026-07-15 (G2 Approval Workflow; see `.claude/CHANGELOG.md`).

- Supersedes: none
- Superseded by: none

This record documents the engineering execution model already embodied in the repository; it was human-ratified on 2026-07-15 (G2 Approval Workflow).

## Context

Engineering work under this platform spans planning, documentation, implementation, independent review, validation, synchronization, and release. Concentrating all of these in one undifferentiated actor blurs authorship/review separation and makes ownership of a decision ambiguous.

Forces:

- Authoring and reviewing must be separate responsibilities so an author cannot approve their own blocking finding (`.claude/constitution/ENGINEERING_CONSTITUTION.md:117,120`).
- Each actor should own exactly one output class and one decision domain to keep context minimal and responsibilities clear (`.claude/constitution/ENGINEERING_CONSTITUTION.md:32`).
- Orchestration cannot be delegated downward: subagents cannot spawn other subagents, so a single coordinator must hold global awareness (`.claude/CLAUDE.md`, Agent System).

Current-state facts:

- The Constitution's single-responsibility philosophy: "each agent owns one output class and one decision domain" (`.claude/constitution/ENGINEERING_CONSTITUTION.md:32`).
- The bootloader's Agent System: the main conversation adopts the Lead Architect contract and coordinates specialists; orchestration is not delegated because subagents cannot spawn subagents; the Lead Architect does not perform specialist reviews (`.claude/CLAUDE.md`, Agent System).
- 18 agent contracts exist in `.claude/agents/`: architecture-reviewer, architecture-validator, backend-engineer, business-rule-validator, consistency-reviewer, dependency-reviewer, documentation-validator, frontend-engineer, implementation-planner, infrastructure-engineer, lead-architect, mobile-engineer, module-author, performance-reviewer, qa-engineer, release-manager, requirements-analyst, security-reviewer.

## Decision

Engineering work is performed by single-responsibility specialist agents, each owning one output class and one decision domain, orchestrated by a Lead Architect that holds global awareness and assembles each specialist's minimal context. Authoring and reviewing remain separate responsibilities; the Lead Architect coordinates but does not perform specialist reviews. This ADR records the existing implemented state (18 agent contracts in `.claude/agents/`).

Scope: governs the platform's execution/coordination model. Adding a specialist is done by adding a contract; the operating model itself is not changed by adding specialists (`.claude/CLAUDE.md`, Agent System).

## Consequences

Positive:

- Clear separation of authoring vs. review supports the Constitution's merge policy that an author cannot approve their own blocking finding (`.claude/constitution/ENGINEERING_CONSTITUTION.md:120`).
- Minimal per-agent context reduces token cost and cross-contamination (`.claude/constitution/ENGINEERING_CONSTITUTION.md:156-157`).

Negative:

- A single Lead Architect coordinator is a central point through which work is routed; parallelism is bounded by that coordination.
- Because subagents cannot spawn subagents, all fan-out must be planned by the Lead Architect.

Neutral / operational:

- The agent set is extended by adding contracts, not by changing the operating model (`.claude/CLAUDE.md`, Agent System).
- Specialists receive only objective-relevant context per the token/context rules (`.claude/constitution/ENGINEERING_CONSTITUTION.md:156-159`).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| Single-responsibility specialists + Lead Architect (chosen) | One decision domain per agent; central orchestrator | Matches implemented model; enforces author/review separation and minimal context |
| Single generalist agent | One agent does authoring, review, and validation | Collapses author/review separation the Constitution requires (`.claude/constitution/ENGINEERING_CONSTITUTION.md:117,120`) |
| Peer agents with delegated orchestration | Agents spawn and coordinate each other | Not possible in this environment: subagents cannot spawn subagents (`.claude/CLAUDE.md`, Agent System) |
| Status quo (undocumented process) | Leave the workflow model unrecorded | The execution model is foundational and warrants a Decision Record |

## Related Documents

- [Engineering Constitution](../../../.claude/constitution/ENGINEERING_CONSTITUTION.md)
- [Bootloader / CLAUDE.md](../../../.claude/CLAUDE.md)
- [Agent contracts directory](../../../.claude/agents/)
- [ADR-001: Documentation-First Development](ADR-001-documentation-first-development.md)
- [ADR-002: AI Engineering Platform Adoption](ADR-002-ai-engineering-platform-adoption.md)
- [ADR-008: Source of Truth Hierarchy](ADR-008-source-of-truth-hierarchy.md)

## Evidence

| Claim | Status | Source (path:line) |
|---|---|---|
| Single-responsibility: each agent owns one output class and one decision domain | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:32` |
| Authoring and reviewing are separate; author cannot approve own blocking finding | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:117,120` |
| Lead Architect coordinates specialists; subagents cannot spawn subagents; Lead Architect does not perform specialist reviews | Confirmed | `.claude/CLAUDE.md` (Agent System) |
| 18 agent contracts exist in `.claude/agents/` | Confirmed | `.claude/agents/` (18 `*.md` contract files) |
| Ownership accountability model requires one accountable owner per module/contract | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:73` |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Ownership: no accountable owner is assigned; module ownership assignment is an explicit v1.0.0 known limitation (`.claude/CHANGELOG.md`). Pending human authority.
- Ratification: this ADR was ratified (Proposed → Accepted) by the commissioning human on 2026-07-15 (G2 Approval Workflow).
- Enforcement: the agent/review model is procedural, not runtime-enforced; runtime enforcement is deferred to v1.1.0 (`.claude/CHANGELOG.md`).
