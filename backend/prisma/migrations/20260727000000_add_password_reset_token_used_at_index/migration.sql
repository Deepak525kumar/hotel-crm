-- ADR-031 D-5 (PR-6), performance-review finding F-1: the sweep job's
-- PasswordResetToken query is `expires_at < now() OR used_at IS NOT NULL`.
-- The existing @@index([expires_at]) covers the first branch; the second
-- had no supporting index, risking a full-table scan on every sweep run
-- (not just first-run backlog, since used tokens accumulate continuously).
-- A partial index on used_at IS NOT NULL is cheap (small, since most rows
-- have used_at NULL) and directly targets that branch.
CREATE INDEX "PasswordResetToken_used_at_idx" ON "PasswordResetToken" ("used_at") WHERE "used_at" IS NOT NULL;
