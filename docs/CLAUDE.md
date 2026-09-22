# docs/

Specifications, decision records, E2E scenarios and implementation handoffs.
The `.claude/` framework governs *how* these are produced; this file says where
things live and which conventions bite.

## Two mandatory entry points

Declared in `.claude/CLAUDE.md` and easy to miss:

- **Testing or QA anything** → read `10-testing/e2e/README.md` first and run the
  numbered scenarios. Do not invent a test plan.
- **Any chatbot work** → read `implementation/CHATBOT_HANDOFF.md`, then
  `implementation/GD-19_CHATBOT_CHECKPOINT.md`.

## Where things go

| Kind | Path | Naming |
|---|---|---|
| Decision record | `14-governance/architecture-decisions/` | `ADR-NNN-kebab-title.md` |
| Module spec | `03-modules/<module>/MODULE_SPEC.md` | `SPEC-<MODULE>-NNN` |
| E2E scenario | `10-testing/e2e/scenarios/` | `NN-kebab-title.md` |
| E2E run log | `10-testing/e2e/runs/` | `YYYY-MM-DD-context.md` |
| Implementation plan / handoff | `implementation/` | free |

Templates live in `.claude/templates/`. The open-issues register is
`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` — append, never delete;
resolved rows move to history.

## Conventions that bite

- **A duplicate ADR number is a blocking integrity finding.** `ls` the directory
  before claiming one.
- **A spec that is not `FROZEN` cannot be implemented from.** Check the Document
  Control `Status` row. Several specs are `REVIEW`, deliberately.
- **Never edit a historical run log.** Append a new one.
- **Record what is untested.** Every scenario carries a "Knowingly untested
  here" section naming *what*, *why it is acceptable*, and where partial
  coverage lives. A suite that implies coverage it lacks is worse than a gap.
- **A `200` is not evidence.** Scenarios verify at the data layer, and never
  substitute a direct DB write for the path under test — if the real path
  cannot run, that is a recorded gap, never a pass.
- **`REMAINING_WORK.md` is the owner's punch list**, distinct from
  `scenarios/08-known-gaps-and-next.md`, which is the technical backlog found by
  testing. Do not merge them.

## Before claiming a gate

```bash
node .claude/tooling/repository-integrity-check.js
```

Orphan-document warnings are common and mostly baselined; **new blocking**
findings are not.
