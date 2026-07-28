# ADR-012: Contracts Capability Ownership (HR Bounded Context)

- **Status:** Accepted — ratified by the commissioning human decision recorded in this record (2026-07-12).
- **Date:** 2026-07-12
- **Scope:** Module/ownership boundaries — the Contracts capability (`backend-hr` / `SPEC-HR-001`).
- **Supersedes:** none (additive; closes the open ownership ambiguity previously tracked as `OD-HR-01a` / `OD-HR-01b` / `SIR-HR-001`, and settles the "standalone Contracts module" framing that `docs/03-modules/onboarding/MODULE_SPEC.md` and `docs/03-modules/employee-management/MODULE_SPEC.md` carried).
- **Change class:** Material architecture/ownership decision requiring a Decision Record per Constitution §6/§7. No backend, frontend, mobile, or test code is changed; no module specification is authored, corrected, or frozen by this record.

## Problem

Three actively-maintained documents referred to a "Contracts module" (or "Contracts/HR module") as if it were, or should become, an independent module with its own ownership boundary and specification:

1. `docs/03-modules/hr/MODULE_SPEC.md` (`SPEC-HR-001` v0.2.1) itself provisionally claims the entire contract-lifecycle/versions/signatures/renewal/expiry/metadata/state surface for `backend-hr` (`RULE-HR-01`..`RULE-HR-15`, its Ownership and Boundaries owned-state block, `IF-HR-GenerateContract`/`IF-HR-UploadSignedContract`/`IF-HR-ConfirmContractSigned`/`IF-HR-GetContractStatus`), while flagging its own claim as disputed (`OD-HR-01a`).
2. `docs/03-modules/onboarding/MODULE_SPEC.md` independently claims first-person execution ownership of contract generation & presentation and hand-signed contract capture/confirmation (§5 items 4-5, §7 steps 7-8) for the identical CRR §9 behavior, while its own §6.5 (lines 187, 190) names a distinct "Contracts module" / "Contracts/HR module" as owner of contract template/versioning/storage and the ongoing lifecycle.
3. `docs/03-modules/employee-management/MODULE_SPEC.md` (§4 Out of Scope, line 40) names "Contracts module" as the owner of "Contract generation, storage, and the manager-confirmed hand-signed contract lifecycle," referencing but not claiming this state.

No `SPEC-CONTRACTS-001` or `backend-contracts` module exists in the repository (`docs/03-modules/contracts/` held only `.gitkeep`; no such module id exists in `MODULE_REGISTRY.yaml`, `DEPENDENCY_GRAPH.yaml`, or `BOUNDARY_INDEX.yaml`). This conflict was tracked as `OD-HR-01a`/`OD-HR-01b` and aggregated as `SIR-HR-001` (High, `OPEN — BLOCKING`), converged on independently by three G4 reviewers (architecture, dependency, consistency), and reconfirmed by an independent Boundary Collision Gate (G1.5) run for a proposed `SPEC-CONTRACTS-001` that was blocked from authoring rather than adding a third competing claim (`SYNC-023`).

## Decision

1. **The Contracts capability SHALL NOT become an independent module or specification.** Its canonical owner is `backend-hr`, specified by `SPEC-HR-001`. No `SPEC-CONTRACTS-001` shall exist and no `backend-contracts` module shall be created. The names "Contracts module," "Contracts/HR module," and "Contract Management module," wherever they appear, are an **alias for `backend-hr` / `SPEC-HR-001`**, not a separate ownership boundary.
2. `backend-hr` owns the complete contract capability: contract lifecycle, contract templates, contract generation, contract metadata, contract versions, amendments, signatures, manager confirmation, acceptance workflow, renewals, expiry, and archival state.
3. Onboarding, Employee Management, Documents, Payslips, Compliance, and every future capability **consume** this functionality through `backend-hr`'s interfaces; they do not own it. `docs/03-modules/onboarding/MODULE_SPEC.md`'s claimed execution ownership of contract generation & presentation and hand-signed contract capture/confirmation (§5 items 4-5, §7 steps 7-8) is superseded by this decision: Onboarding coordinates/triggers these steps as a consumer of `backend-hr`, it does not own them.
4. This is an ownership/boundary decision only. It does not itself resolve `SPEC-HR-001`'s other open decisions (`OD-HR-02`/`02b` stub-type redesign, `OD-HR-03` lapse/offboarding workflow, `OD-HR-07` extension/permanent trigger mechanism, `OD-HR-08` concurrency, `OD-HR-10` worker-facing RBAC gap, `OD-HR-13` hotel-scoping gap, `OD-HR-14` malware-scan position, `OD-HR-15` auth-dependency sequencing risk) or `SPEC-HR-001`'s G2 freeze, which remains blocked on those items, on reserved human ownership assignment (`SYNC-001`), and on a named human approver.

