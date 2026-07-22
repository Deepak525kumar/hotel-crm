# ADR-025: Hotel Manager ↔ Hotel Association — `Hotel.manager_user_id`

- **Status:** Accepted. Ratified directly by the project owner (human decision, recorded 2026-07-22, session `claude/epic-5-verification-next-u5tet9`) — the code this record describes (`Hotel.manager_user_id`, PR 5.1/5.4) is already implemented and merged as part of Epic 5. This record authorizes **no** runtime change, schema migration, code, or specification edit beyond what was already shipped.
- **Date:** 2026-07-21
- **Scope:** Data model / state ownership / authorization model — establishes the storage mechanism for the dedicated Hotel Manager ↔ Hotel association: a nullable `manager_user_id` foreign key on the existing `Hotel` entity, owned by `backend-crm`, read (never written) by `backend-auth` at JWT scope-claim issuance. Resolves the dedicated-Hotel-Manager facet of `OD-CRM-01` (left open by `ADR-023`, which resolved only the Hotel Group/Regional Manager facet) and completes `OD-CRM-05`'s design (the "manager assignment" read input `ADR-023` §6 named but did not define).
- **Supersedes:** none (additive; completes a gap `ADR-023` explicitly left open, does not alter any `ADR-023` decision).
- **Change class:** Material data-model/ownership decision requiring a Decision Record per Constitution §6/§7, same class as `ADR-011`/`ADR-017`/`ADR-023`. Proposed only — authorizes no schema migration, no code, no specification edit; settles the design so `SPEC-CRM-001`/`SPEC-AUTH-001`'s next revisions and `IMPLEMENTATION_EXECUTION_PLAN.md` Epic 5 PR 5.1/5.4 have a decision to consume.

## Problem

`ADR-023` resolved `OD-CRM-01` **only for its Hotel Group / Regional Manager facet**. `SPEC-CRM-001` (`MODULE_SPEC.md:274,308`, FROZEN) and `DECISION_INDEX.md` both record that `OD-CRM-01`'s **dedicated-Hotel-Manager-per-hotel facet** (`REQ-CRM-006`/`RULE-CRM-07`: "each hotel has a dedicated manager… the hotel is associated with a dedicated Hotel Manager") is a separate association `ADR-023` does not cover, and remains open. `ADR-023` §6 itself already named the missing input without defining it: "`backend-auth` reads (never writes) `HotelGroup`/`Hotel.hotel_group_id`/**manager assignment** to compute the claim at issuance" — "manager assignment" was left unresolved for the Hotel-Manager case, tracked as part of `OD-CRM-05`'s remaining design/implementation gap.

`TREQ-AUTH-002` (`SPEC-AUTH-001`, FROZEN, Confirmed authority, not an assumption) already settles the *target cardinality*: "a normal Hotel Manager is scoped to one hotel." What is open is only the **storage mechanism** for that one-hotel fact.

## Grounding facts (verified against repository authority)

- `backend/prisma/schema.prisma`: `Hotel` (line 192) has no manager field; `User` (line 117) has no managed-hotel field; `HotelWorker.position` is free text with observed values `cleaner|checker|housekeeper|supervisor` (no `manager`); `WorkerAssignment.assigned_by_id` is a per-event actor reference, not a durable organizational assignment. **No existing storage can be repurposed.**
- `ADR-011`: the `Hotel` entity (Hotels capability) is owned by `backend-crm`.
- `ADR-023` §2/§1: `backend-crm` already owns the structurally identical `HotelGroup.regional_manager_user_id` FK — the org-unit-owns-the-assignment-FK pattern is already established precedent for the Regional Manager case.
- `ADR-022` §2/`SPEC-EMP-001` `REQ-EMP-012` (FROZEN): the employment record carries **no per-hotel tie** — "no worker is hotel-tied… assignable only within their Hotel Group." Any per-hotel Manager association placed on the employment record would reintroduce exactly the concept `ADR-022` retired `HotelWorker` to eliminate.
- `ADR-017`: `state-user`'s authoritative writer is `backend-auth`; `backend-crm` holds no write authority over `User`.

