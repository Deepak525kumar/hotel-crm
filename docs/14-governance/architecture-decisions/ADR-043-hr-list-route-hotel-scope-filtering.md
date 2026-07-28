# ADR-043: HR List-Route Hotel-Scope Filtering — Extend `checkWorkerScope()` to Contract/Payroll List Routes

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-HR-13`'s remaining list-route half, the fifth sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-HR-001`'s own `OD-HR-13` entry and the commissioning human's explicit approval of Option (a).
- **Date:** 2026-07-28
- **Scope:** `SPEC-HR-001`. Resolves the list-route remainder of `OD-HR-13` — `IF-HR-ListContracts`/`GET /contracts` and `IF-HR-ListPayroll`/`GET /payroll`. Does not reopen the write-path half, already resolved by `ADR-030` PR-1.
- **Supersedes:** none (additive — extends an existing, already-shipped middleware to two additional routes; `backend-hr` has zero code for these specific list endpoints today).
- **Change class:** Architecture/security decision per Constitution §6/§7.

## Problem

`OD-HR-13` (High, `FIND-SEC-HR-04`) identified that `backend-hr`'s routes used only `authMiddleware`/`requirePermission`, never hotel/group-scope enforcement — a Hotel Manager could read/write contract and payroll data, including Tier-3-sensitive IBAN/tax-ID fields, for workers at hotels they don't manage. `ADR-030` PR-1 resolved the write-path half: `POST /contracts`, `POST /payroll`, and `POST /workers/:worker_id/documents` now require `checkWorkerScope()` (group-grain, via `EmploymentRecord.hotel_group_id`). The list routes (`GET /contracts`, `GET /payroll`) were narrowed to `requireRole('admin')` only, as a stopgap, because no query-filter schema or data model existed yet to filter list results against. `ADR-039` (this session, `GD-15` sub-decision 1) has since settled the target request/response shapes for these interfaces, removing that blocker.

## Decision

1. **`checkWorkerScope()`'s existing group-grain filtering extends to the list routes.** `GET /contracts` and `GET /payroll` become available to `MANAGER` (not Admin-only), with results server-side filtered to only workers within the calling manager's own `hotel_group_id` — the identical mechanism and grain already built and shipped for the write path.

2. **`ADMIN` retains unscoped list access**, unchanged from today.

3. **No new authorization pattern is introduced.** This is a direct extension of an already-proven mechanism to a second route class, not a new middleware or a different scoping grain.

## Rationale

- **Reuses a proven mechanism rather than inventing a new one:** `checkWorkerScope()` already exists, is already shipped (`ADR-030` PR-1), and already solves the identical scoping problem for the write path — extending it to list routes is the minimal-surface fix.
- **Closes a real functionality gap, not just a security question:** the Admin-only stopgap left Managers with no way to see even their own hotel-group's contract/payroll requests — a legitimate operational need once the module is built, not merely a theoretical access-control tightening.
- **The original blocker (no query-filter schema) is now resolved** by `ADR-039`'s target-type redesign, making this extension buildable rather than speculative.

## Consequences

- `SPEC-HR-001`'s `OD-HR-13` row is updated to reflect both halves resolved: write-path (`ADR-030` PR-1) and list-route (`ADR-043`), both via `checkWorkerScope()`.
- No code changes are made or authorized by this record — the list routes remain unimplemented; this settles the target scoping behavior for whenever they're built.
- `OD-HR-13`'s own remaining caveat ("every target-state interface in this spec that has no current route yet") is unaffected — this ADR resolves only the two named list routes, not every future HR interface's scoping question in advance.

## Compatibility

No runtime behavior changes — the list routes are currently Admin-only stubs with no query-filter implementation; this settles their target shape, it does not change shipped behavior.

## Scope note

This settles list-route scoping for `GET /contracts`/`GET /payroll` only. It does not resolve any other `GD-15` sub-decision, and does not retroactively scope any interface not named here.
