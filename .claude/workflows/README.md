# Workflow System

Workflows are reusable state machines. They coordinate agent contracts; they do not redefine agent responsibilities or constitutional policy.

## Common State Model

`NOT_STARTED → PREFLIGHT → ACTIVE → REVIEW → VALIDATION → COMPLETE`

Any state may enter `PAUSED_DRIFT`, `BLOCKED`, or `FAILED`. Only the Lead Architect records transitions. Every transition names the input version, evidence, gate result, owner, and next state.

## Execution Rules

- Run pre-flight before entering `ACTIVE` and post-flight before `COMPLETE`.
- Freeze shared inputs before parallel work.
- Parallel branches may not write the same artifact or depend on one another’s unreviewed output.
- A `FAIL` returns to the responsible author/implementer; `BLOCKED` requires missing evidence or authority; drift invokes self-healing.
- Restart from the last passed gate after refreshing all affected context packages.
- Artifacts use stable IDs and record repository revision or document version.

## Workflow Selection

Use the smallest workflow covering the objective. Compose workflows by declared entry/exit conditions; never skip a gate because another workflow already produced a similarly named artifact.
