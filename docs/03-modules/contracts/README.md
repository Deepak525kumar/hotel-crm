# Contracts — not a standalone module

**There is no standalone Contracts module and no `SPEC-CONTRACTS-001`.**

The Contracts capability (contract lifecycle, contract templates, contract
generation, contract metadata, contract versions, amendments, signatures,
manager confirmation, acceptance workflow, renewals, expiry, and archival
state) is owned by the **HR** bounded context:

- **Code module:** `backend-hr` (`backend/src/modules/hr`)
- **Specification:** `SPEC-HR-001` (`../hr/MODULE_SPEC.md`)

Onboarding, Employee Management, Documents, Payslips, Compliance, and every
future capability consume this functionality through `backend-hr`'s
interfaces; they do not own it.

Wherever documentation refers to a "Contracts module," "Contracts/HR
module," or "Contract Management module" (e.g. `../onboarding/MODULE_SPEC.md`,
`../employee-management/MODULE_SPEC.md`), read it as an **alias for
`backend-hr` / `SPEC-HR-001`**, not as a separate ownership boundary.

This decision is recorded in
[`ADR-012`](../../14-governance/architecture-decisions/ADR-012-contracts-ownership-hr-bounded-context.md)
(Accepted) and tracked at `SIR-GLOB-014` / `SIR-HR-001` (RESOLVED) in the
[Specification Issues Register](../../../.claude/governance/SPECIFICATION_ISSUES_REGISTER.md).

This directory is retained only as a redirect marker; do not author a module
specification here.
