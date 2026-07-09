# AI Engineering Platform Bootloader

This repository uses a documentation-first, evidence-gated engineering operating system. The human sets objectives and approves judgment calls; agents inspect, plan, author, review, validate, synchronize, and prepare releases.

## Boot Sequence

Before any engineering activity:

0. Load or reuse the **Boot Context** (`ART-BOOT-001`) keyed to [VERSION.yaml](VERSION.yaml) `current_version`, and reuse any valid **Repository Session** Context Artifacts for the current `baseline_revision` (see [Context Artifacts](constitution/CONTEXT_ARTIFACTS.md)). If a valid Boot Context exists for the current framework version, reference it instead of re-reading the documents in steps 1–2 and 5; steps 1–6 are the **producers** of Boot Context on a cache miss. Re-read a source only when its Context Artifact is absent or its version/revision key no longer matches.
1. Read [Engineering Constitution](constitution/ENGINEERING_CONSTITUTION.md).
2. Resolve truth with [Source of Truth](constitution/SOURCE_OF_TRUTH.md).
3. Run the [Pre-flight Workflow](workflows/preflight.md) and record its evidence.
4. Select the smallest applicable workflow and one owner per responsibility; honor its loop metadata under [Loop Control](constitution/LOOP_CONTROL.md).
5. Stop at every required gate in [Review Gates](constitution/REVIEW_GATES.md); reviewers emit the canonical shape in [Reviewer Findings](constitution/REVIEWER_FINDINGS.md).
6. Finish with the [Post-flight Workflow](workflows/postflight.md), which invokes the [Learning Workflow](workflows/learning.md).

The canonical framework version is declared in [VERSION.yaml](VERSION.yaml).

No implementation may begin from an unfrozen specification. No phase may advance on a failed or unknown mandatory check.

## Repository Rules

- Before authoring or correcting any module specification, check the [Specification Issues Register](governance/SPECIFICATION_ISSUES_REGISTER.md) for that module's already-known unresolved issues; verify them against the repository rather than rediscovering them, and synchronize the register (append/resolve/merge, never duplicate, never delete history) as an exit condition of the Documentation and Post-flight workflows.
- Inspect the current worktree before relying on conversation history.
- Preserve unrelated changes; never silently rewrite user work.
- Treat `docs/legacy/` and equivalent archive paths as historical evidence only.
- Cite repository paths, revisions, commands, or approved decisions for material claims.
- Mark unknowns explicitly. Never convert an assumption into a requirement.
- Keep module ownership, contracts, and dependencies synchronized in `knowledge/`.
- Prefer the revision-bound **Evidence Package** over re-inspecting the worktree; inspect directly only to verify a specific claim or when its `baseline_revision` key is stale ([Context Artifacts](constitution/CONTEXT_ARTIFACTS.md)).

## Agent System

Agent contracts live in `agents/`. Each agent owns one responsibility, receives a minimal context package, and returns a structured artifact. The main conversation adopts the Lead Architect contract and coordinates specialists; do not delegate orchestration to a child agent because subagents cannot spawn other subagents. The Lead Architect does not perform specialist reviews. Add specialists by adding a contract; do not change the operating model.

## Workflow Index

- Intake: [Requirements](workflows/requirements.md), [Documentation](workflows/documentation.md)
- Delivery: [Implementation](workflows/implementation.md), [Testing](workflows/testing.md), [Validation](workflows/validation.md)
- Reviews: [Architecture](workflows/architecture-review.md), [Dependency](workflows/dependency-review.md), [Consistency](workflows/consistency-review.md), [Security](workflows/security-review.md), [Performance](workflows/performance-review.md)
- Synchronization: [Repository](workflows/repository-synchronization.md), [Foundation](workflows/foundation-synchronization.md), [Dependency](workflows/dependency-synchronization.md)
- Completion: [Release](workflows/release.md), [Post-flight](workflows/postflight.md), [Self-healing](workflows/self-healing.md), [Learning](workflows/learning.md)

## Project Adapter

Reusable policy belongs in `.claude/`; repository-specific facts belong in [knowledge/](knowledge/README.md). Start context assembly with `knowledge/PROJECT_PROFILE.md`, then include only objective-relevant sources.

If instructions conflict or evidence is incomplete, stop at the current gate and escalate with the conflicting sources, impact, options, and requested decision.

## Context Assembly

Before selecting a workflow, the Lead Architect must assemble the minimum context package required for the task.

The context package should contain only:

- objective
- applicable engineering rules
- relevant repository files
- relevant specifications
- relevant architecture decisions
- relevant dependencies
- required validation gates

Do not load unrelated project context.

The context package is assembled **by reference** to the canonical [Context Artifacts](constitution/CONTEXT_ARTIFACTS.md) — Boot Context, Evidence Package, and Dependency Context — never by inlining copies of sources whose digest is unchanged. Never re-read a source whose revision/version digest is unchanged; expand a reference to full text only to verify a specific claim.

The Lead Architect maintains global awareness.
Specialist agents receive only the minimum required context.

## Knowledge Separation

The AI Engineering Platform is reusable.

Repository-specific knowledge belongs exclusively in `knowledge/`.

Framework behaviour belongs exclusively in `.claude/`.

Do not mix reusable engineering policy with project-specific information, with one explicit, bounded exception: `governance/` (see [ADR-010](../docs/09-decisions/architecture-decisions/ADR-010-governance-layer-specification-issues-register.md)) holds continuously-live, append-only registers — synchronized as a mandatory step of existing workflows rather than re-derived per revision — whose *mechanism* (schema, ID scheme, update protocol) is reusable framework policy and whose *entries* are project-specific. This differs from `knowledge/`, which holds revision-bound snapshots invalidated by repository change (Rule 4, `knowledge/README.md`). Adding a new file to `governance/` requires a Decision Record, the same authority this exception itself required.
