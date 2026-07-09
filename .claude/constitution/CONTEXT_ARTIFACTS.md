# Context Artifacts

**Status:** Canonical governing policy for reusable context.
**Change class:** Constitutional; human approval required (see [Engineering Constitution](ENGINEERING_CONSTITUTION.md) §20).
**Applies to:** Every workflow, agent, reviewer, and validator that assembles, produces, or consumes context.
**Platform version:** Introduced in framework 1.2.0 (see [../VERSION.yaml](../VERSION.yaml)). Additive; extends Constitution §17 and never overrides it.

## Purpose

Independent agents only compose efficiently if the platform **discovers truth once, freezes it to a revision, reuses it by reference, and invalidates it by digest.** Before 1.2.0 the same framework policy, repository truth, dependency slices, and specification text were re-derived by successive agents and re-read across correction cycles because no durable, revision-bound artifact carried that work forward.

This document is the single canonical definition of the reusable **Context Artifacts**. Workflow files, agent contracts, and templates **reference** these definitions; they never restate them. This document adds only artifact identity, ownership, lifecycle, cache key, invalidation, and reuse policy; it changes no gate, finding schema, confidence rule, loop bound, or specialist boundary.

## 1. Design Invariants

The five invariants below are cited elsewhere as §1.1–§1.5 in list order.

1. **Discover once.** Repository discovery ([repository-synchronization](../workflows/repository-synchronization.md)) runs at most once per `baseline_revision` per repository session (§6). Its output is the Evidence Package. Specialists **consume** it; they do not re-run discovery.
2. **Revision-bound immutability.** Evidence is immutable for its `baseline_revision`. Only a repository change — the `context_invalidators` recorded in [`../knowledge/SYNC_STATE.yaml`](../knowledge/SYNC_STATE.yaml) — invalidates it.
3. **Reference over copy.** Every Context Package carries pointers plus content digests into Boot Context, Evidence Package, and Dependency Context, never inlined copies (extends Constitution §17: "path-and-line evidence … over repeated full documents").
4. **Verify, do not rediscover.** A reviewer inspects the repository **only to verify a specific finding**, never to rediscover implementation the Evidence Package already carries ([REVIEW_GATES.md](REVIEW_GATES.md) Independent Review Protocol, step 1b).
5. **Fail safe.** A cache is advisory and reconstructable. On any doubt about validity, the artifact is treated as **stale** and reproduced by re-running its producing workflow. Missing cache ⇒ current (pre-1.2.0) behavior, never a governance gap.

These invariants never weaken a gate: a stale or absent artifact degrades to full re-derivation, which is exactly today's behavior.

## 2. The Canonical Context Artifacts

