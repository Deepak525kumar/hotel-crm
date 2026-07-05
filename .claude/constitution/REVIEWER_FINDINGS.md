# Standardized Reviewer Findings

**Status:** Canonical governing policy for reviewer and validator output

**Change class:** Constitutional; human approval required (see [Engineering Constitution](ENGINEERING_CONSTITUTION.md) §20)

**Applies to:** Every independent reviewer and validator (architecture, dependency, consistency, security, performance, business-rule, documentation, architecture validation, QA)

## Purpose

Independent reviews only compose if every reviewer emits the same finding shape. This document is the single canonical definition of a finding. Reviewer agent contracts and review templates reference it; they do not restate the fields.

## Canonical Finding Schema

Every actionable finding MUST report exactly these fields, in this order:

| Field | Definition |
|---|---|
| Finding ID | Stable `FIND-<zero-padded-number>` local to the report (Constitution §15) |
| Severity | `Critical` / `High` / `Medium` / `Low` / `Note`, per [Review Gates](REVIEW_GATES.md) severity table |
| Evidence | Path-and-line, revision, command, or decision ID proving the finding (Constitution §5) |
| Impact | The concrete consequence if unresolved, tied to a violated criterion or requirement |
| Recommendation | The corrective direction; not a mandated single solution unless architecture requires it |
| Confidence | `High` / `Medium` / `Low`, per [Loop Control](LOOP_CONTROL.md) §5 |
| Unknowns | Facts the reviewer could not establish that bear on the finding, or `none` |
| Limitations | Scope, environment, or evidence constraints on the review, or `none` |
| Required Outcome | The disposition needed to clear the finding: fix, approved action, accepted risk, or decision |

`Unknowns` and `Limitations` are mandatory fields and may be `none`; they may never be omitted. A finding whose `Confidence` is `Low` and whose `Unknowns` are non-empty is reported as unresolved, not as a pass.

## Report-Level Requirements

Each review report additionally records reviewer identity, immutable input version/revision, independence declaration, checklist evidence, positive evidence, and a single gate recommendation (`PASS` / `PASS_WITH_ACTIONS` / `FAIL` / `BLOCKED`) bound to the exact reviewed version, per [Review Gates](REVIEW_GATES.md).

## Merge and Disposition

Findings are merged across reviewers by `Finding ID` and severity without losing evidence, confidence, or unknowns (Review Gates, Independent Review Protocol). The author cannot approve their own blocking finding (Constitution §12). `Accepted risk` requires a Risk Assessment, expiry, and authorized human (Review Gates).

## Relationship to Existing Policy

This document extends, and never overrides, [Review Gates](REVIEW_GATES.md) severity and disposition rules and the [Engineering Constitution](ENGINEERING_CONSTITUTION.md). It adds only the uniform finding shape and the mandatory `Confidence`, `Unknowns`, and `Limitations` fields.
