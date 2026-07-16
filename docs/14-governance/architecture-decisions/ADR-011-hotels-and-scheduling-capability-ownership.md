# ADR-011: Hotels and Scheduling Capability Ownership (No Standalone Modules)

- **Status:** Accepted — ratified by the commissioning human decision recorded in this record (2026-07-12). This differs from the pending-ratification ADR-001..010 set (`Proposed`, see `SIR-GLOB-008`): those reverse-specify existing architecture and await human ratification, whereas this record *is* the human's forward product/architecture decision, made intentionally rather than discovered.
- **Date:** 2026-07-12
- **Scope:** Module/ownership boundaries — the Hotels capability (`backend-crm` / `SPEC-CRM-001`) and the Scheduling capability (`backend-calendar` / `SPEC-CALENDAR-001`).
- **Supersedes:** none (additive; closes the open ownership ambiguity previously tracked as `OD-CRM-06` / `SIR-CRM-006`, and settles the "future standalone module" framing that several documents carried for Hotels and Scheduling).
- **Change class:** Material architecture/ownership decision requiring a Decision Record per Constitution §6/§7. No backend, frontend, mobile, or test code is changed; no module specification is authored, corrected, or frozen by this record.

## Problem

Two capabilities were referred to, in various planning/module documents, as if they might become independent modules with their own ownership boundary and specification:

1. **Hotels.** `SPEC-EMP-001` (`docs/03-modules/employee-management/MODULE_SPEC.md:45`), an empty placeholder directory `docs/03-modules/hotels/`, and `docs/03-modules/onboarding/MODULE_SPEC.md:72,620` all refer to a "Hotels module," with onboarding asserting as settled fact that a "Hotels module owns Hotel and Hotel Group records." Repository truth is that Hotel state (`state-hotel`) is owned by the `crm` code module (`backend-crm`), specified by `SPEC-CRM-001`. The conflict was tracked as `OD-CRM-06` (`docs/03-modules/crm/MODULE_SPEC.md:277`) and aggregated as `SIR-CRM-006`, left open because "scope of onboarding inclusion in the reconciliation" was itself undecided.
2. **Scheduling.** `SPEC-EMP-001` (`docs/03-modules/employee-management/MODULE_SPEC.md:41,199`) refers to a "Calendar/Scheduling module," and `PIVOT_DESIGN_DOCUMENT.md` describes "calendar/scheduling" as one capability. There is no separate scheduling code module; the `calendar` code module (`backend-calendar`), specified by `SPEC-CALENDAR-001`, is the home for this capability.

No `SPEC-HOTELS-001`, `backend-hotels` module, `SPEC-SCHEDULING-001`, or `backend-scheduling` module exists in the repository, and none should be created.

## Decision

1. **The Hotels capability SHALL NOT become an independent module or specification.** Its canonical owner is `backend-crm`, specified by `SPEC-CRM-001`. Hotel Management remains part of the CRM bounded context. No `SPEC-HOTELS-001` shall exist. The name "Hotels module," wherever it appears, is an **alias for `backend-crm` / `SPEC-CRM-001`**, not a separate ownership boundary. Any roadmap, planning document, dependency note, issue, placeholder, or future-work item that implies a standalone Hotels module is redirected to `SPEC-CRM-001`.
2. **The Scheduling capability SHALL NOT become an independent module or specification.** Scheduling is an extension of the existing Calendar capability, whose canonical owner is `backend-calendar`, specified by `SPEC-CALENDAR-001`. No `SPEC-SCHEDULING-001` shall exist. Future scheduling functionality evolves `SPEC-CALENDAR-001` rather than creating another ownership boundary.
3. These are ownership/boundary decisions only. They do **not** resolve the still-open Hotel-Group / Organization *data-model* ownership question (`OD-CRM-01` / `SIR-CRM-001`), the availability-indicator ownership question (`OD-CAL-01`), or any other in-flight open decision. They settle only *which module and specification own each capability*.

## Alternatives Considered

- **Create `SPEC-HOTELS-001` / `SPEC-SCHEDULING-001` as first-class modules** — rejected: it would add ownership boundaries the product does not want, fragment `state-hotel` and calendar/availability state across additional owners, and multiply the cross-module contracts that the platform already flags as unversioned (`OD-CRM-12`). The Hotels capability is already implemented inside `backend-crm` and the scheduling capability inside `backend-calendar`; splitting them would be a code refactor with no product driver.
- **Leave the ambiguity open** — rejected: the ambiguity was already costing every preflight/consistency pass a re-derivation (`SIR-CRM-006` recurring), and the product owner has now made the call.

## Compatibility

Strictly additive to the knowledge/governance layer. No `state-*` domain changes owner. No API mount moves. No module specification is edited by this record; the existing `OD-CRM-06` / "Hotels module" alias text inside module specifications remains as historical disclosure and is now resolved *by reference* to this ADR through `SIR-CRM-006` (RESOLVED) and `SIR-GLOB-013`.

## Reversibility

Reversing this decision would require a new ADR that supersedes it, plus authoring the corresponding standalone specification(s) and a code refactor to relocate `state-hotel` / calendar state. No data is uniquely stored by this record.

## Consequences

- **Positive:** Future preflight, boundary-collision (G1.5), and consistency passes reach the Hotels→`SPEC-CRM-001` and Scheduling→`SPEC-CALENDAR-001` conclusions immediately from the governance layer instead of rediscovering the ambiguity. `SIR-CRM-006` closes.
- **Negative / cost:** The historical "Hotels module" / "Calendar/Scheduling module" phrasings inside `SPEC-EMP-001`, `docs/03-modules/onboarding/MODULE_SPEC.md`, and `PIVOT_DESIGN_DOCUMENT.md` remain as-written (they are frozen-form or foundational documents not edited by this governance pass); readers rely on this ADR and the Specification Issues Register to interpret them as aliases, not as evidence of separate modules.

## Human Decision Required

None outstanding for the ownership question itself — this record *is* that decision. Owner *assignment* (a named accountable person/team for `backend-crm` and `backend-calendar`) remains blocked on `SYNC-001` / `SIR-GLOB-001`, unchanged by this ADR.
