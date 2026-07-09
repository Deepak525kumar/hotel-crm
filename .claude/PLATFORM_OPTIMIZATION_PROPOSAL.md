# Platform Optimization Proposal — Token-Minimizing Architecture

**Status:** Proposed (not implemented). Documentation / Architecture-Improvement workflow output.
**Change class:** Framework + Constitutional (Constitution §20); human approval required.
**Target framework version:** 1.2.0 (additive, backward-compatible; follows the 1.0.0 → 1.1.0 precedent, SYNC-007).
**Baseline evidence:** `.claude/` at `SYNC_STATE.yaml.baseline_revision = 5b16be40…`, framework `VERSION.yaml.current_version = 1.1.0`.
**Owner:** Lead Architect (orchestration); named specialist owners per section.
**Objective:** Redesign the platform to minimize total token consumption while preserving every workflow, validation gate, specialist boundary, and governance guarantee. Behavioral equivalence is mandatory; no gate is removed, weakened, or bypassed.

---

## 0. Executive Summary

The platform is already disciplined about *prompt-level* economy (shared policy is defined once and referenced, `LOOP_CONTROL.md` §Purpose; context packages are "minimal", CLAUDE.md §Context Assembly). The remaining waste is **architectural**: the same repository truth, boot policy, dependency slices, and specification text are **re-derived** by successive agents and re-read across correction cycles because there is no *durable, revision-bound, reusable artifact* carrying that work forward.

This proposal introduces seven canonical, cache-keyed **Context Artifacts** produced **once per scope** and consumed by every downstream specialist, plus an **incremental correction/review loop** that reruns only the reviewers a change can actually affect, plus a pre-authoring **Boundary Collision** gate that stops ownership conflicts before expensive authoring/review is spent on them.

Net effect (Section 13): an estimated **45–65% reduction** in tokens on a typical multi-review documentation cycle, and larger reductions on correction-heavy cycles, with **zero** change to gate semantics, finding schema, confidence rules, or specialist independence.

The single design invariant: **discover once, freeze to a revision, reuse by reference, invalidate by digest.**

---

## 1. Architecture Changes

### 1.1 The waste, located in evidence

| # | Redundancy | Evidence in current platform | Root cause |
|---|---|---|---|
| W1 | Boot policy re-read every activity | CLAUDE.md "Boot Sequence" mandates reading Constitution, Source of Truth, Review Gates, Reviewer Findings, VERSION.yaml, pre/post-flight before *any* activity | Immutable framework files loaded as full text each time, though they change only on a version bump |
| W2 | Repository truth re-discovered per workflow | `repository-synchronization` produces `ART-REPO-001..003`; but each downstream workflow's Context Packages independently re-reference `MODULE_REGISTRY`, `DEPENDENCY_GRAPH`, `TERMINOLOGY` (documentation.md §Context Packages; preflight.md §Agent I/O) | No durable *Evidence Package* bound to `baseline_revision` |
| W3 | Reviewers re-inspect implementation to "discover" it | `REVIEW_GATES.md` §Independent Review Protocol dispatches 5 reviewers, each re-reading the same repository state to understand the candidate before verifying it | Reviewers get the frozen artifact but not a shared *Evidence Package*; each rebuilds context |
| W4 | Correction reruns more review than needed | `documentation.md` already says "impact-based re-review of affected sections only," and `LOOP_CONTROL.md` §3 invalidates evidence "for the changed area only" — but there is **no artifact** that records *which* sections changed or *which* reviewers must rerun | Policy exists; mechanism (Correction Package + reviewer-selection rule) does not |
| W5 | Ownership conflicts discovered late, during review | `SYNC_STATE.yaml` SYNC-001/005 (ownership blocked) and SYNC-010/011 (boundary/authorization defects surfaced only at G4 security review) | No pre-authoring boundary check; conflicts consume full author+review budget before detection |
| W6 | Full dependency graph loaded where a slice suffices | Context Packages ask for a "direct-dependency slice" but there is no addressable, cached slice artifact — the slice is recomputed each time | Slicing is a per-agent instruction, not a reusable artifact |

### 1.2 The design: seven canonical Context Artifacts

All seven are **produced once per their scope, immutable within that scope, referenced by ID, and invalidated by digest**. They are the load-bearing change; everything else operationalizes them.

