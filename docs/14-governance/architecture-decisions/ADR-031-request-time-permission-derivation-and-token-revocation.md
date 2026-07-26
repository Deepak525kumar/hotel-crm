# ADR-031: Request-Time Permission Derivation, Token-Generation Revocation, and Auth Rate-Limiting

- **Status:** **Accepted.** Ratified directly by the project owner (human decision, recorded 2026-07-26, session `claude/lead-engineer-orchestration-4193hw`) — Constitution §20 human/product + security authority, per the `ADR-021`/`ADR-024`/`ADR-025`/`ADR-027`/`ADR-028`/`ADR-029`/`ADR-030` convention. Authored 2026-07-26 against repository revision `45f6ce2`; amended the same day per independent review (session `claude/lead-engineer-orchestration-4193hw`, PR merging the D-3/D-3.5/D-4/D-6/Non-goals clarifications) before ratification. This decision authorizes §7's PR sequence in full; each PR still requires its own gate (§7's Gate column) — ratification of the record is not a bypass of Security/Architecture/Performance Review on any individual PR.
- **Date:** 2026-07-26
- **Scope:** Authorization + authentication architecture. Decides (i) **where authorization state is resolved** — from the `User.role` at request time rather than from the stored `User.permissions` array snapshotted into the JWT — and (ii) **how an already-issued access token is invalidated**, plus the two adjacent production-security gaps the same enforcement point owns: session sweeping and auth rate-limiting. This is the record `ADR-030` §6 reserved as `ADR-031`, combined with governance decision **GD-07** (Session/token revocation & auth rate-limiting, `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`).
- **Builds on:** `ADR-003` (modular monolith), `ADR-005` (PostgreSQL), `ADR-017` (`state-user` owned by `backend-auth`), `ADR-023` (JWT `scope` claim shape), `ADR-029` (Platform Worker — the canonical asynchronous runtime, which hosts this record's sweep job rather than a new scheduler), `ADR-030` (the capability matrix whose enforcement primitive this record re-plumbs).
- **Supersedes:** No prior ADR.
- **Amends:**
  - **`ADR-030` §5 M-2 and §9** — the "permissions are stored, not derived" premise (`ADR-030` §1 fact 2) and its accepted cost that *"M-2 is re-run on every matrix change until `ADR-031` lands."* On completion of §7's sequence that cost is retired: `ROLE_PERMISSIONS` becomes the single live authority and no backfill migration is required for a future matrix change. `ADR-030`'s capability matrix (§3), ownership matrix (§4), and every D-1…D-10 decision are **consumed unchanged** — this record changes the *derivation path*, not the *matrix*.
  - **`ADR-030` §9's first accepted risk** — "an access-token-TTL window during which a changed matrix is not yet reflected in live tokens. There is no revocation mechanism (GD-07)." This record is that mechanism.
  - **`ADR-024` D3/D4's "both-flags-off reproduces today's behavior exactly" posture** is *reused, not amended*: §7 applies the same additive-flag topology to this cutover.
  - **`ADR-023` decision 6 (JWT `scope` claim shape) is not amended.** The discriminated `{type:'hotel'|'hotel_group'|'global'}` claim stays byte-for-byte as issued today, including its issuance-time resolution from `Hotel.manager_user_id`/`HotelGroup.regional_manager_user_id` (`auth/service.ts:29-51`). Only the `permissions` claim is removed and a `token_generation` claim added.
- **Change class:** Material authorization- **and** authentication-architecture decision requiring a Decision Record per Constitution §6/§7 — same class as `ADR-029`/`ADR-030`. Carries a schema migration (`User.token_generation`) and a security-posture change at the platform's single trust boundary, so §7's gates are Security-Review-blocking throughout.

---

## 1. Problem

Verified against revision `45f6ce2`. Four independent facts, one enforcement point.

**F-1 — Permissions are a snapshot, not a derivation.** `ROLE_PERMISSIONS` (`backend/src/config/constants.ts:137`) is read exactly three times, all at write time, and the result is *persisted into a per-user column*:

- `users/service.ts:151,161` — `createUser` computes `ROLE_PERMISSIONS[role]` and writes it to `User.permissions`.
- `users/service.ts:199,208` — `updateUser` recomputes it **only if `data.role` is present**, otherwise carries `user.permissions` forward verbatim.
- `users/service.ts:295,299` — `updateUserRole` (the `ADR-030` D-4a split route) recomputes it.

`User.permissions String[]` (`prisma/schema.prisma:234`) is therefore an independent, drifting copy of a source constant. Editing `ROLE_PERMISSIONS` changes nothing for any existing account — this is exactly why `ADR-030` needed migration **M-2** and why it accepted re-running M-2 on every future matrix change (`ADR-030` §5, §9).

**F-2 — The snapshot is then copied a second time, into the token.** `auth/service.ts:84` (signup), `:137` (login), and `:194` (refresh) all pass `permissions: user.permissions` into `signTokens(...)`; the claim is declared at `lib/jwt.ts:14` (`AccessTokenPayload.permissions: string[]`). So authorization state at request time is a copy of a copy of a constant, with two independent staleness windows: the DB column (until a write path recomputes it) and the token (until it expires).

**F-3 — The enforcement point never consults the database.** `authMiddleware` (`backend/src/middleware/auth.ts:18-29`) builds the entire `req.auth` — `userId`, `email`, `role`, `permissions`, `scope` — from the verified JWT payload alone. It never re-reads `User.is_active`, `deleted_at`, `role`, or `permissions`. `requirePermission` (`middleware/permissions.ts:9-69`) then decides every authorization outcome from `req.auth.permissions` (`:17`), including the `admin:*` blanket bypass (`:24`) and the `resource:*` wildcard expansion (`:35-45`). `requireRole` (`:71-100`) reads `req.auth.role` (`:79`). Consequences:

- Deactivating an account (`is_active=false`), soft-deleting it (`deleted_at`), demoting it, or narrowing its permission set has **zero effect** on any already-issued access token for up to `JWT_ACCESS_EXPIRY` (default `1h`, `config/env.ts:25`). Only `login` (`auth/service.ts:123`) and `refreshToken` (`:185`) re-check the DB. This is `SIR-USERS-015`.
- There is no revocation primitive of any kind. `Session` (`prisma/schema.prisma:277`) stores only a hashed refresh token; deleting every `Session` row (which `logout` and password-reset confirm already do) does not invalidate a single outstanding **access** token.

**F-4 — Sessions are never swept and no auth endpoint is rate-limited.** `Session` has an `expires_at` index but no deleting job anywhere; expired rows are only *functionally rejected* at refresh time, so the table grows without bound (`SIR-AUTH-014`). Repo-wide there is no rate-limiting middleware and no rate-limiting dependency: `backend/package.json` runtime deps are `@prisma/client`, `bcryptjs`, `express`, `jsonwebtoken`, `winston`, `zod`, `dotenv` only; `app.ts` mounts `express.json`, `express.urlencoded`, `requestLoggerMiddleware`, the v1 router, and the error handlers — nothing else. A `RATE_LIMIT_EXCEEDED` error constant exists and is referenced by zero code (`config/constants.ts:62`). Every unauthenticated endpoint — `POST /auth/login`, `/auth/signup`, `/auth/refresh`, `/auth/password-reset`, `/auth/password-reset/confirm` (`auth/routes.ts:7-12`) — is unmetered, so credential stuffing, reset-token grinding, and the `SIR-AUTH-017` timing side-channel are all unbounded in attempt count (`SIR-AUTH-018`).

These four facts are one architectural problem: **the platform has no live authorization state.** Both the permission set and the account's very validity are frozen at issuance. Fixing revocation without fixing derivation would leave `ADR-030`'s M-2 treadmill in place; fixing derivation without revocation would leave a role change enforceable only after TTL expiry. GD-07 and `ADR-030`'s deferral are the same decision seen from two sides, which is why they are resolved in one record.

**No hard blocker was found against GD-07's recorded recommendation (Option (a)).** Two prerequisites it did not name are recorded as binding constraints in §4 (C-1: derivation must land before the `permissions` claim is dropped; C-3: `optionalAuthMiddleware` is a second, easily-missed enforcement path).

---

## 2. Options considered

| | Option (a) — **request-time derivation + `token_generation` claim + sweep job + rate-limit middleware** | Option (b) — server-side session store / access-token denylist | Option (c) — status quo |
|---|---|---|---|
| Revocation latency | Immediate (next request), for deactivation, deletion, demotion, and permission-set change alike | Immediate | Up to `JWT_ACCESS_EXPIRY` (1h default) |
| Per-request cost | One indexed `User` read by primary key (`id`), cacheable; no network hop | One store read per request **plus** a denylist read; introduces Redis or a hot `Session`-per-access-token table | Zero |
| New infrastructure | **None.** PostgreSQL column + `ADR-029`'s existing Platform Worker + Nginx edge config | Redis (contradicts `ADR-029`'s codified "no external queue/Redis" constraint) or a high-write Postgres table on the request path | None |
| Retires `ADR-030` M-2 treadmill | **Yes** — `ROLE_PERMISSIONS` becomes the only authority | No (orthogonal; still a stored snapshot unless derivation is also done) | No |
| Statelessness of the JWT | Weakened deliberately and minimally: one integer compared against one row already being read | Abandoned — the token becomes a session pointer | Preserved |
| Reversibility | High. Additive column, additive claim, flag-gated cutover, `ADR-024`-style both-off-is-current | Low. Session semantics, client contracts, and infra all change together | n/a |
| Resolves GD-07's rate-limiting half | Yes, at the Nginx edge per `TREQ-AUTH-008` (no app-layer code) | Yes, same edge config; unrelated to the store choice | No |
| Cost | 9 PRs (PR-0..PR-8 + PR-4a), 1 additive migration | Materially larger; new infra to run, monitor, and secure | 0 |

