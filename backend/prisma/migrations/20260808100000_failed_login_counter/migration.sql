-- SPEC-AUTH-001 TREQ-AUTH-007 (2026-08-08): consecutive failed-login
-- monitoring.
--
-- These columns drive a NOTIFICATION, never a lockout. TRULE-AUTH-002's
-- confirmed pattern is "notify and never block": nothing reads
-- failed_login_count to deny a login, and no application-layer throttling is
-- introduced (TREQ-AUTH-008 keeps rate limiting at the Nginx/Cloudflare
-- edge). The counter only decides when to raise the alert.
--
-- Additive-with-default / additive-nullable, so no backfill is needed --
-- every existing row starts at 0 with a null streak start, which is the
-- correct "no failures recorded" state.

ALTER TABLE "User" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "failed_login_since" TIMESTAMP(3);
