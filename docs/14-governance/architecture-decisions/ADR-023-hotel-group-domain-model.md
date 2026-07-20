# ADR-023: Hotel Group Domain Model — Entity, Ownership, Hotel/Employee Association, and Scope Claim Shape

- **Status:** Proposed — pending human ratification per Engineering Constitution §20, consistent with the ADR-011..022 precedent. Authored by the Lead Architect to resolve `OD-EMP-05`, a proven gap: `CONFIRMED_REQUIREMENTS_REGISTER.md`, `PIVOT_DESIGN_DOCUMENT.md`, `SPEC-AUTH-001`, `SPEC-USERS-001`, `SPEC-JOB-DISPATCH-001`, `ADR-022`, and `SPEC-EMP-001` were searched exhaustively and none uniquely determine the Hotel Group data model or mechanism (see the immediately preceding determination in this session; `SPEC-AUTH-001`'s own `ASM-AUTH-02`/`ASM-AUTH-03` independently label the adjacent facts "Inference, not confirmed").
- **Date:** 2026-07-20
- **Scope:** Data model / state ownership / authorization model — establishes `HotelGroup` as a first-class entity, its ownership, the `Hotel`↔`HotelGroup` and Employee↔`HotelGroup` relationships, the Regional-Manager/Hotel-Manager scope model, and the JWT `scope` claim's literal shape. Resolves `OD-EMP-05` (`SPEC-EMP-001`), `ASM-AUTH-02`/`ASM-AUTH-03` (`SPEC-AUTH-001`), and `ADR-022` Prerequisite P2.
- **Supersedes:** none (additive domain-model decision, first Decision Record for this gap).
- **Change class:** Material architecture/data-model decision requiring a Decision Record per Constitution §6/§7, mirroring the ADR-011/ADR-017/ADR-022 precedent. Proposed only — this ADR authorizes no schema migration, no code, and no specification edit; it settles the design so `SPEC-EMP-001`'s next revision and `ADR-022`'s Prerequisite P2 have a decision to consume.

## Problem

`OD-EMP-05` blocks `REQ-EMP-012` acceptance and, per the 2026-07-20 G4 Security review, this module's own deny-by-default hotel/group scoping. Three sub-gaps, each independently confirmed absent from every searched authority:

1. **No `HotelGroup` entity exists.** `PIVOT_DESIGN_DOCUMENT.md` §9.1/§9.3 keeps `Hotel` and adds only a `scope (hotel/group)` field to `User`/`Session` — no group-level entity is modeled, yet CRR §11 assigns the group a business property (**shared billing**) that has no other place to live.
2. **`Hotel`↔`HotelGroup` and Employee↔`HotelGroup` relationships are unstated.** CRR §12 defines the assignment boundary circularly ("within the group of hotels the worker is working in") without saying how a worker acquires that group.
3. **JWT `scope` claim shape is unconfirmed.** `SPEC-AUTH-001`'s `ASM-AUTH-02` flags "single id, array, or group-id-with-membership-lookup" as undecided.

## Decision

1. **`HotelGroup` is a first-class entity**, minimally: `{ id, name, billing_info, regional_manager_user_id }`. Justification: CRR §11's "shared billing" is a group-level property, forcing a table (a derived/virtual grouping cannot hold billing data). One `HotelGroup` has exactly one assigned Regional Manager (`regional_manager_user_id`), matching every cited text's singular "grouped under one Regional Manager" / "the Regional Manager they manage" phrasing (`CONFIRMED_REQUIREMENTS_REGISTER.md` §11; `PIVOT_DESIGN_DOCUMENT.md` §9.1 line 100).
2. **Ownership: `backend-crm`.** `backend-crm` is already the canonical Hotels-capability owner (`ADR-011`), and Hotel-Group formation/RM-assignment rules (CRR §11: "new hotels may only be created by Admin/HQ"; "after a hotel is created, it is assigned to the responsible Regional Manager") are the same class of hotel-lifecycle rule CRM already owns — extending an existing boundary rather than creating a new module or reviving `backend-hotel-workers`.
3. **`Hotel` ↔ `HotelGroup`: many-to-one.** `Hotel.hotel_group_id` (nullable until assigned, per CRR "after a hotel is created, it is assigned"). A Hotel belongs to at most one Hotel Group at a time; nothing in CRR/PDD suggests a hotel spanning groups.
4. **Employee ↔ `HotelGroup`: explicit FK on the employment record, owned by `backend-hr`/`SPEC-EMP-001`.** `employee.hotel_group_id`, set at the `Under Review → Active` hire-approval transition (`RULE-EMP-03`) from the approving manager's own `hotel_group_id`. An explicit field is required — CRR §12's boundary cannot be derived from assignment history without circularity (the boundary bounds the very assignments that would need to derive it). This is the minimal target-state analogue of the retired `HotelWorker` per-hotel tie (`ADR-022` §1), now at group grain instead of hotel grain.
5. **Manager scope (confirms, does not alter, already-Confirmed/Target text in `SPEC-AUTH-001`/`SPEC-JOB-DISPATCH-001`):** Hotel Manager → scoped to their one assigned `hotel_id`; Regional Manager → scoped to every `hotel_id` where `Hotel.hotel_group_id` matches their managed `HotelGroup.id`; Admin → system-wide, no scope restriction.
6. **JWT `scope` claim shape (resolves `ASM-AUTH-02`):** a discriminated claim, `{ type: "hotel", hotel_id } | { type: "hotel_group", hotel_group_id } | { type: "global" }`, issued per the actor's role at token-issuance time. Resolves `ASM-AUTH-03`: `backend-auth` reads (never writes) `HotelGroup`/`Hotel.hotel_group_id`/manager assignment to compute the claim at issuance (`SPEC-AUTH-001:728`'s "learns... at token-issuance time"), mirroring the existing read-only pattern `backend-auth` already has toward other modules' state.

