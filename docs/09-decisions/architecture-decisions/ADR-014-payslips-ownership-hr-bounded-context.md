# ADR-014: Payslip Capability Ownership (HR Bounded Context)

- **Status:** Accepted — ratified by the commissioning human decision recorded in this record (2026-07-13).
- **Date:** 2026-07-13
- **Scope:** Module/ownership boundaries — the payslip-request-to-manager-fulfilment capability (`RULE-HR-09`/`RULE-HR-12`, `IF-HR-RequestPayslip`/`IF-HR-FulfilPayslipRequest`, `EVT-HR-PayslipRequested`/`EVT-HR-PayslipFulfilled`, `Requested → Fulfilled` state machine) vs. a proposed standalone Payslips module (`docs/03-modules/payslips/MODULE_SPEC.md`, target `SPEC-PAYSLIPS-001`).
- **Supersedes:** none (additive; closes the open ownership ambiguity previously tracked as `SIR-GLOB-017` / `SIR-HR-020` / `SYNC-031`, a Boundary Collision Gate (G1.5) stop that blocked authoring `SPEC-PAYSLIPS-001`).
- **Change class:** Material architecture/ownership decision requiring a Decision Record per Constitution §6/§7. This record settles the boundary only; governance-artifact synchronization (register, decision index, boundary index, module registry, sync/session state) is performed separately under this ADR's authority, not part of this ADR itself.

## Problem

A Boundary Collision Gate (G1.5) run for a proposed `SPEC-PAYSLIPS-001` (target: `docs/03-modules/payslips/MODULE_SPEC.md`, currently only `.gitkeep`) found that `docs/03-modules/hr/MODULE_SPEC.md` (`SPEC-HR-001`) already claims complete, first-person ownership of the identical payslip-request-to-manager-fulfilment behavior (CRR §23; PDD §7.7):

1. `RULE-HR-09`/`REQ-HR-009` — "Accept a worker's payslip request and route it for manual manager fulfilment by email."
2. `RULE-HR-12`/`REQ-HR-012` — Tier-3 retention classification of payslip-request records.
3. The `IF-HR-RequestPayslip`/`IF-HR-FulfilPayslipRequest` interfaces and the `EVT-HR-PayslipRequested`/`EVT-HR-PayslipFulfilled` events.
4. A dedicated `Requested → Fulfilled` state machine.

`SPEC-HR-001`'s own authoring note already discloses this ambiguity (`OD-HR-01a`), and `ADR-012` (Contracts) named Payslips only as a **consumer** of the Contracts capability — it did not itself adjudicate payslip-request ownership. This is the same collision shape as the earlier Contracts case (`SYNC-023` → `ADR-012`) and the Chatbot case (`SYNC-027` → `ADR-013`). Tracked as `SIR-GLOB-017` (OPEN — BLOCKED) and its thin cross-reference `SIR-HR-020`, and reconfirmed by an independent Boundary Collision Gate (G1.5) run (`SYNC-031`) that returned FAIL rather than authoring a second competing claim.

## Decision

1. **`backend-hr` (specified by `docs/03-modules/hr/MODULE_SPEC.md`, `SPEC-HR-001`) is the canonical and exclusive owner of the payslip-request capability**, including without limitation: payslip request intake; manual manager fulfilment routing and email delivery; the `Requested → Fulfilled` state machine and all its transitions; `RULE-HR-09`/`RULE-HR-12` business rules; the `IF-HR-RequestPayslip`/`IF-HR-FulfilPayslipRequest` interfaces; the `EVT-HR-PayslipRequested`/`EVT-HR-PayslipFulfilled` events; payslip notification delivery; and the payslip-request audit trail and its Tier-3 retention lifecycle.
2. **No standalone Payslips module is created.** No `backend-payslips` module id is registered and no `SPEC-PAYSLIPS-001` will be authored. `docs/03-modules/payslips/` remains a non-owning placeholder directory (retaining only `.gitkeep`).
3. **A chatbot or any other consumer may initiate the payslip workflow only through `backend-hr`'s published interface contracts** (`IF-HR-RequestPayslip`/`IF-HR-FulfilPayslipRequest`), and never owns, duplicates, or reimplements payslip business logic, state, or the `Requested → Fulfilled` lifecycle. This mirrors the consumption pattern already established for Contracts consumers under `ADR-012` and for Chatbot consumers under `ADR-013`.
4. This is an ownership/boundary decision only. It does not itself resolve owner *assignment* for `backend-hr` (a named accountable person/team, blocked on `SYNC-001`/`SIR-GLOB-001`), `SPEC-HR-001`'s own G2 freeze status, or any other open item in either module's specification.

## Alternatives Considered

- **Carve out a standalone `backend-payslips` module / `SPEC-PAYSLIPS-001`** — the reading the original (blocked) authoring attempt assumed. **Rejected by the commissioning human decision recorded in this record.** The payslip-request capability is a thin, fully HR-internal workflow (request → manual manager email fulfilment → audit) with no independent data model, external consumer surface, or lifecycle distinct from HR's own worker-record and retention machinery; splitting it out would duplicate `SPEC-HR-001`'s existing `RULE-HR-09`/`RULE-HR-12` rules, interfaces, events, and state machine into a second competing claim rather than resolving the collision, the same reasoning `ADR-012` (Contracts) and `ADR-013` (Chatbot) already applied to structurally similar HR-adjacent capabilities.
- **Leave the ambiguity open** — rejected: `SIR-GLOB-017`/`SIR-HR-020` were already blocking `SPEC-PAYSLIPS-001` authoring and any chatbot-initiated payslip workflow design; the product owner has now made the call.

## Compatibility

Strictly additive to the knowledge/governance layer. No `state-*` domain changes owner. No API mount moves. `docs/03-modules/payslips/` requires no `MODULE_REGISTRY.yaml`/`DEPENDENCY_GRAPH.yaml`/`API_INDEX.yaml`/`BOUNDARY_INDEX.yaml` entry since it remains an unregistered, non-owning placeholder; `backend-hr`'s existing entries are annotated (not restructured) to reflect this decision as an exit condition of this ADR's authority, performed separately.

## Reversibility

Reversing this decision would require a new ADR that supersedes it, plus authoring `docs/03-modules/payslips/MODULE_SPEC.md` as `SPEC-PAYSLIPS-001` and a corrective edit removing the superseded rules/interfaces/events/state machine from `docs/03-modules/hr/MODULE_SPEC.md`. No data is uniquely stored by this record.

## Consequences

- **Positive:** Future preflight, boundary-collision (G1.5), and consistency passes reach the Payslips→`backend-hr` conclusion immediately from the governance layer instead of rediscovering the ambiguity. `SIR-GLOB-017`/`SIR-HR-020` close. A chatbot-initiated payslip workflow may now be designed against `backend-hr`'s published interfaces without a competing module claim.
- **Negative / cost:** None beyond governance-artifact synchronization (register, decision index, boundary index annotations), performed separately under this ADR's authority.

## Human Decision Required

None outstanding for the ownership question itself — this record *is* that decision. Owner *assignment* for `backend-hr` remains blocked on `SYNC-001`/`SIR-GLOB-001`, unchanged by this ADR. `SPEC-HR-001`'s own outstanding open questions are unaffected by this record.
