# AI Engineering Platform Bootloader

This repository uses a documentation-first, evidence-gated engineering operating system. The human sets objectives and approves judgment calls; agents inspect, plan, author, review, validate, synchronize, and prepare releases.

## Boot Sequence

Before any engineering activity:

1. Read [Engineering Constitution](constitution/ENGINEERING_CONSTITUTION.md).
2. Resolve truth with [Source of Truth](constitution/SOURCE_OF_TRUTH.md).
3. Run the [Pre-flight Workflow](workflows/preflight.md) and record its evidence.
4. Select the smallest applicable workflow and one owner per responsibility; honor its loop metadata under [Loop Control](constitution/LOOP_CONTROL.md).
5. Stop at every required gate in [Review Gates](constitution/REVIEW_GATES.md); reviewers emit the canonical shape in [Reviewer Findings](constitution/REVIEWER_FINDINGS.md).
6. Finish with the [Post-flight Workflow](workflows/postflight.md), which invokes the [Learning Workflow](workflows/learning.md).

The canonical framework version is declared in [VERSION.yaml](VERSION.yaml).

No implementation may begin from an unfrozen specification. No phase may advance on a failed or unknown mandatory check.

## Repository Rules

- Inspect the current worktree before relying on conversation history.
- Preserve unrelated changes; never silently rewrite user work.
- Treat `docs/legacy/` and equivalent archive paths as historical evidence only.
- Cite repository paths, revisions, commands, or approved decisions for material claims.
- Mark unknowns explicitly. Never convert an assumption into a requirement.
- Keep module ownership, contracts, and dependencies synchronized in `knowledge/`.

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

The Lead Architect maintains global awareness.
Specialist agents receive only the minimum required context.

## Knowledge Separation

The AI Engineering Platform is reusable.

Repository-specific knowledge belongs exclusively in `knowledge/`.

Framework behaviour belongs exclusively in `.claude/`.

Do not mix reusable engineering policy with project-specific information.