## Alternatives Considered

- **Create `SPEC-CONTRACTS-001` / `backend-contracts` as a standalone module**, carving contract-lifecycle state and interfaces out of `backend-hr` and narrowing HR to payroll/payslips only — this was the option a prior session (`SYNC-023`) recommended for human consideration, since all three documents already used "Contracts module" as a distinct concept and it would have cleanly separated payroll concerns from contract concerns. **Rejected by the commissioning human decision recorded in this record.** It would require a scoped rewrite of `SPEC-HR-001` and of onboarding's §5/§7 contract-related language, adds a fourth ownership boundary the product does not want, and the existing `backend-hr` stub already carries the `/contracts` route surface (`GET/POST /contracts`) with no independent client integration pointing elsewhere.
- **Leave the ambiguity open** — rejected: `SIR-HR-001` was already blocking `SPEC-HR-001`'s architecture re-review and G2 freeze, and was independently re-discovered at cost by a second session (`SYNC-023`); the product owner has now made the call.

## Compatibility

Strictly additive to the knowledge/governance layer. No `state-*` domain changes owner (`backend-hr` currently owns no Prisma state; the target-state `Contract` model, once implemented, is `backend-hr`'s). No API mount moves (`/api/v1/hr` already hosts the current-state `/contracts` stub routes). No module specification is edited by this record; the existing "Contracts module" / first-person ownership text inside `docs/03-modules/onboarding/MODULE_SPEC.md`, `docs/03-modules/employee-management/MODULE_SPEC.md`, and `docs/03-modules/hr/MODULE_SPEC.md` itself remains as historical disclosure and is now resolved *by reference* to this ADR through `SIR-HR-001` (RESOLVED) and `SIR-GLOB-014`.

## Reversibility

Reversing this decision would require a new ADR that supersedes it, plus authoring a standalone `SPEC-CONTRACTS-001` and a code refactor to relocate contract-lifecycle state and interfaces out of `backend-hr` into a new `backend-contracts` module. No data is uniquely stored by this record.

## Consequences

- **Positive:** Future preflight, boundary-collision (G1.5), and consistency passes reach the Contracts→`SPEC-HR-001` conclusion immediately from the governance layer instead of rediscovering the ambiguity. `SIR-HR-001` closes. `SPEC-HR-001`'s architecture re-review, previously `BLOCKED` solely on this module-boundary question, may proceed on its remaining open items.
- **Negative / cost:** The historical "Contracts module" phrasings inside `docs/03-modules/onboarding/MODULE_SPEC.md` and `docs/03-modules/employee-management/MODULE_SPEC.md`, and the first-person contract-generation/confirmation-capture language inside `docs/03-modules/onboarding/MODULE_SPEC.md` §5/§7, remain as-written (frozen-form/foundational documents not edited by this governance pass); readers rely on this ADR and the Specification Issues Register to interpret "Contracts module" as an alias for `backend-hr` and Onboarding's execution claims as consumer-side coordination, not competing ownership.

  **Update (2026-07-28):** the deferred corrective edits described above were applied. Discovered during an audit ahead of `GD-15` (HR & Employee-Management module build scope) that `docs/03-modules/hr/MODULE_SPEC.md`'s own `OD-HR-01a`/`OD-HR-01b` rows and Status field still described this dispute as architecture-`BLOCKED`, sixteen days after this ADR resolved it — a documentation-synchronization gap, not a live conflict. Corrected in the same pass: `SPEC-HR-001` (Status field, v0.2.0 correction note, `OD-HR-01a`/`OD-HR-01b` rows, now RESOLVED, bumped to v0.2.2) and `docs/03-modules/onboarding/MODULE_SPEC.md` (§5 items 4-5, §6.5 boundary note, §7 steps 7-8 — reworded to "triggering, not execution," mirroring §5 item 3's already-correct Chatbot invocation-not-execution pattern from `ADR-013`).

## Human Decision Required

None outstanding for the ownership question itself — this record *is* that decision. Owner *assignment* (a named accountable person/team for `backend-hr`) remains blocked on `SYNC-001` / `SIR-GLOB-001`, unchanged by this ADR. `SPEC-HR-001`'s G2 freeze remains blocked on its other open decisions and reviews, listed in Decision §4 above.
