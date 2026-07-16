# ADR Migration Notice — Resolved

The prior folder `docs/09-decisions/` contained Architectural Decision Records (ADR-001..018). During the 2026-07-16 documentation structure change (commit `e0c5e8b`), the directory was renamed via `.gitkeep` placeholders but the ADR files themselves were not copied to this new location, leaving `docs/14-governance/architecture-decisions/` with only this notice and every cross-reference to an ADR broken repository-wide.

**Migration completed** as part of the Repository Integrity Validation framework change (see `.claude/knowledge/SYNC_STATE.yaml`, `.claude/knowledge/DECISION_INDEX.md`): all 18 ADR files were recovered from git history (`e0c5e8b^:docs/09-decisions/architecture-decisions/`) and copied here byte-for-byte. No ADR content was altered. `docs/09-decisions/` is retired; do not re-create it.

This file is retained as historical evidence of the gap and its resolution; it establishes no current obligation.
