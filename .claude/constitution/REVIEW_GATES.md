# Review Gates

## Gate Model

Every gate returns exactly one status:

- `PASS` — all mandatory criteria satisfied with evidence.
- `PASS_WITH_ACTIONS` — no blocking defect; named non-blocking actions have owners and due points.
- `FAIL` — at least one blocking criterion failed.
- `BLOCKED` — required evidence, authority, environment, or decision is unavailable.
- `NOT_APPLICABLE` — applicability rule is demonstrably false.

Unknown is never equivalent to pass. Gate reports identify reviewer, input revision/version, checks, evidence, findings, and status. Findings use the canonical shape in [REVIEWER_FINDINGS.md](REVIEWER_FINDINGS.md); iteration and termination follow [LOOP_CONTROL.md](LOOP_CONTROL.md).

## Gate Ownership

Each gate separates three distinct roles so accountability is never ambiguous:

- **Evidence producer** — the agent whose work generates the gate's mandatory evidence (e.g., a reviewer, engineer, or validator). May not decide the gate on their own authored artifact.
- **Gate owner** — the single role in the table below accountable for evaluating the evidence and recording the gate status. The owner does not author the evidence they judge for blocking findings.
- **Authorizer** — the human (or, for G2/G8, the named human approver) who ratifies decisions reserved to human authority.

The Owner column names the gate owner. Where the owner and evidence producer would otherwise coincide (e.g., an engineer's own implementation verification at G5), the independent check at the next gate (G6) is the authoritative confirmation. No role approves its own blocking finding (Constitution §12).

## Lifecycle Gates

| Gate | Required before | Owner | Mandatory evidence |
|---|---|---|---|
| G0 Pre-flight | Any task work | Lead Architect | synchronized repo state, drift checks, scope, context manifest |
| G1 Requirements | Specification authoring | Requirements Analyst | confirmed requirements, unknowns resolved or excluded |
| G2 Specification Freeze | Implementation planning | Human approver | versioned spec, acceptance criteria, approval record |
| G3 Plan Review | Code changes | Implementation Planner | mapped tasks, risks, validation, rollback |
| G4 Independent Reviews | Approval of docs/code | Applicable reviewers | architecture, dependency, consistency, security/performance findings |
| G5 Implementation Verification | Final validation | Implementing engineer | mapped diff, local checks, implementation evidence |
| G6 Quality Validation | Merge readiness | Documentation/Architecture Validator and QA | complete validation report and test evidence |
| G7 Merge Readiness | Merge | Lead Architect | all applicable gates, synchronized knowledge/docs, no blocking findings |
| G8 Release Readiness | Release authorization | Release Manager + human | immutable revision, release/rollback plan, operational verification |
| G9 Post-flight | Task closure | Lead Architect | synchronization record and future actions |

## Applicability Rules

- **Architecture review:** module boundary, ownership, state, public contract, infrastructure topology, architectural pattern, or constitutional change.
- **Dependency review:** package change or any module/API/event/schema/shared-contract edge change.
- **Consistency review:** all documentation, specification, terminology, shared rule, or cross-module changes.
- **Security review:** authn/authz, secrets, personal/sensitive data, untrusted input, external exposure, dependency, infrastructure, logging, cryptography, or tenant boundary.
- **Performance review:** data volume, hot path, query, cache, concurrency, batch, network, rendering, startup, or explicit SLO impact.
- **Documentation validation:** every frozen specification and every behavior/interface change.
- **Architecture validation:** every implementation that invokes architecture review.
- **QA:** every behavior change; `NOT_APPLICABLE` requires evidence that behavior cannot change.

## Severity and Disposition

| Severity | Definition | Gate effect |
|---|---|---|
| Critical | Exploitable security/safety issue, data loss, unrecoverable release, or constitutional violation | Immediate `FAIL` |
| High | Requirement failure, breaking contract, ownership/architecture violation, or no viable rollback | `FAIL` |
| Medium | Material quality, maintainability, coverage, or operational weakness | Fix or approved action before merge |
| Low | Local improvement with bounded impact | May become tracked action |
| Note | Non-actionable observation | No effect |

Every actionable finding has an ID, evidence, violated criterion, impact, required correction, owner, and status. `Accepted risk` requires a Risk Assessment, expiry/review date, and authorized human.

## Independent Review Protocol

1. Freeze and identify the review input.
2. Dispatch architecture, dependency, consistency, security, and performance reviews independently where applicable.
3. Reviewers do not read one another’s conclusions before submitting initial findings.
4. Merge duplicate findings without losing evidence or severity.
5. Return findings to the author for correction.
6. Re-review changed areas and regression risk.
7. Run independent validation.

## Merge Policy

Merge is allowed only when:

- G0–G7 applicable gates are `PASS` or authorized `PASS_WITH_ACTIONS`;
- no critical/high finding is open;
- medium findings are resolved or explicitly accepted;
- required tests and static checks pass at the candidate revision;
- specs, code, tests, dependency graph, module registry, terminology, and decisions agree;
- migrations and rollback are validated where applicable;
- user-owned unrelated changes are not included;
- approval and evidence are recorded.

Administrative urgency does not alter technical gate results.
