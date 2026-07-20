# ADR-022: Retire `backend-hotel-workers` from the Target Architecture — Employment Record Owned by Employee Management, Hotel-Scoping Migrated to Role×Scope

- **Status:** Accepted. Ratified by merge of PR #166 (2026-07-20). Authored by the Lead Architect from the migration analysis of `backend-hotel-workers` against the target authority `SPEC-EMP-001`, and human direction (2026-07-20) to retire the module from the target architecture rather than freeze a specification for it.
- **Date:** 2026-07-20
- **Scope:** Module lifecycle / bounded-context / state ownership / authorization model — establishes that `backend-hotel-workers` is a marketplace-era module absent from the target architecture, that its `HotelWorker` record is repurposed into the Employee Management employment record, and that hotel-scoping migrates from `HotelWorker` ACTIVE-membership reads to the role×scope JWT model. Refines `ADR-011` (Hotels & Scheduling capability ownership) and coordinates with `SPEC-EMP-001` (Employee Management) and the FROZEN `SPEC-JOB-DISPATCH-001` (`TREQ-008` role×scope).
- **Supersedes:** none (additive lifecycle/ownership decision). Does **not** freeze, author, or bless any `SPEC-HOTELWORKERS-001`; that draft is reverted as an exit condition of this decision.
- **Change class:** Material architecture/ownership/lifecycle decision requiring a Decision Record per Constitution §6/§7, mirroring the ADR-016/ADR-017/ADR-021 precedent. This record settles the target-architecture disposition and migration intent only; it authors no code, modifies no frozen specification, and changes no runtime implementation.

## Problem

`backend-hotel-workers` is a live, fully-implemented module owning `state-hotel-worker` (the `HotelWorker` table, `backend/prisma/schema.prisma:223-246`) via a four-route roster CRUD surface, read by five modules and by the `checkHotelAccess()` authorization middleware (`backend/src/middleware/permissions.ts:124-131`). A determination on 2026-07-20 confirmed it is **currently active, not dead legacy** — so a naive reading suggested authoring a current-state `SPEC-HOTELWORKERS-001`.

However, a migration analysis against the target authority `SPEC-EMP-001` established that the module is **not part of the target architecture**:

1. **`HotelWorker` and the target employment record are opposite-era data shapes.** `HotelWorker` is a **per-(hotel, worker) membership** row with a per-hotel lifecycle `INVITED→ACTIVE→SUSPENDED→REMOVED`. The target employment record (`SPEC-EMP-001` §Owned state; `REQ-EMP-012`) is **one record per employee**, **not hotel-tied**, assignable only within a **Hotel Group**, with an Onboarding-driven lifecycle `Inactive→Under Review→Active/Rejected→Deactivated`. The per-hotel roster-membership concept **is** the marketplace model the pivot explicitly removes (`REQ-EMP-012`: "no worker is hotel-tied").
2. **The pivot already reassigns every responsibility.** PDD §9.1 and `SPEC-EMP-001` (`:88`, `:234`) state the `HotelWorker` record is *repurposed* into the employment record. The FROZEN `SPEC-JOB-DISPATCH-001` states *"HotelWorker becomes the permanent-employment record"* and `TREQ-008` replaces roster-membership hotel-scoping with **role×scope JWT claims** (also `SPEC-USERS-001` `REQ-USERS-022..024`).
3. **Freezing a `SPEC-HOTELWORKERS-001` would manufacture a cross-spec contradiction.** It would enshrine the marketplace roster as a permanent bounded capability, directly contradicting the FROZEN Job Dispatch spec and the REVIEW Employee Management spec — the same class of accepted/authority conflict that `ADR-021` had to resolve for Calendar↔Job-Dispatch, but self-inflicted and immediately obsolete.

A migration matrix classified every `backend-hotel-workers` responsibility as **absorbed by Employee Management**, **replaced by the role×scope authz model (Auth/Users)**, or **deleted as marketplace legacy** — **zero** responsibilities justify an independent target module.

## Decision

1. **`backend-hotel-workers` is not part of the target architecture.** No `SPEC-HOTELWORKERS-001` is authored or frozen; the draft is reverted. The module's target disposition is **retired** (retire-on-migration), not `active`.