**Rejected — (b).** It buys nothing (a) does not, at the price of the exact infrastructure `ADR-029` explicitly codified out of the platform ("Kafka, RabbitMQ, SQS, BullMQ, Redis-backed queues, and equivalents are **not** introduced"). A denylist is also strictly *additive* to (a) later — `token_generation` does not foreclose it — so choosing (a) now preserves (b) as a future option, while choosing (b) now would strand the derivation work anyway.

**Rejected — (c).** `SIR-USERS-015`, `SIR-AUTH-014`, `SIR-AUTH-018` are open production-readiness blockers, and `ADR-030` §9 accepted its stale-token risk *explicitly on the basis that GD-07 is the correct fix.* Doing nothing also means every future capability-matrix change carries a data migration (M-2), which makes the authorization matrix expensive to correct — a governance hazard, not merely an operational one.

---

## 3. Decision

**Adopt Option (a).** Authorization state becomes live: the permission set is derived from `User.role` at request time, and a monotonic `token_generation` claim makes any already-issued access token cheaply invalidatable.

### D-1 — `ROLE_PERMISSIONS` is the single authority; `User.permissions` is retired

The permission set for a request is `ROLE_PERMISSIONS[user.role]`, evaluated per request. `User.permissions` stops being read (PR-3), then stops being written (PR-4), then is dropped (PR-7, after a full-release soak — see §7). No code path recomputes or backfills a snapshot. `ADR-030` M-2 is not re-run again after this lands.

**`ROLE_PERMISSIONS` is a shared contract node from this point on** (the gap `SIR-USERS-017` already notes): it is read on the request path by `backend-auth`'s middleware, so it is frozen as a module-boundary contract, not an internal constant of `backend-users`. It must be treated as immutable at runtime — `config/constants.ts:114-135` already wraps the map and each role's array in `Object.freeze(...)`, which prevents reassignment but is shallow (it does not stop, e.g., a caller holding a reference from splicing an unfrozen nested structure). Once the constant is consulted per request rather than only at write time, that shallow-freeze gap becomes a live authorization-integrity concern, so PR-3 hardens the freeze (deep-freezes each array element if any are ever non-primitive) and pins the immutability with a test.

### D-2 — The access-token claim set changes

`AccessTokenPayload` (`lib/jwt.ts:10-18`) becomes:

| Claim | Today | After |
|---|---|---|
| `sub`, `email`, `role` | present | **unchanged** |
| `scope` | present (`ADR-023` shape) | **unchanged** — still resolved at issuance by `resolveScope()` (`auth/service.ts:29-51`) |
| `permissions: string[]` | present, authoritative | **removed** (PR-5). Derived per request instead |
| `token_generation: number` | — | **added** (PR-2), mirrored from `User.token_generation` at issuance |

