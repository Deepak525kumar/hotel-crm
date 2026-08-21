-- ADR-070 (2026-08-21): bounded per-account login throttle, defense-in-depth
-- alongside the existing IP-keyed edge (Nginx) rate limiting (ADR-031 D-6).
--
-- Distinct from `failed_login_count`/`failed_login_since` (TREQ-AUTH-007,
-- notify-only, never read to deny a login): this column IS read to deny a
-- login, but only for a bounded, self-clearing window -- see ADR-070 §3 for
-- why this does not amend TREQ-AUTH-007's "no lockout" requirement.
--
-- Additive-nullable -- no backfill needed, every existing row starts
-- unthrottled (null).

ALTER TABLE "User" ADD COLUMN "login_locked_until" TIMESTAMP(3);