2. **Employee Management (`SPEC-EMP-001`, code home `backend-hr` per `OD-EMP-10`) becomes the long-term owner of the employment record.** The `HotelWorker` table is repurposed (non-destructively, PDD §9.1) into the one-per-employee employment record EMP owns; per-hotel roster multiplicity and the roster lifecycle are dropped as marketplace legacy.

3. **Authorization migrates from `HotelWorker` ACTIVE-membership to the role×scope model.** The `checkHotelAccess()` roster-membership branch (`permissions.ts:124-131`) is superseded by JWT `scope` claims owned by Authentication/User Management, as already specified in the FROZEN `SPEC-JOB-DISPATCH-001` `TREQ-008` and `SPEC-USERS-001` `REQ-USERS-022..024`.

4. **`HotelWorker` is retained only as an implementation compatibility layer until the migration completes.** Because `checkHotelAccess()` and five consumer modules depend on **live** ACTIVE-membership reads, and every replacement (EMP employment record on `backend-hr`; the Hotel-Group association, `OD-EMP-05`, unresolved; the role×scope JWT authz, unbuilt) is **not yet built**, the `HotelWorker` table and module remain in place, unchanged, as a transitional compatibility layer. They are physically removed only at the pivot foundation phase once the replacements exist. This ADR authorizes **no runtime change**.

## Rationale

- **Eliminates an unjustified module without inconsistency:** every responsibility has a clean target owner (§Migration Matrix in the analysis); nothing is orphaned.
- **Avoids an immediately-obsolete specification:** freezing `SPEC-HOTELWORKERS-001` would require correction the moment the pivot foundation lands; not freezing it removes that debt entirely.
- **Minimizes frozen-spec correction:** the FROZEN Job Dispatch spec already says "HotelWorker becomes the employment record" and `TREQ-008`; retirement *agrees* with it, whereas freezing HW-001 would *contradict* it. Remaining frozen-spec touches are forward-note Corrections, not re-freezes.
- **Preserves single authoritative ownership:** the employment record consolidates under EMP; hotel-scope authority consolidates under Auth/Users (JWT scope). No dual ownership is created.
- **Safe under uncertainty:** by retaining `HotelWorker` as a compatibility layer and gating physical removal on the replacement builds, the decision changes no live authorization path today.

## Consequences

- The draft `SPEC-HOTELWORKERS-001` (branch commit `67b157b`) is reverted; no module spec is authored for `backend-hotel-workers`.
- On ratification (separate, deferred governance step — **not performed by this record**): `MODULE_REGISTRY.yaml` reclassifies `backend-hotel-workers.lifecycle` `active → deprecated` and its `specification` `UNKNOWN → RETIRED (ADR-022)`; `STATE_OWNERSHIP_INDEX`/`DEPENDENCY_GRAPH`/`OWNERSHIP_INDEX` annotate `state-hotel-worker` as repurpose-pending → Employee Management (readers retained until Phase-1 repoint), and add the two reader edges the G4 review found missing (`edge-quality-reads-hotel-worker`; the `checkHotelAccess`/`permissions-middleware` read) so the blast-radius record is complete before migration; `BOUNDARY_INDEX` marks the boundary deprecated/retire-on-pivot; `DECISION_INDEX.md` registers this ADR.
- `SPEC-EMP-001` (REVIEW) gains, at its next revision, an explicit reciprocal statement that the employment record subsumes the retired `HotelWorker` roster, and relates `OD-EMP-05` (Hotel-Group association is the replacement for per-hotel membership) and `OD-EMP-10` (docs↔`backend-hr` mapping).
- No FROZEN specification and no runtime code is changed by this record.

## Compatibility

No runtime behavior changes as a result of this record. `backend-hotel-workers`, the `HotelWorker` table, `checkHotelAccess()`, and every consumer remain exactly as-is until the migration roadmap below is executed at the pivot foundation phase. The record assigns target-architecture disposition and migration intent; it relocates no code and drops no data.

## Migration Roadmap (informative — execution is separately gated, phase by phase)

### Prerequisite implementations (all currently absent/undecided)
- **P1. Employee Management built on `backend-hr`.** `backend-hr` is a stub (`DEPENDENCY_GRAPH.yaml:36`); the employment record, lifecycle, skills, and blocklist must exist. Gated on `SPEC-EMP-001` G2 freeze and `OD-EMP-10`.
- **P2. Hotel-Group association model decided and built.** The Hotel-Group model does not exist in `schema.prisma`; `OD-EMP-05` (how a worker joins a group) is OPEN. This is the replacement for per-hotel roster membership; it must be settled before per-hotel semantics can be dropped.
- **P3. Role×scope JWT authorization built.** `TREQ-008` (FROZEN Job Dispatch) and `REQ-USERS-022..024` (FROZEN Users) specify a `scope` JWT claim and deny-by-default role×scope checks; unbuilt today. This replaces the `checkHotelAccess()` ACTIVE-membership branch.

