# Boundary Collision Workflow

## Loop Metadata

- **Loop type:** Critic ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1) — read-only; finds ownership conflicts; does not edit.
- **Objective:** Detect ownership/boundary collisions **before** authoring so conflict is never paid for with a full author→review cycle.
- **Metric:** Gate G1.5 evaluates every collision dimension (responsibilities, owned state, business rules, interfaces, contracts, APIs, state ownership) against the canonical indexes; result recorded.
- **Boundary:** One scoped change at one `baseline_revision`; single pass; no correction sub-loop (it gates; it does not fix).
- **Retry policy:** Re-run only on scope change or Evidence Package invalidation ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3).
- **Escalation policy:** A confirmed collision or an ownership `unknown` that bears on the change → human (Constitution §7, §18); authoring stays blocked.
- **Termination:** Success (no collision), Failure (collision → stop), or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** No ownership/boundary collision for the scoped change; G1.5 `PASS`/`NOT_APPLICABLE`.
- **Failure condition:** A collision exists → `ART-BOUNDARY-001` Boundary Conflict Report; **do not proceed to authoring**.
- **Confidence threshold:** `High` for a `PASS`; a `Low`-confidence collision is treated as unresolved and escalates.

## Purpose

Stop ownership and boundary conflicts before any authoring budget is spent. The `SYNC_STATE.yaml` history (SYNC-001, SYNC-005, SYNC-010, SYNC-011) shows that ownership and authorization conflicts have historically surfaced only at G4 independent review — after a full author→five-reviewer cycle. This pre-authoring gate detects the same class of conflict from the already-loaded Evidence Package and canonical indexes at **zero new discovery cost**.

## Entry Conditions

G0 passes (Evidence Package available); G1 passes for behavior-bearing work; the scoped change and its target module(s)/state/contracts are identified. Runs **after** requirements/scope and **before** authoring (documentation) or planning (implementation).

## Exit Conditions

Either no collision (G1.5 `PASS`/`NOT_APPLICABLE`, authoring authorized) or a Boundary Conflict Report is produced and the workflow **stops before authoring**.

## Participating Agents

Lead Architect (owner — holds global ownership awareness, Constitution §7); human for any ownership decision or unresolved conflict. No specialist authoring agent participates: authoring has not started.

## Execution Graph

```
Lead Architect (scoped change + ART-EVID-001 + canonical indexes)
  ↓ read OWNERSHIP_INDEX, BOUNDARY_INDEX, CONTRACT_INDEX, API_INDEX, STATE_OWNERSHIP_INDEX (by reference; no new discovery)
Lead Architect — collision detection across the seven dimensions
  ├─ no collision → G1.5 PASS → authoring authorized
  └─ collision    → ART-BOUNDARY-001 (Boundary Conflict Report, canonical finding shape)
                    ↓ G1.5 FAIL → STOP (no authoring) → escalate to human (Constitution §7/§18)
```

## Execution Order

1. Identify the scoped change's claimed responsibilities, owned state, business rules, interfaces, contracts, APIs, and state ownership.
2. Look up each against the canonical indexes (Phase-7) via the Evidence Package — no repository re-inspection.
3. Detect a collision when the scoped change would give a second owner to an already-owned responsibility/state/contract/API, contradict a business-rule authority, or write a state domain whose authoritative writer is another module or `unknown`.
4. If any collision or bearing `unknown` exists, emit `ART-BOUNDARY-001` and set G1.5 `FAIL`; stop before authoring.
5. Otherwise record G1.5 `PASS` and authorize the downstream authoring/planning workflow.

## Agent I/O Contracts

### Lead Architect

- **Inputs:** Scoped change (`ART-PREFLIGHT-001`/`ART-REQ-*`); `ART-EVID-001`; `OWNERSHIP_INDEX.yaml`, `BOUNDARY_INDEX.yaml`, `CONTRACT_INDEX.yaml`, `API_INDEX.yaml`, `STATE_OWNERSHIP_INDEX.yaml` (by reference).
- **Outputs:** G1.5 status; on collision, `ART-BOUNDARY-001` Boundary Conflict Report (canonical finding shape per [REVIEWER_FINDINGS.md](../constitution/REVIEWER_FINDINGS.md)).
- **Next Consumer:** Downstream authoring/planning workflow (on `PASS`); human (on `FAIL`/`BLOCKED`).

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-BOUNDARY-001` | Lead Architect | scoped change, `ART-EVID-001`, canonical indexes | Boundary Conflict Report + G1.5 status | Human (decision); downstream workflow (only on `PASS`) |

## Synchronization Points

None (single-agent, single-pass gate). G1.5 is itself a synchronization barrier: no authoring branch may start until it closes `PASS`.

## Context Packages

### Lead Architect receives

- The scoped change and its claimed ownership footprint.
- `ART-EVID-001` reference + the five canonical-index slices relevant to the footprint. Nothing else (no full graph, no source re-read).

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: boundary-collision`
- `Current Gate: G1.5`
- `Current Agent: Lead Architect`
- `Completed`: `ART-BOUNDARY-001` if produced.
- `Waiting On`: human ownership decision on a detected collision, or `none`.
- `Blockers`: confirmed collision IDs or bearing ownership `unknown`.
- `Next Action`: authorize authoring (on `PASS`) or escalate the conflict (on `FAIL`).

## Parallel Activities

None. This gate runs once, before any authoring fan-out.

## Validation Gates

G1.5 requires every applicable collision dimension evaluated against the canonical indexes. `NOT_APPLICABLE` requires evidence that the change claims no ownership footprint (e.g., a pure editorial doc edit).

### Required Inputs → Produced Outputs

- **G1.5** inputs: scoped change footprint; `ART-EVID-001`; canonical indexes.
- **G1.5** outputs: `PASS`/`FAIL`/`BLOCKED`/`NOT_APPLICABLE`; on `FAIL`, `ART-BOUNDARY-001`; downstream authoring authorized only on `PASS`/`NOT_APPLICABLE`.

## Escalation Conditions

Any confirmed collision; a state domain whose authoritative writer is `unknown` and the change would write it; a claimed responsibility/contract/API already owned by another module; conflicting business-rule authority.

## Artifacts Produced

Boundary Conflict Report (on collision); G1.5 gate record.

## Failure Handling

Do not begin authoring. Preserve the worktree. Record the exact colliding dimension(s) and route to human ownership authority (Constitution §7). This is a `FAIL`/`BLOCKED` termination, never a silent pass ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).

## Restart Conditions

Re-run when scope changes, when an ownership decision resolves the collision, or when the Evidence Package for the current `baseline_revision` is invalidated.
