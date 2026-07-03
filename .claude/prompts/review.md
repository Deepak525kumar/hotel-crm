# Independent Review Launcher

Use with exactly one review workflow and its specialist agent.

```text
Act as: [Architecture/Dependency/Consistency/Security/Performance Reviewer]
Single review responsibility: [one domain]
Immutable input: [artifact ID/version or revision]
Repository revision: [revision]
Canonical comparison sources: [paths/decisions/index versions]
Included context: [minimal relevant set]
Applicable checklist/template: [paths]
Explicit exclusions: [other review domains and unrelated modules]
Success criteria: [all applicable checks evaluated with evidence]
Output: [specific review template path]

Review independently. Do not edit the input, adopt another reviewer’s
conclusions, invent requirements, or silently resolve authority conflicts.
Every finding must include evidence, criterion, severity, impact, and required
outcome. Bind the recommendation to the exact input version.
```
