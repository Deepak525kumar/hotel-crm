# Workflow System

Workflows are reusable state machines. They coordinate agent contracts; they do not redefine agent responsibilities or constitutional policy.

## Common State Model

`NOT_STARTED → PREFLIGHT → ACTIVE → REVIEW → VALIDATION → COMPLETE`

Any state may enter `PAUSED_DRIFT`, `BLOCKED`, or `FAILED`. Only the Lead Architect records transitions. Every transition names the input version, evidence, gate result, owner, and next state.

## Execution Rules

- Run pre-flight before entering `ACTIVE` and post-flight before `COMPLETE`.
- Freeze shared inputs before parallel work.
- Parallel branches may not write the same artifact or depend on one another’s unreviewed output.
- A `FAIL` returns to the responsible author/implementer; `BLOCKED` requires missing evidence or authority; drift invokes self-healing.
- Restart from the last passed gate after refreshing all affected context packages.
- Artifacts use stable IDs and record repository revision or document version.

## Loop Metadata

Every workflow is a bounded loop. Each workflow file declares a `## Loop Metadata` block (objective, metric, boundary, retry policy, escalation policy, termination, success/failure conditions, confidence threshold, and loop type). Shared iteration, termination, and confidence semantics are defined once in [../constitution/LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md); the machine-readable cross-index is [../knowledge/LOOP_REGISTRY.yaml](../knowledge/LOOP_REGISTRY.yaml). No workflow may remain unclassified or unbounded.

## Workflow Selection

Use the smallest workflow covering the objective. Compose workflows by declared entry/exit conditions; never skip a gate because another workflow already produced a similarly named artifact.

## Deterministic Execution Sections

Every workflow file additionally declares six sections that make execution explicit, traceable, and token-efficient. These sections **reference** existing constitutional policy (see [../constitution/](../constitution/)); they never restate loop, gate, finding, source-of-truth, or agent-authority rules.

| Section | Purpose | Answers |
|---|---|---|
| `Execution Graph` | Arrow-form deterministic sequence of role → artifact → role, with explicit parallel branches and named joins. | Who starts? Who owns each step? Where does work fan out? Where does it join? |
| `Agent I/O Contracts` | Per participating agent: `Inputs`, `Outputs`, `Next Consumer`. | What does each agent consume and produce, and who receives it next? |
| `Artifact Handoffs` | Table binding each workflow artifact to its producer, consumer, and downstream artifact. | Every artifact has one producer and one downstream consumer. |
| `Synchronization Points` | Named joins (`SYNC-<workflow>-<n>`) declaring which parallel branches must complete before the join owner proceeds. | Where is the barrier? Who evaluates it? |
| `Context Packages` | Per agent: the minimal packet delivered by the Lead Architect. References canonical indexes; never restates them. | What does each agent receive — and only that? |
| `Status Report` | The canonical `STATUS` shape below, bound to this workflow’s owner, gate, and next action. | What is the single-format progress signal? |

The workflow’s existing `Execution Order` is preserved as the numbered narrative; `Execution Graph` is the deterministic complement, not a replacement.

## Canonical STATUS Shape

Every progress signal from a workflow uses this exact shape. Individual workflows fill it in but do not redefine it.

```
STATUS
- Workflow:      <workflow id from LOOP_REGISTRY.yaml>
- Current Gate:  <G0..G9 | workflow-scoped gate | none>
- Current Agent: <role owning the current step>
- Completed:     <artifact ids or execution-graph steps closed at PASS>
- Waiting On:    <artifact id, evidence, or sync point pending>
- Blockers:      <finding ids, escalations, or "none">
- Next Action:   <single sentence naming the next role and artifact>
```

No narrative status updates. Any longer explanation lives in the artifact evidence, not in the status line.

## Artifact ID Prefixes

Workflow artifacts use stable, workflow-scoped IDs so downstream consumers can cite them without re-describing them. Prefixes are shared across the platform; per-workflow numbering starts at `001`. Constitution §15 governs the shape; this table names the prefixes used by workflow files.

| Prefix | Artifact class | Producer workflow |
|---|---|---|
| `ART-PREFLIGHT` | Pre-flight Record and context manifest set | preflight |
| `ART-REPO` | Repository State Record and source manifest | repository-synchronization |
| `ART-REQ` | Requirements Register (workflow-level, not the internal `REQ-*` IDs) | requirements |
| `ART-RULE` | Rule Matrix / Business Rule Validation report | requirements |
| `ART-SPEC` | Module Specification (frozen candidate) | documentation |
| `ART-PLAN` | Implementation Plan | implementation |
| `ART-IMPL` | Implementation Report and mapped diff | implementation |
| `ART-TEST` | Test Plan, coverage matrix, execution report | testing |
| `ART-VAL` | Validation Report | validation |
| `ART-ARCH-REV` | Architecture Review report | architecture-review |
| `ART-DEP-REV` | Dependency Review report and graph delta | dependency-review |
| `ART-CONS-REV` | Consistency Review report | consistency-review |
| `ART-SEC-REV` | Security Review report and residual-risk statement | security-review |
| `ART-PERF-REV` | Performance Review report and measurements | performance-review |
| `ART-SYNC-FND` | Foundation Drift Report and synchronized dependents | foundation-synchronization |
| `ART-SYNC-DEP` | Dependency Drift Report and rollout/migration plan | dependency-synchronization |
| `ART-RELEASE` | Release Report and deployment/rollback plan | release |
| `ART-POST` | Post-flight Record and impact inventory | postflight |
| `ART-DRIFT` | Drift Report and repair plan | self-healing |
| `ART-IMP` | Improvement records in `IMPROVEMENT_LOG.yaml` (advisory) | learning |
| `ART-BOOT` | Boot Context (framework-version-scoped policy index) | preflight (boot) |
| `ART-EVID` | Evidence Package / Repository Context (revision-scoped) | preflight / repository-synchronization |
| `ART-DEPCTX` | Dependency Context (capability graph slice) | preflight / dependency-review |
| `ART-CTX` | Context Package (per-specialist reference manifest) | all (Lead Architect) |
| `ART-BOUNDARY` | Boundary Conflict Report | boundary-collision |
| `ART-FIND-PKG` | Finding Package (merged findings) | all reviews (Lead Architect merger) |
| `ART-CORR` | Correction Package (changed sections + findings-addressed map) | documentation / implementation |
| `ART-REV-PKG` | Review Package (reviewer report bound to candidate version) | all reviews |
| `ART-MEM` | Module Memory (frozen-spec distilled summary) | documentation (on freeze) |

The `ART-BOOT`, `ART-EVID`, `ART-DEPCTX`, `ART-CTX`, `ART-FIND-PKG`, `ART-CORR`, `ART-REV-PKG`, and `ART-MEM` artifacts are the reusable **Context Artifacts** defined canonically in [../constitution/CONTEXT_ARTIFACTS.md](../constitution/CONTEXT_ARTIFACTS.md); their lifecycle, cache key, and invalidation live there and are not restated in workflow files.

Finding, requirement, rule, decision, and risk IDs (`FIND-*`, `REQ-*`, `RULE-*`, `ADR-*`, `RISK-*`) continue to follow Constitution §15 and live inside artifacts; workflow-level `ART-*` IDs address the enclosing artifact instance.
