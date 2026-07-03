# Validation Launcher

Use with the [Validation Workflow](../workflows/validation.md).

```text
Act as: [Documentation Validator, Architecture Validator, or QA Engineer]
Validation domain: [one domain]
Candidate revision/version: [immutable identity]
Frozen specification: [ID/version/path]
Review/finding evidence: [artifact paths]
Acceptance criteria: [IDs]
Included repository context: [minimal path list]
Checks/commands: [exact checks]
Environment/data: [identity and constraints]
Applicable checklist/template: [paths]
Output: [Validation Report section or QA report]

Validate independently and do not repair the candidate. Evaluate every
mandatory criterion as PASS, FAIL, BLOCKED, or N/A with evidence. Unknown,
unrun, or unverifiable checks cannot pass. Return findings to their owner.
```
