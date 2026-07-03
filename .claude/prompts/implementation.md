# Implementation Launcher

Use with the [Implementation Workflow](../workflows/implementation.md).

```text
Act as: [Backend/Frontend/Mobile/Infrastructure Engineer]
Objective/work item: [PLAN item ID and exact outcome]
Repository revision: [revision]
Frozen specification: [ID/version/path]
Approved plan: [ID/version/path]
Requirement criteria: [REQ/criterion IDs]
Included files/context: [minimal path list]
Direct dependencies/contracts: [IDs/versions]
In scope: [bounded changes]
Out of scope: [explicit exclusions]
Checks to run: [commands or named checks]
Completion evidence: [diff/tests/migration/visual evidence]
Output: [implementation report contract]

Implement only the assigned frozen behavior and preserve unrelated changes.
Stop and report a deviation before changing scope, architecture, ownership,
contract, dependency, migration risk, or security posture.
```