### Dependency order
1. P1 (EMP employment record) — provides the target owner of the repurposed state.
2. P2 (Hotel-Group model) — provides the replacement for hotel-scoped membership.
3. P3 (role×scope JWT authz) — provides the replacement for `checkHotelAccess()` membership reads.
4. Repoint the six consumers + `checkHotelAccess()` from ACTIVE-membership reads to JWT scope / EMP employment record / Hotel-Group.
5. Data migration (below).
6. Remove `backend-hotel-workers` routes/controller/service/module; drop roster-membership semantics.

### Affected specifications
- **FROZEN, already aligned (no text conflict; forward-note Corrections only):** `SPEC-JOB-DISPATCH-001` (already states the repurpose + `TREQ-008`; likely **no change**), `SPEC-USERS-001` (optional `hotel_id` roster-filter read → repoint to scope model), `SPEC-AUTH-001` (`checkHotelAccess` membership branch superseded by JWT scope), `SPEC-ATT-001` (1 incidental roster reference).
- **REVIEW, absorbing owner:** `SPEC-EMP-001` (reciprocal subsume statement; `OD-EMP-05`/`OD-EMP-07`/`OD-EMP-10`).
- **REVIEW consumers:** `SPEC-ANALYTICS-001`, `SPEC-QUAL-001` (leaderboard roster reads → scope model).

### Required correction-class amendments (executed at migration time, not now)
- Each FROZEN-spec touch is an **incremental Correction** under `LOOP_CONTROL.md` §3 (version-bump + affected-reviewer re-verification, `FROZEN` retained), exactly the mechanism ADR-021 used to amend `SPEC-JOB-DISPATCH-001` — **not** a re-freeze. Expected: `SPEC-USERS-001`, `SPEC-AUTH-001`, `SPEC-ATT-001` forward-notes; `SPEC-JOB-DISPATCH-001` likely none.

### Data migration plan
- Pre-launch, no production employee data (PDD §10) → **non-destructive**. Repurpose the retained `HotelWorker` table into the employment record: collapse per-(hotel, worker) rows to one-per-employee, deriving the employee's Hotel-Group association from the (now-removed) per-hotel memberships per the P2 decision. No `DROP TABLE`; a schema evolution + backfill, feature-flagged.

### Authorization migration plan
- Introduce the `scope` JWT claim (P3) alongside the existing `checkHotelAccess()`; run both in parallel behind a `FEATURE_*` flag; cut consumers over to scope-based checks; then remove the `HotelWorker` ACTIVE-membership branch from `permissions.ts`. Order is strict: **JWT scope must be live before the membership branch is removed** to avoid an authorization gap.

### Rollback strategy
- Every phase is additive, feature-flagged, and pre-launch. Rollback = disable the flag and redeploy the prior build. The `HotelWorker` table is retained (repurposed, not dropped) throughout, so no data is lost and the compatibility layer can be re-enabled if a phase regresses.

### Risks
- **High:** authorization replacement is cross-cutting — must not precede the JWT-scope build (strict ordering above).
- **High:** Hotel-Group association (`OD-EMP-05`) is undecided; per-hotel semantics cannot be dropped until it is.
- **Medium:** EMP itself is unfrozen with open decisions; this ADR is gated on EMP's own G2.
- **Medium:** four FROZEN specs carry roster/`checkHotelAccess` references; each forward-note must use the ADR-021 amendment discipline.

### Review impact
- This ADR requires human ratification (Constitution §20). EMP edits ride EMP's own G4/G2. Frozen-spec forward-notes are Correction-class (affected-reviewer re-verification), not re-freezes. No new gate or workflow is introduced.

## Scope note

This record settles the target-architecture disposition of `backend-hotel-workers` and the migration intent only. It authors no code, freezes no specification, amends no FROZEN specification, and performs no knowledge-layer reclassification — those are separate steps deferred to post-ratification. Physical retirement of the module is gated, phase by phase, on the prerequisite builds above.