`role` stays in the token for logging/telemetry continuity, but **it is not the authorization input after PR-3**: the role used for derivation and for `requireRole` is the one read from the row, so a demotion takes effect immediately rather than at TTL. A mismatch between the claim's `role` and the row's `role` is not an error — the row wins, and the mismatch is logged at `warn` once per request as revocation-effectiveness telemetry.

The removal of `permissions` is deliberately sequenced **after** derivation is live and defaulted-on (C-1, §4). Removing a claim is a client-visible token-shape change; §7 PR-5 is the only PR that does it, gated behind `FEATURE_TOKEN_GENERATION_ENFORCEMENT` (the same flag that governs the revocation check, C-4) rather than a third, separate flag.

### D-3 — `authMiddleware` resolves live authorization state

`authMiddleware` (`middleware/auth.ts:5-39`) gains, after successful signature verification and before populating `req.auth`, a single primary-key read of the caller's `User` row selecting `{id, role, is_active, deleted_at, token_generation}`, and then:

1. **`is_active === false` or `deleted_at !== null` → 401** `UnauthorizedError`, not 403. The account is not authenticated at all; this closes `SIR-USERS-015`'s emergency-removal case.
2. **`payload.token_generation !== user.token_generation` → 401** with a distinct, machine-readable error code (`TOKEN_REVOKED`) so clients can distinguish "re-authenticate" from "refresh". A token carrying **no** `token_generation` claim is treated as generation `0` during the transition window and as **invalid** after PR-5's flag is defaulted on (this is the one intentional forced-re-auth event; see §8).
3. `req.auth.permissions = ROLE_PERMISSIONS[user.role] ?? []` — derived, never read from the token.
4. `req.auth.role = user.role.toLowerCase()`, from the row (matching the existing lowercase convention at `users/service.ts:98`).
5. `req.auth.scope` continues to come from the **token** claim, unchanged (`ADR-023`). Scope is *not* re-resolved per request: `resolveScope()` performs up to two additional queries (`auth/service.ts:34-49`), and re-running them on every request is a performance decision this record does not take. **Why role is derived live but scope is not, stated explicitly:** `role` is a single column on the row already being read for revocation — deriving it costs nothing beyond that read. `scope` requires resolving relational state (`Hotel.manager_user_id`/`HotelGroup.regional_manager_user_id`, up to two further queries) that is not already on the `User` row; deriving it live would add queries this record's cost model (§2, "one indexed `User` read") does not budget for. This is an asymmetry of *query cost*, not of architectural principle — if a future record is prepared to pay for those additional queries (or caches them), deriving scope live is a straightforward extension, not a reversal, of this one. Consequence, stated plainly: **a manager-reassignment (a change to `Hotel.manager_user_id`/`HotelGroup.regional_manager_user_id`) remains TTL-lagged.** The mitigation is that a reassignment is an Admin action (`ADR-030` C-09, master-data) which may bump `token_generation` to force re-issuance — the mechanism exists; making the bump automatic on reassignment is left open (§9 OI-2).

**Why a DB read, when `role` could stay in the token and only `ROLE_PERMISSIONS` lookup be avoided?** Because the read is not there to derive permissions — `ROLE_PERMISSIONS[role]` is an in-process map lookup and would be free even against a token-embedded `role`. **The read exists to answer four questions no claim can answer once issued: is this account still active, still not deleted, still this role, and still holding a live `token_generation`.** Permission derivation is a by-product that becomes effectively free once that row is already being loaded for revocation and validity — it does not, by itself, justify a database round trip. Stated plainly: **the DB lookup exists primarily for revocation and account-validity enforcement; permission derivation rides along on it at zero marginal query cost.**

