-- ADR-031 M-1 (PR-2): additive revocation-counter column.
-- No backfill needed — the default (0) covers every existing row, and every
-- currently-outstanding access token is treated as generation 0 during the
-- transition window (ADR-031 D-3.2). Reversible while unread (dropped only
-- at PR-7's M-3, after a full-release soak).
ALTER TABLE "User" ADD COLUMN "token_generation" INTEGER NOT NULL DEFAULT 0;
