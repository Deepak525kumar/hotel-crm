# ADR-017: `state-user` Ownership — `backend-auth` Authoritative Writer, `backend-users` Bounded Profile Writer/Reader

- **Status:** Accepted — ratified by the commissioning human on 2026-07-15 via the G2 Approval Workflow.
- **Date:** 2026-07-15
- **Scope:** State ownership / module boundary — the shared-write `state-user` domain (`User` model, `backend/prisma/schema.prisma`), dual-written today by `backend-auth` and `backend-users` with no single authoritative writer recorded anywhere in the knowledge layer (`.claude/knowledge/STATE_OWNERSHIP_INDEX.yaml`; `OWNERSHIP_INDEX.yaml:38-39`).
- **Supersedes:** none (additive). Resolves the second, previously-OPEN half of `SYNC-005`/`SIR-GLOB-006` — the `state-user` dual-writer ambiguity — that `ADR-016` explicitly left open when it settled only the `state-audit-log` half.
- **Change class:** Material architecture/ownership decision requiring a Decision Record per Constitution §6/§7, mirroring the precedent of `ADR-016`. This record settles the authoritative-writer boundary only; no calling code changes as a result of this record alone (see Compatibility).

## Problem

`state-user` (`User`) is written by two modules — `backend-auth` (account creation, credential/role assignment, password lifecycle) and `backend-users` (profile management) — with `authoritative_writer` unrecorded. This is the same shared-write class `ADR-016` resolved for `state-audit-log`, and the last open state-ownership ambiguity blocking G2 Specification Freeze for `SPEC-AUTH-001` and `SPEC-USERS-001`. A frozen specification set cannot have two modules each claiming authoritative write to one state domain without an architectural inconsistency.

## Decision

1. **`backend-auth` is the authoritative writer of `state-user` (`User`).** It owns account existence, identity, credentials, and role/permission assignment — the security-bearing fields — consistent with `backend-auth` already owning the platform's other identity/security state domains (`Session`, `PasswordResetToken`, and, per `ADR-016`, `state-audit-log`). This resolves `SYNC-005`/`SIR-GLOB-006`'s `state-user` half.
2. **`backend-users` is a bounded profile writer/reader.** It may write only the non-security profile surface of `User` (display/profile attributes) and reads identity fields; it does not create accounts, assign roles/permissions, or manage credentials. It is a bounded writer within the boundary `backend-auth` owns, not a co-authoritative writer.
3. **Role and permission assignment is exclusively `backend-auth`'s.** This is consistent with HOTFIX-AUTH-001 (`SYNC-017`), which already hardcoded server-side role assignment in `AuthService`, and with the `SPEC-USERS-001` framing corrections (`SIR-USERS-002/003`).

## Rationale

- **Narrowest change consistent with today's code shape:** identity/credential/role writes already originate in `backend-auth`; naming it authoritative encodes the existing reality rather than moving code.
- **Precedent coherence:** mirrors `ADR-016` exactly (auth as authoritative writer of the security-adjacent state it already contextually owns; the second module as a bounded/read consumer).
- **Security posture:** consolidating role/permission writes under one owner removes the dual-writer surface that made privilege-assignment defects (e.g. `SIR-GLOB-012` signup role-injection) possible in the first place.

## Consequences

- `SPEC-AUTH-001` and `SPEC-USERS-001` become architecturally consistent on `state-user` and are unblocked for G2 on this axis.
- `backend-users`' spec must, at its next authoring pass, reflect its bounded-writer role (non-security profile fields only). This is a Documentation-Workflow action this record unblocks but does not itself perform; it does not block the two specs frozen at G2 under the already-corrected framing.
- Knowledge layer updated: `STATE_OWNERSHIP_INDEX.yaml`, `OWNERSHIP_INDEX.yaml`, `BOUNDARY_INDEX.yaml` record `state-user` `authoritative_writer: backend-auth`.

## Compatibility

No runtime behavior changes as a result of this record alone. Existing call sites continue to write through their current code paths; the record assigns accountability, it does not relocate writes. Any future narrowing of `backend-users`' write surface to the bounded profile fields is separate implementation work tracked against `SPEC-USERS-001`.

## Scope note

This settles the `state-user` authoritative-writer boundary only. Owner *assignment* (`SIR-GLOB-001`/`SYNC-001`) and `permissions-middleware` ownership reassignment (`SIR-GLOB-007`/`OQ-AUTH-07`) remain OPEN under their own rows and are handled on the implementation track.
