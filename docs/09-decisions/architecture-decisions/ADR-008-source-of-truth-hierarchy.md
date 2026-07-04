# ADR-008: Source of Truth Hierarchy

## Status

**Proposed** — 2026-07-04

Deciders: Authored by AI Engineering Platform; formal ratification is reserved human authority (see `.claude/CHANGELOG.md` v1.0.0 Known Limitations).

- Supersedes: none
- Superseded by: none

This record documents the truth-resolution policy already embodied in the repository; it is not yet human-ratified.

## Context

Multiple sources can describe "what the system does or should do": current code, the default branch, merged docs, frozen specs, open PRs, project memory, and prior conversations. Without a deterministic precedence rule, agents may resolve conflicts by convenience or by document majority, producing inconsistent or invented requirements.

Forces:

- Truth must be resolved, not presumed; existence of a file does not imply authority (`.claude/constitution/ENGINEERING_CONSTITUTION.md:51`).
- Current-state facts (what code does) must be separated from target-state decisions (what a frozen spec approves); their mismatch is drift, not license to choose silently (`.claude/constitution/SOURCE_OF_TRUTH.md:19`).
- Conflicts among equally authoritative sources must escalate rather than be silently decided (`.claude/constitution/SOURCE_OF_TRUTH.md:45`).

Current-state facts:

- The Constitution's §4 lists the seven-rank hierarchy: (1) current repository worktree, (2) current default branch, (3) latest merged authoritative documentation, (4) frozen specifications, (5) open pull requests, (6) project memory, (7) previous conversations (`.claude/constitution/ENGINEERING_CONSTITUTION.md:39-52`).
- `SOURCE_OF_TRUTH.md` provides the full authority table with qualifications, a source-classification scheme, a 10-step resolution algorithm, and a mandatory evidence ledger (`.claude/constitution/SOURCE_OF_TRUTH.md:7-63`).

## Decision

Truth is resolved via the ranked authority hierarchy and conflict algorithm defined in `SOURCE_OF_TRUTH.md`: repository worktree > default branch > merged authoritative docs > frozen specifications > open PRs > project memory > previous conversations, subject to safety and explicit current human decisions above the hierarchy. Every material source MUST be classified (authoritative / corroborating / proposed / historical / generated / external / unknown), current state MUST be separated from target state, and conflicts among same-rank authoritative sources set `BLOCKED_CONFLICT` and escalate. Findings are recorded in an evidence ledger bound to a revision. This ADR records the existing implemented state.

Scope: governs how every plan, review, validation, and implementation input establishes what is known before acting.

## Consequences

Positive:

- Deterministic, auditable conflict resolution; direct reproducible evidence outranks summaries at the same rank (`.claude/constitution/SOURCE_OF_TRUTH.md:42`).
- Only `Confirmed` claims may become implementation inputs; `Unknown`/`Conflicting` claims block affected acceptance criteria (`.claude/constitution/SOURCE_OF_TRUTH.md:63`).

Negative:

- Every material claim carries evidence-ledger overhead (path/line, revision, classification, timestamp) (`.claude/constitution/SOURCE_OF_TRUTH.md:50-61`).
- Resolution can block work (`BLOCKED_CONFLICT`) pending human escalation.

Neutral / operational:

- The hierarchy does not endorse current buggy code as desired behavior; code proves current state, a frozen spec proves target state (`.claude/constitution/SOURCE_OF_TRUTH.md:19`).
- Paths containing `legacy`/`archive`/`deprecated`/examples/fixtures/caches/generated default to non-authoritative until promoted (`.claude/constitution/SOURCE_OF_TRUTH.md:33`).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| Ranked hierarchy + evidence ledger (chosen) | Deterministic precedence, classification, and escalation | Matches implemented policy; prevents silent or majority-vote conflict resolution |
| Documentation-as-authority | Treat latest docs as the definitive truth over code | Docs can be stale or proposed; code proves current state and outranks docs at resolution (`.claude/constitution/SOURCE_OF_TRUTH.md:9-14,19`) |
| Conversation/most-recent-instruction wins | Resolve by the latest chat context | Previous conversations are the lowest rank and require repository or human confirmation (`.claude/constitution/SOURCE_OF_TRUTH.md:17`) |
| Status quo (no formal hierarchy) | Resolve conflicts ad hoc | Produces inconsistent, potentially invented requirements the policy exists to prevent |

## Related Documents

- [Source of Truth](../../../.claude/constitution/SOURCE_OF_TRUTH.md)
- [Engineering Constitution](../../../.claude/constitution/ENGINEERING_CONSTITUTION.md)
- [Bootloader / CLAUDE.md](../../../.claude/CLAUDE.md)
- [ADR-001: Documentation-First Development](ADR-001-documentation-first-development.md)
- [ADR-002: AI Engineering Platform Adoption](ADR-002-ai-engineering-platform-adoption.md)
- [ADR-007: Agent-Based Engineering Workflow](ADR-007-agent-based-engineering-workflow.md)

## Evidence

| Claim | Status | Source (path:line) |
|---|---|---|
| Constitution §4 lists the seven-rank source-of-truth hierarchy | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:39-52` |
| Existence does not imply authority | Confirmed | `.claude/constitution/ENGINEERING_CONSTITUTION.md:51` |
| Full authority table with qualifications | Confirmed | `.claude/constitution/SOURCE_OF_TRUTH.md:7-19` |
| Source classification scheme | Confirmed | `.claude/constitution/SOURCE_OF_TRUTH.md:21-33` |
| 10-step resolution algorithm | Confirmed | `.claude/constitution/SOURCE_OF_TRUTH.md:35-46` |
| Mandatory evidence ledger; only Confirmed claims become inputs | Confirmed | `.claude/constitution/SOURCE_OF_TRUTH.md:48-63` |
| Same-rank authoritative conflict sets BLOCKED_CONFLICT and escalates | Confirmed | `.claude/constitution/SOURCE_OF_TRUTH.md:45` |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Ownership: no accountable owner is assigned (no CODEOWNERS; `backend/package.json:23` author empty). Pending human authority.
- Ratification: this ADR is `Proposed`; ratification is reserved human authority.
