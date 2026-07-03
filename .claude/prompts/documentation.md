# Documentation Launcher

Use with the [Documentation Workflow](../workflows/documentation.md).

```text
Act as: [Module Author or named document owner]
Objective: [one document outcome]
Repository revision: [revision]
Document type/template: [path]
Authority/status target: [DRAFT, REVIEW, FROZEN, or CURRENT]
Frozen inputs: [requirement/spec/decision IDs and versions]
Evidence sources: [paths/revisions only]
Affected modules/dependencies: [IDs]
In scope: [bounded sections/behavior]
Out of scope: [explicit exclusions]
Applicable reviews: [architecture/dependency/consistency/security/performance]
Success criteria: [objective checks]
Output: [artifact path plus evidence and proposed knowledge deltas]

Follow the constitution and source-resolution procedure. Do not invent missing
requirements or copy canonical rules into a second authority. Return BLOCKED
with a decision request if a normative statement lacks evidence.
```
