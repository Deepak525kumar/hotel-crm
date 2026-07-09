# Pre-flight Workflow

## Loop Metadata

- **Loop type:** Pipeline ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Establish a safe, current, correctly scoped execution baseline before any work.
- **Metric:** Gate G0 passes all five checks (repository sync, foundation drift, dependency drift, scope, context packaging).
- **Boundary:** One objective at one revision; discovered drift pauses to the applicable synchronization workflow rather than looping here.
- **Retry policy:** Re-run full pre-flight on any input change (§3); drift routes to self-healing.
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** G0 `PASS` with revision-bound, minimal context manifests.
- **Failure condition:** Any check `FAIL`/`BLOCKED` → do not begin task work.
- **Confidence threshold:** `High`.

## Purpose

Establish a safe, current, correctly scoped execution baseline before any engineering work.

## Context Artifact Reuse (framework 1.2.0)

Pre-flight is the platform's single production/reuse point for the revision-bound [Context Artifacts](../constitution/CONTEXT_ARTIFACTS.md). Before running discovery, the Lead Architect checks the active [Repository Session](../knowledge/SESSION_STATE.yaml):

- If a valid **Evidence Package** (`ART-EVID-001`), **Boot Context** (`ART-BOOT-001`), and applicable **Dependency Context** (`ART-DEPCTX-<capability>`) exist for the current `baseline_revision` and framework version, **reuse them by reference** and skip re-discovery (repository-synchronization runs at most once per `baseline_revision` per session).
- Otherwise, produce them: repository-synchronization emits the Evidence Package body, dependency slicing (step 4) emits the Dependency Context slice, and any prior **Module Memory** (`ART-MEM-<module>`) for in-scope modules is consumed as a first-pass source before discovery.
- Any `context_invalidator` (`SYNC_STATE.yaml`) clears the affected artifact and forces its re-production; a `baseline_revision` or default-branch change invalidates the whole session.

## Entry Conditions

A human objective exists; repository access is available; no task artifact has begun.

## Exit Conditions

Repository is synchronized or limitations are explicit; foundation and dependency drift are cleared; scope is validated; each specialist context package is revision-bound and minimal; G0 is `PASS`.

## Participating Agents

Lead Architect (owner); Requirements Analyst for scope ambiguity; Dependency Reviewer for nontrivial edge drift; human for authority decisions.

## Execution Graph

```
Lead Architect
  ↓ objective
Lead Architect → repository-synchronization (subroutine)
  ↓ ART-REPO-001..003
Lead Architect (objective ↔ repository truth, classify intended change)
  ↓ ART-PREFLIGHT-001 (scope draft)
  ├─ (parallel) Lead Architect — foundation drift check
  └─ (parallel) Lead Architect / Dependency Reviewer — dependency drift check
       ↓ SYNC-preflight-1
Lead Architect (drift routing decision)
  ↓ if drift: pause → foundation-synchronization or dependency-synchronization
  ↓ else:
Requirements Analyst (only if scope ambiguous) → ART-PREFLIGHT-002 (scope statement)
  ↓
Lead Architect (context packaging per participating specialist)
  ↓ ART-PREFLIGHT-003 (context manifests) + ART-PREFLIGHT-004 (workflow/gate plan)
G0 evaluation
```

## Execution Order

1. Run [Repository Synchronization](repository-synchronization.md).
2. Resolve objective against repository truth and classify intended change.
3. Compare architecture, terminology, business rules, shared templates, constitution, and ownership with synchronization state.
4. Compare interfaces, events, contracts, ownership edges, packages, and consumers with dependency graph.
5. If drift exists, pause and run the applicable synchronization workflow.
6. Validate inclusions, exclusions, affected modules, risk, and applicable gates.
7. Build a context manifest per participating specialist.
8. Record G0 result.

## Agent I/O Contracts

### Lead Architect

- **Inputs:** Human objective; `ART-REPO-001..003`; `../knowledge/PROJECT_PROFILE.md`, `MODULE_REGISTRY.yaml`, `DEPENDENCY_GRAPH.yaml`, `TERMINOLOGY.md`, `SYNC_STATE.yaml`; applicable constitution rules; capability registry.
- **Outputs:** `ART-PREFLIGHT-001` scope draft; `ART-PREFLIGHT-003` context manifests (assembled by reference to Context Artifacts); `ART-PREFLIGHT-004` workflow/gate plan; `ART-PREFLIGHT-005` Pre-flight Record with G0 status; and — produced or reused per the Context Artifact Reuse section — `ART-BOOT-001`, `ART-EVID-001`, and applicable `ART-DEPCTX-<capability>`.
- **Next Consumer:** Selected downstream workflow (requirements, documentation, implementation, testing, validation, review, synchronization, or release).

