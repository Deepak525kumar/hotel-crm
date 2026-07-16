# Framework Improvement Proposal — Execution Policy (Model, Reasoning Effort, Agent Deployment)

**Status:** Proposed (not implemented), candidate `v0.2`. Fast Documentation Workflow output; documentation artifact, `REVIEW`-complete, **not frozen**.
**Change class:** Framework + Constitutional (Constitution §20); human approval required.
**Target framework version:** 1.4.0 (additive, backward-compatible; follows the 1.1.0→1.2.0 and 1.2.0→1.3.0 additive precedent — ADR-009/SYNC-007, ADR-010).
**Baseline evidence:** `.claude/` at `VERSION.yaml.current_version = 1.3.0`, branch `claude/framework-documentation-workflow-pyejoh`, worktree clean.
**Owner:** Lead Architect (orchestration); named specialist owners per section.
**Objective:** Make model selection, reasoning effort, and agent deployment strategy **first-class, deterministic framework behavior** — resolved by policy from dimensions the framework already declares — rather than instructions repeated in each prompt. No gate, finding schema, confidence rule, loop bound, specialist boundary, or operating model is changed.

---

## 0. Executive Summary

The platform already defines *what* each agent does (`agents/`, `CAPABILITY_REGISTRY.yaml`), *how loops iterate* (`LOOP_CONTROL.md`, `LOOP_REGISTRY.yaml`), and *when work may run in parallel* (Constitution §3.10/§17, `REVIEW_GATES.md` Independent Review Protocol). What it does **not** define anywhere is *which model tier* and *how much reasoning effort* an agent should use, or a single canonical statement of *deployment strategy* (resume-vs-restart, when to spawn a specialist, when to parallelize). Evidence:

- **Every** agent contract declares `model: inherit` (16 of 16 in `agents/*.md`); tier is never differentiated by responsibility.
- **No** file in `.claude/` contains a reasoning-effort policy (`grep -rniE "reasoning.effort|model.tier"` → 0 framework hits).
- Parallelization rules exist but are **scattered** across three artifacts (Constitution §160, `lead-architect.md:23`, `implementation-planner.md:24`) with no single canonical home — the exact "shared rules have one canonical definition" pattern the Constitution (§6) requires.

The consequence is that model/effort/deployment intent must be **re-stated per prompt** (the token waste this task targets), and is applied non-deterministically because no policy binds it.

**This proposal introduces one canonical policy — `constitution/EXECUTION_POLICY.md` — that expresses model tier, reasoning effort, and deployment/parallelization as deterministic functions of dimensions the framework already carries:** `loop_type` (LOOP_CONTROL §1), `capability` (CAPABILITY_REGISTRY), `gate` + `confidence_threshold` (REVIEW_GATES / LOOP_CONTROL §5), and `scope/severity`. The tier assignments become machine-readable fields on the **two registries that already key agents and loops** (`CAPABILITY_REGISTRY.yaml`, `LOOP_REGISTRY.yaml`). Every workflow then inherits the behavior by reference; no prompt restates it.

The single design invariant, deliberately parallel to 1.2.0's *discover-once / reuse-by-reference*: **decide execution once from declared dimensions, resolve by reference, never restate per prompt.**

