#!/usr/bin/env bash
# backend/scripts/migrate-harness.sh
# Deterministic Prisma migration + rollback harness (EPIC-PLATFORM S0-2).
#
# Prisma Migrate has no native "down" migrations. This harness adds a reviewed,
# deterministic rollback path on top of the existing `prisma migrate deploy`
# tooling (ADR-004/005) without replacing it:
#
#   * Convention: every forward migration under prisma/migrations/<ts>_<name>/
#     ships a sibling `down.sql` that reverses it. `check-pairs` enforces this.
#   * `forward`  applies the committed chain with `prisma migrate deploy`
#     (identical to CI/production) and asserts `migrate status` is clean.
#   * `down [N]` rolls back the newest N applied migrations: it runs each
#     migration's down.sql inside a transaction, then removes its
#     `_prisma_migrations` history row so `migrate deploy` re-applies it (recovery).
#   * `snapshot <file>` exports the production-shaped, data-free schema (the DB
#     built from the full committed chain on an empty database has the exact
#     shape of production, with no dev drift) for dry-runs.
#   * `verify` is the end-to-end proof: forward → full teardown (empty) →
#     recovery, single-step rollback + recovery of the newest migration, and a
#     no-op probe round-trip (S0-2 acceptance: "a no-op migration proves forward
#     + rollback end-to-end").
#
# It reuses the same Postgres engine and `prisma migrate deploy` step already
# used by CI and the deploy workflows; it introduces no new runtime dependency.
#
# Requirements: bash, psql, and the backend's Prisma CLI (npx prisma).
# Environment: DATABASE_URL must point at a THROWAWAY database. `verify` and
# `down` are destructive (they drop the public schema); never run them against a
# database holding real data. As an interlock, those two commands refuse to run
# unless MIGRATE_HARNESS_YES=1 is set (CI sets it against its ephemeral service DB).
#
# Usage:
#   DATABASE_URL=postgresql://... MIGRATE_HARNESS_YES=1 bash scripts/migrate-harness.sh verify
#   DATABASE_URL=postgresql://... bash scripts/migrate-harness.sh forward
#   DATABASE_URL=postgresql://... MIGRATE_HARNESS_YES=1 bash scripts/migrate-harness.sh down [N]
#   DATABASE_URL=postgresql://... bash scripts/migrate-harness.sh snapshot out.sql
#   bash scripts/migrate-harness.sh check-pairs      # (no DB required)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$BACKEND_DIR/prisma/migrations"
PROBE_DIR="$BACKEND_DIR/prisma/harness/noop_probe"

log()  { echo "[migrate-harness] $*"; }
fail() { echo "[migrate-harness] ERROR: $*" >&2; exit 1; }

require_db() {
  [ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set."
  command -v psql >/dev/null 2>&1 || fail "psql not found on PATH."
}

# Interlock for destructive operations (verify / down / reset). These drop the
# public schema and mutate migration history, so they must never run against a
# real database by accident. Callers must opt in explicitly by exporting
# MIGRATE_HARNESS_YES=1; CI sets it in the migration-harness workflow.
confirm_destructive() {
  [ "${MIGRATE_HARNESS_YES:-}" = "1" ] || fail \
    "refusing a destructive operation. This drops the schema in DATABASE_URL — \
point it at a THROWAWAY database and re-run with MIGRATE_HARNESS_YES=1."
}

# Guard: a Prisma migration directory name is <14-digit-timestamp>_<snake_case>.
# Enforcing the shape keeps the name safe to embed in a SQL literal and rejects
# a stray-quote directory name before it can break out of the DELETE statement.
assert_safe_migration_name() {
  case "$1" in
    *[!a-zA-Z0-9_]*) fail "unsafe migration name '$1' (only [A-Za-z0-9_] allowed)." ;;
  esac
}

# All migration directories, oldest -> newest (timestamp prefixes sort lexically).
migration_dirs_asc() {
  find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | sort
}

