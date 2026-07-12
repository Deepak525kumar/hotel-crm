# Hotels — not a standalone module

**There is no standalone Hotels module and no `SPEC-HOTELS-001`.**

The Hotels capability (Hotel and Hotel-Group records, hotel CRUD, the per-hotel
pause-new-jobs toggle) is owned by the **CRM** bounded context:

- **Code module:** `backend-crm` (`backend/src/modules/crm`)
- **Specification:** `SPEC-CRM-001` (`../crm/MODULE_SPEC.md`)
- **State domain:** `state-hotel`, authoritative writer `backend-crm`

Wherever documentation refers to a "Hotels module" (e.g. `SPEC-EMP-001`,
`../onboarding/MODULE_SPEC.md`), read it as an **alias for `backend-crm` /
`SPEC-CRM-001`**, not as a separate ownership boundary.

This decision is recorded in
[`ADR-011`](../../09-decisions/architecture-decisions/ADR-011-hotels-and-scheduling-capability-ownership.md)
(Accepted) and tracked at `SIR-GLOB-013` / `SIR-CRM-006` (RESOLVED) in the
[Specification Issues Register](../../../.claude/governance/SPECIFICATION_ISSUES_REGISTER.md).

This directory is retained only as a redirect marker; do not author a module
specification here.