## Decision

1. **`Hotel.manager_user_id`** — a nullable foreign key on the existing `Hotel` entity, referencing `User.id`. Nullable because assignment happens after hotel creation ("after a hotel is created, it is assigned" — CRR §11, the identical phrasing `ADR-023` already relied on for `Hotel.hotel_group_id`'s own nullable-until-assigned shape). **No new entity is introduced.**

2. **Ownership: `backend-crm`.** `backend-crm` already owns `Hotel` (`ADR-011`) and the structurally identical `HotelGroup.regional_manager_user_id` (`ADR-023` §2). One module owns both organizational-assignment facts about hotels; no ownership split is created. `backend-crm` writes the field at hotel-creation/assignment time (`RULE-CRM-07`), the same business process already responsible for `Hotel.hotel_group_id`/`HotelGroup.regional_manager_user_id`.

3. **State ownership: the `Hotel` entity**, not a new entity, not `User`, not the EMP employment record. Rejected alternatives and why:
   - **Employment record (`backend-hr`):** disqualified — directly contradicts `REQ-EMP-012`/`ADR-022`'s "no worker is hotel-tied." Adding a per-hotel tie to the very entity `ADR-022` redesigned to remove per-hotel ties would be a self-inflicted contradiction of frozen authority.
   - **Join table (`HotelManagerAssignment{hotel_id, manager_user_id}`):** rejected as unnecessary structure. No authority states or requires a Hotel having more than one manager, or a Hotel Manager governing more than one hotel (`TREQ-AUTH-002` confirms exactly one). `ADR-023` used "a derived/virtual grouping cannot hold billing data" as its forcing function for introducing the `HotelGroup` table; no equivalent forcing function exists here. A join table would be premature structure for a confirmed one-hotel-per-manager fact.
   - **`User.managed_hotel_id`:** rejected — breaks the `ADR-017` ownership boundary (`backend-auth` is `state-user`'s sole writer) and breaks symmetry with `ADR-023`'s own choice to place the Regional-Manager FK on the org unit (`HotelGroup`), not on `User`, for no offsetting benefit.

4. **JWT scope generation: `backend-auth` reads, never writes, `Hotel.manager_user_id`** at token-issuance time, exactly as `ADR-023` §6 already established for `HotelGroup`/`Hotel.hotel_group_id`. For a `MANAGER`-role actor, `backend-auth` resolves the Hotel row(s) where `manager_user_id` matches the actor and issues `{type: "hotel", hotel_id}`. This is the literal "manager assignment" read `ADR-023` §6 named but left unresolved; it slots into the existing discriminated-claim mechanism without altering the claim shape, the read-only posture, or the Regional-Manager/Admin resolution paths `ADR-023` §5 already decided.

5. **Epic 5 sequencing (no change to `ADR-024`'s ordering; a field addition within already-decided PRs):**
   - **PR 5.1** (additive schema PR — `IMPLEMENTATION_EXECUTION_PLAN.md` §2) gains `Hotel.manager_user_id` alongside its existing `HotelGroup`/`Hotel.hotel_group_id` addition. Additive, nullable, unread until consumed — the same posture already governing every other PR 5.1 column.
   - **PR 5.4** (scope-claim issuance) reads `Hotel.manager_user_id` alongside `HotelGroup`/`Hotel.hotel_group_id`, per Decision 4.
   - **PR 5.5** (the authz flip) consumes the Hotel-Manager scope resolution as part of its already-decided scope-bound manager behavior — no new PR, no reordering. `ADR-024`'s D1–D6 (PR 5.5-before-5.7 ordering, flag-gated cutover, compatibility guarantee, removal gates) are unaffected and unmodified by this record.

## Compatibility

| Authority | Effect |
|---|---|
| `ADR-023` | Completes the "manager assignment" read input its §6 already named without defining. Adds no new data-model decision beyond the one FK; does not alter the Regional-Manager/Admin resolution paths, the claim shape, or the `backend-crm` ownership assignment (§2) — extends that same ownership to the new field. **Not modified.** |
| `ADR-024` | No change to D1 (PR 5.5 before PR 5.7), D2 (flag-gated cutover mechanism), D3 (flag topology), D4 (compatibility guarantee), D5 (removal conditions), or D6 (roll-forward invariant). This record adds a field consumed within the already-decided PR 5.1/5.4/5.5 sequence; it does not reorder or reopen any of them. **Not modified.** |
| `ADR-022` | No conflict — `HotelWorker` compatibility-layer posture, retirement gating, and the "no per-hotel employment tie" boundary this record explicitly respects (Decision 3) are all unaffected. |
| `SPEC-CRM-001` (FROZEN) | `REQ-CRM-006`/`RULE-CRM-07`'s "association mechanism open" language resolves to `Hotel.manager_user_id`; Owned State gains the field. Text change is a Correction-class forward-note at that spec's next revision (`ADR-022`'s established discipline: "executed at migration time, not now") — **not made by this record**. |
| `SPEC-AUTH-001` (FROZEN) | `ASM-AUTH-02`'s claim-shape assumption and `TREQ-AUTH-002`'s Hotel-Manager acceptance criteria gain a concrete mechanism, mirroring how `ADR-023` already closed the Regional-Manager half. Correction-class forward-note at that spec's next revision — **not made by this record**, consistent with the same precedent (`ADR-023`'s own Compatibility table deferred its `SPEC-AUTH-001`/`SPEC-EMP-001` text changes to "at its next revision," not to the ADR's own authoring pass). |
| `SPEC-EMP-001` (REVIEW) | No owned-state change — this record explicitly keeps the employment record hotel-tie-free (Decision 3), so `REQ-EMP-012` is reinforced, not touched. |

No blocking contradiction found against any of the five checked authorities.

## Consequences

- `SPEC-CRM-001` gains, at its next revision, the resolved `OD-CRM-01` dedicated-Hotel-Manager mechanism and the `Hotel.manager_user_id` field in Owned State.
- `SPEC-AUTH-001` gains, at its next revision, the resolved `ASM-AUTH-02` claim-shape completion and `TREQ-AUTH-002`'s concrete mechanism.
- `IMPLEMENTATION_EXECUTION_PLAN.md` §2 PR 5.1/PR 5.4 text is updated in this same governance pass to name the field (sequencing/scope-only edit, no epic reordering — consistent with how `ADR-024` itself updated the plan's §3/§9 cross-references).
- No runtime change, no schema migration, no knowledge-artifact reclassification beyond `DECISION_INDEX.md` registration is authorized by this record. Physical build remains gated on `ADR-022`'s prerequisite sequencing and `ADR-024`'s cutover ordering, executed at Epic 5 PR 5.1/5.4/5.5.

## Risks

- **Low:** whether a `@@unique` DB constraint on `manager_user_id` should enforce the confirmed one-hotel-per-manager cardinality, versus application-level enforcement only, is an implementation-level choice deferred to PR 5.1's own authoring — not a design question this record needs to settle, since either choice satisfies `TREQ-AUTH-002`.
- **Low:** the `UserRole` enum split (Hotel Manager vs. Regional Manager as distinct roles, `OD-CRM-05`'s remaining implementation gap) is unaffected by and not resolved by this record — it remains a build task at PR 5.4, same disposition already recorded for `OD-CRM-05`.

## Scope note

This record settles the Hotel Manager ↔ Hotel association's storage mechanism, ownership, and read pattern only. It authors no code, freezes/amends no specification, and performs no knowledge-layer reclassification beyond `DECISION_INDEX.md`. On ratification, registration and the `SPEC-CRM-001`/`SPEC-AUTH-001` forward-notes are the standard post-ratification steps (the `ADR-022`/`ADR-023` precedent) — deferred to those specs' own next revisions, not performed here.
