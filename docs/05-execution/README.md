# Execution Layer

`docs/05-execution/` contains exactly two files: [EXECUTION_DASHBOARD.md](EXECUTION_DASHBOARD.md),
which answers "where is engineering work at right now" (current milestone, per-module
implementation status, completed vs. remaining modules, active/upcoming work, and blockers to
that work), and [RELEASE_STATUS.md](RELEASE_STATUS.md), which answers only "are we production-ready"
(G8 release-gate status per module and outstanding release prerequisites). Both link to, rather
than restate, their sources of truth elsewhere in the repository.

ADR authoring/status and governance-decision (`GD-*`) status are explicitly **out of scope** in
this directory — they live exclusively in
[`docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`](../implementation/GOVERNANCE_DECISIONS_REQUIRED.md)
and [`.claude/knowledge/DECISION_INDEX.md`](../../.claude/knowledge/DECISION_INDEX.md). Do not add a
third file here to track status, sprint items, blockers, or a changelog — that duplication is what
this directory previously contained and was collapsed away from; git history is the record of past
execution-layer state, not a hand-maintained narrative file.
