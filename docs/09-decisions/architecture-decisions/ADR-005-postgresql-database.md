# ADR-005: PostgreSQL Database

## Status

**Proposed** — 2026-07-04

Deciders: Authored by AI Engineering Platform; formal ratification is reserved human authority (see `.claude/CHANGELOG.md` v1.0.0 Known Limitations).

- Supersedes: none
- Superseded by: none

This record documents the primary datastore currently implemented in the repository; it is not yet human-ratified.

## Context

The application needs a primary relational datastore that is consistent between development and production and integrates with the chosen ORM (see ADR-004).

Forces:

- Relational integrity and transactional semantics fit the domain (hotels, workers, applications, attendance, HR/payroll).
- Using the same engine in development and production reduces environment-specific defects.
- The chosen ORM (Prisma) targets a specific datasource provider.

Current-state facts:

- The Prisma datasource sets `provider = "postgresql"` with `url = env("DATABASE_URL")` (`backend/prisma/schema.prisma:13-16`).
- Local development provisions PostgreSQL 15 via Docker Compose (`postgres:15-alpine`) (`docker-compose.yml:2-7`).
- Production supplies the database connection through the `PROD_DATABASE_URL` CI secret injected as `DATABASE_URL` into migration steps (`.github/workflows/deploy-production.yml:64,70`).

## Decision

PostgreSQL is the project's primary relational datastore. The database connection is provided via the `DATABASE_URL` environment variable; development uses PostgreSQL 15 in Docker Compose, and production uses a PostgreSQL instance addressed by an injected connection-string secret. This ADR records the existing implemented state.

Scope: covers the primary transactional datastore. Redis is a separate optional performance/cache layer (README describes it as optional and not a source of truth, `README.md:199-204`) and is out of scope for this ADR.

## Consequences

Positive:

- Same engine (PostgreSQL) in development and production reduces environment drift (`docker-compose.yml:2-7`; `.github/workflows/deploy-production.yml:64`).
- Relational/transactional guarantees suit the domain and integrate cleanly with Prisma (ADR-004).

Negative:

- Operating a relational database (backups, migrations, connection management) is an ongoing operational responsibility.

Neutral / operational:

- The production database is addressed via a `DATABASE_URL` secret; the concrete hosting form of that instance is not asserted here (see Open Questions and ADR-006).
- Migrations are applied against production via Prisma Migrate in CI (`.github/workflows/deploy-production.yml:66-70`).

## Alternatives Considered

| Option | Description | Why not chosen |
|---|---|---|
| PostgreSQL (chosen) | Relational engine, same in dev and prod, Prisma-native | Matches implemented state; strong relational/transactional fit and dev/prod parity |
| MySQL / MariaDB | Alternative relational engines | No evidence in repository; Prisma provider is set to `postgresql` (`backend/prisma/schema.prisma:14`) |
| Supabase / hosted BaaS | Managed Postgres-plus-services platform | README explicitly rejects Supabase to avoid vendor lock-in (`README.md:196-198`) |
| NoSQL (e.g. MongoDB) | Document store | Domain is relational (referential entities, HR/payroll); no evidence of a document model |
| Status quo | No datastore decision recorded | The primary datastore is load-bearing and should be anchored in a Decision Record |

## Related Documents

- [Prisma schema](../../../backend/prisma/schema.prisma)
- [Docker Compose (development services)](../../../docker-compose.yml)
- [Production deploy workflow](../../../.github/workflows/deploy-production.yml)
- [Project README](../../../README.md)
- [ADR-004: Prisma ORM](ADR-004-prisma-orm.md)
- [ADR-006: AWS Deployment Architecture](ADR-006-aws-deployment-architecture.md)

## Evidence

| Claim | Status | Source (path:line) |
|---|---|---|
| Prisma datasource provider is `postgresql`, url from `DATABASE_URL` | Confirmed | `backend/prisma/schema.prisma:13-16` |
| Development runs PostgreSQL 15 via `postgres:15-alpine` in Docker Compose | Confirmed | `docker-compose.yml:2-7` |
| Production `DATABASE_URL` is injected from the `PROD_DATABASE_URL` CI secret | Confirmed | `.github/workflows/deploy-production.yml:64,70` |
| Supabase rejected to avoid vendor lock-in | Confirmed | `README.md:196-198` |
| Concrete production Postgres hosting (managed vs. self-hosted, e.g. RDS) | UNKNOWN | Production DB reached only via `DATABASE_URL` secret; no infrastructure evidence identifies the host |
| Owner / accountable party for this decision | UNKNOWN | No CODEOWNERS; `backend/package.json:23` author empty |

## Open Questions

- Production hosting: the concrete production PostgreSQL host is UNKNOWN — the connection is supplied only as a `DATABASE_URL` secret and no repository evidence confirms a managed service such as AWS RDS. See ADR-006 Open Questions.
- Ownership: no accountable owner is assigned (no CODEOWNERS; `backend/package.json:23` author empty). Pending human authority.
- Ratification: this ADR is `Proposed`; ratification is reserved human authority.
