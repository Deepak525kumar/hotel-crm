# ADR-047: Employee-Management Bulk-Import — Per-Row Isolation, Duplicates Always Skipped

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving the invalid-row/duplicate-handling facet of `OD-EMP-08`, the ninth sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-EMP-001`'s own `OD-EMP-08` entry and the commissioning human's explicit approval of Option (b).
- **Date:** 2026-07-28
- **Scope:** `SPEC-EMP-001`'s bulk-CSV import capability (`REQ-EMP-006`). Resolves only the invalid-row/duplicate-handling facet of `OD-EMP-08` — the permission-holder facet was already resolved by `ADR-030` (2026-07-25) and is not reopened here.
- **Supersedes:** none (additive — `employee-management`'s bulk-import capability is not yet built for this facet).
- **Change class:** Product/architecture decision per Constitution §6/§7.

## Problem

`OD-EMP-08`'s invalid-row/duplicate-handling facet was left unresolved after `ADR-030` settled the permission-holder question (bulk-import stays Admin-only). Two concrete risks were named: (1) no defined behavior for a CSV row that fails validation, and (2) no defined duplicate-detection semantics — critically, a risk that a duplicate row could silently overwrite an existing employee's Personalfragebogen data, a real data-loss concern.

## Decision

1. **Per-row isolation.** A bulk-import CSV is processed row by row. Valid rows are imported; a single invalid row does not block or corrupt the import of any other row in the same file.

2. **Invalid rows are skipped and reported.** Each rejected row appears in a per-row error summary (row number, rejection reason) returned to the importing Admin. No row is silently dropped without disclosure.

3. **Duplicate rows (matched by an existing worker identifier) are always skipped and reported — never silently overwritten or merged.** This directly closes the data-loss risk `OD-EMP-08`'s own text named: importing a CSV that happens to include an already-existing worker's row never modifies that worker's existing Personalfragebogen data.

4. **No whole-file-atomic failure mode and no update-mode are introduced by this decision.** A single bad or duplicate row never blocks the entire file's valid rows (rejecting the all-or-nothing alternative), and intentional bulk-update-of-existing-records is out of scope here — duplicates are always skip-only under this resolution.

## Rationale

- **Directly satisfies the pre-existing constraint** `OD-EMP-08`'s own text already named as required ("duplicate semantics that do not silently overwrite an existing employee's Personalfragebogen data") — this decision implements exactly that constraint as the default, unconditional behavior.
- **Per-row isolation avoids an unnecessarily fragile all-or-nothing import.** Rejecting a whole-file-atomic approach (where one bad row out of hundreds blocks the entire batch) keeps a large legitimate import from failing over a single typo.
- **An explicit update-mode was considered and deferred, not rejected outright** — it is a reasonable future enhancement (intentional bulk updates to existing records) but adds meaningful surface (a second import mode, its own permission and audit questions) beyond what's needed to close the specific data-loss risk this decision addresses. If a future need for bulk-update-of-existing-records materializes, it should be its own decision, not retrofitted onto this one.

## Consequences

- `SPEC-EMP-001`'s `OD-EMP-08` is now fully resolved on both facets: permission-holder (`ADR-030`) and invalid-row/duplicate-handling (`ADR-047`).
- `REQ-EMP-006`'s acceptance criteria may now state the concrete per-row isolation and duplicate-skip behavior.
- No code changes are made or authorized by this record — bulk-import remains unimplemented for this facet; this settles the target behavior for whenever it's built.

## Compatibility

No runtime behavior changes — no code exists for this capability today. No migration, no rollback concern.

## Scope note

This settles invalid-row and duplicate-row handling only. It does not introduce a bulk-update-of-existing-records capability — that remains explicitly out of scope, to be decided separately if a future need arises. It does not resolve any other `GD-15` sub-decision.
