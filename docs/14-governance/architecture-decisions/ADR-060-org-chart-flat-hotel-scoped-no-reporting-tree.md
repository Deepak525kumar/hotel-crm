# ADR-060: Org-Chart / Reporting Model — Flat Hotel-Scoped, No Explicit Reporting Tree

- **Status:** Accepted — ratified by the commissioning human on 2026-07-29, resolving `GD-03`'s
  remaining org-chart/reporting-relationship half (`OD-EMP-12`, `SIR-EMP-009`; the twin auth-side
  citation `OQ-AUTH-08`/`SIR-AUTH-009` names the same underlying fact, not a separate decision).
  This closes `GD-03` in full — its permission-set half was already decided by `ADR-030` D-5
  (2026-07-25); this record settles the data-model half `ADR-030` §7/§8 explicitly left open.
  Authored by the Lead Architect from the commissioning human's verbatim ratification instruction.
- **Date:** 2026-07-29
- **Scope:** `SPEC-EMP-001`'s `OD-EMP-12` (org-chart/reporting-relationship model underlying
  `REQ-EMP-013`'s confirmed RM+Admin visibility) and `SPEC-AUTH-001`'s `OQ-AUTH-08` data-model half
  (its permission half already resolved by `ADR-030`). Also names the architectural eligibility
  condition `ADR-058` (Job-Dispatch Migration Strategy) set for Job-Dispatch/Epic 9: "architecturally
  eligible once `GD-03` is resolved."
- **Supersedes:** none (additive — resolves an open decision `ADR-030` explicitly declined to
  settle, using that same ADR's existing scope-based authorization model rather than introducing a
  new one).
- **Change class:** Product/architecture decision per Constitution §6/§7 — resolves the last
  standalone `GD-01..23` item outside `GD-19`'s deferred remainder and `OD-HR-02b`.

## Problem

`REQ-EMP-013` confirms org-chart visibility ("who reports to whom") is restricted to Regional
Manager and Admin (CRR §1). `ADR-030` (`OQ-030-B`) resolved the *permission* half of that
requirement — `org_chart:read` granted to Admin + Regional Manager — but explicitly declined to
resolve the underlying *data model*: no `reports_to`/manager-hierarchy field or concept exists
anywhere in the repository (verified: no such column on `User`/`EmploymentRecord`/`HotelWorker`; no
org-chart route). Without this model, `REQ-EMP-013`'s structure is undefined and `PERF-EMP-004`
(query-complexity-vs-Hotel-Group-cardinality) cannot be assessed. `ADR-058` additionally names this
same gap (under its `GD-03` label) as Job-Dispatch's own architectural eligibility gate: Job-Dispatch
Phase 1 depends on the Regional Manager role/scope model, which this decision's org-chart half
governs.

## Decision

1. **Flat, hotel-scoped. No explicit manager→worker reporting edge is introduced.** No new
   `reports_to_user_id` FK, no hierarchy/tree table, no reporting-chain concept of any kind is added
   to the data model.

2. **"Reports to" / org-chart visibility is derived implicitly from existing hotel/hotel-group scope
   membership**, using the platform's already-established scope-based authorization model — the
   same discriminated JWT `scope` claim (`{type: "hotel", hotel_id} | {type: "hotel_group",
   hotel_group_id} | {type: "global"}`) `ADR-023` introduced and `ADR-030` (D-5) extended to
   Regional Manager. A worker's effective manager(s) are whoever holds manager/Regional-Manager/
   Admin scope over that worker's hotel: Hotel Manager scope resolves to the worker's one
   `hotel_id`; Regional Manager scope resolves to every hotel where `Hotel.hotel_group_id` matches
   the RM's managed `HotelGroup.id` (`ADR-023` §5; `ADR-030` D-5); Admin is global. No new
   authorization primitive is introduced — this decision reuses `ADR-023`/`ADR-030`'s existing
   mechanism rather than adding one.

3. **Job Dispatch's manager-assignment routing is built against hotel/hotel-group membership, not an
   org-chart tree.** Job Dispatch only needs to know which managers and workers belong to a given
   hotel or hotel group; it has no need for a reporting-chain query.

4. **This explicitly defers building any hierarchy/approval-chain/escalation model.** If a future
   requirement introduces approval chains, managerial hierarchies, escalations, or reporting-line
   queries that hotel/hotel-group membership cannot answer, a new architecture decision is required
   then, grounded in that confirmed requirement — not invented here in its absence (Constitution
   §12).