| Artifact | ID prefix | Scope (cache key) | Owner (producer) | Replaces re-work |
|---|---|---|---|---|
| **Boot Context** | `ART-BOOT` | Framework version (`VERSION.yaml.current_version`) | Lead Architect | W1 |
| **Evidence Package** (Repository Context) | `ART-EVID` | Repository `baseline_revision` | Lead Architect (from `repository-synchronization`) | W2, W3 |
| **Dependency Context** (graph slice) | `ART-DEPCTX` | `baseline_revision` + capability id | Lead Architect (from Dependency Reviewer verification) | W3, W6 |
| **Context Package** (per specialist) | `ART-CTX` | Candidate version + role | Lead Architect | W2, W3, W6 |
| **Finding Package** | `ART-FIND-PKG` | Candidate version | Lead Architect (merger) | duplicate finding handling |
| **Correction Package** | `ART-CORR` | Candidate version transition `v(n)→v(n+1)` | Author | W4 |
| **Review Package** | `ART-REV-PKG` | Reviewer × candidate version | Reviewer | W3, W4 |

Boot Context and Evidence Package are the two that matter most: they convert the two largest repeated reads (framework policy, repository truth) into single-production, reference-consumed artifacts.

### 1.3 Immutability and reuse invariants (new, canonical)

