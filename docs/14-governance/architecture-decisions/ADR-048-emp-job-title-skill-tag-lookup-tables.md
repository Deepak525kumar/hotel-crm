# ADR-048: Job Title & Skill Tags — Admin-Managed Lookup Tables, Retire-Not-Delete

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-EMP-13` (Job Title value domain) and `OD-EMP-14` (skill-tag governance), the tenth and final sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-EMP-001`'s own `OD-EMP-13`/`OD-EMP-14` entries and the commissioning human's explicit approval of Option (a) for both, with an explicit retire-not-delete requirement.
- **Date:** 2026-07-28
- **Scope:** `SPEC-EMP-001`'s `REQ-EMP-001` (Job Title) and `REQ-EMP-003` (skill tags).
- **Supersedes:** none (additive — `employee-management` has no shipped data model for either field yet, beyond its Epic-5 slice).
- **Change class:** Product/architecture decision per Constitution §6/§7.

## Problem

Two related fields lacked a settled data-model shape: `OD-EMP-13` — whether Job Title is free-text or a controlled list; `OD-EMP-14` — whether the skill-tag set (already fixed in content and basis) is administratively editable or a fixed, code-defined enum. Both affect the actual schema shape (a controlled list needs a lookup table; free-text needs only a string column) and the operational surface (whether adding a new value requires a code deployment or an Admin action).

## Decision

1. **Both Job Title and skill tags are controlled lists, implemented as Admin-managed lookup tables — not hard-coded enums.**

2. **Admin may add or retire values without requiring a deployment.** Both are configuration-like data, managed operationally, not code changes.

3. **An existing value referenced by any record is never deleted.** Retirement is via an `is_active` (or equivalent) flag on the lookup table row: a retired value remains valid for any historical record that already references it, and is excluded only from future assignment (e.g., not offered in a picklist for new job-title/skill-tag selection going forward).

## Rationale

- **A controlled list (over free-text) keeps both fields consistent for downstream filtering, reporting, and job-matching.** Free-text job titles would produce typo/phrasing variants of the same role (e.g., "Housekeeper" vs. "House Keeper") that break any query grouping or filtering by title.
- **Admin-editable (over a fixed code-defined enum) matches the platform's general pattern of giving Admin operational control over configuration-like data without requiring engineering involvement** for what is fundamentally a data-entry change, not a code change.
- **Retire-not-delete is a referential-integrity requirement, not a nice-to-have:** deleting a lookup value that's referenced by existing employee records would either orphan those references or require silently rewriting historical data — both are unacceptable for records with audit/compliance weight. An `is_active` flag preserves historical accuracy while still preventing the retired value from being assigned going forward.
- **A lookup table (not a hard-coded enum) is required by the Admin-editable requirement itself** — an enum's value set is fixed at compile/deploy time; only a table-backed value set can be modified by an Admin action at runtime.

## Consequences

- `SPEC-EMP-001`'s `OD-EMP-13` and `OD-EMP-14` are resolved with an identical pattern: Admin-managed lookup table, add/retire via Admin action, `is_active`-style retirement preserving referential integrity for historical records.
- `REQ-EMP-001` (Job Title) and `REQ-EMP-003` (skill tags) may now state their concrete target data-model shape (lookup table + `is_active` flag) instead of an unspecified value domain.
- This is the tenth and final `GD-15` sub-decision — all ten are now resolved: `OD-HR-02` (`ADR-039`), `OD-HR-03`/`OD-HR-07` (`ADR-040`), `OD-HR-09` (`ADR-041`), `OD-HR-10` (`ADR-042`), `OD-HR-13` (`ADR-043`), `OD-HR-14` (`ADR-044`), `OD-EMP-04` (`ADR-045`), `OD-EMP-06` (`ADR-046`), `OD-EMP-08` (`ADR-047`), `OD-EMP-13`/`OD-EMP-14` (`ADR-048`). `GD-15` itself may now be marked Decided in the governance tracking documents.
- No code changes are made or authorized by this record — neither field's lookup-table schema exists yet; this settles the target shape for whenever `employee-management`'s remaining scope is built.

## Compatibility

No runtime behavior changes — no lookup-table schema exists for either field today. No migration, no rollback concern.

## Scope note

This settles the data-model shape and retirement mechanics for Job Title and skill tags only. It does not specify the initial seed values for either lookup table (an implementation/content detail, not a governance question), and it is the final `GD-15` sub-decision — `GD-15` itself is now fully resolved.