**Recommendation on location (answers the task's core question):** Prefer **one** new canonical file plus **registry fields**, over the three separate files (`MODEL_POLICY.md`, `AGENT_ORCHESTRATION.md`, `TOKEN_OPTIMIZATION.md`) sketched in the request. The three concerns are one coupled decision (effort *is* a token lever; deployment strategy *determines* model choice), and token optimization + parallelization **already have canonical homes** (Constitution §17, `CONTEXT_ARTIFACTS.md`, `REVIEW_GATES.md`). Three files would split existing authority and force duplicated applicability tables — a consistency-review failure under Constitution §6/§14. §1 justifies this in full.

---

## 1. Framework Improvement Proposal

### 1.1 The gap, located in evidence

| # | Gap | Evidence | Root cause |
|---|---|---|---|
| G1 | Model tier undifferentiated | All 16 `agents/*.md` declare `model: inherit`; no tier maps to responsibility | No policy binds tier to capability |
| G2 | Reasoning effort undefined | 0 framework hits for `reasoning.effort`; each prompt sets effort ad hoc | No canonical effort policy |
| G3 | Deployment strategy implicit | "spawn a specialist" / "keep with primary" decided per prompt; CLAUDE.md §Agent System states the operating model but not a *selection rule* | No deterministic deploy predicate |
| G4 | Parallelization rules scattered | Constitution §3.10 + §17, `lead-architect.md:23`, `implementation-planner.md:24`, `REVIEW_GATES` step 2, `documentation.md §Parallel Activities` | No single canonical statement (violates §6 "one canonical definition") |
| G5 | Resume-vs-restart not named as an execution lever | Fully specified as data (Repository Session reuse, each workflow's Restart Conditions, `context_invalidators`) but never surfaced as an *execution-policy* decision | Mechanism exists; the policy view over it does not |
| G6 | Token guidance repeated per prompt | Constitution §17 is canonical, yet model/effort tiering — a first-order token lever — is absent from it | §17 predates model-tier as a lever |

### 1.2 The design: one policy file, keyed to existing dimensions

`constitution/EXECUTION_POLICY.md` (new, canonical) defines four deterministic resolution functions. **Each input is a dimension the framework already declares** — the policy adds no new taxonomy, it composes existing ones:

```
model_tier(capability)              → { opus-class | sonnet-class }
reasoning_effort(loop_type, gate)   → { high | medium | low }
deployment(capability, task)        → { primary | spawn-specialist }
execution_mode(loop_type, inputs)   → { parallel | sequential }
```

with two orthogonal, already-specified lookups referenced (not redefined):

```
resume_or_restart(session, invalidators)  → CONTEXT_ARTIFACTS §6 + workflow Restart Conditions
token_budget(context package)             → Constitution §17 + CONTEXT_ARTIFACTS (Context Package shape)
```

The load-bearing idea: because `loop_type`, `capability`, `gate`, and `confidence_threshold` are **already** first-class and **already** attached to every workflow/agent, execution policy is a *pure function of data the framework already maintains*. No prompt needs to carry it.

### 1.3 Why one file + registry fields (not three files, not inline-per-prompt)

- **Coupling:** tier, effort, and deployment resolve together from the same keys; separating them forces three cross-referencing files each repeating the applicability table (`loop_type × capability × gate`). Constitution §6: "Shared rules have one canonical definition and may be referenced, not copied."
- **Existing homes:** token optimization is Constitution §17 + `CONTEXT_ARTIFACTS.md`; parallelization is Constitution §3.10/§17 + `REVIEW_GATES` protocol; resume-vs-restart is `CONTEXT_ARTIFACTS §6` + workflow Restart Conditions. A standalone `TOKEN_OPTIMIZATION.md` would **duplicate** §17 — a consistency violation. `EXECUTION_POLICY.md` therefore *extends by reference* and owns only the genuinely-new part: **model tier + reasoning effort + the deployment predicate**.
- **Data vs. mechanism split (mirrors LOOP_CONTROL ↔ LOOP_REGISTRY):** the *mechanism* (resolution functions) is constitutional policy in `EXECUTION_POLICY.md`; the *assignments* (which capability is opus-class) are tuning data in a registry, evolvable through the normal Documentation Workflow without a constitutional edit — exactly how loop *semantics* are constitutional while loop *entries* are registry data. §1.3a resolves **where** that data lives.

### 1.3a Where the assignment data lives: a dedicated `EXECUTION_REGISTRY.yaml`, not fields on `CAPABILITY_REGISTRY`/`LOOP_REGISTRY` (revised in review, see Validation FIND-07)

The mechanism/data split above does not mean the *data* belongs on the two registries it reads from. `knowledge/README.md` shows the framework's settled convention: `SPECIFICATION_INDEX`, `BOUNDARY_INDEX`, `OWNERSHIP_INDEX`, `CONTRACT_INDEX`, `API_INDEX`, and `STATE_OWNERSHIP_INDEX` are **six separate files**, every one of them derived from `MODULE_REGISTRY.yaml` + `DEPENDENCY_GRAPH.yaml` — yet none is merged into those two sources. The framework consistently keeps orthogonal concerns in orthogonal files, cross-referenced by ID, rather than accreting fields onto whichever registry happens to name the same entity.

Model tier, reasoning effort, and execution mode — plus the forward-looking fields an execution/resource policy will eventually need (cost budget, retry policy, caching strategy, fallback-model chain, adaptive-execution triggers) — are exactly such an orthogonal concern: they describe *how much to spend executing* a capability/loop, not *what the capability is authorized to do* (`CAPABILITY_REGISTRY.yaml`, owned by Constitution §7 module-ownership authority) or *how a loop iterates and terminates* (`LOOP_REGISTRY.yaml`, owned by `LOOP_CONTROL.md`). Bolting a fast-growing field set onto those two registries would couple an execution/resource authority to two schemas owned by unrelated constitutional documents, and would force every future execution-policy field to be a Documentation Workflow edit against `CAPABILITY_REGISTRY.yaml`/`LOOP_REGISTRY.yaml` rather than against its own file.

**Revised design:** a new `knowledge/EXECUTION_REGISTRY.yaml`, keyed by `capability_id` (foreign key into `CAPABILITY_REGISTRY.yaml`) and `loop_id` (foreign key into `LOOP_REGISTRY.yaml`) — reference, never copy, mirroring how `DEPENDENCY_GRAPH.yaml` already references `MODULE_REGISTRY.yaml` entries by id. It carries three specified fields (`model_tier`, `reasoning_effort`, `execution_mode`, §1.4) plus explicitly reserved, currently-unspecified extension points named for future use only — `cost_budget`, `retry_policy`, `caching_strategy`, `fallback_model_chain`, `adaptive_execution_triggers` — marked `unspecified: true` per entry until each is separately proposed through the Documentation Workflow. Naming a reserved key is schema forward-compatibility, not a requirement (Constitution §5: "Mark unknowns explicitly. Never convert an assumption into a requirement."); no behavior is defined for any reserved field by this proposal.

### 1.4 Deterministic policy tables (the substance)

**A. Model tier by capability** — realizing the task's Agent Deployment Principles against the actual capabilities in `CAPABILITY_REGISTRY.yaml`, with the tier itself recorded in `EXECUTION_REGISTRY.yaml` (§1.3a):

| Principle (task) | Tier | Capabilities (from CAPABILITY_REGISTRY) |
|---|---|---|
| Architectural reasoning | **opus-class** | `orchestration-and-context-assembly`, `module-specification-authoring`, `implementation-planning`, `architecture-review`, `architecture-validation` |
| Repository-wide synthesis | **opus-class** | `repository-truth-resolution`, `context-artifact-production`, `boundary-collision-detection`, `continuous-learning` |
| Cross-module validation | **opus-class** | `dependency-review`, `consistency-review`, `security-review` |
| Module-level validation | **sonnet-class** | `documentation-validation`, `business-rule-validation` |
| Evidence collection | **sonnet-class** | `quality-assurance-testing`, `performance-review` (measurement), `requirements-analysis` |
| Formatting / low-complexity | **sonnet-class** | implementation capabilities on scoped, plan-bound items (`backend/frontend/mobile/infrastructure-implementation`), register/index synchronization sub-steps |

> Note (evidence, not assumption): `implementation-*` capabilities are placed sonnet-class **by default** because they execute an already-frozen plan against a frozen spec (`CAPABILITY_REGISTRY` `must_not: expand scope`); a work item flagged `architectural: true` in its plan escalates to opus-class via the scope override (row B/§1.4 override rule). Marked explicitly per Constitution §5 (no assumption→requirement).

**B. Reasoning effort by loop type × gate:**

| Effort | When | Basis |
|---|---|---|
| **High** | `Critic` reviews with architectural/security/cross-module scope; `Pipeline` authoring of specs/plans; orchestration & merge/release decisions; any gate whose `confidence_threshold = High` for target-state/decision content | LOOP_CONTROL §5 (High threshold for merge/release), §1 loop types |
| **Medium** | intermediate gates (`confidence_threshold = Medium`, LOOP_CONTROL §5); `Discovery` loops; module-level validation; evidence collection | LOOP_CONTROL §5 default |
| **Low** | purely corrective non-semantic metadata edits; mechanical `Synchronization` sub-steps (register append/resolve, index refresh); no-op confirmations (documentation.md Restart Conditions) | documentation.md §Restart Conditions; LOOP_CONTROL §7 incremental scope |

**C. Deployment predicate** — `spawn-specialist` **iff** all hold, else `primary`:
1. the capability's `responsible_agent` ≠ `lead-architect` (its own capabilities — orchestration, context assembly, boundary collision, drift repair, learning — stay on the primary; CLAUDE.md §Agent System: "do not delegate orchestration"), **and**
2. inputs are frozen (an immutable candidate exists — Constitution §12/§17), **and**
3. the specialist provides measurable value beyond the primary's context (task: "do not deploy additional agents unless they provide measurable value"; "prefer fewer specialized agents").
   Corollary (task: "avoid duplicate analysis"): a capability already satisfied by a valid Context Artifact (`ART-*`) at the current revision is **not** re-spawned (`CONTEXT_ARTIFACTS §1.4` verify-don't-rediscover).

**D. Execution mode** — `parallel` **iff** `loop_type = Critic` against the **same immutable candidate** AND reviewer domains are disjoint (no shared artifact write, no inter-branch dependency); otherwise `sequential`:
- Parallel: the applicability-gated reviews of `documentation.md` / `REVIEW_GATES` step 2 (architecture, dependency, consistency, security, performance) after freeze.
- Sequential: `Pipeline` stages with producer→consumer dependency (author→review→correct); any dependent frozen input not yet available (Constitution §3.10 "concurrency only for independent work with stable inputs"; workflows/README "Freeze shared inputs before parallel work").
- This is a **restatement-by-reference** of rules already in Constitution §3.10/§17 and `REVIEW_GATES`; it *centralizes* G4, it does not change it.

**E. Resume vs. restart** (referenced, not redefined): **resume** (reuse Context Artifacts by reference) is the default; **restart** only when a workflow Restart Condition or a `SYNC_STATE.context_invalidator` fires (`CONTEXT_ARTIFACTS §6` Repository Session; each workflow's Restart Conditions). Execution policy adds only the framing that resume is the default execution mode and restart is the exception — the mechanism is unchanged.

---

## 2. Recommended Files to Modify

Strictly additive; no rule deleted or weakened. Ordered by dependency.

| # | File | Change | Kind |
|---|---|---|---|
| 1 | `docs/14-governance/architecture-decisions/ADR-017-execution-policy-model-effort-deployment.md` | **New** ADR (problem, alternatives, compatibility, migration) | Decision Record |
| 2 | `constitution/EXECUTION_POLICY.md` | **New** canonical policy (§1.2–§1.4 functions + tables) | Constitutional (new file) |
| 3 | `constitution/ENGINEERING_CONSTITUTION.md` | Add **§23 Execution and Resource Policy** — a short article pointing to `EXECUTION_POLICY.md` (mirrors §21→LOOP_CONTROL, §16→CONTEXT_ARTIFACTS); extend §17 with a one-line model/effort-tier reference | Constitutional (additive) |
| 4 | `knowledge/EXECUTION_REGISTRY.yaml` | **New** dedicated registry (§1.3a): `model_tier` + `reasoning_effort` keyed by `capability_id`; `execution_mode` keyed by `loop_id`; reserved (`unspecified: true`) extension points for cost budget, retry policy, caching strategy, fallback-model chain, adaptive-execution triggers | Registry data (new file) |
| 5 | `knowledge/CAPABILITY_REGISTRY.yaml`, `knowledge/LOOP_REGISTRY.yaml` | **No schema change** — referenced by id from `EXECUTION_REGISTRY.yaml`, never duplicated | Unmodified (referenced) |
| 6 | `agents/*.md` (16) | Keep `model: inherit`; add a **one-line** comment that tier is resolved from the capability's `EXECUTION_REGISTRY.yaml` entry (documents meaning; changes no runtime default) | Contract metadata |
| 7 | `CLAUDE.md` | §Agent System + §Context Assembly: one sentence each pointing to `EXECUTION_POLICY.md` (no operating-model change) | Bootloader (additive) |
| 8 | `VERSION.yaml`, `CHANGELOG.md`, `FRAMEWORK_RELEASE_NOTES.md` | Version → 1.4.0 + narrate the additive release | Release records |
| 9 | `knowledge/DECISION_INDEX.md`, `knowledge/SYNC_STATE.yaml`, `knowledge/README.md` | Register ADR-017; record the framework change + `cache_state`/context notes; add `EXECUTION_REGISTRY.yaml` to the `## Files` list alongside the other five lookup indexes | Knowledge sync |
| 10 | `knowledge/IMPROVEMENT_LOG.yaml` | (optional) seed the post-adoption measurement record | Learning (advisory) |

**Not modified:** every `workflows/*.md`, every gate, `REVIEWER_FINDINGS.md`, `LOOP_CONTROL.md` semantics, `CONTEXT_ARTIFACTS.md`. Workflows inherit execution policy **by reference**; they do not restate it (workflows/README "reference existing constitutional policy; never restate").

---

## 3. ADRs / Governance Changes Required

- **ADR-017 — Execution Policy (Model, Reasoning Effort, Agent Deployment).** Required because adding a canonical file to `constitution/` and a new Constitution article is a constitutional change (Constitution §20; the identical authority ADR-009 and ADR-010 required for `CONTEXT_ARTIFACTS.md` and the governance layer). Content: problem (§1.1 gaps), alternatives (three-file split vs. inline-per-prompt vs. one-file+registry — recommend the third, §1.3), compatibility (§8), migration (§7).
- **No `governance/` change.** The Specification Issues Register mechanism is untouched; execution policy introduces no continuously-live register.
- **Decision Hierarchy placement.** Execution policy is stated to sit at **rank 6 (optimization preferences)** of Constitution §2 — it MUST NOT override safety, the constitution, resolved truth, frozen specs, or an active workflow/agent contract. A tier/effort assignment never relaxes a gate, a confidence threshold, or a specialist boundary. This ordering is asserted in ADR-017 and §23 so the policy can be *deterministic* without becoming *authoritative over correctness*.

---

## 4. Workflow Updates Required

**None to workflow logic.** This is the deliberate strength of the design: because policy binds to `loop_type`/`capability`/`gate` — which every workflow already declares — no `workflows/*.md` file changes. Concretely:

- `preflight.md` already produces context manifests "by reference to Context Artifacts" (line 78); the Lead Architect's existing context-packaging step is where `model_tier`/`reasoning_effort`/`execution_mode` are resolved and stamped into `ART-PREFLIGHT-003`/`004`. No new step, no new gate.
- `documentation.md §Parallel Activities` and `REVIEW_GATES` step 2 already express the parallel-review rule; `execution_mode` centralizes its *source* without editing either file.
- The Fast Documentation Workflow (this task's own vehicle) is the first consumer: a "fast" variant is simply `reasoning_effort` resolved lower for non-target-state content and `execution_mode = parallel` for the applicability-gated reviews — expressible entirely from the new fields, no bespoke workflow.

If a future maintainer wants an explicit pointer, a single optional line may be added to `workflows/README.md §Deterministic Execution Sections` noting that model/effort/mode are resolved from `EXECUTION_POLICY.md` — but this is cosmetic, not required for behavior.

---

## 5. Agent Orchestration Updates

No new agent; no boundary collapsed or moved (CLAUDE.md §Agent System: "Add specialists by adding a contract; do not change the operating model"). Responsibilities are **clarified**, one capability extended:

| Agent / capability | Added responsibility | Unchanged |
|---|---|---|
| Lead Architect / `orchestration-and-context-assembly` | Resolve `model_tier`, `reasoning_effort`, `execution_mode`, and `deployment` from `EXECUTION_POLICY.md` when packaging context; stamp them into the context manifest | Never performs specialist reviews; merges findings without changing judgment; owns parallelization decision (already in `lead-architect.md:23`) |
| Every specialist | Consume the resolved tier/effort from its Context Package | Single responsibility, canonical finding shape, Critic/Validation bounds, independence |

- **New capability field, not new capability:** `orchestration-and-context-assembly` gains `execution-policy-resolution` as an explicit duty — already implied by `lead-architect.md` ("Select agents, sequence dependent work, and parallelize only independent frozen inputs") and Constitution §17. This mirrors how 1.2.0 assigned Context-Artifact production to the existing Lead Architect contract (PLATFORM_OPTIMIZATION_PROPOSAL FIND-01) rather than adding an agent.
- **Deployment discipline made explicit** (task's Agent Deployment Principles): the §1.4-C predicate encodes "keep with primary unless measurable value," "prefer fewer specialists," and "avoid duplicate analysis" as a deterministic rule the Lead Architect applies — replacing per-prompt judgment with policy.

---

## 6. Token Optimization Improvements

1. **Eliminates repeated prompt instructions** (primary win, task goal #2): model/effort/deployment intent moves from *every prompt* to *one policy resolved by reference*. On a representative documentation cycle (1 author + up to 5 reviewers + 1 correction) that is 6–7 prompts each no longer restating tier/effort/parallel guidance.
2. **Right-sizes reasoning spend** (task goal #1): sonnet-class + medium/low effort for module-level validation, evidence collection, and mechanical synchronization stops paying opus-class/high-effort cost on low-complexity work — the largest *unforced* spend in the current uniform-`inherit` model.
3. **Compounds with 1.2.0 reuse:** deployment predicate corollary ("do not re-spawn a capability already satisfied by a valid Context Artifact") reuses the `CONTEXT_ARTIFACTS §1.4` verify-don't-rediscover guarantee for *agent spawning*, not just context reading.
4. **Keeps prompts intent-driven** (task goal #3): a prompt states the objective; the framework supplies execution mechanics — the same separation `CONTEXT_ARTIFACTS.md` achieved for evidence.

**Estimated effect:** the *prompt-restatement* savings are **High-confidence** (they remove literally repeated text, provable from any current prompt). The *reasoning-spend* savings are **Medium-confidence**: direction is certain, magnitude depends on real cycle mix and is not instrumented in-repo (Unknown; the Learning loop measures it post-adoption, `IMPROVEMENT_LOG.yaml`). No magnitude percentage is claimed without instrumentation, per Constitution §5.

---

## 7. Migration Impact Assessment

Additive; mirrors ADR-009→1.2.0 and ADR-010→1.3.0. Phased, each phase independently reversible.

- **Phase 0 — ADR-017** (human approval; Constitution §20).
- **Phase 1 — Canonical policy:** add `EXECUTION_POLICY.md`; add Constitution §23 + extend §17. Consistency + Architecture review; human ratification.
- **Phase 2 — Registry data:** add `knowledge/EXECUTION_REGISTRY.yaml` with `model_tier`/`reasoning_effort` per `capability_id` and `execution_mode` per `loop_id` (§1.3a), plus the reserved (`unspecified: true`) extension points; register it in `knowledge/README.md`. `CAPABILITY_REGISTRY.yaml`/`LOOP_REGISTRY.yaml` are unmodified. Pure vocabulary; no runtime change yet.
- **Phase 3 — Documentation of meaning:** agent-contract comments + CLAUDE.md pointers. `model: inherit` stays the enforced default.
- **Phase 4 — Enable resolution:** Lead Architect begins stamping resolved tier/effort/mode into context manifests. Shadow first (record the resolution without acting) for one cycle, then apply.
- **Phase 5 — Version bump 1.4.0** + CHANGELOG/FRAMEWORK_RELEASE_NOTES; DECISION_INDEX + SYNC_STATE updated. Learning loop begins measuring.

**Consumer impact:** none. A repository that ignores the new fields behaves exactly as 1.3.0 (agents still `inherit`; effort still harness-default). No project artifact under `docs/`, `knowledge/` project entries, or code must change.

---

## 8. Backward Compatibility Assessment

| Concern | Compatibility | Basis |
|---|---|---|
| `model: inherit` in all 16 contracts | **Preserved** — remains the enforced default; `model_tier` is *advisory policy* the Lead Architect applies when composing/routing, with `inherit` as the fail-safe on any miss | mirrors CONTEXT_ARTIFACTS §1.5 fail-safe: absent policy ⇒ current behavior |
| Reasoning effort | **Additive** — absent today; a declared field defaults to current harness behavior when unresolved | no existing value to break |
| Reasoning-effort *enforcement* | **Honest unknown** — `model:` is a supported, enforceable agent-frontmatter key (High confidence; it is already in every contract). Whether the harness exposes a per-agent `reasoning_effort` **enforcement** key is **Unknown/Low confidence**; the proposal therefore treats effort as *policy metadata* consumed by the Lead Architect and human operator, with the registry field ready to become the binding source if/when the harness exposes it | Constitution §5 (mark unknowns; no assumption→requirement) |
| Gates, findings, confidence, loop bounds, boundaries | **Untouched** — execution policy sits at Decision-Hierarchy rank 6 and can never relax rank 1–5 | Constitution §2; §3 of this proposal |
| Parallelization semantics | **Preserved** — `execution_mode` restates Constitution §3.10/§17 + REVIEW_GATES by reference; centralization, not change | §1.4-D |
| Reversibility | **Full** — delete `EXECUTION_POLICY.md`, §23, and `EXECUTION_REGISTRY.yaml` ⇒ exact 1.3.0 semantics, no data loss (`CAPABILITY_REGISTRY.yaml`/`LOOP_REGISTRY.yaml` were never touched) | additive-only diff |

---

## Validation — Independent Reviews of This Proposal

Per the Documentation Workflow, independent reviews were run against this frozen proposal `v0.1`; findings use the canonical shape (`REVIEWER_FINDINGS.md`); dispositions applied in this version where author-fixable. `v0.2` (this revision) incorporates a human review round (Correction Package: changed sections §1.3–§1.3a, §2 rows 4–5, §1.4-A, §7 Phase 2, backward-compatibility Reversibility row — FIND-07 below); all prior findings/dispositions carry forward unchanged (LOOP_CONTROL §7).

**FIND-01 · Consistency · High · High confidence.** A standalone `TOKEN_OPTIMIZATION.md` (as sketched in the request) would duplicate Constitution §17 + `CONTEXT_ARTIFACTS.md`, creating two authorities for one rule (§6 violation). *Disposition: fixed* — §1.3 recommends one file that *extends §17 by reference* and owns only model-tier + effort + deployment. **Resolved.**

**FIND-02 · Architecture · High · High confidence.** Binding tier to capability could be read as changing the operating model or adding agents (CLAUDE.md §Agent System forbids). *Disposition: fixed* — §5 assigns resolution to the **existing** Lead Architect capability; no new agent, no boundary moved; mirrors the 1.2.0 FIND-01 precedent. **Resolved.**

**FIND-03 · Governance/Correctness · High · Medium confidence.** A deterministic execution policy must not be able to relax a gate, threshold, or boundary. *Disposition: fixed* — §3 fixes execution policy at Decision-Hierarchy rank 6 (optimization); it can never override rank 1–5. **Resolved.**

**FIND-04 · Evidence · Medium · High confidence.** Reasoning-effort enforcement was initially assumed to be a harness-enforced frontmatter key. *Disposition: fixed* — §8 marks effort-enforcement an explicit Unknown and treats effort as policy metadata until the harness exposes it (Constitution §5). **Resolved.**

**FIND-05 · Token-Optimization · Medium · Medium confidence.** A magnitude percentage would overstate confidence without in-repo instrumentation. *Disposition: fixed* — §6 claims only the High-confidence prompt-restatement removal; magnitude is deferred to Learning-loop measurement. **Resolved.**

**FIND-06 · Consistency · Low · High confidence.** Registry-data vs. constitutional-mechanism could blur (can tiers change without a constitutional edit?). *Disposition: fixed* — §1.3 splits mechanism (constitutional, `EXECUTION_POLICY.md`) from assignments (registry data, normal Documentation Workflow), mirroring LOOP_CONTROL ↔ LOOP_REGISTRY. **Resolved.**

**FIND-07 · Architecture · Medium · High confidence (human review, `v0.2`).** Reviewer feedback: "decide whether execution metadata should extend existing registries or evolve into a dedicated `EXECUTION_REGISTRY.yaml` to better support future capabilities such as cost budgets, retries, caching, fallback models, and adaptive execution." Bolting a fast-growing, execution/resource-scoped field set onto `CAPABILITY_REGISTRY.yaml` (owned by Constitution §7 module-ownership authority) and `LOOP_REGISTRY.yaml` (owned by `LOOP_CONTROL.md`) would couple an orthogonal concern to two schemas owned by unrelated constitutional documents, and contradicts the framework's own convention of keeping derived, single-purpose indexes separate (`knowledge/README.md`: `SPECIFICATION_INDEX`/`BOUNDARY_INDEX`/`OWNERSHIP_INDEX`/`CONTRACT_INDEX`/`API_INDEX`/`STATE_OWNERSHIP_INDEX` are six separate files, all derived from `MODULE_REGISTRY.yaml` + `DEPENDENCY_GRAPH.yaml`, none merged into either). *Disposition: fixed* — §1.3a introduces a dedicated `knowledge/EXECUTION_REGISTRY.yaml`, keyed by `capability_id`/`loop_id` (reference, never copy, mirroring `DEPENDENCY_GRAPH.yaml`'s existing reference-by-id discipline), carrying the three specified fields plus reserved (`unspecified: true`) extension points named for the cited future needs — without specifying their behavior now (Constitution §5: mark unknowns, never convert an assumption into a requirement). `CAPABILITY_REGISTRY.yaml`/`LOOP_REGISTRY.yaml` remain schema-unchanged. **Resolved.**

**Merged result:** 0 open Critical/High findings; all High findings resolved. Terminal review state: **PASS_WITH_ACTIONS** — the actions are the Phase-4 shadow cycle and the Learning-loop measurement (§7), owned and time-bound to their phase.

**Gate status of this proposal:** documentation artifact, `REVIEW`-complete, **not frozen** — freeze (G2) and the constitutional additions require human approval (Constitution §20). This document proposes; it does not implement.