### Requirements Analyst (invoked only on scope ambiguity)

- **Inputs:** Objective; `ART-REPO-003`; ambiguity questions from Lead Architect.
- **Outputs:** `ART-PREFLIGHT-002` clarified scope statement.
- **Next Consumer:** Lead Architect (context packaging).

### Dependency Reviewer (invoked only on nontrivial edge drift)

- **Inputs:** Objective delta; `../knowledge/DEPENDENCY_GRAPH.yaml`; `ART-REPO-003`.
- **Outputs:** Drift classification note (fed into `ART-PREFLIGHT-001`) or referral to dependency-synchronization.
- **Next Consumer:** Lead Architect; dependency-synchronization if `BREAKING`.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-PREFLIGHT-001` | Lead Architect | objective, `ART-REPO-*`, foundation/dependency drift signals | scope draft + affected-module list + risk classification | Downstream workflow; Requirements Analyst if ambiguous |
| `ART-PREFLIGHT-002` | Requirements Analyst | `ART-PREFLIGHT-001` questions | clarified scope statement | Lead Architect |
| `ART-PREFLIGHT-003` | Lead Architect | scope, capability registry, agent contracts | minimal context manifest per specialist | Each participating specialist |
| `ART-PREFLIGHT-004` | Lead Architect | applicability rules, gates | workflow/gate plan (which gates apply, which specialists run) | Downstream workflow; G0 evaluation |
| `ART-PREFLIGHT-005` | Lead Architect | all above + evidence ledger | Pre-flight Record with G0 status | Downstream workflow entry |

## Synchronization Points

- **SYNC-preflight-1:** Lead Architect waits until foundation drift and dependency drift checks both complete before deciding whether to route to a synchronization workflow. Scope confirmation and context packaging (steps 6–7) MUST NOT start until this join closes.

## Context Packages

### Lead Architect receives

- Human objective (verbatim).
- `ART-REPO-001..003`; current `SYNC_STATE.yaml` entries.
- Applicable capability registry slice for anticipated specialists.

### Requirements Analyst receives (only if invoked)

- The specific ambiguity question(s); scope draft `ART-PREFLIGHT-001`; relevant `ART-REPO-003` source citations. Nothing else.

### Dependency Reviewer receives (only if invoked)

- The specific edge/package delta suspected; `DEPENDENCY_GRAPH.yaml` slice for those edges only; relevant manifests/lockfiles.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: preflight`
- `Current Gate: G0` (or the specific sub-check when reporting mid-flight).
- `Current Agent: Lead Architect` (or the invoked specialist).
- `Completed`: closed `ART-PREFLIGHT-*` and `ART-REPO-*` IDs.
- `Waiting On`: SYNC-preflight-1, drift-routing decision, or specialist response.
- `Blockers`: unresolved authority, drift, or classification unknowns.
- `Next Action`: next `ART-PREFLIGHT-*` handoff or downstream workflow entry.

## Parallel Activities

Foundation and dependency drift inspection MAY run in parallel after repository state is frozen. Scope confirmation and context packaging MUST wait for both.

## Validation Gates

G0 requires all five checks: repository synchronization, foundation drift, dependency drift, scope validation, and context packaging.

### Required Inputs → Produced Outputs

- **G0** inputs: `ART-REPO-001..003`, `ART-PREFLIGHT-001..004`, foundation/dependency drift signals.
- **G0** outputs: `ART-PREFLIGHT-005` Pre-flight Record with `PASS`/`PASS_WITH_ACTIONS`/`FAIL`/`BLOCKED`; downstream workflow authorized to enter `ACTIVE`.

## Escalation Conditions

Dirty worktree ownership is unknown; remote/default branch cannot be established and affects decisions; source conflict; missing owner; objective requires product/architecture judgment; destructive action.

## Artifacts Produced

Pre-flight Record, evidence ledger, scope statement, affected-module list, drift reports, context manifests, workflow/gate plan.

## Failure Handling

Do not begin task work. Preserve the worktree. Mark exact check `FAIL` or `BLOCKED`; route drift to self-healing and authority gaps to the human.

## Restart Conditions

Re-run the full pre-flight whenever repository revision, objective, frozen input, architecture, ownership, or dependency state changes.
