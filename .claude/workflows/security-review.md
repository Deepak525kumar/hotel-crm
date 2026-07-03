# Security Review Workflow

## Purpose

Independently assess security and privacy risk introduced or affected by a frozen candidate before it is approved.

## Entry Conditions

Review input version is frozen; data flows, trust boundaries, dependency report, and security policy/checklist are available; reviewer did not author input.

## Exit Conditions

All checklist criteria are evaluated; findings are resolved or block progress; security review status and residual risk are recorded.

## Participating Agents

Security Reviewer (owner); author for fixes; Dependency/Infrastructure agents for facts; Lead Architect for context/triage; human for risk acceptance.

## Execution Order

1. Confirm immutable input and applicable security policy.
2. Map changed attack surface, trust boundaries, sensitive data, and identity/permission model.
3. Execute security checklist.
4. Model relevant threats and abuse cases.
5. Record independent findings with required controls.
6. Author resolves accepted findings.
7. Re-review changed/affected criteria and issue final recommendation.

## Parallel Activities

May run alongside architecture, dependency, consistency, and performance reviews against the same candidate; initial conclusions remain independent.

## Validation Gates

Security component of G4 passes with no unresolved critical/high finding and no undocumented accepted residual risk.

## Escalation Conditions

Critical/high issue, active exposure, secret leakage, legal/privacy uncertainty, requested risk acceptance, or missing security authority.

## Artifacts Produced

Security Review, checklist record, threat/abuse-case summary, finding/disposition log, residual-risk statement, Risk Assessment request where needed.

## Failure Handling

Return findings to author; do not edit the artifact and never include secrets or sensitive payloads in evidence. Semantic fixes create a new candidate version and impact-based re-review.

## Restart Conditions

Restart full review after attack-surface/trust-boundary/data-classification changes; otherwise restart affected checklist sections.
