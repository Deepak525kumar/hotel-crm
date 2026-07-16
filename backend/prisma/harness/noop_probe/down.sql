-- No-op harness probe — down.
-- Reverses the schema-neutral probe forward migration. Nothing was created, so
-- nothing is dropped; the harness still exercises the full rollback path
-- (apply down.sql inside a transaction, then remove the `_prisma_migrations`
-- history row) against this probe.
SELECT 1;
