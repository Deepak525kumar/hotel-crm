# Repository Integrity Validation Report: `ART-INTEGRITY-001`

This artifact is **tool-generated**, not hand-authored: run
`node ../tooling/repository-integrity-check.js --format md --out <path>` at the
candidate revision and attach the output verbatim below the Control block. Do
not restate or re-derive its findings by hand — cite them.

## Control

Repository revision; command invoked; exit code; baseline file digest;
consuming gate (G4-consistency / G6 / G9 / CI).

## Generated Report

<!-- paste the script's --format md output here, unedited -->

## Disposition

For each **new** (non-baselined) finding: fixed in this candidate, or routed
to the Specification Issues Register (`../governance/SPECIFICATION_ISSUES_REGISTER.md`)
with a `SIR-*` ID and owner. A finding may not be silently added to the
baseline to obtain a pass — baseline changes are reviewable in the PR diff
and require the same justification as any other finding disposition.

## Recommendation

`PASS` (zero new blocking findings) / `FAIL` (unresolved new blocking
finding) / `BLOCKED` (script could not run — record why).