migration_name() { basename "$1"; }

psql_exec() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

# Reset the target database to an empty public schema.
reset_db() {
  log "Resetting database to an empty schema."
  psql_exec -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
}

# Apply the full committed chain exactly as CI/production do.
forward() {
  log "Applying migrations (prisma migrate deploy)."
  ( cd "$BACKEND_DIR" && npx --no-install prisma migrate deploy )
  status_clean
}

# Assert Prisma reports no pending/failed migrations and no drift.
status_clean() {
  local out
  out="$( cd "$BACKEND_DIR" && npx --no-install prisma migrate status 2>&1 )" || true
  echo "$out"
  if echo "$out" | grep -qiE 'failed|drift|not in sync|following migration.*not.*applied|have not yet been applied'; then
    fail "migrate status is not clean."
  fi
  log "migrate status is clean."
}

# Roll back one migration directory: run its down.sql in a transaction, then
# delete its history row so migrate deploy will re-apply it.
down_one() {
  local dir="$1" name; name="$(migration_name "$dir")"
  assert_safe_migration_name "$name"
  [ -f "$dir/down.sql" ] || fail "missing down.sql for migration '$name'."
  log "Rolling back $name."
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$dir/down.sql"
  psql_exec -c "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '$name';"
}

# Roll back the newest N migrations (default 1), newest -> oldest.
down() {
  require_db
  confirm_destructive
  local n="${1:-1}" dirs=() i
  while IFS= read -r d; do dirs+=("$d"); done < <(migration_dirs_asc)
  local total=${#dirs[@]}
  [ "$n" -le "$total" ] || fail "asked to roll back $n but only $total migrations exist."
  for (( i = total - 1; i >= total - n; i-- )); do
    down_one "${dirs[$i]}"
  done
}

down_all() {
  local dirs=() i
  while IFS= read -r d; do dirs+=("$d"); done < <(migration_dirs_asc)
  for (( i = ${#dirs[@]} - 1; i >= 0; i-- )); do
    down_one "${dirs[$i]}"
  done
}

# Export the production-shaped, data-free schema. Excludes the Prisma bookkeeping
# table so the snapshot is pure application shape.
snapshot() {
  require_db
  command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found on PATH."
  local out="${1:-/dev/stdout}" raw
  raw="$(mktemp)"
  pg_dump "$DATABASE_URL" \
    --schema-only --no-owner --no-privileges \
    --exclude-table='_prisma_migrations' \
    > "$raw"
  # Strip noise (comments, SET/SELECT config lines, blanks). grep exits 1 when an
  # empty schema yields no kept lines — tolerate that so a fully torn-down schema
  # produces an empty snapshot instead of aborting the harness.
  grep -vE '^\s*(--|SET |SELECT pg_catalog|$)' "$raw" > "$out" || true
  rm -f "$raw"
}

# Enforce the paired-down convention: every migration has a non-empty down.sql.
check_pairs() {
  local ok=1 d
  while IFS= read -r d; do
    if [ ! -s "$d/down.sql" ]; then
      echo "  MISSING or empty down.sql: $(migration_name "$d")" >&2
      ok=0
    else
      log "paired: $(migration_name "$d")"
    fi
  done < <(migration_dirs_asc)
  [ "$ok" -eq 1 ] || fail "one or more migrations lack a down.sql (paired-down convention)."
  log "All migrations have a paired down.sql."
}

count_app_relations() {
  # Any top-level schema object (table, type, function, trigger, view, sequence,
  # index, ...) present in a snapshot file. Counting all CREATE statements — not
  # just tables/types — means the teardown-to-empty assertion catches leaked
  # objects such as standalone functions a down.sql forgot to drop.
  grep -cE '^CREATE ' "$1" || true
}

# No-op probe round-trip on a throwaway copy of the chain with the probe appended.
noop_probe_roundtrip() {
  log "No-op probe: forward -> rollback -> recovery."
  local tmp; tmp="$(mktemp -d)"
  mkdir -p "$tmp/prisma/migrations"
  cp "$BACKEND_DIR/prisma/schema.prisma" "$tmp/prisma/schema.prisma"
  cp -R "$MIGRATIONS_DIR/." "$tmp/prisma/migrations/"
  cp "$MIGRATIONS_DIR/migration_lock.toml" "$tmp/prisma/migrations/" 2>/dev/null || true
  local probe="29990101000000_noop_probe"
  cp -R "$PROBE_DIR" "$tmp/prisma/migrations/$probe"

  reset_db
  ( cd "$BACKEND_DIR" && npx --no-install prisma migrate deploy --schema "$tmp/prisma/schema.prisma" )
  local before after n
  before="$(mktemp)"; after="$(mktemp)"
  snapshot "$before"
  n="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '$probe';")"
  [ "$n" = "1" ] || fail "no-op probe was not registered in migration history."

  # Rollback the probe.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$PROBE_DIR/down.sql"
  psql_exec -c "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '$probe';"
  n="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '$probe';")"
  [ "$n" = "0" ] || fail "no-op probe history row was not removed on rollback."
  snapshot "$after"
  diff -u "$before" "$after" || fail "no-op probe altered the schema (should be schema-neutral)."

  # Recovery: re-apply the probe.
  ( cd "$BACKEND_DIR" && npx --no-install prisma migrate deploy --schema "$tmp/prisma/schema.prisma" )
  n="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM \"_prisma_migrations\" WHERE migration_name = '$probe';")"
  [ "$n" = "1" ] || fail "no-op probe did not recover (re-apply) after rollback."
  rm -f "$before" "$after"
  rm -rf "$tmp"
  log "No-op probe round-trip OK."
}

verify() {
  require_db
  confirm_destructive
  command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found on PATH."
  check_pairs

  local full empty recovered rt
  full="$(mktemp)"; empty="$(mktemp)"; recovered="$(mktemp)"; rt="$(mktemp)"

  log "== Forward: apply full chain on an empty (production-shaped) database =="
  reset_db
  forward
  snapshot "$full"
  local rel; rel="$(count_app_relations "$full")"
  [ "$rel" -gt 0 ] || fail "forward migration produced no schema objects."
  log "Forward OK ($rel table/type definitions)."

  log "== Rollback: tear the whole chain down to empty =="
  down_all
  snapshot "$empty"
  local remaining; remaining="$(count_app_relations "$empty")"
  [ "$remaining" -eq 0 ] || fail "rollback left $remaining schema objects; teardown is not complete."
  log "Full teardown OK (schema empty)."

  log "== Recovery: re-apply the full chain, expect an identical schema =="
  forward
  snapshot "$recovered"
  diff -u "$full" "$recovered" || fail "recovery schema differs from the original forward schema."
  log "Recovery OK (schema identical)."

  log "== Single-step: roll back the newest migration, then recover =="
  down 1
  forward
  snapshot "$rt"
  diff -u "$full" "$rt" || fail "single-step rollback+recovery diverged from the original schema."
  log "Single-step rollback + recovery OK."

  noop_probe_roundtrip

  rm -f "$full" "$empty" "$recovered" "$rt"
  log "VERIFY PASSED: forward, rollback, recovery, and no-op probe all proven end-to-end."
}

cmd="${1:-}"
case "$cmd" in
  forward)     require_db; forward ;;
  down)        shift; down "${1:-1}" ;;
  snapshot)    shift; snapshot "${1:-/dev/stdout}" ;;
  check-pairs) check_pairs ;;
  status)      require_db; status_clean ;;
  verify)      verify ;;
  *)
    echo "Usage: $0 {verify|forward|down [N]|snapshot <file>|status|check-pairs}" >&2
    exit 2 ;;
esac
