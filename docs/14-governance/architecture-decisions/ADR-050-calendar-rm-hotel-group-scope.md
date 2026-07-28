# ADR-050: Calendar Manager Edit Scope — Hotel Manager at Hotel Scope, Regional Manager at Hotel-Group Scope, Admin Globally

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-CAL-07`, the second sub-decision of `GD-18` (Calendar module scope, M2). Authored by the Lead Architect from `SPEC-CALENDAR-001`'s own `OD-CAL-07` entry and the commissioning human's explicit approval of Option (a), with the clarification that this decision is authorization-only and independent of the still-open organizational reporting model.
- **Date:** 2026-07-28
- **Scope:** `SPEC-CALENDAR-001`'s permission matrix and `IF-CAL-PlaceAssignment`. Applies the existing platform authorization model (`ADR-030`, `ADR-023`) to Calendar's own edit-scope question; does not modify either underlying ADR.
- **Supersedes:** none (additive — applies an already-existing platform mechanism to a module that hadn't yet adopted it).
- **Change class:** Architecture decision per Constitution §6/§7.

## Problem

`OD-CAL-07` asked which manager roles may edit the calendar, and specifically whether a Regional Manager's scheduling scope spans a Hotel Group — Calendar's own spec described this as unmodeled ("no enum token"). This was initially assumed to depend on `GD-03`'s still-open organizational reporting model (`OD-EMP-12`) since both concern "which manager can act across which scope" — but on inspection, `ADR-030` (Manager Write Authority) and `ADR-023` (Hotel-Group scope model) already generically resolved the Regional Manager scope question platform-wide: the `REGIONAL_MANAGER` token exists, and its scope resolves to `{type: 'hotel_group'}` via `HotelGroup.regional_manager_user_id`. What Calendar's own spec lacked was simply the application of that already-existing mechanism to its own interface.

## Decision

1. **Calendar adopts the existing platform authorization model established by `ADR-030` and `ADR-023`, without modification:** Hotel Manager may edit the calendar at hotel scope; Regional Manager may edit at hotel-group scope (resolved via `HotelGroup.regional_manager_user_id`, the same mechanism already used platform-wide); Admin may edit globally.

2. **No new permission token, scope type, or interface is introduced.** `IF-CAL-PlaceAssignment` uses the same `REGIONAL_MANAGER`/`HOTEL_MANAGER`/`ADMIN` roles and the same scope-resolution mechanism every other scope-aware interface in this platform already uses.

3. **This decision concerns authorization only.** It does not resolve, and does not depend upon, the still-open organizational reporting model (`OD-EMP-12`, part of `GD-03`'s org-chart half) — that question concerns reporting *relationships* for HR/analytics visibility purposes, a distinct concern from calendar-edit *authorization scope*, which `ADR-030`/`ADR-023` already settled generically.

## Rationale

- **The scope-resolution mechanism this decision needs already exists and is already generic platform infrastructure** (`ADR-030` D-5/D-7, `ADR-023`'s `HotelGroup` entity and RM/HM scope model) — Calendar adopting it is a direct, zero-new-mechanism application, not a fresh architecture decision.
- **Distinguishing authorization scope from the org-chart/reporting-model question avoids an unnecessary dependency.** `OD-CAL-07`'s own text conflated "no enum token" (which is actually already resolved platform-wide) with the org-chart question (which is genuinely still open) — separating them lets this decision proceed without waiting on `GD-03`'s unrelated remaining half.
- **Reusing the identical mechanism other interfaces already use** keeps the permission model consistent and auditable across modules, rather than inventing a Calendar-specific scope-resolution variant.

## Consequences

- `SPEC-CALENDAR-001`'s `OD-CAL-07` and its permission matrix are updated: Regional Manager calendar-edit scope is hotel-group-grain, using the existing mechanism, no new token.
- `IF-CAL-PlaceAssignment`'s Auth column may now state the concrete scope-resolution mechanism instead of disclosing an unmodeled gap.
- `GD-03`'s org-chart/reporting-model half (`OD-EMP-12`) remains open, entirely unaffected by this decision — it is not a prerequisite for, nor resolved by, this ADR.
- No code changes are made or authorized by this record — Calendar's manager weekly-plan placement view (`REQ-CAL-T01`) remains unbuilt; this settles its target authorization model for whenever it's built.

## Compatibility

No runtime behavior changes — no code exists for `IF-CAL-PlaceAssignment` or the manager weekly-plan placement view today. No migration, no rollback concern.

## Scope note

This settles Calendar's own manager edit-scope authorization only. It does not resolve `OD-EMP-12`/`GD-03`'s org-chart half, and does not resolve any other `GD-18` sub-decision.