1. **Discovery-once:** Repository discovery (`repository-synchronization`) runs **at most once per `baseline_revision` per workflow instance**. Its output is the Evidence Package. Specialists **consume** it; they do not re-run discovery. Repository inspection by a reviewer is permitted **only to verify a specific finding**, never to rediscover implementation (mirrors the task's Review-System requirement and `REVIEW_GATES.md` §Independent Review Protocol step 1 "Freeze and identify the review input").
2. **Revision-bound evidence:** Evidence is immutable for its `baseline_revision`. Only a repository change (the `context_invalidators` already listed in `SYNC_STATE.yaml`) invalidates it.
3. **Reference over copy:** Every Context Package carries **pointers + digests** into Boot Context / Evidence Package / Dependency Context, never inlined copies (extends Constitution §17 "path-and-line evidence … over repeated full documents").

These invariants are additive to the Constitution (see §3) and to `LOOP_CONTROL.md` (see §4); they contradict nothing.

---

## 2. Workflow Changes

Two structural insertions and one loop rewrite. No workflow is removed; every gate keeps its owner and evidence.

### 2.1 New stage: Boundary Collision (pre-authoring gate G1.5)

Inserted **after** requirements/pre-flight and **before** authoring, in every workflow that authors an owned artifact (documentation, implementation). New workflow file `boundary-collision.md`.

```
G1 Requirements (or G0 for pure-doc)  →  [G1.5 Boundary Collision]  →  authoring
                                            │ conflict?
                                            └─ FAIL → Boundary Conflict Report → STOP (no authoring)
```

- **Detects conflicts across:** responsibilities, owned state, business rules, interfaces, contracts, APIs, and state ownership — read directly from `MODULE_REGISTRY.yaml` (single accountable owner, Constitution §7) and `DEPENDENCY_GRAPH.yaml` (edges, state owners), which the Evidence Package already carries. **Zero new discovery cost.**
- **On conflict:** emit `ART-BOUNDARY-001` Boundary Conflict Report (canonical finding shape, `REVIEWER_FINDINGS.md`), set gate `FAIL`, and **stop before authoring**. This directly prevents the SYNC-001/005/010/011 class of waste, where ownership/authorization conflicts consumed a full author→5-reviewer cycle before surfacing at G4.
- **Loop type:** Critic (read-only, finds defects, does not edit). Owner: Lead Architect (has global ownership awareness; Constitution §7 reserves ownership). Bound: single pass; no correction sub-loop (it gates, it does not fix).

### 2.2 New stage: Dependency Slicing (inside pre-flight)

Pre-flight (`preflight.md` step 4, dependency-drift check) additionally emits the **Dependency Context** slice (`ART-DEPCTX-001`) for the selected capability: the transitive edges the capability touches, not the whole graph. Downstream reviewers/authors reference the slice ID. Avoids repeated full-graph traversal (W6, task Dependency-System requirement).

### 2.3 Loop rewrite: incremental correction (replaces full re-review)

Current documentation loop (documentation.md §Execution Graph): author → **all applicable reviewers** → merge → correct → **re-review affected sections** → validate. The "affected sections" intent exists but is not mechanized. New mechanized loop:

```
Merged Findings (ART-FIND-PKG)
        ↓
Author → Correction Package (ART-CORR: changed sections + version bump + findings-addressed map)
        ↓
Affected-Reviewer Determination (Lead Architect, deterministic rule §8.2)
        ↓
Only reviewers whose domain intersects the changed sections rerun (Review Package updated incrementally)
        ↓
Validator (only re-validates dimensions tied to changed sections)
```

Unchanged sections are **never re-authored**; unaffected reviewers **do not rerun** (task Correction-System + Loop-Optimization requirements). This is a pure efficiency change to *which* work repeats — the retry bound (≤3, `LOOP_CONTROL.md` §3), confidence threshold, and termination guarantee are untouched.

### 2.4 Reviewer input contract change (reuse, not rediscovery)

Every reviewer's Context Package (documentation.md §Context Packages "Each Reviewer receives") is extended to carry, by reference: the **frozen candidate**, the **Evidence Package**, the **Dependency Context slice**, and (on re-review) **previous Review Package + Correction Package**. The independence rule is preserved verbatim: reviewers still receive **only the immutable candidate**, never the author's proposed fixes or peers' in-flight findings before SYNC-doc-1 (documentation.md §Context Packages, `REVIEW_GATES.md` step 3). Reuse of *evidence* ≠ sharing of *conclusions*.

---

## 3. CLAUDE.md Changes

Additive only. The Boot Sequence gains a caching clause; Context Assembly gains the artifact vocabulary.

- **Boot Sequence:** add step 0 — *"Load or reuse the Boot Context (`ART-BOOT-001`) keyed to `VERSION.yaml.current_version`. If a valid Boot Context exists for the current framework version, reference it instead of re-reading the constitution, source-of-truth, review-gate, and finding-schema documents. Re-read source documents only when Boot Context is absent or its version key no longer matches."* The existing six steps remain as the **producers** of Boot Context on a cache miss.
- **Context Assembly:** add the seven canonical artifacts to the list of what a context package *references* (not inlines), and add the invariant: *"Assemble by reference to Boot Context, Evidence Package, and Dependency Context; never re-read a source whose digest is unchanged."*
- **Knowledge Separation:** unchanged. The artifacts are framework behaviour ⇒ their **definitions** live in `.claude/`; their **instances** are revision-bound runtime state (see lifecycle §5).
- **Repository Rules:** add — *"Prefer the Evidence Package over re-inspecting the worktree; inspect directly only to verify a specific claim or when the Evidence Package's revision key is stale."*

No existing CLAUDE.md rule is deleted or weakened.

---

## 4. LOOP_CONTROL Changes

Additive; extends, never overrides (`LOOP_CONTROL.md` §6).

- **New §7 Incremental Correction (canonical):**
  - A correction iteration produces a **Correction Package** naming exactly the changed sections and the findings addressed.
  - Re-review scope is the **union of reviewer domains intersecting the changed sections**; reviewers outside that union carry their prior `PASS` forward unchanged (their evidence was invalidated for "the changed area only," already permitted by §3).
  - A reviewer's prior finding disposition is **reused** unless its section changed. This makes the existing §3 sentence ("invalidates dependent review/validation evidence for the changed area only") *operational* via the Correction Package, rather than re-deriving the whole review.
  - Retry bound (≤3), changed-hypothesis rule, confidence thresholds, and the four terminal states are **unchanged**.
- **New §8 Evidence Reuse:** Evidence, once recorded against a revision, is immutable for that revision and reused by reference. Re-derivation of already-recorded evidence at an unchanged revision is a defect (symmetric to §3's "repeating an identical attempt is forbidden").
- **`LOOP_REGISTRY.yaml`:** add two loops — `boundary-collision` (Critic) and `dependency-slice` (Discovery sub-loop of pre-flight) — with full metadata mirroring the existing entries. No existing loop entry changes semantics.

---

## 5. Workflow Changes (per-file, detailed)

| File | Change | Preserves |
|---|---|---|
| `preflight.md` | Emit Evidence Package (`ART-EVID-001`) and Dependency Context (`ART-DEPCTX-001`) as first-class G0 outputs; add "reuse if revision key matches" branch | All five G0 checks, SYNC-preflight-1 join |
| `repository-synchronization.md` | Its `ART-REPO-001..003` become the **body** of the Evidence Package; add digest stamping | Discovery loop, read-only guarantee, SYNC-repo-1 |
| `documentation.md` | Insert G1.5; replace full re-review with the §2.3 incremental loop; extend reviewer Context Packages to reference Evidence/Dependency Context | G2, G4, G6-doc; SYNC-doc-1/2; reviewer independence |
| `implementation.md` | Same G1.5 insertion; plan/reviewers consume Evidence Package | G3, G5 |
| `architecture/dependency/consistency/security/performance-review.md` | Reviewers consume Evidence Package + Context Package + previous findings; repository inspection limited to finding verification | Each review's `G4-*` component, Critic bound |
| `validation.md` | Re-validate only dimensions tied to changed sections (Correction Package driven) | G6 across mandatory dimensions |
| `boundary-collision.md` (**new**) | Pre-authoring conflict gate G1.5 | — |

---

## 6. Artifact Definitions

Each artifact declares: **Producer · Consumers · Cache key · Lifecycle · Invalidation · Reuse policy · Synchronization.** All use stable IDs (Constitution §15) and the workflow README prefix convention.

### 6.1 Boot Context — `ART-BOOT-001`
- **Producer:** Lead Architect (on framework boot, cache miss).
- **Contents:** distilled, referenceable index of Constitution articles, Source-of-Truth hierarchy, Review-Gate map (G0–G9 + owners + applicability), canonical finding schema, and Loop-Control policy pointers — as an index with digests, **not** full document copies.
- **Cache key:** `VERSION.yaml.current_version` (currently `1.1.0`).
- **Lifecycle:** session-durable; spans workflows within one framework version.
- **Invalidation:** framework version change; any constitutional change (Constitution §20).
- **Reuse:** every workflow, every specialist, references it. No specialist re-reads the constitution when Boot Context is valid.
- **Consumers:** all.

### 6.2 Evidence Package — `ART-EVID-001` (Repository Context)
- **Producer:** Lead Architect via `repository-synchronization` (owns `ART-REPO-001..003`).
- **Contents:** Repository State Record, protected-change list, source manifest/divergence report, plus digests of `MODULE_REGISTRY`, `DEPENDENCY_GRAPH`, `TERMINOLOGY`, `PROJECT_PROFILE`, `SYNC_STATE`.
- **Cache key:** `baseline_revision` (+ default-branch id).
- **Lifecycle:** revision-scoped; immutable while the worktree/HEAD is unchanged.
- **Invalidation:** exactly the `SYNC_STATE.yaml.context_invalidators` already declared (repository revision, default branch, architecture/ownership decision, terminology/rule change, contract/event/schema/package/consumer change).
- **Reuse:** every specialist consumes it instead of re-inspecting the repository (W2/W3). Direct inspection allowed only to verify a claim.
- **Consumers:** authors, all reviewers, validators, release manager.

### 6.3 Dependency Context — `ART-DEPCTX-<capability>`
- **Producer:** Lead Architect (from Dependency Reviewer's verified slice).
- **Contents:** the transitive `DEPENDENCY_GRAPH` slice for the capability — edges, state owners, consumed/published events — nothing outside the slice.
- **Cache key:** `baseline_revision` + capability id.
- **Lifecycle:** revision-scoped.
- **Invalidation:** contract/event/schema/package/consumer change touching the slice.
- **Reuse:** dependency review, architecture review, authoring, boundary collision.

### 6.4 Context Package — `ART-CTX-<role>`
- **Producer:** Lead Architect.
- **Contents (by reference only):** objective; applicable-rule pointers into Boot Context; Evidence Package pointer; Dependency Context slice; acceptance criteria; output contract. Exactly CLAUDE.md §Context Assembly's list, but as references + digests.
- **Cache key:** candidate version + role.
- **Invalidation:** any referenced digest changes.
- **Reuse:** re-issued on re-review only if the role is in the affected-reviewer union (§8.2).

### 6.5 Finding Package — `ART-FIND-PKG-001`
- **Producer:** Lead Architect (merges by `FIND-*` + severity, `REVIEWER_FINDINGS.md` §Merge).
- **Contents:** merged canonical findings across reviewers, with confidence/unknowns/limitations preserved.
- **Cache key:** candidate version.
- **Lifecycle:** candidate-version-scoped; superseded on version bump.
- **Reuse:** consumed by author (correction) and by validator; carries forward unchanged findings across cycles.

### 6.6 Correction Package — `ART-CORR-001`
- **Producer:** Author.
- **Contents:** changed-section list, new candidate version, and a findings-addressed map (`FIND-* → disposition`).
- **Cache key:** version transition `v(n)→v(n+1)`.
- **Reuse:** input to Affected-Reviewer Determination (§8.2) and to incremental validation.

### 6.7 Review Package — `ART-REV-PKG-<reviewer>`
- **Producer:** each reviewer.
- **Contents:** the reviewer's report bound to the exact candidate version + the sections examined + gate recommendation.
- **Cache key:** reviewer × candidate version.
- **Reuse:** on re-review, only the sections intersecting the Correction Package are re-examined; the rest of the package is carried forward.

---

## 7. Agent Responsibility Changes

No specialist boundary is collapsed or merged (Constitution §5 single responsibility; CLAUDE.md §Agent System "do not change the operating model"). Responsibilities are **clarified**, not moved:

| Agent | Added responsibility | Unchanged |
|---|---|---|
| Lead Architect | Produce/cache/invalidate Boot Context, Evidence Package, Dependency Context; run Boundary Collision gate; compute Affected-Reviewer union | Never performs specialist reviews; merges findings without changing judgment |
| Each Reviewer | Consume Evidence Package + previous findings; **inspect repository only to verify a finding**; emit a Review Package | Independence (no peer conclusions pre-SYNC), canonical finding shape, Critic bound |
| Author (Module Author / engineer) | Emit a Correction Package per correction iteration | Cannot approve own blocking finding; version bump on semantic edit |
| Validator | Re-validate only Correction-Package-affected dimensions | G6 mandatory-dimension coverage |

New capability entries (in `CAPABILITY_REGISTRY.yaml`): `boundary-collision-detection` (Lead Architect), `evidence-package-production` (Lead Architect). No new *agent contract file* is required — these are Lead-Architect orchestration duties already implied by Constitution §17 ("maintains indexes and assembles context").

---

## 8. Review Workflow Changes

### 8.1 Reviewers consume, verify — not rediscover
Independent Review Protocol (`REVIEW_GATES.md`) step 1 already freezes the input. Add step 1b: *"Load the Evidence Package and Context Package for the frozen input; use them as the discovered context. Repository inspection is permitted only to verify a specific finding."* Steps 2–7 (independent dispatch, no peer conclusions, merge by ID, return, re-review, validate) are unchanged.

### 8.2 Affected-Reviewer Determination (new deterministic rule)
Given a Correction Package with changed sections `S`, reviewer `R` reruns **iff** `domain(R) ∩ sections-touching(S) ≠ ∅`, where `domain(R)` comes from `REVIEW_GATES.md` §Applicability Rules (e.g., a terminology-only edit → Consistency Reviewer reruns; Security/Performance carry prior `PASS` forward; an auth-flow edit → Security reruns). The rule is deterministic, auditable, and defaults **conservatively**: if section→domain mapping is `unknown`, the reviewer **reruns** (never a silent skip; consistent with `LOOP_CONTROL.md` "`Unknown` is never a terminal success").

### 8.3 Governance invariants explicitly preserved
- Authoring ≠ reviewing (Constitution §12).
- Author cannot approve own blocking finding.
- Critical/High unresolved → blocks merge; exceptions need a time-bounded Risk Assessment + human (Constitution §12, `REVIEW_GATES.md` §Merge Policy).
- Confidence thresholds and the four gate statuses (`PASS`/`PASS_WITH_ACTIONS`/`FAIL`/`BLOCKED`) unchanged.
- Reviewer independence pre-SYNC unchanged.

---

## 9. Context Package Design

The Context Package is redefined from *"a bundle of copied text"* to *"a manifest of references + digests."* Concretely, `ART-CTX-<role>` is:

```
objective:            <verbatim, 1 paragraph>
rules:                ref → ART-BOOT-001 §<articles>        # pointer, not text
repository_evidence:  ref → ART-EVID-001 @<baseline_revision>
dependency_slice:     ref → ART-DEPCTX-<capability>
frozen_input:         ref → ART-SPEC-001 v<n> (immutable)
prior_findings:       ref → ART-FIND-PKG-001 (re-review only)
acceptance_criteria:  <ids only>
output_contract:      <finding schema ref → ART-BOOT-001>
digests:              { each ref : sha }                    # invalidation keys
```

A specialist expands a reference to full text **only if** it must verify a specific claim against it — the default is to trust the revision-bound digest. This is the mechanism that converts Constitution §17's *aspiration* ("path-and-line evidence over repeated full documents") into an *enforced artifact shape*.

---

## 10. Cache Strategy

Three cache scopes, keyed by the natural immutability boundary of each artifact:

| Scope | Key | Artifacts | Hit condition |
|---|---|---|---|
| **Framework-version** | `VERSION.yaml.current_version` | Boot Context | key matches current framework version |
| **Revision** | `baseline_revision` (+ default branch) | Evidence Package, Dependency Context | worktree/HEAD unchanged and no `context_invalidator` fired |
| **Candidate-version** | candidate `vX.Y` | Finding Package, Review Package, Correction Package, Context Package | candidate version unchanged for that role/section |

- Keys are **content-addressed** (git revision, blob sha, framework version string) — deterministic, no heuristic staleness.
- Cache is **advisory and reconstructable**: a miss simply re-runs the existing producing workflow, so the platform degrades to today's behavior with zero correctness risk (governance-safe).
- Caches store **only identified, revision-bound summaries** — exactly Constitution §17's existing rule ("Cache only identified, revision-bound summaries. Invalidate them when sources change").

---

## 11. Invalidation Strategy

Invalidation is **declarative and already half-specified** — `SYNC_STATE.yaml.context_invalidators` lists the triggers. This proposal binds each trigger to the caches it invalidates:

| Invalidator (from `SYNC_STATE.yaml`) | Invalidates |
|---|---|
| repository revision changes | Evidence Package, Dependency Context, all candidate-version caches derived from them |
| default branch changes | Evidence Package |
| architecture or ownership decision | Evidence Package, Boundary-Collision result, affected Dependency Context |
| canonical terminology or business-rule change | Boot Context (if constitutional), Consistency-domain review packages |
| contract / event / schema / package / consumer change | Dependency Context slice(s) touching the edge; Dependency/Architecture review packages |
| framework version change (**new**) | Boot Context |

**Rules:** (1) invalidation **cascades downstream only** (Evidence → Context Package → Review Package), never upstream; (2) a partial invalidation (one edge) invalidates only the intersecting slice, not the whole Evidence Package (this is what makes W6/W4 savings real); (3) on **any** uncertainty about whether an invalidator fired, the artifact is treated as **stale** and reproduced (fail-safe, matching the conservative-default philosophy of §8.2).

---

## 12. Synchronization Strategy

- **Producers own invalidation.** The Lead Architect (owner of Evidence/Boot/Dependency Context) is the single writer that stamps and invalidates them — consistent with Constitution §7 "state has one authoritative writer" and §19 "update canonical source first, then dependents, indexes."
- **`SYNC_STATE.yaml` gains a `cache_state` block** recording, per artifact, its key and last-valid revision/version — a machine-readable record so the next session reuses rather than rediscovers (Constitution §17 "End each handoff with an evidence manifest so the next agent need not rediscover context").
- **Synchronization points unchanged.** SYNC-doc-1, SYNC-doc-2, SYNC-preflight-1, SYNC-repo-1 keep their join semantics; the artifacts flowing across them are now references, not copies.
- **Post-flight** additionally records final cache validity so a follow-up session inherits warm, revision-bound context.

---

## 13. Token Impact Analysis

Modeled on one representative documentation cycle (author + 5 applicable reviewers + 1 correction round + validation) — the shape exercised by SYNC-008/009/010/011.

**Assumptions** (order-of-magnitude, from observed file sizes: constitution set ≈ 6–10 KB each; registries ≈ 2–8 KB; a module spec ≈ large). Units are relative "context loads," not exact tokens.

| Cost center | Today | Proposed | Basis |
|---|---|---|---|
| Boot policy | re-read per agent (≈7 agents × full constitution set) | 1× produce + 6× reference | W1 → Boot Context |
| Repository discovery | re-derived per workflow + partially per reviewer (≈6×) | 1× Evidence Package + 5× reference | W2/W3 |
| Dependency graph | full-graph reads across reviewers | 1× slice + references | W6 |
| Correction round | re-author + **all 5** reviewers rerun | changed sections + **affected subset** (~1–2 reviewers) | W4/§8.2 |
| Boundary conflicts (SYNC-001/005/010/011 class) | full author→5-review cycle then FAIL | stopped at G1.5 before authoring | W5 |

**Estimated reduction:**
- **Boot + discovery reuse alone:** ~35–50% on the first pass (the 6–7 redundant full re-reads of policy + repository truth collapse to references).
- **Incremental correction:** each correction round drops from "5 reviewers + full re-author" to "~1–2 reviewers + changed sections" — on correction-heavy cycles (the common case, given the retry bound is 3), this compounds to **an additional 20–40%** on rounds 2–3.
- **Boundary collision:** eliminates the entire author+review budget for the ownership-conflict class outright (100% of that wasted cycle), which the live `SYNC_STATE.yaml` shows is not hypothetical.
- **Blended estimate:** **45–65%** total-token reduction on a representative multi-review, one-correction cycle; higher on conflict or multi-correction cycles.

**Confidence:** Medium. The reduction *direction and mechanism* are High-confidence (they remove literally repeated reads, provable from the workflow files). The *magnitude* is Medium because exact token counts depend on model context behavior and are not instrumented in-repo (Unknown; would be confirmed by the Learning loop measuring real cycles post-adoption).

---

## 14. Migration Plan

Strictly additive; mirrors the 1.0.0→1.1.0 additive precedent (SYNC-007, CHANGELOG). No breaking change; the platform degrades gracefully to current behavior on any cache miss.

**Phase 0 — Decision Record (Constitution §20).** Author ADR "Context-Artifact Reuse Architecture" (problem, alternatives, compatibility, migration). Human approval required.

**Phase 1 — Canonical policy (constitution/).** Add `LOOP_CONTROL.md` §7–§8; extend Constitution §17 with the artifact vocabulary (no rule removed). Consistency + Architecture review; human ratification.

**Phase 2 — Artifact definitions & registries.** Add the seven prefixes to `workflows/README.md`; add `boundary-collision` + `dependency-slice` to `LOOP_REGISTRY.yaml`; add capabilities to `CAPABILITY_REGISTRY.yaml`; add `cache_state` block to `SYNC_STATE.yaml`.

**Phase 3 — Workflow files.** Add `boundary-collision.md`; edit preflight/repository-synchronization/documentation/implementation/review/validation per §5. Each edit runs the platform's own documentation workflow (dogfooding).

**Phase 4 — CLAUDE.md.** Boot Sequence step 0 + Context Assembly references.

**Phase 5 — Validation & version bump.** Full independent review of the changed framework; `VERSION.yaml` → 1.2.0; FRAMEWORK_RELEASE_NOTES + CHANGELOG. No consumer of the framework must change anything: absent Boot/Evidence caches, workflows produce them on first use.

**Backward compatibility:** every new artifact has a defined producing workflow; a session that ignores caches behaves exactly as 1.1.0. Reversible: deleting the cache_state block and the two new workflow stages returns to 1.1.0 semantics with no data loss.

---

## 15. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| RISK-01 | **Stale cache serves outdated truth** (correctness) | High | Content-addressed keys (revision/version/sha); fail-safe reproduction on any invalidation uncertainty (§11 rule 3); caches are advisory and reconstructable (§10) |
| RISK-02 | **Evidence reuse erodes reviewer independence** (governance) | High | Reuse is of *evidence*, never of peer *conclusions*; pre-SYNC independence rule unchanged (§2.4, §8.1); reviewers still receive only the immutable candidate |
| RISK-03 | **Affected-Reviewer rule skips a reviewer that should rerun** (governance) | High | Conservative default: unknown section→domain mapping forces rerun (§8.2); Critical/High still block merge regardless |
| RISK-04 | **Boundary Collision produces false positives**, stalling valid work | Medium | It emits canonical findings with confidence + a human escalation path; a Low-confidence collision routes to human, not an auto-stop of legitimate work |
| RISK-05 | **Cache-state desync across sessions** | Medium | Single authoritative writer (Lead Architect, §12); `SYNC_STATE.yaml.cache_state` is the one record; post-flight reconciles |
| RISK-06 | **Added artifact vocabulary raises platform complexity** | Low | Definitions are additive and referenced-once (same discipline the platform already uses for LOOP_CONTROL); no operating-model change |
| RISK-07 | **Magnitude of savings unproven** | Low | Learning loop instruments real cycles post-adoption; direction is proven, magnitude is an open measurement (§13 Unknown) |

No risk touches a security control, gate status, or merge policy — all mitigations keep governance strictly intact.

---

## 16. Rollout Plan

1. **Ratify** (human): ADR + constitutional additions (Phase 0–1). Gate: G4 architecture/consistency + human §20 approval.
2. **Land registries + definitions** (Phase 2): no runtime behavior change yet; pure vocabulary. Gate: consistency review.
3. **Enable Boot Context + Evidence Package first** (Phase 3, highest-value/lowest-risk — pure read-caching of immutable inputs). Observe one full real workflow (e.g., the next module spec) with the Learning loop measuring token deltas.
4. **Enable Boundary Collision** (Phase 3): shadow-mode first (report conflicts without stopping) for one cycle, then enforce G1.5. Validates RISK-04 before it can stall work.
5. **Enable incremental correction + Affected-Reviewer rule** (Phase 3): the governance-sensitive step. Run **parallel** to full re-review for one correction cycle and diff the finding sets; enforce only after the incremental set is proven ⊇ the findings the full rerun would have caught (validates RISK-02/03).
6. **Version bump to 1.2.0** (Phase 5) after all gates pass and the Learning loop records the first measured reduction.
7. **Post-adoption:** Learning loop (`IMPROVEMENT_LOG.yaml`) tracks realized token reduction and any missed-reviewer incidents; either feeds a §20 refinement.

Rollback at any step: disable the stage/cache; platform reverts to 1.1.0 semantics with no artifact loss.

---

## Validation — Independent Reviews of This Proposal

Per the workflow's mandate to run independent reviews, merge findings, and apply corrections until no architectural issue remains. Reviews conducted against this frozen proposal `v0.1`; findings use the canonical shape (`REVIEWER_FINDINGS.md`); dispositions applied in this same version where author-fixable.

**FIND-01 · Architecture · Medium · High confidence.** Initial draft added new *agent contract files* for boundary detection, risking an operating-model change (CLAUDE.md §Agent System forbids it). *Disposition: fixed* — §7 assigns boundary/evidence duties to the existing Lead Architect contract; no new agent. **Resolved.**

**FIND-02 · Governance · High · High confidence.** Evidence reuse could be read as letting reviewers share context that erodes independence. *Disposition: fixed* — §2.4/§8.1 make explicit that reuse is of revision-bound *evidence* only; pre-SYNC independence and "immutable candidate only" are preserved verbatim. **Resolved (RISK-02 tracks residual).**

**FIND-03 · Governance/Correctness · High · Medium confidence.** The Affected-Reviewer rule could silently skip a reviewer that should rerun. *Disposition: fixed* — §8.2 conservative default (unknown mapping ⇒ rerun) + rollout step 5 proves the incremental finding set ⊇ full-rerun set before enforcement. **Resolved as bounded (RISK-03).**

**FIND-04 · Token-Optimization · Medium · Medium confidence.** Savings magnitude was stated too confidently. *Disposition: fixed* — §13 downgraded magnitude to Medium confidence with an explicit Unknown and a Learning-loop measurement plan. **Resolved.**

**FIND-05 · Knowledge-Consistency · Low · High confidence.** New artifact instances risk violating Knowledge Separation (framework vs project). *Disposition: fixed* — §3 clarifies definitions live in `.claude/` (framework), instances are revision-bound runtime state recorded in `SYNC_STATE.yaml`. **Resolved.**

**FIND-06 · Performance · Note · High confidence.** Cache-miss path must not be slower than today. *Disposition: no change needed* — a miss re-runs the existing producing workflow unchanged (§10); worst case equals current behavior. **Closed.**

**FIND-07 · Workflow · Medium · High confidence.** Inserting G1.5 must not renumber or skip existing gates. *Disposition: fixed* — G1.5 is inserted as a named sub-gate between G1 and authoring; G0–G9 numbering and ownership are untouched (§2.1, §5). **Resolved.**

**Merged result:** 0 open Critical/High findings; all High findings resolved or bounded with a rollout validation step and a tracked risk. Remaining items (RISK-02/03/07) are dispositioned as **tracked, gated-before-enforcement** actions, not blockers to *proposing* the redesign. Terminal review state: **PASS_WITH_ACTIONS** — the actions are the rollout validation steps (§16 steps 4–5) and the Learning-loop measurement, all owned and time-bound to their phase.

**Gate status of this proposal:** documentation artifact, `REVIEW`-complete, **not frozen** — freeze (G2) and the constitutional additions require human approval (Constitution §20). This document proposes; it does not implement.
