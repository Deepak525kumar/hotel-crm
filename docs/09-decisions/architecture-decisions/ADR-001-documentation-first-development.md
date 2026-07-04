# ADR-001: Documentation-First Development

## Status

**Proposed** — 2026-07-04

Deciders: Authored by AI Engineering Platform; formal ratification is reserved human authority (see `.claude/CHANGELOG.md` v1.0.0 Known Limitations).

- Supersedes: none
- Superseded by: none

This record documents a practice already embodied in the repository's governing policy; it is not yet human-ratified.

## Context

The repository operates an AI-assisted engineering system in which agents plan, author, review, and implement changes. Without an explicit ordering rule, implementation can begin before intended behavior is agreed, producing code that defines its own requirements after the fact.

Forces:

- Intent must be reviewable and frozen before it is coded, so that implementation maps to an approved target rather than an inferred one.
- Ambiguity discovered during coding must return to requirements rather than being resolved silently by an implementer.
- Multiple agents act on the same codebase and need one canonical, versioned statement of intended behavior.

Current-state facts:

- The Engineering Constitution names "Documentation first: define intended behavior before implementation" as a core philosophy (`.claude/constitution/ENGINEERING_CONSTITUTION.md:29`), alongside "Frozen specifications: implement only an identifiable approved specification version" (`.claude/constitution/ENGINEERING_CONSTITUTION.md:30`) and "Validation before progress" (`.claude/constitution/ENGINEERING_CONSTITUTION.md:31`).
- The Documentation and Specification Rules require that "Intended behavior is documented before code changes" and that a specification becomes frozen only with a version, approver, approval date, and no unresolved blocking issue (`.claude/constitution/ENGINEERING_CONSTITUTION.md:63,65`).
- The bootloader states: "No implementation may begin from an unfrozen specification. No phase may advance on a failed or unknown mandatory check." (`.claude/CLAUDE.md`, Boot Sequence).

## Decision

The project adopts documentation-first development: intended behavior MUST be documented and frozen before implementation begins, and implementation MUST map to an identified, approved specification version. This ADR records the existing implemented state of the governing policy — it does not introduce a new practice.

Scope: the rule governs engineering activity performed under this platform (specifications, implementation, review, validation). It does not by itself mandate any particular product feature.

## Consequences

Positive:

- Implementation traces to an approved, versioned specification, improving reviewability and reducing scope drift (`.claude/constitution/ENGINEERING_CONSTITUTION.md:66`, "Implementers may not expand scope").
- Ambiguity is routed back to requirements rather than resolved silently.

Negative:

- Additional upfront documentation and freeze overhead before code can start.
- Small changes still incur specification/gate ceremony unless a smaller workflow is selected.

Neutral / operational:

- Enforcement is procedural (agent + gate discipline), not yet a runtime control; runtime enforcement is an explicit v1.0.0 limitation (`.claude/CHANGELOG.md`, Known Limitations).
- Documentation must separate current, target, and historical state (`.claude/constitution/ENGINEERING_CONSTITUTION.md:68`).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| Documentation-first (chosen) | Freeze intended behavior before implementation | Records the practice already mandated by the Constitution and bootloader |
| Code-first / status quo | Implement, then document after the fact | Contradicts the Constitution's ordering; lets implementers define requirements retroactively and expands scope silently |
| Test-first only | Drive behavior from tests without frozen specifications | Tests encode behavior but do not supply owner, scope, interfaces, risks, and acceptance criteria required for a frozen spec (`.claude/constitution/ENGINEERING_CONSTITUTION.md:64`) |

## Related Documents

- [Engineering Constitution](../../../.claude/constitution/ENGINEERING_CONSTITUTION.md)
- [Source of Truth](../../../.claude/constitution/SOURCE_OF_TRUTH.md)
- [Bootloader / CLAUDE.md](../../../.claude/CLAUDE.md)
- [Platform Changelog](../../../.claude/CHANGELOG.md)
- [ADR-002: AI Engineering Platform Adoption](ADR-002-ai-engineering-platform-adoption.md)
- [ADR-007: Agent-Based Engineering Workflow](ADR-007-agent-based-engineering-workflow.md)
- [ADR-008: Source of Truth Hierarchy](ADR-008-source-of-truth-hierarchy.md)

## Evidence

| Claim | Status | Source (path:line) |
|---|---|---|
| "Documentation first: define intended behavior before implementation" is a stated philosophy | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:29` |
| Frozen-specification and validation-before-progress philosophies are stated | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:30-31` |
| "Intended behavior is documented before code changes" | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:63` |
| Freeze requires version, approver, approval date, no blocking issue | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:65` |
| Implementers may not expand scope; ambiguity returns to Requirements Analyst | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:66` |
| "No implementation may begin from an unfrozen specification." | Confirmed | `.claude/CLAUDE.md` (Boot Sequence) |
| Runtime enforcement is out of scope for v1.0.0 | Confirmed | `.claude/CHANGELOG.md` (Known Limitations) |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Ownership: no accountable owner is assigned (no CODEOWNERS; `backend/package.json:23` author is empty). Pending human authority.
- Ratification: this ADR is `Proposed`; formal ratification is reserved human authority (`.claude/CHANGELOG.md`, Known Limitations).
- Enforcement: whether documentation-first should become a runtime-enforced control (hooks/policy) rather than procedural is deferred to v1.1.0 (`.claude/CHANGELOG.md`, Next Planned Release).
