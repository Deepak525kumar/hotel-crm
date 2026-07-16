# Migration + Rollback Harness (S0-2)

| Field | Value |
|---|---|
| Backlog item | S0-2 — Prisma migration + rollback harness (EPIC-PLATFORM, Phase 0) |
| Decisions | [ADR-004 (Prisma ORM)](../../14-governance/architecture-decisions/ADR-004-prisma-orm.md), [ADR-005 (PostgreSQL)](../../14-governance/architecture-decisions/ADR-005-postgresql-database.md) |
| Harness | [`backend/scripts/migrate-harness.sh`](../../../backend/scripts/migrate-harness.sh) |
| CI | [`.github/workflows/migration-harness.yml`](../../../.github/workflows/migration-harness.yml) |

## Why this exists

Forward migrations are applied deterministically by `prisma migrate deploy` in
CI and in the staging/production deploy workflows (ADR-004). Prisma Migrate has
**no native down/rollback**: the production deploy performs a *code-only*
rollback and explicitly assumes migrations are backward-compatible
(`.github/workflows/deploy-production.yml`, "Rollback model"). S0-2 closes that
gap with a reviewed, deterministic rollback path layered on top of the existing
tooling — it does not replace `prisma migrate deploy`.

## Mechanism

1. **Paired-down convention.** Every forward migration
   `backend/prisma/migrations/<timestamp>_<name>/migration.sql` ships a sibling
   `down.sql` that reverses it (idempotent `DROP ... IF EXISTS ... CASCADE`).
   The harness `check-pairs` command and the CI job fail if any migration lacks
   one. **Authoring a new migration therefore requires writing its `down.sql` in
   the same change.**
2. **Reversible history.** Rolling back runs a migration's `down.sql` inside a
   single transaction and then deletes its `_prisma_migrations` history row, so a
   subsequent `prisma migrate deploy` cleanly **re-applies** it (recovery).
3. **Production-shaped snapshot.** A database built from the full committed
   migration chain on an empty database has the exact shape of production with no
   developer drift. The harness dry-runs against exactly this, and `snapshot`
   exports the data-free schema for offline dry-runs (CI uploads it as the
   `production-shape-schema` artifact).
4. **No-op probe.** [`backend/prisma/harness/noop_probe/`](../../../backend/prisma/harness/noop_probe/)
   is a schema-neutral migration used only by the harness self-test. It proves
   the forward → rollback → recovery machinery end-to-end independently of any
   real schema change (the S0-2 acceptance criterion). It lives outside
   `prisma/migrations/`, so `prisma migrate deploy` never applies it to a real
   environment.

## Commands

Run from `backend/` with `DATABASE_URL` pointing at a **throwaway** database.
`verify` and `down` drop the `public` schema, so they refuse to run unless
`MIGRATE_HARNESS_YES=1` is set — never run them against real data. Migration
directory names are validated (`[A-Za-z0-9_]` only) before being used in SQL.

| Command | Effect |
|---|---|
| `bash scripts/migrate-harness.sh check-pairs` | Assert every migration has a non-empty `down.sql` (no DB needed). |
| `bash scripts/migrate-harness.sh forward` | `prisma migrate deploy` + assert `migrate status` clean. |
| `MIGRATE_HARNESS_YES=1 bash scripts/migrate-harness.sh down [N]` | Roll back the newest `N` migrations (default 1). |
| `bash scripts/migrate-harness.sh snapshot <file>` | Export the production-shaped, data-free schema. |
| `MIGRATE_HARNESS_YES=1 bash scripts/migrate-harness.sh verify` | Full proof: forward → teardown-to-empty → recovery, single-step rollback + recovery, and the no-op probe round-trip. |

## CI

`.github/workflows/migration-harness.yml` runs `check-pairs` then `verify`
against a Postgres 15 service (the same image ci.yml uses) on any push/PR that
touches the migration chain, the harness, `schema.prisma`, or the workflow. It
uploads the production-shaped snapshot as a build artifact.

## Manual production rollback (destructive migrations)

The deploy workflow's automatic rollback is code-only. If a migration is **not**
backward-compatible (dropped column, renamed table, narrowed type), a code
rollback alone cannot recover the database. Procedure:

1. Take/confirm a backup (RDS snapshot; secondary logical export via
   `scripts/backup-db.sh`).
2. On a scratch database restored from that backup (a production-shaped
   snapshot), rehearse: `down 1` then re-`forward` with the harness.
3. Apply the vetted `down.sql` to production inside a transaction, then remove
   the corresponding `_prisma_migrations` row (as the harness does) so the fix
   migration can be re-applied.
4. Prefer additive, backward-compatible migrations so the deploy workflow's
   code-only rollback remains sufficient and this manual path is rarely needed.
