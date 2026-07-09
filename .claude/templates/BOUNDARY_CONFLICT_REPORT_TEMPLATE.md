# Boundary Conflict Report — `ART-BOUNDARY-001`

Produced by the Lead Architect at gate **G1.5** ([boundary-collision](../workflows/boundary-collision.md)) when a scoped change collides with existing ownership before authoring. Findings use the canonical shape ([../constitution/REVIEWER_FINDINGS.md](../constitution/REVIEWER_FINDINGS.md)). On any collision, authoring **does not start**; the report escalates to human ownership authority (Constitution §7).

```
report: ART-BOUNDARY-001
gate: G1.5
owner: Lead Architect
baseline_revision: <sha>
scoped_change: <objective / affected modules>
evidence_package: ref → ART-EVID-001 @<sha>
indexes_consulted: [OWNERSHIP_INDEX, BOUNDARY_INDEX, CONTRACT_INDEX, API_INDEX, STATE_OWNERSHIP_INDEX]
independence: n/a (pre-authoring; no specialist review yet)
```

## Collision Dimensions Evaluated

| Dimension | Source index | Collision? | Evidence |
|---|---|---|---|
| Responsibilities | BOUNDARY_INDEX | yes/no | <module + existing owner> |
| Owned state | STATE_OWNERSHIP_INDEX | yes/no | <state domain + authoritative writer> |
| Business rules | BOUNDARY_INDEX / spec | yes/no | <RULE-* authority> |
| Interfaces | API_INDEX | yes/no | <interface + owner> |
| Contracts | CONTRACT_INDEX | yes/no | <contract id + owner_module> |
| APIs | API_INDEX | yes/no | <route + owning module> |
| State ownership | STATE_OWNERSHIP_INDEX | yes/no | <domain + authoritative_writer or UNKNOWN> |

## Findings (canonical shape)

```
- Finding ID:      FIND-<n>
  Severity:        Critical | High | Medium | Low | Note
  Evidence:        <index path + entry, DEPENDENCY_GRAPH edge, revision>
  Impact:          <which ownership rule/boundary is violated (Constitution §7)>
  Recommendation:  <ownership decision needed; do not author until resolved>
  Confidence:      High | Medium | Low
  Unknowns:        <e.g., authoritative_writer UNKNOWN> | none
  Limitations:     <index staleness, scope> | none
  Required Outcome: human ownership decision | scope narrowing | approved coupling Decision Record
```

## Gate Result

```
status: PASS | FAIL | BLOCKED | NOT_APPLICABLE
# PASS/NOT_APPLICABLE → authoring authorized
# FAIL/BLOCKED → STOP before authoring; escalate to human (Constitution §7/§18)
next_action: <authorize authoring | escalate conflict with decision request>
```
