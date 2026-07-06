# Repository Synchronization Workflow

## Loop Metadata

- **Loop type:** Discovery ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Produce a non-destructive, revision-bound view of current repository truth.
- **Metric:** Branch, `HEAD`, default branch, remote/fetch status, worktree changes, and source classifications are all recorded.
- **Boundary:** Read-only inspection at one revision; no correction sub-loop — facts are captured or marked `unknown`.
- **Retry policy:** Re-run whole workflow on state change (§3); no in-place retry of a recorded fact.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Blocked, or restart on state change ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** All required facts captured or explicitly `unknown`; unrelated changes protected.
- **Failure condition:** Baseline or dirty-change ownership unknowable in a way that blocks dependent decisions → `BLOCKED`.
- **Confidence threshold:** `High` for recorded facts; unknowns explicit.

## Purpose

Create a non-destructive, revision-bound view of current worktree, default branch, merged baseline, and proposed changes.

## Entry Conditions

Repository root is known and readable.

## Exit Conditions

Branch, `HEAD`, default branch, remote/fetch status, worktree changes, relevant merges/PRs, and source classifications are recorded.

## Participating Agents

Lead Architect (owner); human when remote access or change ownership requires authorization.

## Execution Graph

```
Lead Architect
  ├─ (parallel) local inspection ─┐
  └─ (parallel) active-document inventory ─┤
                                           ↓ SYNC-repo-1
                                Lead Architect (remote comparison, network-permitting)
                                           ↓ ART-REPO-001 (Repository State Record)
                                Lead Architect (classify uncommitted files)
                                           ↓ ART-REPO-002 (protected-change list)
                                Lead Architect (locate active docs, specs, PRs, historical)
                                           ↓ ART-REPO-003 (source manifest + divergence report)
                                pre-flight scope validation (consumer)
```

## Execution Order

1. Verify repository root and version-control system.
2. Record current branch, `HEAD`, status, remotes, and configured remote default branch.
3. Refresh remote metadata when permitted; never merge, rebase, reset, stash, or discard automatically.
4. Compare local baseline with default branch and identify divergence.
5. Classify uncommitted files as task-owned, user-owned, generated, or unknown.
6. Locate active documentation, frozen specs, open proposals, and historical paths.
7. Produce source/evidence manifest and synchronization status.

## Agent I/O Contracts

### Lead Architect

- **Inputs:** Repository root; local git state; remote metadata (when permitted); active-doc paths; open-PR list; `../knowledge/PROJECT_PROFILE.md`.
- **Outputs:** `ART-REPO-001` Repository State Record; `ART-REPO-002` protected-change list; `ART-REPO-003` source manifest and divergence report.
- **Next Consumer:** Pre-flight workflow (scope validation and context packaging steps).

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-REPO-001` | Lead Architect | git worktree, remotes, HEAD | Repository State Record (branch, HEAD, default, fetch status) | Pre-flight (`ART-PREFLIGHT-*`) |
| `ART-REPO-002` | Lead Architect | worktree diff, ownership signals | Protected-change list (task-owned / user-owned / generated / unknown) | Pre-flight; self-healing on `unknown` |
| `ART-REPO-003` | Lead Architect | active docs, frozen specs, open PRs, historical paths | Source manifest + divergence report | Pre-flight; Consistency Reviewer for stale references |

## Synchronization Points

- **SYNC-repo-1:** Lead Architect waits until (a) local repository inspection and (b) active-document inventory both complete before starting remote comparison. Only Lead Architect evaluates the join.

## Context Packages

### Lead Architect receives

- Repository root path.
- Any prior `../knowledge/SYNC_STATE.yaml` entry for this repository.
- Network availability signal (permit / deny) for remote refresh.
- Explicit exclusion of unrelated worktree hunks (preserved verbatim).

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: repository-synchronization`
- `Current Gate: G0-repository-check`
- `Current Agent: Lead Architect`
- `Completed`: closed `ART-REPO-*` IDs.
- `Waiting On`: remote fetch, `unknown` change classification, or SYNC-repo-1.
- `Blockers`: unknown dirty-change ownership; ambiguous baseline; unavailable required network.
- `Next Action`: next `ART-REPO-*` handoff or pre-flight resumption.

## Parallel Activities

Local repository inspection and active-document inventory MAY run in parallel. Remote comparison waits only when network metadata is required.

## Validation Gates

Pre-flight repository check passes when decisions are bound to a known revision and unrelated/unknown changes are protected.

### Required Inputs → Produced Outputs

- **G0-repository-check** inputs: `ART-REPO-001`, `ART-REPO-002`, `ART-REPO-003`.
- **G0-repository-check** outputs: gate status recorded on the pre-flight record; drift entries opened in `../knowledge/SYNC_STATE.yaml` when a divergence is detected.

## Escalation Conditions

Unknown dirty-change ownership, detached/ambiguous baseline, conflicting remotes, required network access unavailable, or any proposed destructive operation.

## Artifacts Produced

Repository State Record, source manifest, divergence report, protected-change list.

## Failure Handling

Continue only read-only investigation unaffected by the uncertainty. Block planning/merge/release decisions dependent on unknown state.

## Restart Conditions

Restart after branch, `HEAD`, worktree, remote metadata, or PR baseline changes.
