# Repository Synchronization Workflow

## Purpose

Create a non-destructive, revision-bound view of current worktree, default branch, merged baseline, and proposed changes.

## Entry Conditions

Repository root is known and readable.

## Exit Conditions

Branch, `HEAD`, default branch, remote/fetch status, worktree changes, relevant merges/PRs, and source classifications are recorded.

## Participating Agents

Lead Architect (owner); human when remote access or change ownership requires authorization.

## Execution Order

1. Verify repository root and version-control system.
2. Record current branch, `HEAD`, status, remotes, and configured remote default branch.
3. Refresh remote metadata when permitted; never merge, rebase, reset, stash, or discard automatically.
4. Compare local baseline with default branch and identify divergence.
5. Classify uncommitted files as task-owned, user-owned, generated, or unknown.
6. Locate active documentation, frozen specs, open proposals, and historical paths.
7. Produce source/evidence manifest and synchronization status.

## Parallel Activities

Local repository inspection and active-document inventory MAY run in parallel. Remote comparison waits only when network metadata is required.

## Validation Gates

Pre-flight repository check passes when decisions are bound to a known revision and unrelated/unknown changes are protected.

## Escalation Conditions

Unknown dirty-change ownership, detached/ambiguous baseline, conflicting remotes, required network access unavailable, or any proposed destructive operation.

## Artifacts Produced

Repository State Record, source manifest, divergence report, protected-change list.

## Failure Handling

Continue only read-only investigation unaffected by the uncertainty. Block planning/merge/release decisions dependent on unknown state.

## Restart Conditions

Restart after branch, `HEAD`, worktree, remote metadata, or PR baseline changes.
