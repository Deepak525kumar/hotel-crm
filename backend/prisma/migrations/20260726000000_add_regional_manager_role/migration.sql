-- ADR-030 M-1 (PR-2): additive-only UserRole enum value.
-- Postgres requires ALTER TYPE ... ADD VALUE to run in its own transaction,
-- separate from any statement that references the new value (ADR-030 §5) —
-- this migration does nothing else and is intentionally not reversible
-- (accepted, ADR-030 §5/§9).
ALTER TYPE "UserRole" ADD VALUE 'REGIONAL_MANAGER';