## Compatibility

| Authority | Effect |
|---|---|
| `ADR-022` | Satisfies Prerequisite P2 ("Hotel-Group association model decided and built") at the decision level; does not itself build it. No conflict — `ADR-022`'s `HotelWorker`-as-compatibility-layer posture and no-runtime-change constraint are unaffected. |
| `SPEC-AUTH-001` | Resolves `ASM-AUTH-02` (claim shape) and `ASM-AUTH-03` (owning module: `backend-crm` for the entity, `backend-auth` as read-only scope-resolver) from "Inference, not confirmed" to decided. No change to `SPEC-AUTH-001`'s own frozen text is made or required by this ADR (a forward-note is the spec's own next-revision concern, per the `ADR-021`/`ADR-022` precedent). |
| `SPEC-USERS-001` | `RULE-USERS-11`'s target scope claim is compatible with the discriminated shape decided here; no contradiction, no `state-user` ownership change (unaffected by `ADR-017`). |
| `SPEC-EMP-001` | Directly resolves `OD-EMP-05`; `REQ-EMP-012`'s "assignable only within Hotel Group" now has a concrete mechanism. No other owned-state change. |
| `SPEC-JOB-DISPATCH-001` | `TREQ-008`/`TRULE-007`'s "cross-hotel assignment only within Hotel Group" now has a concrete check: `worker.hotel_group_id == target_hotel.hotel_group_id`. No contradiction — both are target/unbuilt. |

No blocking contradiction found against any of the five checked authorities.

## Consequences

- `SPEC-EMP-001` gains, at its next revision, the resolved `OD-EMP-05` mechanism and its `hotel_group_id` field in Owned state.
- A new `backend-crm`/`SPEC-CRM-001` decision item is created (Hotel Group formation/ownership) — out of scope for this ADR to author into that spec; routed to `SPEC-CRM-001`'s own next revision.
- `SPEC-AUTH-001` gains, at its next revision, the resolved claim shape closing `ASM-AUTH-02`/`ASM-AUTH-03`.
- No runtime change, no schema migration, no knowledge-artifact update is authorized by this ADR. Physical build remains gated on `ADR-022`'s own prerequisite sequencing.

## Risks

- **Medium:** one-Regional-Manager-per-Hotel-Group is the simplest reading consistent with every cited singular phrasing, but no authority explicitly rules out one RM managing multiple groups; if wrong, `HotelGroup.regional_manager_user_id` needs to invert to a join table — flagged, not resolved here (would require re-derivation from a not-yet-written product clarification, not inferable from current text).
- **Low:** billing-detail shape (`billing_info`) is named only as "shared billing" in CRR §11 with no field-level specification; deferred to `SPEC-CRM-001`'s own authoring.
