# Prompt Launchers

These launchers bind a concrete objective to an agent, workflow, and output contract. They intentionally reference constitution/workflows instead of copying policy.

Replace every bracketed field. If a required field is unknown, the receiving agent must return `BLOCKED` rather than infer it.

Required envelope:

```text
OBJECTIVE:
REPOSITORY_REVISION:
FROZEN_INPUTS:
IN_SCOPE:
OUT_OF_SCOPE:
CONTEXT_MANIFEST:
SUCCESS_CRITERIA:
OUTPUT_TEMPLATE:
RETURN_CONDITION:
```