**Per-request cost and caching.** The added read is one indexed lookup on `User.id` (the primary key), on a request that already performs at least one query in virtually every authenticated handler. **Caching is optional; implementations may disable it entirely and read the row on every request.** If caching is used, it is bounded by an explicit rule: a short-TTL in-process cache keyed by `user_id`, **TTL ≤ 5 seconds, every cache entry invalidated by `user_id` on any `token_generation` bump within the same process.** A cache whose TTL exceeds the revocation guarantee would silently re-introduce the exact staleness this record removes, so the TTL is a stated ceiling, not a target — going uncached is always compliant; caching beyond 5 seconds never is. No cross-process cache (that would be Option (b)'s infrastructure).

**Failure mode when the database is unavailable, stated explicitly.** Today, a valid JWT authorizes a request even if the database is down (`authMiddleware` never queries it). After this record, a valid JWT plus an unreachable database means the added `User` read fails, and the request is rejected (401/500 depending on how the failure is surfaced) rather than authorized on claims alone. **This is an accepted, deliberate change to the platform's failure mode** — the trade this record makes (live revocation) is incompatible with authorizing purely from a cached claim during a database outage. It is not a new single point of failure in practice (every authenticated handler already queries the database at least once to do its work), but it does mean auth now fails *before* those handlers would have, rather than inside them. Recorded here rather than left implicit.

### D-4 — `token_generation` is the revocation primitive

`User` gains `token_generation Int @default(0)` (additive, no backfill needed — the default covers every existing row). It is **incremented, never reset**, by `backend-auth` (the `state-user` authoritative writer, `ADR-017`) on:

| Trigger | Where | Why |
|---|---|---|
| Role change | `users/service.ts:283-310` (`updateUserRole`) | Immediate enforcement of a demotion |
| Deactivation (`is_active=false`) / soft delete | `updateUserProfile`, `deleteUser` | Emergency account removal (`SIR-USERS-015`) |
| Password change / password-reset confirm | `auth/service.ts` reset-confirm path | Post-compromise lockout; the path already deletes all `Session` rows, and this extends the same intent to access tokens |
| Explicit admin "revoke all sessions" action | new Admin-only endpoint (PR-4) | Operator-facing incident response |
| `logout` | `auth/service.ts:213-` | **Deliberately NOT bumped.** Logout on one device must not sign the user out everywhere. Logout keeps its current semantics (delete that one `Session` row); the access token expires naturally within its TTL. A separate "log out everywhere" is the admin/self-service revoke action above. |

Every bump is written **in the same transaction** as the state change that motivates it, so a revocation can never be lost against a committed demotion or deactivation (the same atomicity argument as `ADR-029` §2). Every bump writes an `AuditLog` row (`ADR-016`, `backend-auth` as writer).

**No module other than `backend-auth` writes `token_generation` directly.** `backend-users`' write paths that must trigger a bump (`updateUserRole`, deactivate, soft-delete) call into a `backend-auth`-owned service function (e.g. `bumpTokenGeneration(userId, tx)`, invoked inside the same transaction) rather than incrementing the column themselves. This is stated as a binding rule, not left to be inferred from the ownership table in §5: a future `prisma.user.update({ data: { token_generation: { increment: 1 } } })` written directly inside `backend-users` (or any other module) would work today and silently create a second, uncoordinated writer of authoritative token state — exactly the kind of drift `ADR-017` exists to prevent for `state-user` generally. PR-4's invariant coverage (C-6 territory) should include a check that the column is written only from the designated `backend-auth` seam.

**Access-token TTL is shortened** from `1h` to a configuration default of **15 minutes** (`JWT_ACCESS_EXPIRY`, `config/env.ts:25`), stated as policy-then-value per `ADR-029` §8's convention: the TTL is configuration, and 15m is the initial deployment default. Refresh TTL (`7d`) is unchanged. The TTL is now defense-in-depth rather than the primary revocation mechanism — with D-3 live, revocation no longer *depends* on it.

### D-5 — Session sweep runs on the Platform Worker

No new scheduler is introduced. The sweep is a scheduled job on the **Platform Worker** (`ADR-029` §3, which is already the canonical asynchronous runtime and already hosts scheduled jobs). It deletes, on a configuration-driven interval (initial default: hourly):

- `Session` rows with `expires_at < now()` (closes `SIR-AUTH-014`), and
- `PasswordResetToken` rows that are expired or already used (the second half of `SIR-AUTH-018`, structurally identical and correctly swept by the same job).

Deletion is batched with a bounded per-run limit so a large first run cannot lock the table, and each run emits a count metric via the Platform Worker's existing observability surface (`ADR-029` §9). **Retention interaction, recorded not resolved:** `Session` and `PasswordResetToken` disposal is now a *deletion* policy, so both rows join `OutboxEvent` as records needing a GDPR retention tier under `SIR-NOTIF-002`/GD-09 before G8 — sweeping does not pre-empt that assignment, and the sweep interval must not be read as the retention decision.

### D-6 — Rate limiting is enforced at the Nginx edge, not the application layer

**Correction against `SPEC-AUTH-001` (FROZEN):** `TREQ-AUTH-008`/`TRULE-AUTH-002` (`docs/03-modules/auth/MODULE_SPEC.md:215,240`) are **Confirmed authority**, Must-level, and explicit: *"No rate-limiting/CAPTCHA is introduced at the application layer... edge-level (Nginx/Cloudflare) rate limiting is a separate, out-of-module concern."* `TREQ-AUTH-007` independently confirms repeated failed logins are handled by **manager notification, never lockout, never a rate-limit block**. An in-process Express rate-limit middleware — this record's original draft — would silently reverse a Confirmed business requirement without the escalation that requires (Constitution §6/§20); it is corrected here, not carried forward.

**Decision: rate limiting is an edge-level Nginx configuration change, not new backend code.**

- **Mechanism:** `limit_req_zone`/`limit_req` directives added to `nginx/hotelcrm.conf` (and mirrored in `deploy/aws-edge-checklist.md`), keyed on `$binary_remote_addr`, applied to the five `auth/routes.ts:7-12` paths (`login`, `signup`, `refresh`, `password-reset`, `password-reset/confirm`) with a generous `burst` allowance so legitimate retry/refresh traffic is not denied. No new backend file, no new runtime dependency, no application code change. **Nginx is the initial deployment target, not a requirement of the decision itself:** any edge that enforces the same IP-keyed, application-blind property is equally compliant — a Cloudflare (or equivalent CDN/WAF edge) rate-limiting rule is an acceptable substitute or addition if the deployment topology changes, since `TREQ-AUTH-008` itself names "Nginx/Cloudflare" as interchangeable edge options.
- **Scope, honestly stated:** Nginx limits by client IP only. **Per-account throttling is out of scope by the same confirmed requirement** that puts rate limiting at the edge — the application layer must not inspect the request to apply an account-keyed limit, since that is itself an application-layer control. This is recorded as a real, accepted gap (§10 OI-3a), not silently dropped.
- **Client IP correctness:** the edge terminates TLS and sees the real client IP directly (no `X-Forwarded-For` trust chain to configure inside the app) — this removes the spoofing concern the rejected in-app design would have carried.
- **Response:** Nginx's own `503`/`429` (`limit_req_status`) with a `Retry-After` header, configured directly in the edge config. The backend's `RATE_LIMIT_EXCEEDED` constant (`config/constants.ts:62`) remains unused dead code; retiring it is a separate, non-blocking hygiene item, not part of this decision.
- **`SIR-AUTH-018`'s rate-limiting half is resolved at the edge, not in `backend/src`.** This changes what "resolved" means for that register row: closed by infrastructure configuration, cited accordingly in §11.
- **`SIR-AUTH-017` (timing side-channel) is unaffected by this correction** — an edge IP limit bounds enumeration throughput exactly as an app-layer one would; it still does not equalize branch latency. §10 OI-1 keeps the residual open, unchanged.

### D-7 — `requirePermission` and `requireRole` are unchanged in source

This is a deliberate, load-bearing design property. Both wrappers keep reading `req.auth.permissions` (`middleware/permissions.ts:17`) and `req.auth.role` (`:79`); the `admin:*` bypass (`:24`), the `resource:*` wildcard expansion (`:35-45`), and every log line stay byte-for-byte. **Only the provenance of `req.auth` changes.** Consequences:

- Every one of `ADR-030`'s route gates, and its PR-7 invariant + route×role matrix tests, keep working with no edit.
- `requirePermissionFlagged`/`requireRoleFlagged` (`permissions.ts:110-122`) and the scope helpers (`resolveHotelAccess`, `checkHotelAccess`, `resolveWorkerScope`, `checkWorkerScope`) are untouched.
- The blast radius of this record is `middleware/auth.ts`, `lib/jwt.ts`, `auth/service.ts`, `users/service.ts`, one new middleware file, one Platform Worker job, and one migration — **not** "every authorization check," which `ADR-030` §6 feared. That fear was correct about the *risk surface* (the trust boundary) and pessimistic about the *edit surface*.

---

## 4. Binding constraints

These are ordering/safety invariants, not implementation preferences. Violating any one of them opens a privilege or availability gap.

- **C-1 — Derivation lands, and is proven on, before the `permissions` claim is removed.** Removing the claim first would make `req.auth.permissions` empty for every in-flight token and deny every permission-gated route platform-wide. PR-5 is gated on PR-3 being flag-on and soaked.
- **C-2 — Derivation must be verified against `ADR-030`'s post-M-2 matrix, not against stored snapshots.** For any row where `User.permissions` ≠ `ROLE_PERMISSIONS[role]`, switching to derivation is a **live authorization change**, in either direction. PR-3 therefore ships with a read-only reconciliation report (count and sample of drifted rows, per role, per token) run **before** the flag flips, and its output is a Security-Review input. A drifted row that *loses* a permission is an availability incident; one that *gains* a permission is a security incident. Neither may be discovered in production.
- **C-3 — `optionalAuthMiddleware` (`middleware/auth.ts:41-67`) receives the identical treatment.** It builds the same `req.auth` shape from the same claims (`:53-59`) and is a second, easily-overlooked enforcement path. If it keeps trusting the `permissions` claim after PR-5, it silently becomes a zero-permission path (or, worse, a stale-permission path) on every route that uses it. Its swallow-all `catch` (`:62-64`) must continue to leave `req.auth` unset on failure — including on the new revocation/inactive checks — never partially populated.
- **C-4 — Both flags off reproduces today's behavior exactly** (`ADR-024` D3/D4 topology, reused). Two independent additive flags: `FEATURE_DERIVED_PERMISSIONS` (PR-3) and `FEATURE_TOKEN_GENERATION_ENFORCEMENT` (PR-3's revocation check + PR-5's claim removal). Neither is a permission *widening* toggle, so neither is the `ADR-030` M-4 hazard; both are removed after soak (PR-7).
- **C-5 — The `token_generation` bump is transactional with its trigger.** A bump committed separately from the demotion it enforces can be lost, leaving a demoted user holding a valid pre-demotion token — the precise failure this record exists to remove.
- **C-6 — No handler may read `User.permissions` after PR-4.** Enforced by a CI grep-style invariant test in the same PR, in the spirit of `ADR-030` D-8's invariant test: the column's continued existence between PR-4 and PR-6 must not become a second authority.
- **C-7 — Clients must handle forced re-auth before PR-5's flag is enabled in production.** All three clients (`frontend/`, `mobile/` worker-app, `mobile/` checker-app) must treat a 401 carrying `TOKEN_REVOKED` as "clear credentials and re-authenticate," distinct from the ordinary expiry path that triggers a refresh. Shipping PR-5 first would strand users in a refresh loop. This mirrors `ADR-030` PR-3's ordering constraint against `ALLOWED_ROLES`.

---

## 5. Ownership

No new state owner and no new module. Recorded for the knowledge layer:

| State / component | Authoritative writer | Notes |
|---|---|---|
| `User.token_generation` | `backend-auth` | `ADR-017` (`state-user`). `backend-users` write paths that must bump it (`updateUserRole`, deactivate, soft-delete) do so through the `backend-auth`-owned service seam, not by writing the column ad hoc. |
| `User.permissions` | `backend-users` (today) → **column retired** (PR-7) | Ceases to be authorization state at PR-3; ceases to be written at PR-4; dropped at PR-7. |
| `ROLE_PERMISSIONS` | `backend-auth` contract (**reclassified**) | Was an internal constant of the users module's write path; becomes a request-path shared contract node (D-1). Resolves the `SIR-USERS-017` shared-contract-node gap. |
| Rate-limit counters | `backend-auth` (in-process, ephemeral) | Not persisted state; no schema, no owner row, no retention tier. |
| Session/reset-token sweep | Platform Worker (`ADR-029`) | Job placement only; `Session`/`PasswordResetToken` ownership stays `backend-auth`. |

---

## 6. Migration plan

| ID | Migration | Reversible | Notes |
|---|---|---|---|
| **M-1** | Add `User.token_generation Int @default(0)` | **Yes** (additive column, droppable while unread) | No backfill: the default covers all existing rows, and every currently-outstanding token is treated as generation `0` during the transition (D-3.2). |
| **M-2** | *(no migration)* — reconciliation report only: rows where `User.permissions` ≠ `ROLE_PERMISSIONS[role]` | n/a (read-only) | C-2's pre-flip evidence. Deliberately **not** a write: the point of this record is to stop reconciling snapshots. Output is a Security-Review artifact for PR-3. |
| **M-3** | Drop `User.permissions` | **No** (data loss, by design) | Runs in PR-7, only after PR-5 has soaked and C-6's invariant test has been green across a full release cycle. Pre-drop snapshot of `(user_id, role, permissions)` to a backup table retained for one release, matching `ADR-030` §5's operational envelope. |

`JWT_ACCESS_EXPIRY` `1h`→`15m` is a configuration change, not a migration.

---

## 7. PR sequence

Each PR is independently revertible except where noted. Gate column: **S** = Security Review blocking, **A** = Architecture Review blocking, **P** = Performance Review blocking (Constitution §12 — the author cannot self-approve).

| PR | Goal | Depends on | Migrations | Rollback | Gate |
|---|---|---|---|---|---|
| **PR-0** | Characterization tests pinning today's behavior at the trust boundary: a deactivated / soft-deleted / demoted user's existing access token still authorizes; `req.auth.permissions` comes from the claim; no auth endpoint is rate-limited; `Session` rows survive expiry. These must **fail** after PR-3/PR-1 — they are the evidence that the change took effect | — | — | revert | — |
| **PR-1** | **Rate limiting** (D-6): `limit_req_zone`/`limit_req` added to `nginx/hotelcrm.conf` (+ `deploy/aws-edge-checklist.md`) for the five `auth/routes.ts` endpoints, IP-keyed, with `Retry-After`. Infrastructure config, not backend code. Correct under any outcome of §2 — **may ship without ratifying this ADR** | PR-0 | — | revert (config) | **S** |
| **PR-2** | **Schema + issuance**: M-1; `token_generation` added to `AccessTokenPayload` (`lib/jwt.ts`) and mirrored from the row at all three issuance sites (`auth/service.ts:84,137,194`). **Nothing verifies the claim yet** — additive, invisible, and it seeds the claim into circulation before PR-3 can require it (the `ADR-030` D-6 "add the token, read it later" pattern) | PR-1 | M-1 | revert; column droppable while unread | **S** |
| **PR-3** | **The cutover.** `authMiddleware` **and** `optionalAuthMiddleware` (C-3) resolve the live `User` row: `is_active`/`deleted_at` → 401; `token_generation` mismatch → 401 `TOKEN_REVOKED`; `permissions` derived from `ROLE_PERMISSIONS[row.role]`; `role` taken from the row. `ROLE_PERMISSIONS` frozen (D-1). Behind `FEATURE_DERIVED_PERMISSIONS` + `FEATURE_TOKEN_GENERATION_ENFORCEMENT`, both default **off**; ships with M-2's reconciliation report as review evidence (C-2). The `permissions` claim is still issued and still honored when the flag is off. **Performance-gate acceptance criterion (P):** with the flags on in a staging/load-test environment, the added `User` lookup must show **no statistically significant increase in median request latency** (target: <5ms added at p50) across the representative authenticated-route mix; if the measured cost exceeds this, PR-3 does not merge on the strength of "it's one indexed read" alone — the optional cache (D-3) becomes a requirement of this PR, not a fallback saved for later | PR-2 | M-2 (read-only) | flags off (both-off = today, C-4) | **S**, **A**, **P** |
| **PR-4** | **Revocation triggers + write-path cleanup**: transactional `token_generation` bump (C-5) on role change, deactivation, soft delete, and password-reset confirm; new Admin-only "revoke all sessions for user" endpoint; `AuditLog` row per bump; `createUser`/`updateUser`/`updateUserRole` stop computing and writing `User.permissions`; C-6's no-reader invariant test. `logout` semantics explicitly unchanged (D-4) | PR-3 (flag-on) | — | revert | **S** |
| **PR-5** | **Claim removal + client forced-re-auth**: drop `permissions` from `AccessTokenPayload` and all issuance sites; a claim-less token becomes invalid; `JWT_ACCESS_EXPIRY` default → `15m`. Requires the client work of PR-4a below to be already deployed (C-7) | PR-4, **PR-4a deployed** | — | revert (re-adding a claim is backward-compatible) | **S** |
| **PR-4a** | **Clients**: `frontend/` + both mobile apps distinguish 401 `TOKEN_REVOKED` (clear credentials, re-authenticate) from ordinary expiry (refresh); surface 429 + `Retry-After` on login/reset. **Ships before PR-5's flag is enabled in production** (C-7). Numbered `4a` because it parallels PR-4 rather than following it — it depends only on PR-3's error contract | PR-3 | — | revert per app | — |
| **PR-6** | **Sweep job** (D-5) on the Platform Worker: expired `Session` + expired/used `PasswordResetToken`, batched, bounded, metered, interval configurable (default hourly) | PR-1 (independent of PR-2..5) | — | disable job | **P** |
| **PR-7** | **Flag retirement + column drop**: remove both flags and the dead claim-honoring branch; M-3 drops `User.permissions` after a full-release soak with C-6 green | PR-5, PR-6 | M-3 | **not reversible** (by design; pre-drop snapshot retained one release) | **S**, **A** |
| **PR-8** | Documentation, register, and knowledge-graph synchronization: close the §11 SIR rows, mark GD-07 resolved, restate `ADR-030` §5 M-2 / §9 as superseded, reclassify `ROLE_PERMISSIONS` as a contract node in `DEPENDENCY_GRAPH.yaml`/`CONTRACT_INDEX.yaml`, register this ADR in `DECISION_INDEX.md` | PR-7 | — | — | — |

**Ordering constraints that are not negotiable:**

- **PR-2 before PR-3.** The claim must be in circulation before any request path requires it, or every outstanding token is rejected at once.
- **PR-3 (flag-on, soaked) before PR-5.** C-1 — removing the claim while derivation is off denies every permission-gated route platform-wide.
- **PR-4a deployed before PR-5's flag is enabled in production.** C-7 — otherwise every client loops on refresh against a permanently-401 token.
- **PR-4's bumps land after PR-3's check is live, not before.** A bump with nothing verifying it is a silent no-op that will read as "revocation works" in review.
- **PR-7 after a full-release soak, never in the same release as PR-5.** M-3 is the only irreversible step.
- **PR-1 and PR-6 may ship independently of ratification.** Rate limiting and sweeping are correct under every option in §2, including (c).

> **Owner amendment (2026-07-27):** the "full-release soak" precondition above was written
> assuming transition into an operational deployment upon this ADR's completion. As of PR-7,
> this repository has **no completed production deployment** — verified via the GitHub
> Deployments API (192 sampled production-environment deploy attempts, 2026-06-14 through
> 2026-07-26, 100% failure at the migration step on an unpopulated `DATABASE_URL` secret; zero
> `release/*` tags) and first-party project record (`docs/legacy/infrastructure/AWS_DEPLOYMENT_EXECUTION_PLAN.md`,
> 2026-06-20: *"no AWS resources provisioned, no deployment performed"*). The owner has decided:
> PR-7 and PR-8 may proceed once PR-1 through PR-6 are fully implemented and gate-verified in the
> repository, independent of whether a production environment has ever run this code. **The
> production-soak precondition is not waived** — it is relocated from a repository-implementation
> gate to an operational rollout gate, tracked in full at
> `docs/implementation/ADR-031_PRODUCTION_ROLLOUT_CHECKLIST.md`, which must be satisfied before
> either `FEATURE_DERIVED_PERMISSIONS` or `FEATURE_TOKEN_GENERATION_ENFORCEMENT` (or code at/after
> PR-7, which removes them as toggles) ever runs against a real production database. Nothing in
> D-1 through D-6 or C-1 through C-7 above is superseded by this amendment; only the *place* the
> soak precondition is enforced changes.

---

## 8. Consequences

- **One forced re-authentication event, platform-wide**, when PR-5's flag is enabled: tokens issued before PR-2 carry no `token_generation` and are rejected. Bounded by access-token TTL if PR-5 is enabled during a low-traffic window after PR-2 has been deployed for longer than one TTL; unavoidable in principle, cheap in practice (clients hold a valid 7-day refresh token and PR-4a makes the path graceful).
- **The JWT is no longer self-sufficient for authorization.** This is the trade being made, stated plainly: one indexed primary-key read is added to every authenticated request. In exchange, revocation becomes immediate and the permission matrix becomes editable without a data migration. If the platform later needs a fully stateless request path, that is a reversal of this record, not a tuning exercise.
- **`ADR-030`'s M-2 treadmill ends.** A future capability-matrix change becomes a source edit plus a test, with no backfill and no per-user data change.
- **`ADR-030`'s stale-token risk (§9, first bullet) closes.**
- **A demotion, deactivation, or soft delete takes effect on the next request** — including mid-session. Handlers that assumed a stable `req.auth` for the life of a token do not exist today (nothing caches `req.auth` across requests), but this becomes a standing invariant.
- **Manager-reassignment latency is unchanged** (D-3.5): scope stays issuance-time. Recorded as a known, bounded gap with an available manual mitigation, and as OI-2.
- **Rate limiting changes observable behavior for legitimate clients** under retry storms; Nginx's `burst` allowance is configuration, set generously so only sustained abuse is denied.
- **Rate limiting is IP-keyed only, per `TREQ-AUTH-008`.** Distributed credential stuffing across many IPs is not bounded by this decision — an accepted, confirmed-requirement-driven gap, not an oversight (§10 OI-3a).
- **`Session` and `PasswordResetToken` gain a deletion policy** and therefore join `OutboxEvent` as records needing a GDPR retention tier under `SIR-NOTIF-002`/GD-09 before G8.
- **New Prisma field:** `User.token_generation Int @default(0)`. New middleware file, one new Platform Worker job, one new Admin endpoint. No new module, no new external dependency, no new infrastructure.

### Risks

- **Critical, mitigated by C-2** — flipping derivation on against drifted `User.permissions` rows silently changes live authorization in both directions. Mitigation: the pre-flip reconciliation report is a blocking Security-Review input, and both flags default off.
- **Critical, mitigated by C-1/C-3** — a missed `optionalAuthMiddleware` update, or claim removal before derivation, produces a platform-wide authorization failure or a stale-permission path. Mitigation: explicit constraint plus PR-0 characterization coverage on both middlewares.
- **High, mitigated by C-5** — a non-transactional bump loses a revocation against a committed demotion.
- **High, mitigated by C-7/PR-4a ordering** — clients stranded in a refresh loop on `TOKEN_REVOKED`.
- **Medium** — an over-long authorization cache TTL would silently re-introduce staleness. Mitigation: D-3 fixes the TTL ceiling at 5 seconds as policy, with per-`user_id` invalidation on bump, and caching is optional.
- **Low** — added per-request read latency. Mitigation: PR-3 carries a Performance Review gate with a stated acceptance criterion (<5ms added at p50, no statistically significant regression); a primary-key read on a request that already queries is expected to be within noise, and the optional bounded cache is a PR-3 requirement, not a later fallback, if measurement says otherwise.
- **Low** — the database becomes a hard dependency of authorization itself, where today a valid JWT authorizes even during a database outage. Not mitigated, by design: this is an accepted change to the platform's failure mode (D-3), traded for live revocation. Recorded, not hidden.

---

## 9. Non-goals

Stated once, plainly, for reviewers who would otherwise ask "does this also fix X?" Everything below is unresolved by this record; each has its own entry in the Open Items table that follows, with a disposition. This section exists to make that scope boundary visible without reading the whole table.

- **Not solved by `ADR-031`:**
  - MFA (OI-5)
  - Live derivation of `scope` (D-3.5 — role is derived live, scope is not; see the query-cost rationale there)
  - Per-device / per-token revocation (OI-6 — `token_generation` is user-grained: revoking one device revokes all of a user's tokens)
  - Permission inheritance / a privilege hierarchy (out of scope entirely; `ADR-030`'s flat capability model is consumed unchanged)
  - RBAC redesign (`requirePermission`/`requireRole` are explicitly unchanged in source, D-7)
  - Per-account (not per-IP) rate-limiting (OI-3a)
  - `CHECKER`'s hotel-scope bypass (OI-7 — pre-existing, untouched)
  - GDPR retention-tier assignment for `Session`/`PasswordResetToken` (OI-4 — this record sweeps for hygiene, it does not assign a tier)

---

## 10. Open items — NOT resolved by this record

Recorded rather than assumed (Constitution §6). None blocks §7's sequence; each needs its own decision or its own PR.

| ID | Item | Disposition |
|---|---|---|
| **OI-1** | `SIR-AUTH-017` — password-reset/login timing side-channel. Rate limiting (D-6) bounds enumeration throughput but does not equalize branch latency; the identical pre-existing gap in `login()` (`bcrypt.compare` runs only when a user is found) is untouched | **Stays OPEN.** Constant-time branch equalization is its own change with its own review. |
| **OI-2** | Should a manager-reassignment (`Hotel.manager_user_id` / `HotelGroup.regional_manager_user_id` change) automatically bump `token_generation`, making scope revocation immediate too? | **OPEN.** The mechanism exists (D-4); making the bump automatic couples `backend-crm`'s master-data writes to `backend-auth`'s token state — a cross-module boundary question (GD-13 territory), not a permission-derivation question. |
| **OI-3a** | Per-account (not just per-IP) rate-limiting for credential stuffing spread across many IPs | **OPEN, confirmed-requirement-bounded.** `TREQ-AUTH-008` puts rate limiting at the edge; an edge proxy cannot key on application-level account identity without becoming an application-layer control. Any fix here is a confirmed-requirement change, not an architecture decision — out of this record's authority (Constitution §6). |
| **OI-4** | GDPR retention tiers for `Session` and `PasswordResetToken` | **OPEN under GD-09 / `SIR-NOTIF-002`.** D-5 sweeps for hygiene; it does not assign a retention tier. |
| **OI-5** | MFA (`TREQ-AUTH-006`, GD-08, `SIR-GLOB-004`) | **Untouched and OPEN.** `token_generation` composes with a future MFA design (an MFA-state change is another bump trigger) but nothing here decides MFA. |
| **OI-6** | Access-token denylist for sub-TTL revocation of *individual* tokens (as opposed to all of a user's tokens) | **OPEN, deliberately deferred.** `token_generation` is user-grained: revoking one device's token revokes all of them. Per-token revocation is Option (b)'s territory and remains strictly additive later. |
| **OI-7** | `CHECKER` bypasses hotel scope entirely (`middleware/permissions.ts:156`), noted as out of scope by `ADR-030` §7 | **Still OPEN.** Unchanged by this record — derivation changes provenance, not the bypass. Re-recorded so it is not read as closed by a record that touches this file. |

---

## 11. Compatibility

| Authority | Effect |
|---|---|
| `ADR-017` | Consumed unchanged. `backend-auth` remains `state-user`'s authoritative writer; `token_generation` is its column. |
| `ADR-023` | Consumed unchanged. The `scope` claim's shape and issuance-time resolution are explicitly preserved (D-3.5). |
| `ADR-024` | Consumed, not amended. D3/D4's additive two-flag, both-off-is-current topology is reused for this cutover (C-4). Neither flag widens authority, so this is not an `ADR-030` M-4-class privilege toggle. |
| `ADR-029` | Consumed and extended by reuse: the sweep job is hosted on the existing Platform Worker (§3 D-5), honoring the "no external queue/Redis" constraint — which is also the ground on which Option (b) is rejected. |
| `ADR-030` | **Amended** — §1 fact 2, §5 M-2, and §9's first two accepted costs. §3's capability matrix, §4's ownership matrix, and D-1…D-10 are consumed **unchanged**; D-7's no-source-change property (§3) keeps `ADR-030` PR-7's invariant and route×role matrix tests valid without edit. `ADR-030` §6's reservation of this decision as `ADR-031` is discharged by this record. |
| `SPEC-AUTH-001` (FROZEN) | Gains, at its next revision, the resolved revocation/session-lifecycle posture and the derived-permission enforcement point. `OQ-AUTH-14` (`SIR-AUTH-014`) resolves. **`TREQ-AUTH-008`/`TRULE-AUTH-002` (no app-layer rate-limiting) are consumed, not amended** — D-6 was corrected during review specifically to conform to this Confirmed authority rather than rewrite it; the ADR now decides only the edge-config mechanics, which the spec already scopes as "a separate, out-of-module concern." No frozen requirement text is rewritten by this record (the `ADR-023`/`ADR-025`/`ADR-030` forward-note precedent). |
| `SPEC-USERS-001` | `SIR-USERS-015` resolves. The module stops owning a permission snapshot; `ROLE_PERMISSIONS`'s reclassification closes the shared-contract-node half of `SIR-USERS-017`. Correction-class forward-note at next revision — **not made by this record**. |
| `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` | Rows to move to RESOLVED **on completion of §7** (not on ratification): `SIR-USERS-015` (token revocation → D-3/D-4), `SIR-AUTH-014` (session sweep → D-5), `SIR-AUTH-018` (auth rate limiting **and** its `PasswordResetToken`-sweep half → D-6/D-5). `SIR-AUTH-019` is **already RESOLVED** via `ADR-030` PR-1 and is not re-resolved here; it is cited by GD-07 only as lineage. `SIR-AUTH-017` stays OPEN (OI-1). `SIR-USERS-003`'s remaining facet is already tracked through `SIR-AUTH-019` and is unaffected. |
| `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` | `GD-07` marked resolved by this record, adapted from Option (a) — the derivation/revocation/sweep mechanics as recommended, with the rate-limiting half corrected to edge-level per `TREQ-AUTH-008` rather than the row's original in-app framing. Its "~3–5 PRs" estimate becomes 9 (PR-0 through PR-8, including PR-4a), the increase being the flag-gated cutover sequencing and client forced-re-auth work the row did not enumerate. `GD-08`, `GD-09`, `GD-13` untouched; `GD-09` gains the `Session`/`PasswordResetToken` retention items (OI-4). |
| `.claude/knowledge/DEPENDENCY_GRAPH.yaml`, `CONTRACT_INDEX.yaml` | `ROLE_PERMISSIONS` registered as a request-path shared contract node owned by `backend-auth`; `backend-auth` gains a read edge to `state-user` on the request path (PR-8, §7). |
| `docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md` | Gains this record's §7 sequence as its own epic on ratification; no epic is renumbered by this record. |
| `DECISION_INDEX.md` | Gains this row (`ADR-031`, **Proposed**) in the same governance pass; updated to Accepted only on owner ratification. |

**One contradiction was found during independent review and corrected in this text, not left standing:** D-6's original draft proposed application-layer rate-limiting middleware, which directly reversed `SPEC-AUTH-001`'s Confirmed `TREQ-AUTH-008`/`TRULE-AUTH-002`/`TREQ-AUTH-007` ("no rate-limiting/CAPTCHA at the application layer... never lockout"). D-6 now decides only an Nginx edge-config change, which the frozen spec already scopes as "a separate, out-of-module concern" — the confirmed requirement is consumed, not amended or overridden. No other blocking contradiction was found against any checked authority (independent consistency, specification, and knowledge-graph reviews; five additional citation/sequencing defects were found and corrected in place — canonical drop/flag-retirement PR is §7 PR-7 throughout, PR-5's claim removal is gated by the existing `FEATURE_TOKEN_GENERATION_ENFORCEMENT` flag rather than an undeclared third flag, the PR count is 9 consistently, D-1's freeze-hazard citation is corrected to describe `Object.freeze`'s shallow-freeze limit rather than an unfrozen array, and the `resource:*` wildcard citation is `permissions.ts:35-45`).

---

## 12. Scope note

This record settles the derivation model, the revocation primitive, the sweep placement, the rate-limiting approach, the migration plan, and the PR sequence. It authors no code, freezes or amends no specification text, and performs no knowledge-layer reclassification beyond what §11 schedules for PR-8. **Status is `Accepted` (ratified 2026-07-26):** every PR in §7 is authorized, subject to its own Gate column review; the register rows in §11 move to RESOLVED on completion of §7, per §11's own note, not on ratification alone.
