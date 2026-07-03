# Documentation Workflow

## Purpose

Author, independently review, validate, and freeze an authoritative specification or engineering document.

## Entry Conditions

G0 passes; G1 passes for behavior-bearing documents; owner, template, and target authority are known.

## Exit Conditions

Artifact is approved, versioned, traceable, internally consistent, review-complete, and marked `FROZEN` or `CURRENT`.

## Participating Agents

Module Author or designated document owner; Architecture, Dependency, and Consistency Reviewers as applicable; Documentation Validator; Lead Architect; human approver.

## Execution Order

1. Select template and identify canonical versus referenced content.
2. Author from confirmed requirements/evidence with stable IDs.
3. Freeze a review candidate version.
4. Run applicable independent reviews.
5. Merge findings; author applies corrections and records dispositions.
6. Re-review affected sections.
7. Documentation Validator checks complete artifact and evidence.
8. Human approves target-state/decision content.
9. Set version/status and update indexes/cross-references.

## Parallel Activities

Architecture, dependency, consistency, security, and performance reviews MAY run in parallel against the same immutable candidate.

## Validation Gates

G2 requires valid approval metadata and no blocker. G4 and documentation portion of G6 must pass before freeze.

## Escalation Conditions

New requirement, architecture decision, authority conflict, canonical-source ambiguity, constitutional change, or unresolved high finding.

## Artifacts Produced

Versioned document, evidence manifest, independent review reports, finding/disposition log, Validation Report, approval record.

## Failure Handling

Return to the responsible author at the failed criterion. Any semantic correction increments candidate version and invalidates affected review evidence.

## Restart Conditions

Restart at authoring for scope/requirement changes, at review for semantic edits, or at validation for purely corrective nonsemantic metadata edits.