Every artifact declares **Producer · Consumers · Cache key · Lifecycle · Invalidation · Reuse**. All use stable IDs (Constitution §15) and the prefixes registered in [../workflows/README.md](../workflows/README.md#artifact-id-prefixes). All are runtime **instances**; their *definitions* are framework policy (this file) and their *instances* are revision-bound runtime state recorded in `SESSION_STATE.yaml`/`SYNC_STATE.yaml` (Knowledge Separation, CLAUDE.md).

| Artifact | ID prefix | Scope (cache key) | Owner (producer) |
|---|---|---|---|
| Boot Context | `ART-BOOT` | framework version (`VERSION.yaml.current_version`) | Lead Architect |
| Evidence Package (Repository Context) | `ART-EVID` | repository `baseline_revision` | Lead Architect |
| Dependency Context (graph slice) | `ART-DEPCTX` | `baseline_revision` + capability id | Lead Architect |
| Context Package (per specialist) | `ART-CTX` | candidate version + role | Lead Architect |
| Finding Package | `ART-FIND-PKG` | candidate version | Lead Architect (merger) |
| Correction Package | `ART-CORR` | version transition `v(n)→v(n+1)` | Author |
| Review Package | `ART-REV-PKG` | reviewer × candidate version | Reviewer |
| Module Memory | `ART-MEM` | module id + freeze revision | Lead Architect (on freeze) |

### 2.1 Boot Context — `ART-BOOT-001`
- **Producer:** Lead Architect, on framework boot (cache miss).
- **Contents:** a referenceable **index with digests** of the Constitution articles, Source-of-Truth hierarchy, Review-Gate map (G0–G9 + owners + applicability), the canonical finding schema, and Loop-Control policy pointers. **Not** full-text copies of those documents.
- **Cache key:** `VERSION.yaml.current_version`.
- **Lifecycle:** session-durable across workflows within one framework version.
- **Invalidation:** framework version change; any constitutional change (Constitution §20).
- **Reuse:** every workflow and specialist references it. No specialist re-reads the constitution set while Boot Context is valid for the current framework version.

### 2.2 Evidence Package (Repository Context) — `ART-EVID-001`
- **Producer:** Lead Architect via [repository-synchronization](../workflows/repository-synchronization.md); its `ART-REPO-001..003` are the body.
- **Contents:** Repository State Record, protected-change list, source manifest / divergence report, plus content digests of `MODULE_REGISTRY`, `DEPENDENCY_GRAPH`, `TERMINOLOGY`, `PROJECT_PROFILE`, and the six canonical lookup indexes.
- **Cache key:** `baseline_revision` (+ default-branch id).
- **Lifecycle:** revision-scoped; immutable while worktree/HEAD unchanged.
- **Invalidation:** exactly the `SYNC_STATE.yaml.context_invalidators` (repository revision, default branch, architecture/ownership decision, terminology/rule change, contract/event/schema/package/consumer change).
- **Reuse:** every specialist consumes it instead of re-inspecting the repository. Direct inspection is allowed only to verify a claim.

### 2.3 Dependency Context — `ART-DEPCTX-<capability>`
- **Producer:** Lead Architect, from the Dependency Reviewer's verified slice.
- **Contents:** the transitive `DEPENDENCY_GRAPH` slice for one capability — edges, state owners, consumed/published relations — and nothing outside the slice.
- **Cache key:** `baseline_revision` + capability id.
- **Lifecycle:** revision-scoped.
- **Invalidation:** contract / event / schema / package / consumer change touching the slice.
- **Reuse:** dependency review, architecture review, boundary collision, authoring — consume the slice rather than traversing the full graph.

### 2.4 Context Package — `ART-CTX-<role>`
- **Producer:** Lead Architect.
- **Contents (by reference only):** objective; applicable-rule pointers into Boot Context; Evidence Package pointer; Dependency Context slice; acceptance criteria; output contract; and a `digests` map that is the invalidation key set. Exactly CLAUDE.md §Context Assembly's list, expressed as references + digests. See §4 for the shape.
- **Cache key:** candidate version + role.
- **Invalidation:** any referenced digest changes.
- **Reuse:** re-issued on re-review only if the role is in the affected-reviewer union ([REVIEW_GATES.md](REVIEW_GATES.md) Incremental Re-review).

### 2.5 Finding Package — `ART-FIND-PKG-001`
- **Producer:** Lead Architect, merging by `FIND-*` + severity ([REVIEWER_FINDINGS.md](REVIEWER_FINDINGS.md) §Merge).
- **Contents:** merged canonical findings across reviewers with confidence/unknowns/limitations preserved.
- **Cache key:** candidate version.
- **Lifecycle:** candidate-version-scoped; superseded on version bump.
- **Reuse:** consumed by author (correction) and validator; unchanged findings carry forward across cycles.

### 2.6 Correction Package — `ART-CORR-001`
- **Producer:** Author.
- **Contents:** changed-section list, new candidate version, and a findings-addressed map (`FIND-* → disposition`).
- **Cache key:** version transition `v(n)→v(n+1)`.
- **Reuse:** input to Affected-Reviewer Determination ([REVIEW_GATES.md](REVIEW_GATES.md)) and to incremental validation.

### 2.7 Review Package — `ART-REV-PKG-<reviewer>`
- **Producer:** each reviewer.
- **Contents:** the reviewer's report bound to the exact candidate version + the sections examined + gate recommendation.
- **Cache key:** reviewer × candidate version.
- **Reuse:** on re-review only the sections intersecting the Correction Package are re-examined; the rest is carried forward by reference.

### 2.8 Module Memory — `ART-MEM-<module>` (see §7)
- **Producer:** Lead Architect on specification freeze (G2).
- **Contents:** immutable, revision-bound distilled summary of a frozen module specification — boundary, owned state, contracts, interfaces, key rules, and the freeze revision.
- **Cache key:** module id + freeze revision.
- **Invalidation:** a new frozen specification for the module, or a change to the module's owned state/contracts (a `context_invalidator`).
- **Reuse:** consumed **before** repository discovery by any future specification touching that module (§7).

## 3. Cache, Invalidation, and Synchronization

### 3.1 Three cache scopes
| Scope | Key | Artifacts | Hit condition |
|---|---|---|---|
| Framework-version | `VERSION.yaml.current_version` | Boot Context | key matches current framework version |
| Revision | `baseline_revision` (+ default branch) | Evidence Package, Dependency Context, Module Memory | worktree/HEAD unchanged and no invalidator fired |
| Candidate-version | candidate `vX.Y` | Context Package, Finding/Correction/Review Package | candidate version unchanged for that role/section |

Keys are **content-addressed** (git revision, blob digest, framework-version string) — deterministic, no heuristic staleness.

### 3.2 Invalidation binding (declarative)
Each `SYNC_STATE.yaml.context_invalidators` trigger binds to the caches it invalidates:

| Invalidator | Invalidates |
|---|---|
| repository revision changes | Evidence Package, Dependency Context, Module Memory, all derived candidate caches |
| default branch changes | Evidence Package |
| architecture or ownership decision | Evidence Package, Boundary-Collision result, affected Dependency Context, OWNERSHIP/BOUNDARY indexes |
| canonical terminology or business-rule change | Boot Context (if constitutional), consistency-domain Review Packages |
| contract / event / schema / package / consumer change | Dependency Context slice(s) touching the edge; dependency/architecture Review Packages; CONTRACT/API/STATE_OWNERSHIP/OWNERSHIP/BOUNDARY indexes |
| framework version change | Boot Context |
| specification status/version change | SPECIFICATION_INDEX; affected Module Memory |

Rules: (1) invalidation **cascades downstream only** (Evidence → Context Package → Review Package), never upstream; (2) a partial invalidation (one edge) invalidates only the intersecting slice, not the whole Evidence Package; (3) on any uncertainty, treat as stale and reproduce (§1.5).

### 3.3 Synchronization
The Lead Architect is the single authoritative writer of Boot Context, Evidence Package, Dependency Context, and Module Memory (Constitution §7 "state has one authoritative writer"; §19 "update canonical source first, then dependents"). Cache validity is recorded in `SESSION_STATE.yaml` (per-session) and `SYNC_STATE.yaml.cache_state` (per-revision), so a follow-up session inherits warm, revision-bound context instead of rediscovering it (Constitution §17 evidence-manifest handoff).

## 4. Context Package Shape

The Context Package is a **manifest of references + digests**, not copied text:

```
objective:            <verbatim, 1 paragraph>
rules:                ref → ART-BOOT-001 §<articles>        # pointer, not text
repository_evidence:  ref → ART-EVID-001 @<baseline_revision>
dependency_slice:     ref → ART-DEPCTX-<capability>
module_memory:        ref → ART-MEM-<module> (if module previously frozen)
frozen_input:         ref → <artifact id> v<n> (immutable)
prior_findings:       ref → ART-FIND-PKG-001 (re-review only)
acceptance_criteria:  <ids only>
output_contract:      ref → ART-BOOT-001 (finding schema)
digests:              { each ref : blob-sha }               # invalidation keys
```

A specialist expands a reference to full text **only** to verify a specific claim; the default is to trust the revision-bound digest. This enforces Constitution §17 as an artifact shape rather than an aspiration.

## 5. Governance Preservation (non-negotiable)

Reuse is of **evidence**, never of peer **conclusions**. Every reviewer still receives only the immutable candidate and never the author's proposed fixes or peers' in-flight findings before the review-merge sync point ([documentation.md](../workflows/documentation.md) §Context Packages; [REVIEW_GATES.md](REVIEW_GATES.md) Independent Review Protocol step 3). Finding schema, confidence thresholds, the four gate statuses, single-responsibility boundaries, loop bounds (≤3), and termination guarantees are unchanged. Absent any cache, the platform behaves exactly as framework 1.1.0.

## 6. Repository Session (framework 1.2.0)

A **Repository Session** persists revision-bound Context Artifacts across multiple workflows within one repository revision so discovery is not repeated per workflow.

- **Record:** [`../knowledge/SESSION_STATE.yaml`](../knowledge/SESSION_STATE.yaml) holds the active `baseline_revision`, the produced artifact IDs, and their digests.
- **Reuse rule:** when a new workflow enters pre-flight, the Lead Architect **reuses** a valid Evidence Package / Dependency Context / Boot Context for the current `baseline_revision` instead of re-running discovery. Repository discovery runs again only when the session's `baseline_revision` changes.
- **Invalidation:** any `context_invalidator` clears the affected artifact from the session; the whole session invalidates when `baseline_revision` or the default branch changes.
- **Boundary:** a session never carries evidence across a revision change; stale-session reuse is forbidden (§1.5 fail-safe).

## 7. Module Memory (framework 1.2.0)

Each frozen module specification produces an immutable **Module Memory** artifact (`ART-MEM-<module>`) so future specifications consume a distilled, revision-bound module summary **before** repository discovery, narrowing what discovery must re-read.

- **Produced at:** G2 specification freeze, by the Lead Architect, from the frozen `ART-SPEC`.
- **Consumed at:** pre-flight of any future workflow whose scope touches that module — before repository discovery, as a first-pass context source (Source-of-Truth rank 6 "project memory": must cite revision-bound sources; here the freeze revision).
- **Authority:** Module Memory is a **corroborating** summary, never authoritative over current repository truth. If it disagrees with the Evidence Package at the current revision, the repository wins and drift is recorded (Constitution §5; Source of Truth §Authority Hierarchy). Module Memory therefore accelerates discovery without ever substituting for it.
- **Index:** [`../knowledge/MODULE_MEMORY.yaml`](../knowledge/MODULE_MEMORY.yaml) is the machine-readable cross-index of module-memory artifacts and their freeze revisions.

## Relationship to Existing Policy

This document extends Constitution §17 (Token and Context Optimization), §5 (Repository and Evidence Rules), and §19 (Change Management and Synchronization); it operationalizes [LOOP_CONTROL.md](LOOP_CONTROL.md) §7–§8. It overrides none of them. Where a source-authority, gate, severity, finding-shape, or loop rule already exists, this document references it and adds only reusable-context identity and lifecycle.
