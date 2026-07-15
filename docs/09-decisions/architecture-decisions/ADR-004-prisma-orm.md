# ADR-004: Prisma ORM

## Status

**Accepted** — 2026-07-04 (ratified 2026-07-15 by the commissioning human via the G2 Approval Workflow; see `.claude/CHANGELOG.md`)

Deciders: Authored by AI Engineering Platform; formal ratification was granted by the commissioning human on 2026-07-15 (G2 Approval Workflow; see `.claude/CHANGELOG.md`).

- Supersedes: none
- Superseded by: none

This record documents the data-access and migration tooling currently implemented in the repository; it was human-ratified on 2026-07-15 (G2 Approval Workflow).

## Context

The backend needs type-safe database access and a repeatable schema-migration mechanism that works consistently across development and production.

Forces:

- The codebase is TypeScript; type-safe query construction reduces a class of runtime errors.
- Schema evolution must be version-controlled and applied deterministically in CI/CD.
- The team wants to avoid vendor lock-in at the data layer (`README.md:196-198`).

Current-state facts:

- The Prisma schema declares the `prisma-client-js` generator (`backend/prisma/schema.prisma:9-11`).
- `@prisma/client` (^5.12.0) is a runtime dependency and `prisma` (^5.12.0) is a dev dependency (`backend/package.json:26,45`).
- `postinstall` runs `prisma generate`; `migrate:deploy` runs `prisma migrate deploy`; additional scripts cover `migrate dev`, `db push`, `studio`, and `seed` (`backend/package.json:8,14-18`).
- The production deploy workflow runs `npx prisma migrate deploy` as a gated step (`.github/workflows/deploy-production.yml:66-70`).

## Decision

Prisma is the project's ORM and data-access layer, and Prisma Migrate is the schema-migration tool. The generated `prisma-client-js` client is the type-safe database interface for backend modules. This ADR records the existing implemented state.

Scope: applies to backend persistence access and migrations. Generated Prisma client code is a generated artifact and must be regenerated from `schema.prisma` rather than hand-edited (consistent with `.claude/constitution/ENGINEERING_CONSTITUTION.md:96`).

## Consequences

Positive:

- Type-safe queries generated from a single schema source reduce data-layer errors.
- Migrations are version-controlled and applied deterministically in CI via `prisma migrate deploy` (`.github/workflows/deploy-production.yml:66-70`).

Negative:

- A `postinstall` `prisma generate` step couples installs to schema generation (`backend/package.json:8`).
- Prisma abstracts SQL; complex or performance-critical queries may require raw SQL escape hatches.

Neutral / operational:

- Prisma version is pinned by constraint at ^5.12.0 for both client and CLI (`backend/package.json:26,45`).
- The deploy workflow's migration-status handling depends on Prisma 5.x behavior (`.github/workflows/deploy-production.yml:43-62`).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| Prisma (chosen) | Type-safe client + Prisma Migrate from one schema | Matches implemented state; type-safe queries and deterministic migrations for a TS codebase |
| TypeORM / Sequelize | Alternative Node ORMs | No evidence in repository; would duplicate an already-implemented responsibility (`.claude/constitution/ENGINEERING_CONSTITUTION.md:87`). Not evaluated in depth (UNKNOWN) |
| Raw SQL / query builder (e.g. Knex) | Hand-written SQL or lightweight builder | Loses generated type safety and integrated migration tooling; more boilerplate for module CRUD |
| Status quo | No ORM decision recorded | Persistence tooling is load-bearing and should be anchored in a Decision Record |

## Related Documents

- [Prisma schema](../../../backend/prisma/schema.prisma)
- [Backend package manifest](../../../backend/package.json)
- [Production deploy workflow](../../../.github/workflows/deploy-production.yml)
- [Project README](../../../README.md)
- [ADR-005: PostgreSQL Database](ADR-005-postgresql-database.md)
- [ADR-003: Modular Monolith Architecture](ADR-003-modular-monolith-architecture.md)
- [Engineering Constitution](../../../.claude/constitution/ENGINEERING_CONSTITUTION.md)

## Evidence

| Claim | Status | Source (path:line) |
|---|---|---|
| `prisma-client-js` generator is declared | Confirmed | `backend/prisma/schema.prisma:9-11` |
| `@prisma/client` ^5.12.0 is a runtime dependency | Confirmed | `backend/package.json:26` |
| `prisma` ^5.12.0 is a dev dependency | Confirmed | `backend/package.json:45` |
| `postinstall` runs `prisma generate` | Confirmed | `backend/package.json:8` |
| `migrate:deploy` runs `prisma migrate deploy`; migrate/push/studio/seed scripts exist | Confirmed | `backend/package.json:14-18` |
| Production deploy runs `npx prisma migrate deploy` | Confirmed | `.github/workflows/deploy-production.yml:66-70` |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Ownership: no accountable owner is assigned for the data-access layer (no CODEOWNERS; `backend/package.json:23` author empty). Pending human authority.
- Ratification: this ADR was ratified (Proposed → Accepted) by the commissioning human on 2026-07-15 (G2 Approval Workflow).
