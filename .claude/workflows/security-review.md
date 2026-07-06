# Security Review Workflow

## Loop Metadata

- **Loop type:** Critic ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §1).
- **Objective:** Independently assess security and privacy risk introduced or affected by a frozen candidate before approval.
- **Metric:** All applicable security-checklist criteria evaluated; security component of G4 and residual risk recorded.
- **Boundary:** One immutable candidate version; the reviewer does not edit and never records secrets; semantic fix creates a new version and impact-based re-review, at most three cycles (§3).
- **Retry policy:** Restart affected checklist sections after fixes; full restart on attack-surface/trust-boundary/data-classification change ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §3).
- **Escalation policy:** See Escalation Conditions; Constitution §18.
- **Termination:** Success, Failure, or Blocked ([LOOP_CONTROL.md](../constitution/LOOP_CONTROL.md) §4).
- **Success condition:** No unresolved critical/high finding and no undocumented accepted residual risk.
- **Failure condition:** Critical/high issue, active exposure, secret leakage, or missing security authority → escalate; findings never downgraded for schedule.
- **Confidence threshold:** `High` for any blocking finding.

## Purpose

Independently assess security and privacy risk introduced or affected by a frozen candidate before it is approved.

## Entry Conditions

Review input version is frozen; data flows, trust boundaries, dependency report, and security policy/checklist are available; reviewer did not author input.

## Exit Conditions

All checklist criteria are evaluated; findings are resolved or block progress; security review status and residual risk are recorded.

## Participating Agents

Security Reviewer (owner); author for fixes; Dependency/Infrastructure agents for facts; Lead Architect for context/triage; human for risk acceptance.

## Execution Graph

```
Lead Architect (dispatch)
  ↓ immutable ART-SPEC-001 v0.n (or diff) + data flows + trust boundaries + ART-DEP-REV-001 + security policy
Security Reviewer — confirm immutable input; map changed attack surface, trust boundaries, sensitive data, identity/permission model
  ↓
Security Reviewer — execute security checklist
  ↓
Security Reviewer — model relevant threats and abuse cases
  ↓
Security Reviewer — record independent findings with required controls (never including secrets)
  ↓ ART-SEC-REV-001 v0.n (checklist record + threat/abuse-case summary + findings + residual-risk statement + Risk Assessment request where needed)
Author — resolve accepted findings; produce new candidate version
  ↓ ART-SPEC-001 v0.n+1
Security Reviewer — re-review changed/affected criteria (impact-based)
  ↓ (repeat; retry bound: 3 cycles)
Lead Architect — record security component of G4; route Risk Assessment to human authorizer where requested
```

## Execution Order

1. Confirm immutable input and applicable security policy.
2. Map changed attack surface, trust boundaries, sensitive data, and identity/permission model.
3. Execute security checklist.
4. Model relevant threats and abuse cases.
5. Record independent findings with required controls.
6. Author resolves accepted findings.
7. Re-review changed/affected criteria and issue final recommendation.

## Agent I/O Contracts

### Security Reviewer

- **Inputs:** Immutable `ART-SPEC-001` v0.n (or frozen diff); data flows; trust boundaries; `ART-DEP-REV-001` (external dependencies); security policy/checklist; sensitive-data classifications.
- **Outputs:** `ART-SEC-REV-001` — checklist record + threat/abuse-case summary + findings per canonical schema (no secrets in evidence) + residual-risk statement + gate recommendation bound to the reviewed version + Risk Assessment request when needed.
- **Next Consumer:** Lead Architect (G4 merge); author (correction); human authorizer (risk acceptance).

### Dependency Reviewer / Infrastructure Engineer (consulted)

- **Inputs:** Specific package/topology facts requested by Security Reviewer.
- **Outputs:** Fact confirmation referenced by `ART-SEC-REV-001` (no independent judgment).
- **Next Consumer:** Security Reviewer.

### Author (correction step)

