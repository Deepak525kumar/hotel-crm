# Milestone: Authorization Foundation Complete

| Field | Value |
|---|---|
| Date | 2026-07-27 |
| Status | Complete |
| Governed by | [`GOVERNANCE_DECISIONS_REQUIRED.md`](GOVERNANCE_DECISIONS_REQUIRED.md) `GD-02`, `GD-03`, `GD-07` |

## Completed

- **`ADR-030`** — Manager Write-Authority Capability Model (Accepted 2026-07-25/26; PR-1 through PR-8)
- **`ADR-031`** — Request-Time Permission Derivation, Token-Generation Revocation, and Auth Rate-Limiting (Accepted 2026-07-26/27; PR-0 through PR-8, including PR-4a)

Both are the record of `GD-02`/`GD-03` (manager write-permission authority, 5-role model) and `GD-07`
(session/token revocation & auth rate-limiting) respectively — see those rows in
`GOVERNANCE_DECISIONS_REQUIRED.md` for the decision record and full PR-merge history.

## Major outcomes

- **Capability-based write authority** (`ADR-030`): hotel/hotel-group writes narrowed to Admin-only;
  `MANAGER`/`REGIONAL_MANAGER` gain scope-filtered `users:write` over a profile-only DTO, separate
  from role assignment; manager/RM employee-record authority is action-only, never field-level.
- **`REGIONAL_MANAGER` capability model** (`ADR-030` D-5): new role at `hotel_group` scope, no
  master-data capability; capability-named route gates replacing the prior blanket admin/manager
  gate.
- **Request-time permission derivation** (`ADR-031` D-1): `ROLE_PERMISSIONS[user.role]` is the
  single live authorization authority, evaluated per request from the `User` row — not from a
  stored snapshot or a JWT claim. Retires the `ADR-030`-era backfill treadmill (a matrix change is
  now a source edit plus a test, no data migration).
- **Token revocation** (`ADR-031` D-3/D-4): a monotonic `token_generation` counter on `User`, bumped
  transactionally with role change, deactivation, soft delete, and password-reset; a mismatch (or a
  missing claim) invalidates an already-issued access token immediately, closing the prior
  access-token-TTL revocation gap.
- **Session cleanup** (`ADR-031` D-5): a batched, bounded `SessionSweepJob` on the existing Platform
  Worker deletes expired `Session` rows and expired/used `PasswordResetToken` rows on a configurable
  interval (default hourly).
- **Edge rate limiting** (`ADR-031` D-6): `limit_req_zone`/`limit_req` at the Nginx (or
  Cloudflare-equivalent) edge for all five auth endpoints, IP-keyed, with `Retry-After` — consuming,
  not reversing, `SPEC-AUTH-001`'s Confirmed no-app-layer-rate-limiting requirement.
- **Documentation synchronized**: `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` closed
  (`SIR-USERS-015`, `SIR-AUTH-014`, `SIR-AUTH-018`); `GOVERNANCE_DECISIONS_REQUIRED.md` (`GD-02`,
  `GD-03`, `GD-07`) marked resolved; `ADR-030` §5/§9 forward-noted as superseded by `ADR-031`;
  `ROLE_PERMISSIONS` reclassified as a `backend-auth`-owned shared contract node in
  `DEPENDENCY_GRAPH.yaml`/`CONTRACT_INDEX.yaml`; `DECISION_INDEX.md` carries both ADRs as Accepted.

## What remains open (deliberately, not silently)

- **`SIR-AUTH-017`** (password-reset timing side-channel) — explicitly out of `ADR-031`'s scope.
- **`SIR-AUTH-022`** (new, Low) — the `ADR-031` M-3 pre-drop backup table
  (`_User_permissions_backup_20260727`) has no tracked removal date beyond a code comment; needs a
  scheduled migration or ticket, possibly folded into the `GD-09`/OI-4 retention-tier conversation.
- **Production rollout gate** — per the owner amendment recorded in `ADR-031` §7, the
  "full-release soak" precondition originally attached to `ADR-031` PR-7 is relocated to
  [`ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md`](ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md) — an
  operational gate that must be satisfied before either of the (now-retired-as-toggles, always-on)
  derivation/revocation behaviors ever runs against a real production database. As of this
  milestone, no item on that checklist is complete — this repository has no completed production
  deployment (see that file's own evidence section).
- **`GD-08`** (MFA), **`GD-09`** (GDPR retention-tier assignment), **`GD-13`** (cross-module
  state-read boundary) remain untouched by this milestone, as `ADR-031` §11 records.

## Why this is "Authorization Foundation," not "Authorization Complete"

This milestone closes the specific, named gaps `GD-02`/`GD-03`/`GD-07` identified: write-authority
scope, the 5-role/Regional-Manager model, and session/token revocation + rate-limiting. It does not
close MFA, retention/GDPR tiering, or per-account rate-limiting (`ADR-031` §9 Non-goals, §10 Open
Items) — those are separate, still-open governance decisions with their own rows above.
