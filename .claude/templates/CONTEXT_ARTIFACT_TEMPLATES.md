# Context Artifact Templates

Fill-in shapes for the reusable Context Artifacts. Canonical definitions (owner, lifecycle, cache key, invalidation, reuse) live in [../constitution/CONTEXT_ARTIFACTS.md](../constitution/CONTEXT_ARTIFACTS.md); these templates only give the recording form. Every instance uses stable IDs (Constitution §15) and records a `baseline_revision` or candidate version.

---

## Boot Context — `ART-BOOT-001`

```
artifact: ART-BOOT-001
framework_version: <VERSION.yaml.current_version>
produced_at: <ISO-8601 or revision>
policy_index:
  constitution:      { source: constitution/ENGINEERING_CONSTITUTION.md, digest: <sha>, articles: [..] }
  source_of_truth:   { source: constitution/SOURCE_OF_TRUTH.md, digest: <sha> }
  review_gates:      { source: constitution/REVIEW_GATES.md, digest: <sha>, gates: [G0..G9, G1.5] }
  reviewer_findings: { source: constitution/REVIEWER_FINDINGS.md, digest: <sha> }
  loop_control:      { source: constitution/LOOP_CONTROL.md, digest: <sha> }
  context_artifacts: { source: constitution/CONTEXT_ARTIFACTS.md, digest: <sha> }
valid: true          # false ⇒ reproduce
invalidated_by: [framework version change, constitutional change]
```

## Evidence Package — `ART-EVID-001`

```
artifact: ART-EVID-001
baseline_revision: <HEAD sha>
default_branch: <name>
body:
  repository_state:   ART-REPO-001
  protected_changes:  ART-REPO-002
  source_manifest:    ART-REPO-003
index_digests:
  module_registry:    <sha>
  dependency_graph:   <sha>
  terminology:        <sha>
  project_profile:    <sha>
  canonical_indexes:  { specification: <sha>, boundary: <sha>, ownership: <sha>, contract: <sha>, api: <sha>, state_ownership: <sha> }
valid: true
invalidated_by: [repository revision, default branch, architecture/ownership decision, terminology/rule change, contract/event/schema/package/consumer change]
```

## Dependency Context — `ART-DEPCTX-<capability>`

```
artifact: ART-DEPCTX-<capability>
baseline_revision: <HEAD sha>
capability: <capability id or module set>
slice:
  nodes: [..]        # only nodes in the transitive slice
  edges: [..]        # only edges the capability touches
  state_domains: [..]
source: DEPENDENCY_GRAPH.yaml @<sha>
verified_by: dependency-review   # slice verified, not rediscovered downstream
valid: true
invalidated_by: [contract/event/schema/package/consumer change touching the slice]
```

## Context Package — `ART-CTX-<role>`

```
artifact: ART-CTX-<role>
role: <specialist role>
candidate: <artifact id> v<n>
objective: <one paragraph>
rules:               ref → ART-BOOT-001 §<articles>
repository_evidence: ref → ART-EVID-001 @<baseline_revision>
dependency_slice:    ref → ART-DEPCTX-<capability>
module_memory:       ref → ART-MEM-<module>   # if applicable
prior_findings:      ref → ART-FIND-PKG-001   # re-review only
acceptance_criteria: [<ids>]
output_contract:     ref → ART-BOOT-001 (finding schema)
digests: { <ref>: <sha>, .. }
```

## Finding Package — `ART-FIND-PKG-001`

```
artifact: ART-FIND-PKG-001
candidate: <artifact id> v<n>
merged_from: [ART-ARCH-REV-001, ART-DEP-REV-001, ART-CONS-REV-001, ART-SEC-REV-001, ART-PERF-REV-001]
findings:            # canonical shape per REVIEWER_FINDINGS.md, merged by FIND-* + severity
  - { id: FIND-001, severity: .., evidence: .., confidence: .., unknowns: .., limitations: .., required_outcome: .. }
```

## Correction Package — `ART-CORR-001`

```
artifact: ART-CORR-001
transition: v<n> → v<n+1>
changed_sections: [<section ids/anchors>]
findings_addressed: { FIND-001: fixed, FIND-002: accepted-risk (RISK-001), .. }
affected_reviewer_union: [<roles whose domain intersects changed_sections>]   # per REVIEW_GATES Incremental Re-review
carried_forward: [<roles carrying prior PASS unchanged>]
```

## Review Package — `ART-REV-PKG-<reviewer>`

```
artifact: ART-REV-PKG-<reviewer>
reviewer: <role>
candidate: <artifact id> v<n>
sections_examined: [<section ids>]
gate_recommendation: PASS | PASS_WITH_ACTIONS | FAIL | BLOCKED
findings: [FIND-*]      # canonical shape
independence: declared  # peers' conclusions not read before merge sync
```

## Module Memory — `ART-MEM-<module>`

```
artifact: ART-MEM-<module>
module: <module id>
freeze_revision: <sha>
spec: <ART-SPEC id> v<X.Y.Z> (FROZEN)
summary:
  boundary: <one-line responsibility>
  owned_state: [<state domains>]
  owned_contracts: [<contract ids>]
  interfaces: [<public interfaces>]
  key_rules: [RULE-*]
authority: corroborating   # never authoritative over current repository truth
invalidated_by: [new frozen spec for module, owned-state/contract change]
```