- **Inputs:** Only accepted `ART-SEC-REV-001` findings and required controls.
- **Outputs:** Revised `ART-SPEC-001` v0.n+1 with dispositions.
- **Next Consumer:** Security Reviewer (impact-based re-review).

### Lead Architect

- **Inputs:** Final `ART-SEC-REV-001`.
- **Outputs:** Security component of G4; Risk Assessment routed to human authorizer where the reviewer requested it.
- **Next Consumer:** Parent workflow's G4 record; human authorizer for accepted-risk decisions.

## Artifact Handoffs

| Artifact ID | Producer | Consumes | Produces | Next Consumer |
|---|---|---|---|---|
| `ART-SEC-REV-001` (v0.n) | Security Reviewer | immutable candidate + data flows + `ART-DEP-REV-001` + policy | checklist + threat summary + findings + residual risk + Risk Assessment request | Lead Architect (G4); author (fixes); human (risk acceptance) |
| Revised candidate | Author | `ART-SEC-REV-001` findings | new version + dispositions | Security Reviewer (re-review) |
| G4-security record | Lead Architect | final `ART-SEC-REV-001` | security component of G4 + Risk Assessment routing | Parent workflow's G4 record; human authorizer |

## Synchronization Points

- Parent-workflow join: `SYNC-doc-1` (for documentation-scoped reviews) or the equivalent join in the dispatching workflow. Security Reviewer submits `ART-SEC-REV-001` independently and does not wait for other reviewers.
- Retry-cycle re-review starts only after the author produces `ART-SPEC-001` v0.n+1.

## Context Packages

### Security Reviewer receives

- Immutable candidate at the exact reviewed version.
- Data-flow and trust-boundary evidence.
- `ART-DEP-REV-001` slice for external dependencies within the changed attack surface.
- Sensitive-data classifications; identity/permission model.
- Security policy and checklist.
- Explicit exclusion of secrets, sensitive payloads, and other reviewers' in-flight findings.

### Dependency Reviewer / Infrastructure Engineer receives (consulted step)

- Only the specific fact question asked (package version, topology detail); no scope creep.

### Author receives (correction step)

- Only accepted `ART-SEC-REV-001` findings and required controls with safe redaction where applicable.

## Status Report

Emit the canonical `STATUS` shape from [README.md](README.md#canonical-status-shape) with:

- `Workflow: security-review`
- `Current Gate: G4-security`
- `Current Agent: Security Reviewer` (or author during correction).
- `Completed`: closed `ART-SEC-REV-001` versions.
- `Waiting On`: revised candidate; human risk decision; consulted specialist fact.
- `Blockers`: critical/high issue; active exposure; secret leakage; missing security authority.
- `Next Action`: re-review, Risk Assessment routing, or G4 record.

## Parallel Activities

May run alongside architecture, dependency, consistency, and performance reviews against the same candidate; initial conclusions remain independent.

## Validation Gates

Security component of G4 passes with no unresolved critical/high finding and no undocumented accepted residual risk.

### Required Inputs → Produced Outputs

- **G4-security** inputs: final `ART-SEC-REV-001` with checklist evidence, threat/abuse-case summary, findings, and residual-risk statement bound to the reviewed candidate version.
- **G4-security** outputs: security-component gate status; Risk Assessment routed to human authorizer where the reviewer requested it; findings merged into the parent workflow's G4 record.

## Escalation Conditions

Critical/high issue, active exposure, secret leakage, legal/privacy uncertainty, requested risk acceptance, or missing security authority.

## Artifacts Produced

Security Review, checklist record, threat/abuse-case summary, finding/disposition log, residual-risk statement, Risk Assessment request where needed.

## Failure Handling

Return findings to author; do not edit the artifact and never include secrets or sensitive payloads in evidence. Semantic fixes create a new candidate version and impact-based re-review.

## Restart Conditions

Restart full review after attack-surface/trust-boundary/data-classification changes; otherwise restart affected checklist sections.
