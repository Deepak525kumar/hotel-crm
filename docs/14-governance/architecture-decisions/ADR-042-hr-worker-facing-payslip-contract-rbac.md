# ADR-042: HR Worker-Facing RBAC — Narrow Self-Scoped Permissions for Payslip Request and Contract Status

- **Status:** Accepted — ratified by the commissioning human on 2026-07-28, resolving `OD-HR-10`, the fourth sub-decision of `GD-15` (HR & Employee-Management module build scope). Authored by the Lead Architect from `SPEC-HR-001`'s own `OD-HR-10` entry (including its `FIND-SEC-HR-03` security strengthening) and the commissioning human's explicit approval of Option (a).
- **Date:** 2026-07-28
- **Scope:** `SPEC-HR-001`. Resolves `OD-HR-10` and the worker-facing rows of the permission matrix; directly satisfies `FIND-SEC-HR-03`'s IDOR-prevention requirement for `IF-HR-RequestPayslip` and `IF-HR-GetContractStatus`.
- **Supersedes:** none (additive — `backend-hr` has zero code; no existing permission is removed or narrowed).
- **Change class:** Architecture/security decision per Constitution §6/§7.

## Problem

`backend-hr`'s current-state RBAC (`ROLE_PERMISSIONS` in `backend/src/config/constants.ts`) grants `hr:read`/`hr:write` only to `ADMIN`/`MANAGER` — `WORKER` and `CHECKER` hold no `hr:*` permission of any kind. This directly conflicts with CRR §23's confirmed requirement that a worker can request their own payslip, and with the general need for a worker to view their own contract status. A prior G4 Security review (`FIND-SEC-HR-03`, High) additionally required that whoever resolves this MUST scope any worker-facing `worker_id` parameter to the authenticated caller's own identity — never a client-supplied path/body parameter — and explicitly warned that extending blanket `hr:read`/`hr:write` to `WORKER` would NOT satisfy the requirement (it would grant a worker read/write over all HR data, not just their own).

## Decision

1. **Two new narrow-scope permissions are introduced:** `hr:payslip:request` (a `WORKER` may create a payslip request, scoped to their own `worker_id` only) and `hr:contract:read-own` (a `WORKER` may read their own contract status only — never another worker's).

2. **Both permissions are self-scoped by construction, not by implementation discipline.** The `worker_id` used for both `IF-HR-RequestPayslip` and `IF-HR-GetContractStatus` MUST be derived server-side from the authenticated caller's own identity (JWT claim), never accepted as a client-supplied path or body parameter for `WORKER`-role callers. This directly satisfies `FIND-SEC-HR-03`'s IDOR-prevention requirement as a structural property of the permission's own definition, not a separate check layered on top.

3. **No blanket `hr:read`/`hr:write` extension to `WORKER` is introduced.** `ADMIN`/`MANAGER` retain their existing broader `hr:read`/`hr:write` scope unchanged; the two new permissions are additive and worker-exclusive.

4. **This mirrors the platform's existing narrow-capability permission pattern** (e.g. `org_chart:read`, established by `ADR-030`) — a purpose-specific permission string per capability, rather than overloading one permission name with different scope meanings depending on the caller's role.

## Rationale

- **Directly satisfies the pre-existing security requirement rather than working around it.** `FIND-SEC-HR-03` explicitly named the wrong answer (blanket permission extension) and the right shape (self-scoped, server-derived). Option (a) implements exactly that shape.
- **Rejected alternative (reusing `hr:read`/`hr:write` with a middleware self-scope check for Worker-role callers)** would conflate two different scope meanings ("can read any HR data" vs. "can read only my own") under one permission name — harder to reason about at a permission-matrix glance, and a worse fit for the platform's own established narrow-permission convention.

## Consequences

- `SPEC-HR-001`'s `OD-HR-10` row and permission matrix are updated to show `hr:payslip:request`/`hr:contract:read-own` as the resolved worker-facing permissions, both self-scoped.
- `IF-HR-RequestPayslip` and `IF-HR-GetContractStatus`'s Auth columns should state the server-derived-`worker_id` precondition explicitly as a MUST, mirroring how other worker-facing interfaces in this platform state equivalent preconditions (e.g. Consent's `ADR-037` precondition, Chatbot's `FIND-SEC-R3-01` precondition).
- No code changes are made or authorized by this record — `backend-hr` remains zero-code; this settles the target permission model for whenever the module is built.

## Compatibility

No runtime behavior changes — no code exists for this capability today. No migration, no rollback concern. `ADMIN`/`MANAGER`'s existing `hr:read`/`hr:write` scope is unchanged.

## Scope note

This settles worker-facing RBAC for payslip requests and contract-status reads only. It does not resolve any other `GD-15` sub-decision, and does not itself implement the `checkWorkerScope()`-style middleware enforcement — that remains an ordinary implementation task once `backend-hr` is built, informed by this decision's requirement that the scoping be structural (server-derived), not optional.