5. **This resolves `GD-03` in full.** `ADR-030` D-5 already decided the permission set (`org_chart:
   read` → Admin + Regional Manager); this record decides the data model the permission reads from.
   No further sub-decision remains under `GD-03`.

## Rationale

- **Every approved architecture decision to date already follows the scope-based pattern.**
  `ADR-023` (Hotel-Group domain model, JWT scope claim), `ADR-030` (manager write authority,
  Regional-Manager operational scope) both authorize by hotel/hotel-group scope, never by an
  explicit reporting edge. Introducing a parallel hierarchy concept here would fork the
  authorization model in two directions for no confirmed requirement.
- **No confirmed requirement depends on an explicit reporting tree.** `REQ-EMP-013` requires
  *visibility* of "who reports to whom" for RM/Admin, which a scope-derived view satisfies exactly:
  an RM's "reports" are every worker at every hotel in their group; nothing in CRR/PDD describes
  approval chains, multi-level escalation, or a hierarchy deeper than manager/RM/Admin. Modeling a
  tree the requirements never describe would manufacture a requirement, which Constitution §12
  prohibits — the same discipline `GD-22`'s billing disposition applied.
- **Reversible, minimal-cost deferral.** Nothing about the flat model forecloses adding an explicit
  reporting edge later — if approval chains or escalations are confirmed, a new FK/table is an
  additive schema change, not a rework of this decision's consequences. Building the tree now, before
  any such requirement exists, would be strictly more expensive to get right and harder to reverse
  than deferring it.
- **Resolves `PERF-EMP-004` at the design level.** Query complexity for group-wide/org-chart reads is
  now bounded by hotel/hotel-group membership cardinality (already the basis for every other
  scope-filtered query in the platform, per `ADR-035`'s workload baseline), not by an unbounded
  reporting-tree traversal — no separate performance decision is required.

## Consequences

- `SPEC-EMP-001`'s `OD-EMP-12` resolves: flat hotel-scoped, no reporting-tree data model. `REQ-EMP-013`
  is now implementable: RM/Admin org-chart visibility is a scope-filtered read over
  hotel/hotel-group membership, no new schema.
- `SPEC-AUTH-001`'s `OQ-AUTH-08` fully resolves (both permission and data-model halves); no further
  auth-side action remains.
- **`ADR-058`'s named eligibility gate for Job-Dispatch (`GD-20`/Epic 9) is satisfied.** Job-Dispatch
  implementation is now architecturally eligible. This record does not authorize, schedule, or plan
  Job-Dispatch's implementation — per `ADR-058`'s own §4, scheduling remains implementation
  planning's responsibility, exercised in a future, dedicated pass.
- No schema change is authorized or required by this record (no `reports_to_user_id` FK is added).
  Any future approval-chain/escalation/hierarchy requirement requires its own new architecture
  decision.
- No code changes are made or authorized by this record.

## Compatibility

No runtime behavior changes — no org-chart endpoint or reporting-hierarchy code exists yet to be
affected. No migration, no rollback concern at the governance layer.

## Scope note

This settles only the org-chart/reporting-relationship data model and closes `GD-03`. It does not
author Job-Dispatch's (Epic 9) PR sequence or implementation plan — that is a distinct, later,
dedicated implementation-planning pass. It does not reopen `ADR-030`'s permission-set decision or
any other resolved `GD-*` item.

## Addendum (2026-08-05, PR6 documentation synchronization)

The Compatibility section's "no org-chart endpoint... exists yet" is now stale as a statement of
current repository fact — it was accurate when this record was ratified (2026-07-29) and remains
accurate as a description of what *this ADR itself* authorized (still nothing; see "No code changes
are made or authorized by this record" above). A route implementing the flat, hotel-scoped model
this ADR settled was subsequently built under the Regional Manager V1 authorization work
(`GET /hotel-groups/:hotel_group_id/org-chart`, `backend/src/modules/employee-management/routes.ts`,
gated on the `org_chart:read` token this record's data-model decision made meaningful, shipped in
PR #338) and a corresponding frontend page under PR #339
(`frontend/app/(protected)/hotel-groups/[id]/org-chart/`). That implementation conforms to this
ADR's flat/no-reporting-tree model — no `reports_to` field, no hierarchy, group-grain employee
listing exactly as described in this record's body — so it required no new architecture decision to
build, consistent with this record's own framing as "architecturally eligible" work. This addendum
is appended rather than editing the original Compatibility text, per this repository's append-only
convention for correcting a ratified record (the same pattern applied to `documents/MODULE_SPEC.md`'s
Change Log).
