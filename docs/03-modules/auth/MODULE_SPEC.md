# Module Specification: `backend-auth`

> Specification of ONE bounded capability — credential issuance/verification, session
> lifecycle, and role-based (soon role×scope) authorization for the hotel-crm backend. This
> capability is **MID-PIVOT**. It carries two labeled layers: `[CURRENT STATE]` —
> already-implemented signup/login/refresh/logout/password-reset/profile behavior plus the
> `auth-middleware` contract, reverse-specified at repository revision
> `db4dbbb5416c78d6420ae0b9ef97b2c10be6c67a`; and `[TARGET STATE]` — the confirmed 5-role,
> role×scope, MFA-for-managers, email-mediated-forgot-password model that is authoritative but
> almost entirely unbuilt. `[MIGRATION GAP]` marks the delta between them. Every material claim
> is bound to source: current-state claims cite `path:line @db4dbbb5`; target-state claims cite
> the confirmed authorities `CONFIRMED_REQUIREMENTS_REGISTER.md` (CONFIRMED §x) and
> `PIVOT_DESIGN_DOCUMENT.md` (PIVOT §x). This document records behavior and confirmed contract;
> it does not create product policy and does not implement anything. All human-authority
> decisions are carried as explicit open decisions and are NOT resolved here.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-AUTH-001 / 0.2.6` (Document Control previously claimed `0.3.0` with no corresponding Change Log row — corrected to `0.2.4` at the `GD-09` amendment, `0.2.5` at the `GD-08` amendment, now `0.2.6` at this `GD-03` amendment) |
| Status | `FROZEN` (Amended (Correction, v0.2.4→0.2.5) 2026-07-28, per `GD-08`/`ADR-038`; prior amendment v0.2.3→0.2.4 per `GD-09`/`ADR-033`) |
| Owner | `unassigned (SYNC-001, human authority required)` |
| Authors / reviewers | Author: Module Author agent. Reviewers: Architecture, Dependency, Consistency, and Performance reviews completed — all returned `PASS_WITH_ACTIONS`; dispositions applied at v0.2.0 (see Review and Change Log). Security review completed — returned **`FAIL`** (1 Critical, 4 High): Critical — `POST /password-reset` account-takeover (`REQ-AUTH-007`/`RULE-AUTH-004`, `OQ-AUTH-05`); High — JWT refresh-secret fallback (`REQ-AUTH-015`/`RULE-AUTH-008`, `OQ-AUTH-04`), `checkHotelAccess` admin/manager/checker bypass (`REQ-AUTH-013`/`RULE-AUTH-006`, `OQ-AUTH-06`), cleartext `Session.refresh_token` storage (new finding, `OQ-AUTH-15`), and absence of any MFA compensating control (`REQ-AUTH-022`). None of these findings is resolved by this document — they are live code defects — and each is recorded as a blocking, unassigned residual risk pending a code fix or an authorized Risk Assessment per Constitution §12 (see "Risks, Assumptions, and Open Decisions" below). The Security Reviewer independently confirmed every flagged current-state behavior in v0.1.0 was documented accurately and completely; the FAIL attaches to the underlying code, not to this document. This status does NOT clear the Security gate. |
| Repository revision | `db4dbbb5416c78d6420ae0b9ef97b2c10be6c67a` |
| Approved by / at | FROZEN at G2 Specification Freeze on 2026-07-15 by the commissioning human via the G2 Approval Workflow. Per the approving decision, the specification is frozen independently of implementation security findings: the open security findings recorded against this module remain **implementation/release prerequisites** (must be fixed or re-reviewed before G8 Release Readiness), NOT specification-freeze blockers. No temporary Risk Assessment was created. Cross-cutting G2 blockers cleared by ADR-001..010 (ratified 2026-07-15) and by the `state-user` authoritative-writer decision ADR-017 (Accepted, 2026-07-15). Security posture: the Critical (`POST /password-reset`) was already resolved in code by HOTFIX-AUTH-002; the 4 remaining High findings (`OQ-AUTH-04`/`06`/`15`, absent MFA) stay OPEN as release prerequisites, review by G8. |
| Supersedes | None — first specification for `backend-auth` (registry `specification: UNKNOWN` prior; `.claude/knowledge/MODULE_REGISTRY.yaml:40`). |

## Purpose and Scope

**Outcome:** Define the contract for the hotel-crm authentication and authorization
capability across its full pivot arc. This is ONE bounded capability implemented by a single
backend module (`backend-auth`), specified together with the `User`/`Session` Prisma models it
partially or wholly writes, the JWT issuance/verification functions it owns (`backend/src/lib/jwt.ts`),
and the `auth-middleware` in-process contract it owns and that every other active backend module
consumes.

- `[CURRENT STATE]` (implemented @db4dbbb5): seven HTTP endpoints (signup, login, refresh,
  password-reset, logout, get-current-user, update-profile) backed by `AuthService`; HS256 JWT
  access/refresh tokens with no `scope` claim; a `Session` row per login/signup that is rotated
  in place on refresh (a de-facto sliding 7-day inactivity window) and deleted on logout/password
  reset; a 4-role (`WORKER|CHECKER|MANAGER|ADMIN`) permission model with zero MFA, zero
  rate-limiting, zero failed-login tracking, and a password-reset endpoint that is a public,
  token-less, direct password-overwrite operation.
- `[TARGET STATE]` (confirmed, almost entirely unbuilt — CONFIRMED §1, §2; PIVOT §4.1, §5.3,
  §5.4, §9.1): a 5-role model adding a new `Regional Manager` role with hotel-group scope; a
  role×scope deny-by-default authorization model with a `scope` JWT claim; MFA required for
  Hotel Manager and above; failed-login handling that notifies the manager instead of locking
  the account; and a genuinely email-mediated forgot-password flow. PIVOT §12 names only
  "RM role+scope" as this module's explicit M1 deliverable — MFA, email-reset, and
  failed-login-notify are confirmed requirements attributable to this capability but are not
  explicitly milestone-pinned by either authority document (carried as `OQ-AUTH-01`).

**In scope:**
- `backend/src/modules/auth/{service.ts,controller.ts,routes.ts,validation.ts,types.ts}` and
  `backend/src/__tests__/auth.test.ts` — full current-state behavior of all seven endpoints.
- `backend/src/middleware/auth.ts` (`authMiddleware`, `optionalAuthMiddleware`) — the
  `auth-middleware` contract, owned by `backend-auth` per `.claude/knowledge/DEPENDENCY_GRAPH.yaml:57`
  even though the file lives outside `backend/src/modules/auth/`.
- `backend/src/lib/jwt.ts` — access/refresh token signing and verification, owned by this
  module (no separate registry/graph entry exists for it; it is treated as part of this
  module's own implementation, not a shared contract, since its only callers are
  `modules/auth/service.ts` and `middleware/auth.ts`).
- The `User` and `Session` Prisma models (`backend/prisma/schema.prisma`) to the extent this
  module writes them — `User` is a **shared-write** model (also written by `backend-users`,
  SYNC-005, out of scope beyond flagging the shared-write fact) and `Session` is **solely**
  owned by this module.
- `backend/src/middleware/permissions.ts` (`requireRole`, `requirePermission`,
  `checkHotelAccess`) and `backend/src/__tests__/rbac.test.ts` — specified here as the
  functional RBAC enforcement mechanism this capability depends on for its target-state role×scope
  requirements, **while preserving the registry's ownership distinction**: `permissions-middleware`
  is a **separate contract with owner `unassigned`**, NOT owned by `backend-auth`
  (`.claude/knowledge/DEPENDENCY_GRAPH.yaml:58,383-399`), and — notably — `backend-auth`'s own
  routes do not consume it (verified: `permissions-middleware`'s consumer list,
  `DEPENDENCY_GRAPH.yaml:388-399`, does not include `backend-auth`). This spec fully specifies
  `permissions-middleware`'s REQ/RULE behavior in its own Requirements/Business-Rules sections
  because it is the functional RBAC mechanism this capability's target-state role×scope
  requirements depend on — that in-scope decision documents the contract's *behavior*, it does
  NOT resolve or narrow its *ownership*: whether `permissions-middleware` should be reassigned to
  `backend-auth` remains a separate, unresolved architecture decision (`OQ-AUTH-07`), not silently
  settled by this document (architecture review FIND-001).
- Config surface: `backend/src/config/env.ts` `JWT_*` fields and their consumption; the
  declared-but-unwired `EMAIL_SERVICE`/`SENDGRID_API_KEY`/`RESEND_API_KEY` fields relevant to
  the target email-mediated forgot-password flow.
- `.claude/knowledge/DEPENDENCY_GRAPH.yaml` nodes `backend-auth`, `auth-middleware`, the
  `state-user`/`state-session` state-domain blocks, and the client/deploy edges targeting it.
- `.claude/knowledge/MODULE_REGISTRY.yaml` entry `id: backend-auth`.

**Out of scope:**
- The internal business logic of every OTHER module that merely *consumes*
  `auth-middleware`/`permissions-middleware` (12 other backend modules, see Dependencies) —
  their own authorization decisions are specified, or pending specification, elsewhere.
- `backend-users`' own CRUD writes to `User` (SYNC-005's other writer) — only the shared-write
  fact is recorded here, not that module's internal behavior.
- `HotelWorker` lifecycle mechanics (`backend-hotel-workers`) beyond the boundary evidence
  `checkHotelAccess` reads (an `ACTIVE` `HotelWorker` row lookup).
- Notification delivery mechanics for the target failed-login-notify-manager trigger — this
  spec records the trigger as this module's target *producer*-side gap only; the delivery
  contract itself is specified in `docs/03-modules/notifications/MODULE_SPEC.md` (`TREQ-001`,
  `MIG-GAP-01`).
- The not-yet-specified `PersonalData`/special-category-field access model (PIVOT §9.3, §5.4,
  §4.13) beyond noting it as a forward dependency on this module's permission mechanism.
- Any code change, migration, or implementation of any kind. This is documentation only.

**Non-goals:** Requirements discovery, product-policy invention, code planning, independent
review, or resolving any open decision below.

## Evidence and Traceability

`[CURRENT STATE]` requirements (REQ-AUTH-001..024) — reverse-specified at `db4dbbb5`:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-AUTH-001` signup: duplicate-email rejected, bcrypt hash @ `BCRYPT_ROUNDS=12`, role defaults `WORKER`, permissions from `ROLE_PERMISSIONS[role]`, `Session` created, `AuditLog` (`SIGNUP`) written | `modules/auth/service.ts:15-72`; `config/constants.ts:88-129,131` @db4dbbb5 | Code + test | Observed; tested |
| `REQ-AUTH-002` `Session.expires_at = now + 7*24*60*60*1000` is hardcoded literally at 3 independent call sites, decoupled from the `JWT_REFRESH_EXPIRY` env value used to sign the refresh token itself | `modules/auth/service.ts:48,99,154` @db4dbbb5 | Code | Observed |
| `REQ-AUTH-003` login: not-found/deleted → `UnauthorizedError('Invalid credentials')`; `!is_active` → `ForbiddenError('Account is disabled')`; bcrypt mismatch → `UnauthorizedError`; success → tokens + `Session` create + `AuditLog`(`LOGIN`) | `modules/auth/service.ts:74-123` @db4dbbb5 | Code + test | Observed; tested (not-found/disabled/wrong-password) |
| `REQ-AUTH-004` refreshToken: verifies refresh JWT `type:'refresh'`; looks up `Session` by `refresh_token`+`user_id`; `UnauthorizedError` if missing/expired; re-validates user active/not-deleted; rotates `refresh_token` and resets `expires_at` on the SAME `Session` row (`session.update`, not `create`); writes NO `AuditLog` row | `modules/auth/service.ts:125-163` @db4dbbb5 | Code (absence of test, absence of audit call) | Observed; **untested** |
| `REQ-AUTH-005` logout: `refresh_token` in body → delete only that `Session`; absent → delete ALL sessions for the user; `AuditLog`(`LOGOUT`, `actor_role: null`) | `modules/auth/service.ts:165-174` @db4dbbb5 | Code + test | Observed; tested |
| `REQ-AUTH-006` getCurrentUser: selected-field read by id; 404 `NotFoundError` if missing; `role` returned lowercased | `modules/auth/service.ts:176-195` @db4dbbb5 | Code + test | Observed; tested |
| `REQ-AUTH-007` resetPassword (`POST /password-reset`, public, no `authMiddleware`): input `{email, new_password}` only (`PasswordResetSchema`); no token, no email verification step, no email ever sent; unknown/inactive/deleted email → silent no-op (comment: "Return silently — do not reveal whether email exists"); matching active user → unconditional `password_hash` overwrite + delete ALL that user's `Session` rows + `AuditLog`(`MODIFY`, `{action:'password_reset'}`) | `modules/auth/routes.ts:11`; `modules/auth/service.ts:197-212`; `modules/auth/validation.ts:31-37`; `modules/auth/controller.ts:85-99` (response message: "If that email exists, the password has been reset") @db4dbbb5 | Code (absence of test) | Observed; **untested** |
| `REQ-AUTH-008` updateProfile: partial update of `first_name/last_name/phone/profile_photo_url`; `AuditLog`(`MODIFY`, `{fields: Object.keys(data)}`) | `modules/auth/service.ts:214-242` @db4dbbb5 | Code (absence of test) | Observed; **untested** |
| `REQ-AUTH-009` `authMiddleware`: extracts `Bearer` token, verifies via `verifyAccessToken` (HS256, `JWT_SECRET`), sets `req.auth={userId,email,role,permissions}`, else `UnauthorizedError` | `middleware/auth.ts:5-38` @db4dbbb5 | Code (no dedicated test file found) | Observed; **untested** (no `middleware/auth.test.ts` in `backend/src/__tests__/`) |
| `REQ-AUTH-010` `optionalAuthMiddleware`: same extraction/verify but never throws; applied GLOBALLY to the entire v1 router ahead of every module's own `authMiddleware` | `middleware/auth.ts:40-65`; `routes/v1/index.ts:2,20` @db4dbbb5 | Code | Observed |
| `REQ-AUTH-011` `requirePermission(permissions)`: allows if `req.auth.role==='super_admin'` (a role string absent from the 4-value `UserRole` enum and from `ROLE_PERMISSIONS`/`ROLE_HIERARCHY` — dead/unreachable) OR `admin:*` blanket permission; else exact or wildcard (`resource:*`) match | `middleware/permissions.ts:7-63` @db4dbbb5 | Code + test (dead branch itself untested, consistent with unreachability) | Observed; RULE-004 branch tested, `super_admin` branch not exercised |
| `REQ-AUTH-012` `requireRole(roles)`: exact string match against `req.auth.role` (lowercased role tokens `admin/manager/checker/worker`) | `middleware/permissions.ts:65-94`; `__tests__/rbac.test.ts:31-59` @db4dbbb5 | Code + test | Observed; tested |
| `REQ-AUTH-013` `checkHotelAccess()`: `admin`/`manager`/`checker` roles bypass ENTIRELY (no DB query); otherwise requires an `ACTIVE` `HotelWorker` row matching `hotel_id`(params/query/body) + `req.auth.userId` | `middleware/permissions.ts:96-156`; `__tests__/rbac.test.ts:91-136` (test names cite "PATCH-04 §4c bypass") @db4dbbb5 | Code + test | Observed; tested |
| `REQ-AUTH-014` Access token: HS256, `JWT_SECRET`, claims `{sub,email,role,permissions,iat,exp}`, expiry `JWT_ACCESS_EXPIRY` (default `'1h'`); NO `scope` claim exists anywhere in the token | `lib/jwt.ts:27-33`; `config/env.ts:20` @db4dbbb5 | Code | Observed |
| `REQ-AUTH-015` Refresh token: HS256, `JWT_REFRESH_SECRET` **falling back to `JWT_SECRET` if unset** (same secret then signs both token types), claims `{sub,type:'refresh',iat,exp}`, expiry `JWT_REFRESH_EXPIRY` (default `'7d'`) | `lib/jwt.ts:35-42,70-89` @db4dbbb5 | Code | Observed |
| `REQ-AUTH-016` `JWT_SECRET` required (min 32 chars) at env load; `JWT_REFRESH_SECRET` optional (min 32 chars if present) | `config/env.ts:18-19` @db4dbbb5 | Code | Observed |
| `REQ-AUTH-017` `User.email_verified_at`/`phone_verified_at`/`last_login_at` are present on the schema but never written by any code path in this module (verified: no matching field name in any `service.ts` `data:` block) | `schema.prisma:128-130`; `modules/auth/service.ts` (absence) @db4dbbb5 | Code (absence) | Observed |
| `REQ-AUTH-018` `Session.device_info`/`ip_address` are present on the schema but never populated — both `session.create` call sites set only `user_id`/`refresh_token`/`expires_at` | `schema.prisma:162-163`; `modules/auth/service.ts:44-50,95-101` @db4dbbb5 | Code (absence) | Observed |
| `REQ-AUTH-019` `UserRole` enum has exactly 4 values (`WORKER,CHECKER,MANAGER,ADMIN`); no `REGIONAL_MANAGER` | `schema.prisma:22-27` @db4dbbb5 | Code | Observed |
| `REQ-AUTH-020` `ROLE_HIERARCHY` (`{admin:1,manager:2,checker:3,worker:4}`) is declared but has ZERO consumers anywhere outside its own declaration (repo-wide grep) | `config/constants.ts:65-70` @db4dbbb5 | Code (absence) | Observed |
| `REQ-AUTH-021` No login rate-limiting and no CAPTCHA exist anywhere in `backend/src` (repo-wide grep for rate-limit middleware/CAPTCHA returns none; `RATE_LIMIT_EXCEEDED`/`TOO_MANY_REQUESTS` constants are declared in `constants.ts` but never thrown/used) | `config/constants.ts:11,62` (declared, unused); repo-wide grep, no matches @db4dbbb5 | Code (absence) | Observed |
| `REQ-AUTH-022` No MFA/TOTP/2FA code exists anywhere in `backend/src` (repo-wide grep, no matches) | repo-wide grep, no matches @db4dbbb5 | Code (absence) | Observed |
| `REQ-AUTH-023` `EMAIL_SERVICE`/`SENDGRID_API_KEY`/`RESEND_API_KEY` are declared as optional Zod env fields but have ZERO consumers anywhere outside `env.ts` (repo-wide grep) — directly relevant to the target email-mediated forgot-password flow (`TREQ-AUTH-005`) | `config/env.ts:42-44`; repo-wide grep, no matches @db4dbbb5 | Code (absence) | Observed |
| `REQ-AUTH-024` Test coverage: `auth.test.ts` covers signup (duplicate-email, success, role-permission assignment), login (not-found, disabled, wrong-password), logout (with/without token), getCurrentUser (found/not-found); `refreshToken`/`resetPassword`/`updateProfile` have ZERO tests; `middleware/auth.ts` (`authMiddleware`/`optionalAuthMiddleware`) and `lib/jwt.ts` have ZERO dedicated tests; `middleware/permissions.ts` (RBAC guards) IS separately covered by `rbac.test.ts` (13 cases: `requireRole` ×4, `requirePermission` ×4, `checkHotelAccess` ×5) | `__tests__/auth.test.ts:1-211`; `__tests__/rbac.test.ts:1-136`; repo-wide search, no `jwt.test.ts`/`auth-middleware.test.ts` @db4dbbb5 | Test (presence + absence) | Observed |
| Modular-monolith architecture (ADR-003) | PIVOT §5.1, §11; `backend/src/modules/*` @db4dbbb5 | Architecture decision (Proposed) | Confirmed |
| Source-of-truth hierarchy (ADR-008) governs current-vs-target resolution used throughout this spec | `.claude/constitution/SOURCE_OF_TRUTH.md`; ADR-008 @db4dbbb5 | Architecture decision (Proposed) | Confirmed |

`[TARGET STATE]` requirements (TREQ-AUTH-001..010) — confirmed authorities, almost entirely
unbuilt:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `TREQ-AUTH-001` exactly 5 roles (Staff/Worker, Checker, Hotel Manager, Regional Manager [new], Admin); no Supervisor role | CONFIRMED §1:15-16; PIVOT §4.1:85 | Confirmed authority | Target; unbuilt (`MIG-GAP-AUTH-01`) |
| `TREQ-AUTH-002` Regional Manager sees all Hotel-Manager-visible data across every hotel in their managed Hotel Group; a normal Hotel Manager is scoped to one hotel; Admin is system-wide | CONFIRMED §1:20-22; PIVOT §5.4:173-179 | Confirmed authority | **Built** — `REGIONAL_MANAGER` token resolves to `{type:'hotel_group'}` scope claim per `ADR-030` D-5/D-7; enforced across `resolveHotelAccess()`/`resolveWorkerScope()` (`middleware/permissions.ts`), PR #338/#339; see 2026-08-05 forward-note below |
| `TREQ-AUTH-003` JWT claims carry `user_id`, `role`, AND `scope` (the hotel or hotel-group the user may act within); `User`/`Session` are modified to "add scope (hotel/group)" | PIVOT §5.3:170; §9.1:375 (`User, Session \| Add scope (hotel/group); add Regional Manager role; keep soft delete`) | Confirmed authority | Target; unbuilt (`MIG-GAP-AUTH-03`) |
| `TREQ-AUTH-004` login with email/username + password; auto-logout after 1 week (7 days) of inactivity | CONFIRMED §2:27-28; PIVOT §4.1:87, §5.3:168 | Confirmed authority | Target; **partially already-satisfied** — the 7-day sliding-window mechanic already exists (`RULE-AUTH-002`); only username-login support is an actual gap (`MIG-GAP-AUTH-04`) |
| `TREQ-AUTH-005` "Forgot password" reset via email | CONFIRMED §2:29 | Confirmed authority | Target; unbuilt (`MIG-GAP-AUTH-05`) |
| `TREQ-AUTH-006` MFA required for Hotel Manager and above (Hotel Manager, Regional Manager, Admin); explicitly NOT required for Staff/Checker | CONFIRMED §2:30-31; PIVOT §4.1:88, §5.3:169 | Confirmed authority | Target; unbuilt (`MIG-GAP-AUTH-06`) |
| `TREQ-AUTH-007` no account lockout after repeated failed logins; instead notify the manager | CONFIRMED §2:32-33; PIVOT §4.1:89 | Confirmed authority | Target; unbuilt (`MIG-GAP-AUTH-07`); cross-ref `docs/03-modules/notifications/MODULE_SPEC.md` `TREQ-001`/`MIG-GAP-01` (same finding, consumer side) |
| `TREQ-AUTH-008` no login rate-limiting, no CAPTCHA; rate limiting is handled at the Nginx/Cloudflare edge, outside this module | CONFIRMED §2:34-35; PIVOT §5.2:160,163 | Confirmed authority | **Narrowed by `ADR-070` (2026-08-21):** the edge remains the sole control for `signup`/`refresh`/`password-reset` (request+confirm) and for IP-keyed throttling of `login` — unaffected. `login` alone gained ONE additional application-layer control: a bounded, self-clearing per-account throttle after `AUTH_LOGIN_THROTTLE_THRESHOLD` (default 10) consecutive failures, closing `ADR-031 §10 OI-3a`'s "many-IPs-one-account" gap. No CAPTCHA, no manual unlock, no change to `signup`/`refresh`/`password-reset`. See `ADR-070` for why this composes with, rather than contradicts, `TREQ-AUTH-007`'s "never locked" requirement. |
| `TREQ-AUTH-009` deny-by-default RBAC; two-dimensional role×scope model; cross-hotel access requires the actor's scope to include the target hotel; hotel creation is Admin/HQ-only | PIVOT §5.4:172-180; §4.3:103 | Confirmed authority | Target; unbuilt (`MIG-GAP-AUTH-08`) |
| `TREQ-AUTH-010` special-category fields (Konfession, disability) sit behind a restricted sub-permission, audit-logged on every access | PIVOT §5.4:180; §4.13:145; CONFIRMED §27 | Confirmed authority | Target; unbuilt; boundary/forward-dependency note only, not solely this module's gap (`OQ-AUTH-09`) |

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| User | The `User` Prisma row: credential holder (`email`/`password_hash`), role, permissions array, active/soft-delete flags. **Shared-write state** — written by both `backend-auth` (create at signup; `password_hash` overwrite at password-reset) and `backend-users` (separate CRUD); `authoritative_writer: UNKNOWN` (SYNC-005). | `schema.prisma:117-155`; `DEPENDENCY_GRAPH.yaml:421-427` |
| Session | The `Session` Prisma row: one active refresh-token grant per login/signup, rotated in place on refresh, deleted on logout/password-reset. **Solely owned** by `backend-auth`. | `schema.prisma:157-169`; `DEPENDENCY_GRAPH.yaml:428-433` |
| Access token | Short-lived HS256 JWT (`JWT_ACCESS_EXPIRY`, default 1h) carrying `{sub,email,role,permissions}`; presented as a `Bearer` header on every authenticated request. `[TARGET]` gains a `scope` claim (`TREQ-AUTH-003`). | `lib/jwt.ts:5-12,27-33` |
| Refresh token | Long-lived HS256 JWT (`JWT_REFRESH_EXPIRY`, default 7d) carrying `{sub,type:'refresh'}`; exchanged via `POST /refresh` for a new access+refresh pair; backed 1:1 by a `Session` row. | `lib/jwt.ts:14-19,35-42` |
| `auth-middleware` | The in-process contract exposing `authMiddleware`/`optionalAuthMiddleware`; owned by `backend-auth`; consumed by every other active backend module plus itself. | `middleware/auth.ts`; `DEPENDENCY_GRAPH.yaml:57,364-382` |
| `permissions-middleware` | The in-process contract exposing `requireRole`/`requirePermission`/`checkHotelAccess`; a **separate contract, owner `unassigned`**, NOT owned by `backend-auth` despite implementing this capability's RBAC — `backend-auth`'s own routes do not consume it. | `middleware/permissions.ts`; `DEPENDENCY_GRAPH.yaml:58,383-399` |
| Role (current) | One of 5 lowercased string tokens (`worker`,`checker`,`manager`,`regional_manager`,`admin`) carried on the access-token `role` claim and matched exactly by `requireRole`. Built per `ADR-030` D-5 — see 2026-08-05 forward-note below; `OQ-AUTH-13`'s exact-casing question is resolved (`REGIONAL_MANAGER` enum / `regional_manager` claim, uppercase-enum/lowercase-claim convention preserved). | `middleware/permissions.ts:65-94`; `lib/scope.ts`; CONFIRMED §1 |
| Permission | A granular string code (e.g. `"hotels:read"`, `"admin:*"`) derived request-time from `ROLE_PERMISSIONS[role]` (`ADR-031` D-1 — no longer assigned at signup or carried on the token); matched exactly or via `resource:*` wildcard by `requirePermission`. | `config/constants.ts:88-190`; `middleware/permissions.ts:7-63`; `middleware/auth.ts` |
| Scope | The hotel or hotel-group a user may act within, carried on the access token alongside `user_id`/`role`, issued by `resolveScope()` on login/refresh: `{type:'global'}` for admin, `{type:'hotel_group'}` for a Regional Manager (via `HotelGroup.regional_manager_user_id`), `{type:'hotel'}` for a Hotel Manager, `null` otherwise. Built per `ADR-023`/`ADR-030`. | PIVOT §5.3:170; `backend/src/modules/auth/service.ts` |
| Regional Manager | `[TARGET]` a NEW role, not present in `UserRole` today; sees Hotel-Manager-shaped data across an entire Hotel Group. | CONFIRMED §1:19-20; PIVOT §4.1:85 |
| MFA | `[TARGET]` an additional login step required for Hotel Manager/Regional Manager/Admin, not required for Staff/Checker; zero implementation of any kind exists today (`REQ-AUTH-022`). | CONFIRMED §2:30-31 |

## Requirements and Acceptance Criteria

`[CURRENT STATE]` requirements (all Observed @db4dbbb5 unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| REQ-AUTH-001 | Signup creates a user with role-derived permissions and an initial session. | Must | Duplicate email → `ConflictError`; success → `User` row created (`role` default `WORKER` if omitted, `permissions=ROLE_PERMISSIONS[role]`), a `Session` row, and an `AuditLog`(`SIGNUP`) row; response includes access+refresh tokens. | RULE-AUTH-001 |
| REQ-AUTH-002 | The 7-day session TTL is a hardcoded literal, not derived from `JWT_REFRESH_EXPIRY`. | Should (gap) | All 3 `Session` write call sites (signup, login, refresh) independently compute `Date.now() + 7*24*60*60*1000`; changing `JWT_REFRESH_EXPIRY` does NOT change `Session.expires_at` behavior. | RULE-AUTH-001 |
| REQ-AUTH-003 | Login authenticates by email+password with typed error branches. | Must | Not-found/soft-deleted → 401 "Invalid credentials"; disabled (`!is_active`) → 403 "Account is disabled"; wrong password → 401 "Invalid credentials"; success → tokens + `Session` + `AuditLog`(`LOGIN`). No failed-attempt counting or notification of any kind exists. | RULE-AUTH-001 |
| REQ-AUTH-004 | Refresh rotates the token pair and slides the session window on the SAME `Session` row. | Must | Valid, unexpired `refresh_token` matching a `Session` for an active user → new access+refresh tokens, `Session.refresh_token` and `Session.expires_at` updated in place (not a new row); no `AuditLog` row is produced for this action. | RULE-AUTH-002 |
| REQ-AUTH-005 | Logout scope depends on whether a `refresh_token` is supplied. | Must | Body contains `refresh_token` → only that `Session` deleted (single-device logout); body omits it → ALL `Session` rows for the user deleted (every-device logout); `AuditLog`(`LOGOUT`) written either way. | RULE-AUTH-003 |
| REQ-AUTH-006 | `GET /me` returns the caller's own profile. | Must | Valid `authMiddleware` session → selected fields, `role` lowercased; deleted/missing user → 404. | — |
| REQ-AUTH-007 | `POST /password-reset` is a public, token-less, direct-overwrite endpoint with deliberate user-enumeration avoidance. | Must (gap) | No `authMiddleware` on the route; body is `{email,new_password}` only; unknown/inactive/deleted email → HTTP 200 no-op (identical response to success: "If that email exists, the password has been reset"); matching active user → `password_hash` overwritten unconditionally, ALL that user's sessions deleted, `AuditLog`(`MODIFY`) written. No possession/verification factor of any kind is required. | RULE-AUTH-004 |
| REQ-AUTH-008 | `PUT /profile` partially updates non-credential profile fields. | Must | Only `first_name`/`last_name`/`phone`/`profile_photo_url` are mutable; omitted fields retain current value; `AuditLog`(`MODIFY`) records the changed field names. | — |
| REQ-AUTH-009 | `authMiddleware` gates every route that requires it. | Must | Missing/invalid/expired Bearer token → 401; valid token → `req.auth={userId,email,role,permissions}` populated from the verified JWT payload, no DB lookup performed per request. | — |
| REQ-AUTH-010 | `optionalAuthMiddleware` is a global, non-throwing pre-pass applied to the ENTIRE v1 router. | Should (gap) | A malformed/expired Bearer token at this layer is silently ignored (treated identically to no token) rather than surfaced; each module's own `authMiddleware`, where required, still separately rejects it. | — |
| REQ-AUTH-011 | `requirePermission` contains an unreachable `super_admin` bypass branch. | Should (gap) | `req.auth.role==='super_admin'` can never be true given the 4-value `UserRole` enum (`worker\|checker\|manager\|admin` lowercased) — dead code, zero live exposure today. | RULE-AUTH-005 |
| REQ-AUTH-012 | `requireRole` performs exact, case-sensitive string matching. | Must | Caller's lowercased `role` must exactly equal one of the allowed role tokens; no hierarchy/inheritance is applied (`ROLE_HIERARCHY` exists but is never consulted, `REQ-AUTH-020`). | — |
| REQ-AUTH-013 | `checkHotelAccess` bypasses admin/manager/checker entirely; only a non-bypassed caller is checked against `HotelWorker`. | Must (gap) | `admin`/`manager`/`checker` roles pass with ZERO DB query; any other authenticated caller (in practice, `worker`) must have an `ACTIVE` `HotelWorker` row for the target `hotel_id`, else 403; missing `hotel_id` → 403. | RULE-AUTH-006 |
| REQ-AUTH-014 | Access tokens carry no scope/hotel information. | Should (gap) | Token claims are exactly `{sub,email,role,permissions,iat,exp}`; no `hotel_id`/`hotel_group_id`/`scope` field exists in any signed token today. | — |
| REQ-AUTH-015 | Refresh-token signing silently falls back to the access-token secret. | Should (gap) | If `JWT_REFRESH_SECRET` is unset, `signRefreshToken`/`verifyRefreshToken` use `JWT_SECRET` — the same secret then signs BOTH token types in that environment. | RULE-AUTH-008 |
| REQ-AUTH-016 | Environment validation enforces a minimum-length access-token secret only. | Must | Server fails to boot if `JWT_SECRET` is absent or <32 chars; `JWT_REFRESH_SECRET` may be entirely absent with no boot-time warning. | — |
| REQ-AUTH-017 | Verification/last-login timestamp fields are schema-present but functionally dead within this module. | Should (gap) | `email_verified_at`/`phone_verified_at`/`last_login_at` are never set by `AuthService`; `last_login_at` in particular is never written even on a successful `login()` call. | — |
| REQ-AUTH-018 | Session device/IP metadata fields are schema-present but never populated. | Should (gap) | `Session.device_info`/`ip_address` remain `null` for every row created by this module; no client fingerprinting or IP capture occurs at signup/login despite `req.ip` being available and used elsewhere (`AuditLog.ip_address`). | — |
| REQ-AUTH-019 | The role enum has exactly 4 values today. | Must | `UserRole` = `{WORKER,CHECKER,MANAGER,ADMIN}`; no `REGIONAL_MANAGER` value exists in the schema. | — |
| REQ-AUTH-020 | `ROLE_HIERARCHY` is unused dead configuration. | Should (gap) | The constant is declared but has zero consumers anywhere in `backend/src`; no code path performs a hierarchy/inheritance check of any kind. | — |
| REQ-AUTH-021 | Application-layer rate-limiting is narrowly scoped: only `login` has a per-account throttle; `signup`/`refresh`/`password-reset` remain edge-only. | Must (`ADR-070`, 2026-08-21) | `POST /auth/login` rejects with `429 RATE_LIMIT_EXCEEDED` (`TooManyRequestsError`, now actually thrown via `RATE_LIMIT_EXCEEDED`/`TOO_MANY_REQUESTS`) while `User.login_locked_until` is in the future, set once a streak reaches `AUTH_LOGIN_THROTTLE_THRESHOLD` (default 10, above the notify threshold of 5) and cleared automatically on expiry or a successful login. `signup`/`refresh`/`password-reset` (request+confirm) remain unthrottled at this layer, unchanged from before. | — |
| REQ-AUTH-022 | No MFA mechanism of any kind exists. | Must (gap) | Login never requests or verifies a second factor for any role; no TOTP/OTP/recovery-code model, field, or library import exists anywhere in `backend/src`. | — |
| REQ-AUTH-023 | Outbound-email configuration exists but is entirely unwired. | Should (gap, relevant to TREQ-AUTH-005) | `EMAIL_SERVICE`/`SENDGRID_API_KEY`/`RESEND_API_KEY` are declared, optional Zod fields with zero consumers repository-wide; no email-sending code path exists for password reset or anything else in this module. | — |
| REQ-AUTH-024 | Test coverage is uneven across this module's surfaces. | Should (gap) | `signup`/`login`/`logout`/`getCurrentUser` are unit-tested; `refreshToken`/`resetPassword`/`updateProfile` have ZERO tests; `middleware/permissions.ts` (RBAC guards) IS fully covered (13 cases, `rbac.test.ts`); `middleware/auth.ts` and `lib/jwt.ts` have ZERO dedicated tests. | — |

`[TARGET STATE]` requirements (confirmed authority; unbuilt unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| TREQ-AUTH-001 | Role model expands to exactly 5 roles including the new Regional Manager; Supervisor never exists. | Must | `UserRole`(or equivalent) has exactly `{Staff/Worker, Checker, Hotel Manager, Regional Manager, Admin}`; no `Supervisor` token exists anywhere. | TRULE-AUTH-001 |
| TREQ-AUTH-002 | Regional Manager gets Hotel-Manager-shaped visibility across their entire Hotel Group; Hotel Manager stays scoped to one hotel. | Must | A Regional Manager's read/action scope resolves to every hotel in their assigned group; a Hotel Manager's resolves to exactly one hotel; Admin resolves to all hotels. | TRULE-AUTH-001 |
| TREQ-AUTH-003 | JWT access tokens carry `scope` alongside `user_id`/`role`. | Must | Every issued access token includes a `scope` claim identifying the hotel or hotel-group the bearer may act within, sufficient for a downstream check to authorize without a DB round trip. Pending/Inactive users receive no operational scope (ADR-065). | TRULE-AUTH-005 |
| TREQ-AUTH-004 | Auto-logout occurs after 1 week (7 days) of inactivity; login accepts email OR username. | Must | A session with no successful refresh for 7 consecutive days is no longer honored (**already effectively true today**, `RULE-AUTH-002`); a login attempt with a username (not just email) succeeds if the credential is valid (**not yet supported**). | TRULE-AUTH-002 |
| TREQ-AUTH-005 | "Forgot password" is an email-mediated flow. | Must | A password-reset request results in an email being sent to the account holder containing a way to complete the reset (token/link); the account's password is NOT changed by supplying only an email address in a single call. | TRULE-AUTH-004 |
| TREQ-AUTH-006 | MFA gates login for Hotel Manager, Regional Manager, and Admin; never for Staff/Checker. | Must | A Hotel-Manager-or-above login is not considered complete (no usable session/token issued) until a second factor is verified; Staff/Checker logins are unaffected. | TRULE-AUTH-003 |
| TREQ-AUTH-007 | Repeated failed logins trigger a manager notification instead of any lockout. | Must | N consecutive failed logins for an account → the responsible manager is notified (via the notifications capability, out of this module's own delivery scope); the account is never locked and no rate-limit blocks further attempts. | TRULE-AUTH-002 |
| TREQ-AUTH-008 | Rate-limiting/CAPTCHA at the application layer is narrowly scoped to one bounded per-account login throttle; otherwise edge-only. | Must (`ADR-070` narrows; already satisfied) | `signup`/`refresh`/`password-reset` remain unthrottled at the application layer, edge-level (Nginx/Cloudflare) rate limiting only, unchanged. `login` alone additionally rejects with `429` while an account-keyed, time-bounded, self-clearing throttle (`ADR-070`) is active — not a CAPTCHA, not a manual lockout. | TRULE-AUTH-002 |
| TREQ-AUTH-009 | Authorization is deny-by-default, role×scope, with hotel creation Admin/HQ-only. | Must | Every authorization decision requires both a role check AND a scope check; absent an explicit grant, access is denied; cross-hotel access requires the actor's scope to include the target hotel; hotel-creation endpoints accept only Admin/HQ callers. | TRULE-AUTH-001 |
| TREQ-AUTH-010 | Special-category fields sit behind a restricted, audit-logged sub-permission. | Must | Access to Konfession/disability-class fields is gated by a dedicated permission distinct from general profile-read, and every access is written to `AuditLog`. | TRULE-AUTH-006 |

## Business Rules

`[CURRENT STATE]` rules (RULE-AUTH-001..009):

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-AUTH-001 | Any `Session` created (signup or login) | `expires_at` is set to `now + 7d` via an independently-computed literal, not a shared constant or `JWT_REFRESH_EXPIRY`-derived value. | 3 call sites (`service.ts:48,99,154`) must be kept manually in sync; a future change to one is not guaranteed to reach the others. | `unassigned (SYNC-001)`; `modules/auth/service.ts:48,99,154` |
| RULE-AUTH-002 | Any successful `POST /refresh` | The SAME `Session` row is updated (not replaced): `refresh_token` rotates, `expires_at` resets to `now+7d`. | This produces a rolling/sliding 7-day inactivity window as an emergent property of the refresh implementation — it already functionally satisfies `TREQ-AUTH-004`'s inactivity-logout requirement, even though no code or documentation currently states this as an intentional design goal. | `unassigned (SYNC-001)`; `modules/auth/service.ts:150-156` |
| RULE-AUTH-003 | Any `POST /logout` | Session deletion scope is entirely determined by whether `refresh_token` is present in the request body — no other signal (e.g. a "logout everywhere" flag) exists. | None. | `unassigned (SYNC-001)`; `modules/auth/service.ts:165-174` |
| RULE-AUTH-004 | Any `POST /password-reset` | Enumeration-avoidance is invariant: the HTTP response is identical (200, same message) whether or not the email matched an active account; a match causes an unconditional overwrite with no current-password confirmation and revokes all sessions for that user. | The endpoint requires no possession/verification factor (no token, no email round-trip) — evidenced here neutrally per task framing; severity is for the Security Reviewer. | `unassigned (SYNC-001)`; `modules/auth/service.ts:197-212` |
| RULE-AUTH-005 | `requirePermission` evaluation | The `role==='super_admin'` branch can never be satisfied given the current 4-value `UserRole` enum; it is dead code, not a live escalation path. | A future 5-role rollout (`TREQ-AUTH-001`) must not silently extend or reuse this branch without deliberate review. | `unassigned (SYNC-001)`; `middleware/permissions.ts:18` |
| RULE-AUTH-006 | `checkHotelAccess` evaluation | `admin`/`manager`/`checker` bypass the hotel-membership check entirely (no DB query); only a caller whose role is none of those three (in practice, `worker`) is checked against an `ACTIVE` `HotelWorker` row. | The bypass is attributed in code/test comments to `"PATCH-04 §4c"`, traceable to `docs/legacy/api/API_SPEC_V1_PATCH_V2.md` — per this repository's Source-of-Truth policy, `docs/legacy/` is historical evidence only, not a current authoritative decision (`.claude/CLAUDE.md` Repository Rules; ADR-008). The bypass is therefore a **deliberate, documented-in-a-non-authoritative-source** design, not an accidental oversight — but its consistency with the CURRENT confirmed one-hotel Manager scope (`TREQ-AUTH-002`) is unresolved (`OQ-AUTH-06`). | `unassigned (SYNC-001)`; `middleware/permissions.ts:103-108`; `__tests__/rbac.test.ts:92,100` |
| RULE-AUTH-007 | Any authorization check via `requireRole`/`requirePermission`/`checkHotelAccess` | All three guards evaluate ROLE (and, for `checkHotelAccess`, `HotelWorker` membership) only — no `scope`/hotel-group dimension exists anywhere in the current authorization model. | `checkHotelAccess`'s membership check is the closest current analogue to a scope check, and it applies to only one role in practice (`worker`, per RULE-AUTH-006). | `unassigned (SYNC-001)`; `middleware/permissions.ts:65-156` |
| RULE-AUTH-008 | Token signing/verification when `JWT_REFRESH_SECRET` is unset in a given environment | Access and refresh tokens are signed with the SAME secret (`JWT_SECRET`); `verifyAccessToken` performs no `type`-claim check, so a refresh token's signature verifies successfully under `verifyAccessToken` too (though its payload lacks `email`/`role`/`permissions`, so `req.auth.role` would be `undefined` and `req.auth.permissions` an empty array). | Recorded as evidence for independent Security Review, not characterized as exploited or fixed here. | `unassigned (SYNC-001)`; `lib/jwt.ts:27-33,37,53-68,70-89` |
| RULE-AUTH-009 | Any `logAudit` call from this module | `actor_role` is normalized to an uppercase `UserRole` token or stored as `null` (as in `logout`, which always passes `null`, `service.ts:173`). | `logAudit` is a shared `BaseService` method, called by every module; this module (`backend-auth`) is `state-audit-log`'s designated `authoritative_writer` per `ADR-016`, though it does not exclusively invoke the helper. | `backend-auth` (`ADR-016`); `lib/base-service.ts:7-31` |

`[TARGET STATE]` rules (TRULE-AUTH-001..006) — confirmed authority:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| TRULE-AUTH-001 | Any authorization decision | Deny-by-default: access requires BOTH a role grant AND a scope match; absence of an explicit grant on either dimension denies. | Admin's scope is "all," collapsing the scope check to a no-op for that role only. | PIVOT §5.4:172-180 |
| TRULE-AUTH-002 | Login/session lifecycle | Auto-logout after 7 days of inactivity (no lockout ever); repeated failed logins are handled by notify-only escalation, never by blocking further attempts; no rate-limiting/CAPTCHA is introduced at this layer. | None — "notify and never block" is the confirmed pattern for this capability's failure handling. | CONFIRMED §2:28,32-35 |
| TRULE-AUTH-003 | Login for a Hotel-Manager-or-above account | MFA verification is required before a usable session/token is issued; Staff/Checker logins are never subject to this gate. | None. | CONFIRMED §2:30-31; PIVOT §5.3:169 |
| TRULE-AUTH-004 | A forgot-password request | The flow is asynchronous and email-mediated: request → email dispatched → user completes the reset via that email's contents; a single-call `{email,new_password}` overwrite is not this flow. | None. | CONFIRMED §2:29 |
| TRULE-AUTH-005 | Any access-token issuance | The token embeds `scope` alongside `user_id`/`role` so a downstream authorization check never needs a DB round trip to establish "which hotels may this bearer act within." | Pending/Inactive users receive `null` or no operational scope, regardless of their role (ADR-065). | PIVOT §5.3:170 |
| TRULE-AUTH-006 | Access to a special-category field (Konfession, disability) | Gated by a dedicated, restricted sub-permission; every access — not just every write — is written to `AuditLog`. | None. | PIVOT §5.4:180; CONFIRMED §27 |

## Ownership and Boundaries

**Module owner:** `unassigned (SYNC-001, human authority required)`. No CODEOWNERS file exists
and `backend/package.json` author is empty; owner assignment is reserved human authority and is
NOT invented here (`.claude/knowledge/MODULE_REGISTRY.yaml:34`).

**Owned state:**
- `state-session` (`Session` model, `schema.prisma:157-169`) — **sole** owner `backend-auth`
  per `DEPENDENCY_GRAPH.yaml:64,428-433`; independently corroborated by code inspection — no
  other module's `service.ts` touches `prisma.session.*`.
- The `auth-middleware` contract (`middleware/auth.ts`) — owned by `backend-auth`
  (`DEPENDENCY_GRAPH.yaml:57`) despite living outside `backend/src/modules/auth/`.
- `lib/jwt.ts` (signing/verification) — not separately registered in the graph as a contract;
  treated here as this module's own implementation detail since its only callers are this
  module's own `service.ts` and `middleware/auth.ts`.

**Consumed/shared-write state:**
- `state-user` (`User` model, `schema.prisma:117-155`) — **shared-write**: written by BOTH
  `backend-auth` (create at signup, `password_hash` update at password-reset) and
  `backend-users` (separate CRUD); `authoritative_writer: UNKNOWN` (`DEPENDENCY_GRAPH.yaml:421-427`,
  `SYNC_STATE.yaml` `SYNC-005`, blocked pending human decision). This spec does NOT resolve
  SYNC-005 — it is recorded as an open decision (`OQ-AUTH-03`).
- `state-audit-log` (`AuditLog` model, `schema.prisma:494-516`) — written via the shared
  `BaseService.logAudit` by every module including this one; `authoritative_writer: backend-auth`,
  resolved by `ADR-016` (Accepted, 2026-07-14; `STATE_OWNERSHIP_INDEX.yaml` `state-audit-log` row).
  Existing writer call sites across all modules continue writing through the shared
  `BaseService.logAudit` helper unchanged — `ADR-016` designates this module the accountable
  owner, not a code refactor of every call site. `backend-compliance` is a read-only consumer
  of `AuditLog`, never a writer, per `ADR-016`; see `IF-AUTH-GetAuditTrail` below for the
  interface this module exposes to satisfy that read.
- `HotelWorker` (read-only, via `checkHotelAccess`) — this module's own code does not write
  `HotelWorker`; the membership check is a read against a state domain owned by
  `backend-hotel-workers`.

**Permitted writes:** This module writes `state-session` exclusively and `state-user` in a
narrow, documented slice (create at signup; `password_hash` overwrite at password-reset) — it
does not perform general `User` CRUD (that is `backend-users`' responsibility, out of scope
here beyond the shared-write flag).

**Boundary/non-responsibilities:** This module does not implement MFA of any kind today
(`REQ-AUTH-022`); it does not send email (password-reset performs no email step,
`REQ-AUTH-023`); it does not implement rate-limiting or CAPTCHA (a confirmed non-goal, handled
at the edge, `TREQ-AUTH-008`); it does not own `permissions-middleware`
(`middleware/permissions.ts`) despite that file implementing this capability's RBAC end-to-end
— that contract's owner is `unassigned`, distinct from this module (`OQ-AUTH-07`); it does not
manage `HotelWorker` lifecycle, only reads it via `checkHotelAccess`; it does not compute or
enforce hotel-group membership for the target Regional Manager scope (no such concept exists
in any current model); it does not decide WHO gets notified on repeated failed logins or
deliver that notification — that is the `notifications` capability's producer/consumer
relationship, cross-referenced but not specified here.

## Interfaces and Contracts

Base router mounts at `backend/src/routes/v1/index.ts:22` (`/auth`). `optionalAuthMiddleware`
runs globally ahead of this router (`routes/v1/index.ts:20`); three of the seven routes additionally
require `authMiddleware` per-route (`routes.ts:12-14`) — `logout`, `me`, `profile`; the remaining
four (`signup`, `login`, `refresh`, `password-reset`) are public. Envelope: `{status:"success", data,
meta:{timestamp, request_id}}` (`controller.ts`, consistent with the sibling notifications
spec's documented envelope). Error types map to HTTP via `backend/src/lib/errors.ts:1-95`:
`ValidationError`(422), `UnauthorizedError`(401), `ForbiddenError`(403), `NotFoundError`(404),
`ConflictError`(409). Compatibility vocabulary (consistent with sibling specs): these contracts
are **unversioned** in code, so compatibility posture is **baseline/UNKNOWN**, not
"Additive/Stable."

`[CURRENT STATE]` endpoints and the in-process contracts (implemented @db4dbbb5):

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `POST /auth/signup` (unversioned) | inbound | `SignupSchema`: email, password (min 8, ≥1 uppercase, ≥1 digit), first/last name, optional phone, optional `role` (lowercase enum) | 201, `AuthResponse` (user + tokens) | `ConflictError`(409) duplicate email; `ValidationError`(422) | none (public) | baseline/UNKNOWN |
| `POST /auth/login` (unversioned) | inbound | `LoginSchema`: email, password | 200, `AuthResponse` | `UnauthorizedError`(401) not-found/wrong-password; `ForbiddenError`(403) disabled account | none (public) | baseline/UNKNOWN |
| `POST /auth/refresh` (unversioned) | inbound | `RefreshTokenSchema`: `refresh_token` | 200, `{access_token,refresh_token,expires_in}` | `UnauthorizedError`(401) invalid/expired token or session, or user inactive/deleted | none (public; the refresh token itself is the credential) | baseline/UNKNOWN |
| `POST /auth/password-reset` (unversioned) | inbound | `PasswordResetSchema`: email, `new_password` (same complexity rule as signup) | 200, `{message}` — **identical response whether or not the email matched** (`REQ-AUTH-007`) | `ValidationError`(422) only; no auth-specific error branch is ever surfaced to the caller | **none — no `authMiddleware`, publicly reachable** | baseline/UNKNOWN |
| `POST /auth/logout` (unversioned) | inbound | optional body `refresh_token` | 200, `{message}` | `UnauthorizedError`(401) if no valid session | `authMiddleware` | baseline/UNKNOWN |
| `GET /auth/me` (unversioned) | inbound | none | 200, selected `User` fields, `role` lowercased | `UnauthorizedError`(401); `NotFoundError`(404) if the authenticated id no longer resolves | `authMiddleware` | baseline/UNKNOWN |
| `PUT /auth/profile` (unversioned) | inbound | `UpdateProfileSchema`: optional first/last name, phone, `profile_photo_url` | 200, updated selected fields | `UnauthorizedError`(401); `NotFoundError`(404); `ValidationError`(422) | `authMiddleware` | baseline/UNKNOWN |
| `authMiddleware`/`optionalAuthMiddleware` (unversioned, in-process, exported functions) | outbound (contract this module PROVIDES to 12 other backend modules) | `Authorization: Bearer <access_token>` header | populates `req.auth={userId,email,role,permissions}` or (optional variant) leaves it undefined | `UnauthorizedError`(401) from the mandatory variant only | N/A — this IS the auth boundary | baseline/UNKNOWN |

DTO shapes: `AuthResponse`/`AuthUser`/`AuthTokens` (`modules/auth/types.ts:1-21`);
`AccessTokenPayload`/`RefreshTokenPayload` (`lib/jwt.ts:5-19`).

`[TARGET STATE]` interfaces (unbuilt; shapes not yet authored): an MFA-verification step
inserted into the login flow for Hotel-Manager-and-above accounts (exact second-factor
mechanism — TOTP app, SMS code, email code — UNSTATED, `OQ-AUTH-02`); a split forgot-password
flow (request-reset → email dispatched → complete-reset-with-token, replacing the current
single-call `PasswordResetSchema`); a `scope` claim on the access token and a corresponding
`User`/`Session` schema change (PIVOT §9.1:375); role×scope parameters threaded through
`requireRole`/`requirePermission`/`checkHotelAccess` (a `permissions-middleware`-contract
change, not owned by this module — cross-module coordination required). None of these shapes
are specified further here; they will be authored when the corresponding milestone begins
(PIVOT §12: M1 covers "RM role+scope" explicitly; MFA/email-reset/failed-login-notify
milestone-pinning is itself an open question, `OQ-AUTH-01`).

`IF-AUTH-GetAuditTrail / v0` (outbound-facing; **implemented**, `AuthService.getAuditTrail()`,
`backend/src/modules/auth/{service,types}.ts`) — per `ADR-016`, `backend-auth` is
`state-audit-log`'s authoritative writer and exposes a read-only `AuditLog` query method
(`AuditLogQuery`/`AuditLogEntryDto`, filters: `actor_id`/`actor_role`/`action`/`resource_type`/
`resource_id`/`from`/`to`, bounded/paginated) for any in-process consumer; no direct Prisma
access to `AuditLog` by any other module is permitted. Deliberately generic and caller-agnostic
— `ADR-016`'s own text anticipated "a future `IF-AUTH-*`/`IF-AUDIT-*` contract", not one shaped
around a single consumer, so this interface names no specific caller in its own signature.
`docs/03-modules/compliance/MODULE_SPEC.md`'s `IF-COMPLIANCE-GetAuditTrail`/`OD-COMPLIANCE-004`
is one consumer of this interface (via `complianceService`'s direct in-process call, mirroring
`backend-hr`'s existing `documentService` import — no HTTP route exists or is needed for this
consumption, per `ADR-032`'s direct-in-process-call standard), not its sole intended caller.
Service-only for now: no HTTP route exists, since no external (frontend/mobile) caller has been
identified for this capability; a route may be added later if one is.

**Performance-rationale clarification (performance review FIND-05, applies to `TRULE-AUTH-005`
and the Terminology "Scope" entry above):** PIVOT §5.3's stated rationale for the `scope`
claim — "so authorization checks are cheap" — is repeated verbatim by this document without
reconciling it against this document's own current-state evidence: `checkHotelAccess` already
costs ZERO DB queries for 3 of the current 4 roles today (via the `admin`/`manager`/`checker`
bypass, `RULE-AUTH-006`), and a single already-index-optimal lookup for the 4th (`worker`, via
`HotelWorker`'s `@@unique([hotel_id, worker_id])`, `schema.prisma:224`). The real
performance-relevant consequence of the target `scope`-claim design is therefore absorbing the
cost of *newly enforcing* scope checks for the 3 currently-bypassed roles once `TREQ-AUTH-009`
closes that bypass (cross-ref `OQ-AUTH-06`) — it is not optimizing a bottleneck that exists
today, since no DB-round-trip bottleneck currently exists for 3 of 4 roles and the 4th is already
index-optimal.

## Events

No event bus exists (`DEPENDENCY_GRAPH.yaml:410-418`, `events: []`, verified absent
repository-wide). This module neither publishes nor consumes events; `published_events`/
`consumed_events` are `none-observed` for `backend-auth`
(`.claude/knowledge/MODULE_REGISTRY.yaml:38-39`). `[TARGET]` the failed-login-notify-manager
trigger (`TREQ-AUTH-007`) will require this module to become a NEW producer into the
`notification-service` in-process contract (cross-ref
`docs/03-modules/notifications/MODULE_SPEC.md`'s Proposed Knowledge Deltas section, line ~655 —
under that document's own explicit heading "Proposed only — NOT applied. Application requires the
appropriate synchronization gate" — which already anticipates `backend-auth` as a future producer;
this is the already-anticipated but not-yet-added edge, proposed and not applied, consistent with
how this spec's own Dependencies section characterizes the same cross-reference) — no such call
site exists today (verified: `modules/auth/service.ts` imports nothing from `modules/notifications`;
consistency review FIND-001 — corrected from a prior mis-citation of that document's Dependencies
section).

## Dependencies

`[CURRENT]` existing `DEPENDENCY_GRAPH.yaml` edges/contracts referenced (no new backend `calls`
edges proposed by this spec beyond the terminology/graph promotions in Proposed Knowledge
Deltas):

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `auth-middleware` (owned by `backend-auth`) | Every other active backend module gates its own routes with `authMiddleware`/`optionalAuthMiddleware` | in-process function import | baseline/UNKNOWN | A verification failure here surfaces as a typed `UnauthorizedError` to the CALLING module's own route, not silently swallowed |
| `permissions-middleware` (owned `unassigned`, distinct contract, NOT this module) | 10 other modules gate role/permission/hotel-scope checks with it (independently verified consumer set: `analytics, attendance, calendar, crm, hotel-workers, hr, quality, users, work-applications, work-requests`); `backend-auth` itself does NOT consume it. Note (dependency review FIND-001): `DEPENDENCY_GRAPH.yaml:394`'s `backend-assignments` consumer entry is stale — independently verified `backend/src/modules/assignments/routes.ts` does not import `middleware/permissions` at all (it uses only `authMiddleware`, with a comment citing "service-level guards" instead); flagged for a separate dependency-synchronization correction, not applied here. | in-process function import | baseline/UNKNOWN | Same typed-error pattern; out of this module's ownership |
| `base-service` | Shared `PrismaClient` access + `logAudit` | in-process abstract class | baseline/UNKNOWN | N/A (synchronous, in-process) |
| `prisma-schema` | `User`/`Session`/`UserRole`/`AuditLog` types | shared Prisma contract | baseline/UNKNOWN | N/A |
| `validation-middleware` | `validateBody(SignupSchema\|LoginSchema\|...)` on every mutating route | in-process function import | baseline/UNKNOWN | `ValidationError`(422) surfaced before the service layer runs |
| `edge-frontend-auth` | Web app login/me/logout | `POST /login`,`GET /me`,`POST /logout` | baseline/UNKNOWN | Client-side error surfacing only |
| `edge-mobile-worker-auth` | Employee App auth | `/auth/*` | baseline/UNKNOWN | Client-side error surfacing only |
| `edge-mobile-checker-auth` | Checker App auth | `/auth/*` | baseline/UNKNOWN | Client-side error surfacing only |
| `edge-operations-deploys-backend` | Deployment packages/runs this module as part of the single backend service | N/A | not-applicable | N/A |

**Graph revision note:** `DEPENDENCY_GRAPH.yaml`'s header records `observed_revision:
5b16be40ef0aa9ac3f186e7323b960886a6153c2`, an earlier revision than this spec's Document
Control repository revision `db4dbbb5416c78d6420ae0b9ef97b2c10be6c67a`. Every edge/contract cited
above was independently re-verified against the current worktree during authoring (see Evidence
and Traceability's direct `path:line` citations) — this is a traceability note flagging the
revision gap, consistent with the same note in `docs/03-modules/notifications/MODULE_SPEC.md`,
not a correction of substance.

`[CURRENT]` client consumers (verified):
- `frontend-web` — `authApi.login`/`me`/`logout` (`frontend/lib/api.ts:170-183`). No client
  currently calls `POST /refresh`, `POST /password-reset`, `POST /signup`, or `PUT /profile`
  through this file (verified: only `login`/`me`/`logout` are exported from `authApi`) — worth
  noting since `POST /password-reset`'s current-state shape (`REQ-AUTH-007`) therefore has ZERO
  existing frontend-web consumers to migrate if the target email-mediated flow (`TREQ-AUTH-005`)
  changes its contract.
- `mobile-worker` — `/auth` (`mobile/worker-app/src/lib/api.ts:61`).
- `mobile-checker` — `/auth` (`mobile/checker-app/src/lib/api.ts:59`).

`[CURRENT]` external/config dependency (declared, unwired — independently verified):
- `EMAIL_SERVICE`/`SENDGRID_API_KEY`/`RESEND_API_KEY` (`config/env.ts:42-44`) are declared as
  optional Zod fields but consumed nowhere else — repo-wide grep for each name outside `env.ts`
  returned zero matches. Directly relevant to `TREQ-AUTH-005`/`MIG-GAP-AUTH-05`: the
  configuration shape for an eventual email provider exists, but no client library, no
  send-email code, and no template of any kind exists anywhere.

`[TARGET]` new dependencies (unbuilt):
- **An MFA/TOTP (or equivalent second-factor) library and, per PIVOT §9.3, an as-yet-unnamed
  data model** for factor enrollment/secret/recovery-code storage — no such model is listed in
  PIVOT §9.1's "Models retained (modified)" or §9.3's "Models added" tables (`OQ-AUTH-02`).
- **An email-sending client** wired to `EMAIL_SERVICE`/`SENDGRID_API_KEY`/`RESEND_API_KEY` (or a
  replacement) for the forgot-password flow (`TREQ-AUTH-005`) — the config shape exists,
  nothing else does.
- **A new producer call site into `notification-service`** for the failed-login-notify-manager
  trigger (`TREQ-AUTH-007`) — this module does not currently import
  `modules/notifications/service.ts` at all; the target dependency direction is
  `backend-auth → backend-notifications`, the reverse of no existing edge, matching the
  already-anticipated (but not-yet-added) edge noted in the notifications spec's own Proposed
  Knowledge Deltas.
- **A `scope`-aware read path** (hotel-group membership resolution for Regional Manager) that
  this module's JWT-issuance code would need to call at login/refresh/signup time — the owning
  module for hotel-group membership is UNSTATED (most likely `backend-crm`/`backend-hotel-workers`
  based on their existing `Hotel`/`HotelWorker` ownership, but no authority document names it
  explicitly — inference, not confirmed, `ASM-AUTH-02`).

## State and Lifecycle

`[CURRENT STATE]` `User` row lifecycle (the slice this module touches;
`schema.prisma:117-155`):
- Created only via `signup` (this module) within its documented scope; `backend-users` performs
  its own separate CRUD outside this module's evidence base (SYNC-005, not resolved here).
- `password_hash`: set at signup; overwritten at `resetPassword` (this module); presumably also
  mutable via `backend-users`, out of scope.
- `deleted_at` (GDPR soft delete): never set by any code path within this module (verified: no
  `deleted_at:` write anywhere in `modules/auth/service.ts`) — read/checked by `login`,
  `refreshToken`, and `resetPassword` (all treat a non-null `deleted_at` as "does not exist" for
  their purposes) but never written here.
- `role`/`permissions`: set once at signup from `ROLE_PERMISSIONS[role]`; never mutated by any
  method in this module (no "change role" endpoint exists here).
- `email_verified_at`/`phone_verified_at`/`last_login_at`: always `null` in practice within this
  module's write surface (`REQ-AUTH-017`).

`[CURRENT STATE]` `Session` row lifecycle (`schema.prisma:157-169`;
`modules/auth/service.ts`):
- Entry: a NEW row is created at both `signup` AND `login` — a user who signs up and then
  separately logs in accumulates 2 distinct `Session` rows, not a reused one (verified: both
  call `this.prisma.session.create`, not an upsert).
- Update: `refreshToken` updates the SAME row in place (`session.update` by unique `id`),
  rotating `refresh_token` and resetting `expires_at` — this is the row's ONLY mutation path
  besides deletion.
- Deletion: `logout` (targeted or all-device, `RULE-AUTH-003`) or `resetPassword` (all rows for
  that user, forcing global re-login after a password change, `service.ts:210`). Deletion IS
  the only revocation mechanism — there is no soft-revoke/flag field.
- **No sweep/TTL job exists** to delete rows whose `expires_at` has already passed (consistent
  with the sibling notifications spec's independently-confirmed, repository-wide absence of any
  scheduled-job runtime — no node-cron/BullMQ found, `REDIS_URL` declared-unused). Expired rows
  are functionally rejected only at the moment a `refreshToken` call checks
  `session.expires_at < new Date()` (`service.ts:134`) — they are never proactively deleted, so
  `Session` accumulates dead rows unboundedly over the life of the deployment. This missing-job
  gap is carried as its own open decision (`OQ-AUTH-14`, performance review FIND-02), distinct
  from `OQ-AUTH-11`'s GDPR retention-*tier* question below: `PIVOT_DESIGN_DOCUMENT.md` §5.2's
  "Async: Scheduled jobs" layer names retention-deletion, job-request auto-close, and rework
  timers as examples of that layer's pattern, but does not name session/token cleanup — so,
  absent this item, the gap would otherwise fall through unassigned to any module or milestone.

**Concurrency:** No optimistic locking or version field exists on `User` or `Session`.
`resetPassword`'s `password_hash` update (`service.ts:205-208`) and its `Session` deleteMany
(`service.ts:210`) are two SEPARATE, non-transactional Prisma calls, not wrapped in
`$transaction` — a request racing between them is theoretically possible (e.g., a `refreshToken`
call using a not-yet-deleted `Session` for a user whose password was just changed). This is
recorded as an observed non-atomic sequence, not asserted as an exploited defect; independent
Security Review is the appropriate venue for a severity judgment, consistent with this spec's
framing for `resetPassword` throughout.

**Retention/migration:** `[CURRENT]` `Session` rows persist indefinitely once expired (no
sweep, above). `[TARGET]` CONFIRMED §25 defines three GDPR retention tiers (6-month shift
coordinates, 5-year general data, 6-year payroll/tax-adjacent fields); neither `User` nor
`Session` nor `AuditLog` is explicitly named under any of the three tiers by either authority
document for THIS module's specific write surface — the same open-question class already
carried by the notifications spec for `Notification` (`OQ-NOTIF-02`), recorded here as its own
item (`OQ-AUTH-11`) rather than assumed resolved by cross-reference.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** All seven endpoints are synchronous request/response; unexpected
Prisma/DB errors (not one of the typed `AppError` subclasses already documented in Requirements)
propagate via each controller's `catch(error){next(error)}` to the shared `errorHandler`
(`app.ts:57`, itself outside this module) — no auth-specific retry/circuit-breaker exists.
`resetPassword`'s two-step, non-transactional password-update-then-session-deleteMany sequence
(State and Lifecycle, Concurrency) is this module's one distinct partial-completion failure
mode: a crash between the two calls leaves the password changed but old sessions still valid.

**Trust boundaries/authorization:**
- `POST /password-reset` carries NO `authMiddleware` (`routes.ts:11`) — it is the only mutating
  endpoint in this module reachable by a fully anonymous caller who need only supply a target
  email address. The mutation performed (unconditional `password_hash` overwrite +
  all-session revocation) is high-impact; its own enumeration-avoidance behavior and complete
  absence of a possession/verification factor are recorded here as neutral, evidenced
  current-state facts (`REQ-AUTH-007`, `RULE-AUTH-004`) — the Security Reviewer assesses
  severity independently, not this document.
- The `requirePermission` dead `super_admin` branch (`RULE-AUTH-005`) presents no live
  escalation path today but is inconsistent dead code a future 5-role rollout must not silently
  extend.
- `checkHotelAccess`'s blanket admin/manager/checker bypass (`RULE-AUTH-006`) means the ONLY
  role subject to any hotel-membership enforcement today is, in practice, `worker` — evidenced,
  not characterized as a defect, but directly informs whether the target one-hotel Manager scope
  (`TREQ-AUTH-002`) requires removing or replacing this bypass (`OQ-AUTH-06`).
- The JWT refresh-secret fallback (`RULE-AUTH-008`) means that, in any environment where
  `JWT_REFRESH_SECRET` is unset, access and refresh tokens share one signing secret and
  `verifyAccessToken` performs no `type`-claim discrimination — recorded as evidence for the
  Security Reviewer.
- `optionalAuthMiddleware` (`REQ-AUTH-010`) silently swallows token errors ahead of every
  module's own `authMiddleware` — each downstream module that actually requires auth still
  rejects the request correctly; the risk surface is limited to modules that read `req.auth`
  without an `authMiddleware` gate, which is outside this module's own boundary to enumerate.
- `Session.refresh_token` is stored in cleartext (verified: `session.create`/`update` write
  `tokens.refresh_token` directly, `service.ts:47,98,153`; no hashing observed on this column) —
  a compromised `Session` row yields a directly usable bearer credential, unlike a hashed-token
  storage pattern. Independent Security Review (G4) confirmed this a **High**-severity finding
  (`OQ-AUTH-15`, new), recommending hash-at-rest mirroring `password_hash`'s treatment.

**Data classification/retention:** `password_hash` (bcrypt, 12 rounds, `BCRYPT_ROUNDS`) is the
only credential-class secret this module writes. `AuditLog` rows from this module carry
`ip_address` (`req.ip`) and `details` (e.g. `{email}` on signup/login, `{action:'password_reset'}`
on reset, `{fields}` on profile update) — no special-category data (CONFIRMED §27) is observed
in any current auth payload. Retention tier assignment for `User`/`Session`/`AuditLog` is
unstated (`OQ-AUTH-11`, above).

**Performance budgets/workload:** No explicit SLO exists in code or the authority documents for
auth request latency (consistent with sibling specs' finding of no SLOs anywhere in this
codebase). `bcrypt.hash`/`bcrypt.compare` at `BCRYPT_ROUNDS=12` is the dominant per-request cost
on signup/login/resetPassword; no queueing or rate-limit bounds concurrent-hash load at this
layer, consistent with the confirmed non-goal deferring rate-limiting to the edge
(`TREQ-AUTH-008`). **Concurrency-contention note (performance review FIND-01, High-evidence /
Medium-confidence):** this module uses `bcryptjs` (`backend/package.json:27`), a pure-JS
implementation — unlike the native-binding `bcrypt` package, it cannot offload hashing work to
libuv's thread pool, so each hash/compare call runs synchronously on the main thread. Per
`ecosystem.config.js:9-11`, this backend runs as a single, non-clustered process
(`instances:1, exec_mode:'fork'`) serving every active module on one Node.js event loop; under
concurrent signup/login/password-reset load, `bcryptjs` hashing at `ROUNDS=12` can therefore
degrade latency for unrelated concurrent requests (task assignment, attendance, quality, etc.)
system-wide, not only for auth callers. This is flagged as requiring a concurrent-load benchmark
before being treated as safe at production scale; the `bcryptjs`-vs-native-`bcrypt` package
choice and the single-instance process topology are both architecture/capacity decisions outside
this module's own authority to resolve — recorded as evidence, not remediated here.

`refreshToken`'s `Session.findFirst` filters on `refresh_token` (unique-indexed,
`schema.prisma:161`) AND `user_id` — the `refresh_token` unique index alone is already selective
enough that the compound filter is a non-issue in practice, unlike the composite-index gap
flagged in the sibling notifications spec; recorded for completeness, not as a defect.

**Observability/audit:** `SIGNUP`/`LOGIN`/`LOGOUT`/`MODIFY`(profile-update)/`MODIFY`
(password-reset) all produce an `AuditLog` row. `refreshToken` is the ONE mutating method in
this module that writes NO audit row (`REQ-AUTH-004`) — token rotation and session-lifetime
extension leave no queryable trail beyond the `Session` row's own overwritten
`refresh_token`/`expires_at` fields (no history/versioning). `middleware/permissions.ts`
separately emits structured `logger.info`/`logger.warn` entries on every role/permission/hotel
check (`permissions.ts:19-24,43-49,54-59,76-81,86-90,113-117,134-139,144-149`); `authMiddleware`/
`AuthService` emit no comparable structured logs of their own beyond the shared
`requestLoggerMiddleware`.

## Rollout and Compatibility

`[CURRENT]` Behavior is already deployed at `db4dbbb5`; the current-state layer is a reverse
specification, not a change.

`[TARGET]` Migration strategy (PIVOT §10) — a **forward refactor**, not a dual-running
migration, consistent with the rest of the pivot (system is pre-launch, no production employee
data):
- **Phase 1 / M1 — explicit, named deliverable for this module:** "Add Regional Manager role +
  scope to auth/RBAC" (PIVOT §10 Phase 1:409; §12 M1:452, validation: "RBAC + envelope tests
  green"). This is the ONLY auth-capability item PIVOT's own milestone table names explicitly.
- **MFA / email-reset / failed-login-notify milestone-pinning:** neither PIVOT §10's phase
  breakdown nor §12's milestone table explicitly lists MFA (`TREQ-AUTH-006`), the email-mediated
  forgot-password flow (`TREQ-AUTH-005`), or failed-login-notify-manager (`TREQ-AUTH-007`) under
  any milestone — whether they are implicitly bundled into M1's "RBAC" scope or deferred to a
  later milestone is UNSTATED (`OQ-AUTH-01`).
- **Feature-flagged:** PIVOT §10:431 states each new module is gated by "the existing
  `FEATURE_*` env convention" — repository-wide verification finds ZERO matches anywhere in
  actual source/config (the same factual mismatch already independently flagged by the
  notifications spec's `OQ-NOTIF-03` and by the job-dispatch spec) — this module's target RBAC/
  MFA/email-reset rollout has no existing flag mechanism to attach to either (`OQ-AUTH-12`).
- **Backward compatibility:** adding a `REGIONAL_MANAGER` enum value and a `scope` claim/column
  are additive — none of the 7 current endpoints needs removal. The `/password-reset` endpoint's
  target shape (request-first, then complete-with-token) is NOT additive: it changes the
  endpoint's request contract from a single `{email,new_password}` call to at least two calls —
  a breaking change to that specific contract. It has ZERO current client consumers to migrate
  (verified: no `frontend-web`/mobile client calls `/password-reset` today, Dependencies
  section) — recorded as evidence lowering migration risk, not as a decided rollout plan.
- **Rollback:** additive work (Regional Manager, scope claim, MFA, notify-on-failed-login) rolls
  back by redeploying the prior build, consistent with the pre-launch, no-dual-running-migration
  posture. The password-reset contract change, being breaking rather than additive, would need
  its own rollback consideration if/when planned — not specified here, out of scope for a
  documentation-only spec.

### `[MIGRATION GAP]` enumeration (current code vs target authority)

| Gap ID | Current state (evidence) | Target requirement (evidence) | Milestone |
|---|---|---|---|
| MIG-GAP-AUTH-01 | `UserRole` has exactly 4 values; no `REGIONAL_MANAGER` (`schema.prisma:22-27`) | Exactly 5 roles incl. Regional Manager, no Supervisor (CONFIRMED §1; PIVOT §4.1) — `TREQ-AUTH-001` | M1 |
| MIG-GAP-AUTH-02 | No hotel-group/scope concept anywhere in `User`/`Session`/JWT/middleware; `checkHotelAccess` bypasses `manager`/`checker` entirely rather than enforcing one-hotel scope (`RULE-AUTH-006`) | Regional Manager = group-wide; Hotel Manager = one-hotel scope (CONFIRMED §1; PIVOT §5.4) — `TREQ-AUTH-002` | M1 |
| MIG-GAP-AUTH-03 | `AccessTokenPayload` has no `scope` claim (`lib/jwt.ts:5-12`) | JWT carries `user_id`,`role`,`scope` (PIVOT §5.3, §9.1) — `TREQ-AUTH-003` | M1 |
| MIG-GAP-AUTH-04 | Login accepts email only, no username; the 7-day inactivity mechanic ALREADY exists via `RULE-AUTH-002`'s sliding-window refresh | Email/username + 7-day auto-logout (CONFIRMED §2) — `TREQ-AUTH-004` | M1 (username support only; inactivity-logout is already satisfied) |
| MIG-GAP-AUTH-05 | `/password-reset` is a synchronous, public, direct-overwrite endpoint (`REQ-AUTH-007`); `EMAIL_SERVICE`/`SENDGRID_API_KEY`/`RESEND_API_KEY` declared-but-unwired (`REQ-AUTH-023`) | Forgot-password reset via email (CONFIRMED §2) — `TREQ-AUTH-005` | Unpinned — `OQ-AUTH-01` |
| MIG-GAP-AUTH-06 | Zero MFA code/model anywhere (`REQ-AUTH-022`); no MFA-related model appears in PIVOT §9.1/§9.3 | MFA required for Hotel Manager and above (CONFIRMED §2; PIVOT §4.1,§5.3) — `TREQ-AUTH-006` | Unpinned — `OQ-AUTH-01`, `OQ-AUTH-02` |
| MIG-GAP-AUTH-07 | Zero failed-login tracking of any kind (no counter field, no model, repo-wide grep clean); zero notification trigger exists | Repeated failed logins notify the manager, no lockout (CONFIRMED §2) — `TREQ-AUTH-007` | Unpinned — `OQ-AUTH-01`; cross-ref `docs/03-modules/notifications/MODULE_SPEC.md` `MIG-GAP-01` |
| MIG-GAP-AUTH-08 | `requireRole`/`requirePermission`/`checkHotelAccess` implement role-only (plus one role's hotel-membership) checks; no scope dimension exists to enforce cross-hotel-access-requires-scope or hotel-creation Admin/HQ-only gating | Deny-by-default role×scope; hotel creation Admin/HQ-only (PIVOT §5.4, §4.3) — `TREQ-AUTH-009` | M1 |

## Validation Plan

`[CURRENT STATE]` criteria:

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| REQ-AUTH-001 signup success/dup-email/role-permissions | Unit | `auth.test.ts:47-111` | **already covered** |
| REQ-AUTH-003 login not-found/disabled/wrong-password | Unit | `auth.test.ts:115-154` | **already covered** |
| REQ-AUTH-005 logout targeted/all-device | Unit | `auth.test.ts:158-178` | **already covered** |
| REQ-AUTH-006 getCurrentUser found/not-found | Unit | `auth.test.ts:182-209` | **already covered** |
| REQ-AUTH-012 requireRole match/no-match/no-auth/array | Unit | `rbac.test.ts:31-59` | **already covered** |
| REQ-AUTH-011 requirePermission exact/wildcard/admin-blanket/denied | Unit | `rbac.test.ts:61-89` | **already covered** (dead `super_admin` branch itself not separately exercised) |
| REQ-AUTH-013 checkHotelAccess admin/manager bypass, worker allow/deny, missing hotel_id | Unit | `rbac.test.ts:91-136` | **already covered** |
| REQ-AUTH-004 refreshToken rotation, sliding-window, expiry rejection, type-claim check | Unit (to add) | mocked Prisma `session.findFirst`/`update` | assert `Session.update` receives rotated `refresh_token` and a new `expires_at`; assert `UnauthorizedError` on expired/missing session and on wrong `type` claim | **CURRENTLY UNTESTED** |
| REQ-AUTH-007 resetPassword enumeration-avoidance, overwrite, session revocation | Unit (to add) | mocked Prisma `user.findUnique`/`update`, `session.deleteMany` | assert identical no-throw behavior for unknown vs. inactive vs. deleted email; assert `password_hash` overwritten and ALL sessions deleted on match | **CURRENTLY UNTESTED** |
| REQ-AUTH-008 updateProfile partial-field semantics | Unit (to add) | mocked Prisma `user.update` | assert omitted fields retain prior value; assert `AuditLog` records changed field names only | **CURRENTLY UNTESTED** |
| REQ-AUTH-009 authMiddleware missing/invalid/expired/valid token | Unit (to add) | direct middleware invocation with mocked `verifyAccessToken` | assert `req.auth` population on success; assert `UnauthorizedError` on each failure mode | **CURRENTLY UNTESTED** |
| REQ-AUTH-015 refresh-secret fallback behavior | Unit (to add) | `JWT_REFRESH_SECRET` unset vs. set | assert both token types validate correctly under the fallback; assert no cross-type confusion when `JWT_REFRESH_SECRET` IS set | **CURRENTLY UNTESTED** |

`[TARGET STATE]` criteria (to be authored when the corresponding milestone begins; recorded as
expectations, not yet executable): `TREQ-AUTH-001`/`002` role/scope model (assert exactly 5
roles, Regional-Manager group-wide visibility, Hotel-Manager one-hotel visibility);
`TREQ-AUTH-003` scope claim present and consulted by authorization checks without a DB round
trip; `TREQ-AUTH-004` username-login accepted, 7-day inactivity logout (regression-test the
ALREADY-implemented sliding window so it is not silently broken by the scope refactor);
`TREQ-AUTH-005` email dispatched on forgot-password, reset completes only via the emailed
token/link; `TREQ-AUTH-006` Hotel-Manager-and-above login blocked pending MFA verification,
Staff/Checker login unaffected; `TREQ-AUTH-007` N failed logins produce exactly one manager
notification via the `notification-service` contract, account never locked; `TREQ-AUTH-009`
deny-by-default cross-hotel denial, hotel-creation Admin/HQ-only enforcement. Success gates per
PIVOT §10/§12 milestone table where pinned; UNPINNED items (`OQ-AUTH-01`) have no milestone
gate to validate against until resolved.

## Risks, Assumptions, and Open Decisions

Genuine remaining human-authority items (status OPEN).

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OQ-AUTH-01 | decision | PIVOT §12's M1 row names only "RM role+scope; sendSuccess; broadcast-ready assignment" as objectives/deliverables. MFA (`TREQ-AUTH-006`), the email-mediated forgot-password flow (`TREQ-AUTH-005`), and failed-login-notify-manager (`TREQ-AUTH-007`) are confirmed `CONFIRMED_REQUIREMENTS_REGISTER.md` §2 requirements squarely inside this module's "Login & Account Access" capability, but neither authority document explicitly milestone-pins them. Mirrors the same open-question pattern already carried by the notifications spec (`OQ-NOTIF-06`) for push-delivery implementation timing. **MFA portion RESOLVED (deferred) `GD-08`/`ADR-038`, 2026-07-28:** MFA explicitly deferred to a post-MVP hardening milestone — a deliberate scheduling decision, not a silent gap. `TREQ-AUTH-005`/`TREQ-AUTH-007` milestone-pinning remains open, unaffected by this ADR. | PIVOT §12:450-457 (no explicit row); CONFIRMED §2 (requirements exist, no milestone attribution); `ADR-038` | human/unassigned | **MFA portion RESOLVED (deferred, `ADR-038`); `TREQ-AUTH-005`/`007` milestone question remains OPEN** |
| OQ-AUTH-02 | decision | No MFA-related data model (secret/enrollment/recovery-code storage) appears in PIVOT §9.1 "Models retained (modified)" or §9.3 "Models added" — the ten added models (`PersonalData, WorkerDocument, Contract, ConsentLog, RetentionLog, CalendarEntry, JobRequest, PayslipRequest, ReworkTask, ReceptionData`) do not include one. Where MFA state persists is entirely UNSTATED. **RESOLVED (deferred) `GD-08`/`ADR-038`, 2026-07-28:** the data-model question is explicitly deferred, not decided — no mechanism (TOTP vs. OTP) is selected until MFA re-enters near-term scope. `TREQ-AUTH-006` remains a confirmed, unimplemented requirement, not silently dropped. | PIVOT §9.1:372-382; §9.3:385-397 (both silent on MFA storage); `ADR-038` | human/unassigned | **RESOLVED (deferred to post-MVP) — no mechanism selected, `ADR-038`** |
| OQ-AUTH-03 | decision | (Already tracked repository-wide as `SYNC-005`.) `state-user` has two writers (`backend-auth`, `backend-users`); `authoritative_writer: UNKNOWN`. This module's own signup-create and password-reset-update calls are part of the compounding evidence; not resolved here. | `DEPENDENCY_GRAPH.yaml:421-427`; `SYNC_STATE.yaml` `SYNC-005` | human | **OPEN (cross-repository, not unique to this module)** |
| OQ-AUTH-04 | **security defect — CONFIRMED HIGH** | The JWT refresh-secret fallback (`JWT_REFRESH_SECRET ?? JWT_SECRET`, `lib/jwt.ts:37,72`) means both token types share one signing secret whenever the optional env var is unset in a given environment, and `verifyAccessToken` performs no token-`type` discrimination. Previously recorded as evidence for the Security Reviewer to assess; independent Security Review (G4) has now performed that assessment and confirmed this **High** severity. This finding is NOT resolved by this document (fixing it — e.g. making `JWT_REFRESH_SECRET` required, or adding a `type`-claim check to `verifyAccessToken` — is a code change, out of scope here) and contributes to the module's blocking Security `FAIL` disposition (Constitution §12); it requires a code fix or an authorized, time-bounded Risk Assessment. | `lib/jwt.ts:27-33,37,53-68,70-89` | human/unassigned | **OPEN — Confirmed High (security review); contributes to blocking Security FAIL; requires code fix or Risk Assessment per Constitution §12** |
| OQ-AUTH-05 | **security defect — CONFIRMED CRITICAL** | `resetPassword`'s current-state behavior — `{email,new_password}` body only, no reset token, no email ever sent, public `POST /password-reset` with no `authMiddleware`, silent no-op on unknown/inactive/deleted email, unconditional overwrite + full session revocation on match — is recorded neutrally as evidence throughout this spec (`REQ-AUTH-007`, `RULE-AUTH-004`, Interfaces, Failure/Security). Previously left open "for the Security Reviewer to independently assess"; that assessment has now happened — independent Security Review (G4) confirmed this **Critical**, describing it as "a complete, self-service, zero-interaction account-takeover primitive against every active account in the system." This finding is NOT resolved by this document (fixing the endpoint is a code change, out of scope here) and is **BLOCKING for G2 freeze** per Constitution §12: it must be either fixed in code or formally accepted via an authorized, time-bounded Risk Assessment before this module can be frozen. It MUST NOT be treated as a routine open item pending convenience. | `modules/auth/routes.ts:11`; `modules/auth/service.ts:197-212` | human/unassigned | **OPEN — BLOCKING (Critical); requires code fix or human-authorized Risk Assessment per Constitution §12 before G2 freeze** |
| OQ-AUTH-06 | **security defect — CONFIRMED HIGH** (scope-implementation direction remains a separate open decision) | `checkHotelAccess`'s blanket bypass for `admin`/`manager`/`checker` (`middleware/permissions.ts:105`) means a `manager` today has NO enforced one-hotel scope anywhere in the request pipeline via this middleware. The bypass is attributed in code/test comments to "PATCH-04 §4c," traceable to `docs/legacy/api/API_SPEC_V1_PATCH_V2.md` — per this repository's Source-of-Truth policy, `docs/legacy/` content is historical evidence only, not a current authoritative decision. Independent Security Review (G4) has now assessed and confirmed this bypass **High** severity — no longer merely an open scope question. Whether the target one-hotel Manager scope (`TREQ-AUTH-002`) is implemented by removing this bypass or by a different scope-check layered on top remains unstated implementation direction (still appropriately out of this spec's scope) — that implementation-direction question is NOT resolved by the severity confirmation. Contributes to the module's blocking Security `FAIL` disposition (Constitution §12); requires a code fix or an authorized Risk Assessment. | `middleware/permissions.ts:103-108`; `__tests__/rbac.test.ts:92,100`; `docs/legacy/rbac/AUTHORITY_CHAIN_RECONCILIATION_REPORT.md:154-158` (non-authoritative, historical) | human/unassigned | **OPEN — Confirmed High; contributes to blocking Security FAIL; requires code fix or Risk Assessment per Constitution §12; implementation direction remains separately open** |
| OQ-AUTH-07 | decision | `permissions-middleware` (`requireRole`/`requirePermission`/`checkHotelAccess`) is owned `unassigned`, distinct from the `auth-middleware` contract which IS owned by `backend-auth`, despite both implementing this capability's RBAC end-to-end and living in sibling files under `backend/src/middleware/`. Whether `permissions-middleware` should be reassigned to `backend-auth`'s ownership, once `SYNC-001` unblocks, is a human/architecture decision. | `DEPENDENCY_GRAPH.yaml:57-58,364-399` | human/unassigned | **OPEN** |
| OQ-AUTH-08 | decision | Org-chart visibility ("who reports to whom," restricted to Regional Manager + Admin, CONFIRMED §1:23) is a confirmed target requirement, but no org-chart concept, model, or endpoint exists anywhere in the current repository (verified: no `reportsTo`/manager-hierarchy field on `User`/`HotelWorker`; no org-chart route). Whether this is an auth-module permission-gate responsibility or a separate module's feature is unstated; recorded as a boundary note, not claimed as this module's own gap. **PARTIALLY RESOLVED by `ADR-030`** (Accepted, 2026-07-25): the *permission* half closes — `org_chart:read` is granted to Admin + Regional Manager only (C-33, §3 capability matrix), matching CONFIRMED §1:23 exactly. **Data-model half RESOLVED `GD-03`/`ADR-060`, 2026-07-29:** flat, hotel-scoped — no explicit `reports_to`/hierarchy field or table is introduced; org-chart visibility is derived implicitly from existing hotel/hotel-group scope membership (the same discriminated JWT `scope` claim `ADR-023`/`ADR-030` already established), not a new authorization primitive. Explicit reporting chains/approval hierarchies/escalations remain deferred until a confirmed business requirement needs one. Both halves of this row are now resolved. | CONFIRMED §1:23; repo-wide grep, no matches; `ADR-060` | human/unassigned | **RESOLVED — permission half (`ADR-030`); data-model half flat hotel-scoped, no reporting tree (`ADR-060`)** |
| OQ-AUTH-09 | decision | Special-category field access-gating (Konfession, disability — PIVOT §5.4:180, §4.13:145; CONFIRMED §27) requires "a restricted sub-permission, audit-logged on every access." Whether this is expressed via this module's existing `ROLE_PERMISSIONS`-style string tokens or a separate consent/field-level ACL depends on the not-yet-specified `PersonalData` model (PIVOT §9.3) owned by a different, not-yet-specified module. | PIVOT §5.4:180; §9.3:388 (`PersonalData` model named, no owning module or ACL mechanism specified) | human/unassigned | **OPEN** |
| OQ-AUTH-10 | decision | (Already tracked repository-wide as `SYNC-001`.) Module owner is `unassigned`; blocks accountable ownership and SLO-setting, consistent with every other spec in this repository. | `.claude/knowledge/MODULE_REGISTRY.yaml:34` | human | **OPEN (cross-repository, not unique to this module)** |
| OQ-AUTH-11 | decision | Neither CONFIRMED §25's three GDPR retention tiers (6mo shift-coords / 5yr general / 6yr payroll-tax) nor any other authority document explicitly names `User`, `Session`, or `AuditLog` (this module's write surface) under a tier. **RESOLVED (provisional) `GD-09`/`ADR-033`, 2026-07-28:** `User` and `Session` assigned **Tier 2 (5-year general)**. `AuditLog` is explicitly **excluded from all three tiers and retained indefinitely** — it is the platform's own accountability record (CRR §30), and deleting audit history on the same clock as the data it describes would defeat its purpose (mirrors `OD-RETENTION-08`'s identical reasoning for Retention's own audit trail). Provisional pending tax-advisor sign-off (`OD-RETENTION-01`) for the `User`/`Session` tier only — `AuditLog`'s indefinite-retention exclusion is not contingent on that sign-off. | CONFIRMED §25 (silent on these models); `schema.prisma:117-169,494-516`; `ADR-033` | human/unassigned | **RESOLVED (provisional) — `User`/`Session` Tier 2, `AuditLog` indefinite, `ADR-033`; tax-advisor sign-off tracked separately, non-blocking** |
| OQ-AUTH-12 | decision | PIVOT §10:431 states each new module is gated by "the existing `FEATURE_*` env convention... already exists in the codebase." Repo-wide grep finds zero matches anywhere in actual source/config — the same factual mismatch already independently flagged by the notifications spec's `OQ-NOTIF-03`. This module's target RBAC/MFA/email-reset rollout has no existing flag mechanism to attach to either. | PIVOT §10:431; repo-wide grep, no matches | human/unassigned | **OPEN — factual mismatch, not silently accepted** |
| OQ-AUTH-13 | decision | The exact string token for the new Regional Manager role (`regional_manager`? `REGIONAL_MANAGER`? something else) is unstated by either authority document — CONFIRMED §1/PIVOT §4.1 use the prose "Regional Manager" throughout, never a code-shaped identifier. This module's existing convention is uppercase-enum/lowercase-claim (`UserRole.MANAGER` ↔ `role:'manager'`); an implementer would need this decided before schema/token work begins. **RESOLVED by `ADR-030`** (Accepted, 2026-07-25, D-5): `REGIONAL_MANAGER` is the enum token (uppercase-enum/lowercase-claim convention preserved), added to `UserRole`. See forward-note below. | CONFIRMED §1; PIVOT §4.1, §5.4 (prose only, no identifier) | human/unassigned | **Resolved** (`ADR-030`, 2026-07-25) — see forward-note |
| OQ-AUTH-14 | risk | `Session` rows are never proactively swept (State and Lifecycle: "No sweep/TTL job exists") — expired rows are only functionally rejected at `refreshToken`-check time, never deleted, so `Session` accumulates dead rows unboundedly over the life of the deployment. Distinct from `OQ-AUTH-11` (which covers GDPR retention-tier *classification*, not deletion-mechanism *existence*). `PIVOT_DESIGN_DOCUMENT.md` §5.2's "Async: Scheduled jobs" layer names retention-deletion, job-request auto-close, and rework timers as examples of that layer's pattern, but does not name session/token cleanup — so, absent this item, the gap would otherwise fall through unassigned to any module or milestone. Performance review (FIND-02, Medium) flagged this as needing an owner. | `modules/auth/service.ts` (absence of a sweep job; State and Lifecycle section above); `PIVOT_DESIGN_DOCUMENT.md` §5.2 (job list, session/token cleanup absent) | human/unassigned | **OPEN** |
| OQ-AUTH-15 | **security defect — CONFIRMED HIGH (new finding)** | `Session.refresh_token` is stored in cleartext — `session.create`/`session.update` write `tokens.refresh_token` directly with no hashing observed on this column (`modules/auth/service.ts:47,98,153`; schema column `schema.prisma:157-169`). A compromised `Session` row (e.g. via DB read access, backup exposure, or an unrelated SQL-injection/exfiltration vector elsewhere) yields a directly usable bearer credential, unlike `password_hash`, which is bcrypt-hashed at rest. Independent Security Review (G4) identified this as a new **High**-severity finding not previously called out as its own point in v0.1.0 (though the underlying evidence — `service.ts:47,98,153` — was already documented in this spec's "Trust boundaries/authorization" section as a neutral observation). Recommends hashing the refresh token at rest, mirroring `password_hash`'s treatment. Contributes to the module's blocking Security `FAIL` disposition (Constitution §12); requires a code fix or an authorized Risk Assessment — not resolved by this document. | `schema.prisma:157-169`; `modules/auth/service.ts:47,98,153` | human/unassigned | **OPEN — Confirmed High (new finding); contributes to blocking Security FAIL; requires code fix or Risk Assessment per Constitution §12** |
| SYNC-001 | decision | Module owner is `unassigned` (no CODEOWNERS; empty package author) — blocks accountable ownership and SLO-setting, consistent with every other spec in this repository. | `MODULE_REGISTRY.yaml:34` | human | **OPEN (cross-repository, not unique to this module)** |

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| ASM-AUTH-01 | assumption | PIVOT §12 M1's validation criterion "RBAC + envelope tests green" is intended to cover this module's core role×scope target requirements (`TREQ-AUTH-001..003,009`) even though MFA/email-reset/failed-login-notify are not explicitly itemized under M1's own "Key deliverables" column. | PIVOT §12:452 (M1 row) | Inference, not confirmed (see `OQ-AUTH-01`) |
| ASM-AUTH-02 | assumption | The target `scope` JWT claim (PIVOT §5.3) is assumed to be role-dependent in shape — a single `hotel_id` for Hotel Manager/Staff/Checker, a `hotel_group_id` (or equivalent group membership) for Regional Manager — since PIVOT §5.4's RBAC table describes "One hotel" vs. "All hotels in group" data scope but never specifies the claim's literal shape (single id, array, or group-id-with-membership-lookup). | PIVOT §5.3:170; §5.4:173-179 (data-scope column, no claim-shape specification) | Inference, not confirmed |
| ASM-AUTH-03 | assumption | Hotel-group membership resolution (needed to compute a Regional Manager's `scope`) is assumed to be owned by `backend-crm`/`backend-hotel-workers` (existing `Hotel`/`HotelWorker` owners) rather than a new module, since no authority document names an owning module for "Hotel Group" as a first-class concept distinct from `Hotel`. | `DEPENDENCY_GRAPH.yaml:65-66` (`state-hotel`, `state-hotel-worker` ownership); PIVOT §4.3:99-103 (Hotel Groups mentioned, no owning-module statement) | Inference, not confirmed |

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate.

- **MODULE_REGISTRY.yaml:** set `specification` for `backend-auth`
  (`MODULE_REGISTRY.yaml:40`) from `SPEC-AUTH-001@0.2.1 (REVIEW)` → `SPEC-AUTH-001@0.2.2
  (REVIEW)`. Do not alter `owner` (remains `unassigned`, `SYNC-001`).
- **DEPENDENCY_GRAPH.yaml (proposed):**
  - No new `calls`/`consumes-api` edges are proposed for CURRENT-state behavior — all cited
    edges already exist and were independently re-verified during authoring.
  - NOTE (future, do not add yet): once M1 lands, a new `calls` edge
    `backend-auth → backend-notifications` (contract `notification-service`) will be needed for
    the failed-login-notify-manager trigger (`TREQ-AUTH-007`/`MIG-GAP-AUTH-07`) — not added now
    because the call site does not exist in code yet, consistent with how the notifications
    spec's own Proposed Knowledge Deltas already anticipates this same future edge from the
    opposite direction.
  - Consider (human/architecture decision, not applied here): reassigning `owner_module` for the
    `permissions-middleware` contract entry (`DEPENDENCY_GRAPH.yaml:383-399`) from `unassigned`
    to `backend-auth`, consistent with `auth-middleware`'s existing ownership, given both files
    implement this capability's authorization surface end-to-end — flagged per `OQ-AUTH-07`, not
    resolved here.
- **TERMINOLOGY.md:** promote to canonical, sourced to this spec: `Session`, `Access token`,
  `Refresh token`, `auth-middleware`, `permissions-middleware`, `Scope` (target), `Regional
  Manager` (target). Additionally: the four existing `Worker`/`Checker`/`Manager`/`Admin`
  "Definition unresolved" rows (`TERMINOLOGY.md:25-28`) should each gain a `[TARGET]` cross-note
  that CONFIRMED §1/PIVOT §4.1 confirm a 5th role (`Regional Manager`) is being added and that
  none of the five roles is currently formally defined beyond the bare `UserRole` enum token —
  proposed wording only, not applied here. `Regional Manager` itself is currently ABSENT from
  `TERMINOLOGY.md`'s Project Term Candidates table entirely (verified: no matching row) and
  should be added as a new row citing CONFIRMED §1:19-20 and PIVOT §4.1:85, status "Definition
  unresolved — new role, no code representation yet."
- **DECISION_INDEX.md:** reference ADR-003 (modular monolith) and ADR-008 (source-of-truth
  hierarchy, governing this spec's own current/target-state separation method) as existing
  anchors — both already indexed, no new entry needed. No NEW Decision Record is proposed by
  this spec as strictly REQUIRED-before-planning (unlike the notifications spec's `OQ-NOTIF-01`),
  but four items are flagged as candidates for a Decision Record if/when M1 implementation
  planning for this module begins — proposed, not created here: `OQ-AUTH-02` (MFA storage
  model), `OQ-AUTH-06` (hotel-scope bypass reconciliation), `OQ-AUTH-13` (Regional Manager
  role-token spelling), and — added per architecture review FIND-002 — the target
  `scope`-resolution **dependency direction** (`ASM-AUTH-02`/`ASM-AUTH-03`): how `backend-auth`
  learns a Regional Manager's hotel-group membership at token-issuance time, i.e. a new
  cross-module call (`backend-auth → backend-crm`/`backend-hotel-workers` or equivalent) vs. a
  stored field on `User`/`Session`. Architecture review notes this fourth candidate is an
  M1-pinned architectural choice with high blast radius (12 consumers of `auth-middleware`) and
  should not be deferred past the other three without deliberate reconsideration.
- **SYNC_STATE.yaml:** none proposed by the author; the synchronization owner records spec
  issuance if/when this candidate advances (consistent with the pattern already used for
  `SYNC-008`/`SYNC-009`/`SYNC-010`).

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-08 | Initial current-state reverse specification at `db4dbbb5`, paired with target-state requirements drawn from CONFIRMED §1/§2/§25/§27 and PIVOT §4.1/§4.3/§4.13/§5.2/§5.3/§5.4/§9.1/§9.3/§10/§12. REQ-AUTH-001..024, RULE-AUTH-001..009 (current); TREQ-AUTH-001..010, TRULE-AUTH-001..006 (target). MIGRATION GAP enumeration `MIG-GAP-AUTH-01..08`. Identified and independently verified: zero MFA/TOTP/rate-limit/CAPTCHA code anywhere in `backend/src`; zero failed-login-tracking code; zero email-sending consumers of the declared `EMAIL_SERVICE`/`SENDGRID_API_KEY`/`RESEND_API_KEY` env fields; the `requirePermission` `super_admin` branch and `ROLE_HIERARCHY` constant are both dead code; the `checkHotelAccess` admin/manager/checker bypass traces (via code/test comments) to a `docs/legacy/` (non-authoritative) planning document; `permissions-middleware` is a distinct, `unassigned`-owned contract NOT consumed by `backend-auth` itself; PIVOT §9.1 explicitly scopes `User`/`Session`'s target schema change to "add scope; add Regional Manager role; keep soft delete" with no MFA-storage model named anywhere in §9.1/§9.3; PIVOT §12's M1 row names only "RM role+scope" for this capability, leaving MFA/email-reset/failed-login-notify milestone-unpinned. Carried 13 genuine open decisions (`OQ-AUTH-01..13`) plus cross-references to the already-tracked `SYNC-001`/`SYNC-005`; explicitly did NOT resolve the severity of the public, token-less `POST /password-reset` endpoint or the manager/checker hotel-scope bypass, instead recording both neutrally as evidence for independent Security Review, per task framing. | None — first version, no prior findings to resolve. | None — status REVIEW, G2 freeze reserved to human. |
| 0.2.0 | 2026-07-08 | Applied author-fixable dispositions from five independent, completed G4 reviews against the frozen v0.1.0 candidate: architecture, dependency, consistency, and performance all returned `PASS_WITH_ACTIONS`; security returned **`FAIL`** (1 Critical, 4 High). No REQ/RULE/MIG-GAP ids renumbered; two new open items added (`OQ-AUTH-14`, `OQ-AUTH-15`). **Consistency FIND-001 (Medium):** corrected the Events section's cross-reference — the notifications spec's anticipated `backend-auth` producer edge lives in that document's Proposed Knowledge Deltas section (line ~655, explicitly headed "Proposed only — NOT applied"), not its Dependencies section as v0.1.0 stated; reworded to match this document's own Dependencies section's already-accurate "already-anticipated but not-yet-added, per the notifications spec's own Proposed Knowledge Deltas — proposed, not applied" phrasing. **Dependency FIND-001 (Medium):** corrected the Dependencies section's `permissions-middleware` row from the graph's stale "11 other modules" to the independently-verified 10 (`analytics, attendance, calendar, crm, hotel-workers, hr, quality, users, work-applications, work-requests`), and flagged `DEPENDENCY_GRAPH.yaml:394`'s `backend-assignments` consumer entry as stale (independently verified `backend/src/modules/assignments/routes.ts` does not import `middleware/permissions`, using only `authMiddleware` with a "service-level guards" comment instead) for a separate dependency-synchronization correction — not applied here (Lead Architect owns the graph fix in post-flight). **Architecture FIND-001 (Medium):** added a clarifying sentence to Purpose and Scope → In scope's `permissions-middleware` bullet stating this spec documents its behavior as the functional RBAC mechanism this capability depends on, while `OQ-AUTH-07` (ownership reassignment) remains a separate, unresolved architecture decision — not silently resolved. **Architecture FIND-002 (Medium):** added the target `scope`-resolution dependency direction (`ASM-AUTH-02`/`ASM-AUTH-03` — new cross-module call vs. stored field for Regional-Manager hotel-group membership resolution) as a fourth Decision Record candidate in Proposed Knowledge Deltas → DECISION_INDEX.md, alongside `OQ-AUTH-02`/`OQ-AUTH-06`/`OQ-AUTH-13`, noting its high blast radius (12 consumers of `auth-middleware`). **Performance FIND-01 (High-evidence/Medium-confidence):** added the `bcryptjs`-is-pure-JS / single-instance-fork-topology (`ecosystem.config.js:9-11`) system-wide-contention observation to "Performance budgets/workload," flagged as requiring a concurrent-load benchmark before being treated as safe at production scale; noted the library and topology choices are architecture/capacity decisions outside this module's own authority. **Performance FIND-02 (Medium):** added `OQ-AUTH-14` (session-sweep-job gap, distinct from `OQ-AUTH-11`'s retention-tier question) and cross-referenced it from "State and Lifecycle." **Performance FIND-05 (Medium):** added a clarifying note after the Interfaces target-state paragraph reconciling PIVOT §5.3's "cheap authorization checks" rationale against this document's own evidence that `checkHotelAccess` already costs zero DB queries for 3 of 4 roles today and one already-index-optimal query for the 4th — the real performance consequence of the target `scope` claim is absorbing newly-enforced checks once `TREQ-AUTH-009` closes the bypass (cross-ref `OQ-AUTH-06`), not optimizing an existing bottleneck. **Performance FIND-06:** no action taken — reviewer confirmed the no-approved-SLO gap is already accurately and completely disclosed in v0.1.0. **Security (`FAIL`, NOT resolved by this documentation-only pass):** the Security Reviewer explicitly confirmed every flagged current-state behavior in v0.1.0 (`REQ-AUTH-007`/password-reset, `REQ-AUTH-015`/refresh-secret fallback, `REQ-AUTH-013`/`checkHotelAccess` bypass, the dead `super_admin` branch, and the non-transactional `resetPassword` sequence) was documented accurately and completely — the FAIL attaches to the underlying code, not to this document. Per the reviewer's disposition, promoted `OQ-AUTH-05` (password-reset) to explicitly CONFIRMED **Critical** — "a complete, self-service, zero-interaction account-takeover primitive against every active account in the system" — and `OQ-AUTH-04` (refresh-secret fallback) and `OQ-AUTH-06` (`checkHotelAccess` bypass) to explicitly CONFIRMED **High**, each no longer merely "open for assessment." Added `OQ-AUTH-15` (new finding: cleartext `Session.refresh_token` storage, High, `schema.prisma:157-169`/`service.ts:47,98,153`, recommending hash-at-rest mirroring `password_hash`). **Carried forward, explicitly UNRESOLVED by this documentation-only spec** (require a human/engineering fix-or-Risk-Assessment decision outside this workflow): Critical FIND-001 (password-reset account-takeover, `OQ-AUTH-05`); High FIND-002 (refresh-secret fallback, `OQ-AUTH-04`); High FIND-003 (`checkHotelAccess` bypass, `OQ-AUTH-06`); High FIND-004 (cleartext session tokens, `OQ-AUTH-15`); High FIND-007 (no MFA compensating control, `REQ-AUTH-022`). Document Control bumped to `0.2.0`; Authors/reviewers row updated to record all five G4 gate recommendations. Status remains `REVIEW` — NOT frozen; owner remains `unassigned`; no code file and no `.claude/knowledge/*.yaml` file was touched by this pass. | Consistency FIND-001; Dependency FIND-001; Architecture FIND-001; Architecture FIND-002; Performance FIND-01; Performance FIND-02; Performance FIND-05; Performance FIND-06 (no action, confirmed already-correct). | None — status REVIEW, not approved; Security gate remains `FAIL`/blocking (1 Critical, 4 High) pending code fix(es) or an authorized Risk Assessment per Constitution §12; G2 freeze remains reserved to human authority. |
| 0.2.1 | 2026-07-08 | Applied three nonsemantic corrective edits found by G6-doc Documentation Validation against v0.2.0 (purely factual/citation corrections; no requirement, rule, gap, or open-decision content changed, so no re-review of any G4 dimension was required per the Documentation Workflow's restart conditions). **FIND-DOC-01 (Medium):** corrected Interfaces and Contracts' self-contradictory "five of the seven routes" to the accurate "three of the seven routes" (`logout`/`me`/`profile`; the other four are public), matching the Interfaces table and Requirements section that were already correct. **FIND-DOC-02 (Medium):** corrected the Proposed Knowledge Deltas → `MODULE_REGISTRY.yaml` target value from the stale `SPEC-AUTH-001@0.1.0 (REVIEW)` to the current `SPEC-AUTH-001@0.2.1 (REVIEW)`. **FIND-DOC-03 (Low):** corrected the `REQ-AUTH-024` evidence citation from `__tests__/rbac.test.ts:1-137` to the file's actual length, `1-136`. Document Control bumped to `0.2.1`. Status remains `REVIEW`; Security gate unaffected and still `FAIL`/blocking (1 Critical, 4 High); owner remains `unassigned`. | FIND-DOC-01; FIND-DOC-02; FIND-DOC-03. | None — status REVIEW, not approved; Security gate remains `FAIL`/blocking pending code fix(es) or an authorized Risk Assessment per Constitution §12; G2 freeze remains reserved to human authority. |
| 0.2.2 | 2026-07-15 | Fast Documentation Workflow (Package B, `AUDIT-REPO-2026-07-14` `AUDIT-H2`): this module's `state-audit-log` (`AuditLog`) ownership text was not synchronized to `ADR-016` (Accepted, 2026-07-14), which resolved the model's `authoritative_writer` from `UNKNOWN` to `backend-auth` and made `backend-compliance` a read-only consumer — `STATE_OWNERSHIP_INDEX.yaml`, `SPEC-COMPLIANCE-001`, and Repository Synchronization (Package A) already reflected the decision; this document did not. Corrected: (1) Ownership and Boundaries' `state-audit-log` bullet now states `authoritative_writer: backend-auth` per `ADR-016` instead of `UNKNOWN`, and cross-references the new interface (below); (2) `RULE-AUTH-009`'s Owner/Source column corrected from `unassigned (SYNC-001)` to `backend-auth (ADR-016)`; (3) added a `[TARGET STATE]` `IF-AUTH-GetAuditTrail / v0` paragraph to Interfaces and Contracts documenting the read-only `AuditLog`-query interface this module must expose to `backend-compliance`, closing `SPEC-COMPLIANCE-001`'s `OD-COMPLIANCE-004` (that document's `IF-COMPLIANCE-GetAuditTrail` counterpart). No requirement/rule identifier renumbered; no new open decision added (route/contract shape remains `[OPEN]`, deferred to this module's own implementation milestone, consistent with every other unbuilt `TREQ-AUTH-*`/`TRULE-AUTH-*` item). `state-user`'s separate dual-writer gap (`OQ-AUTH-03`/`SYNC-005`) is untouched — this correction is scoped exclusively to `state-audit-log`/`ADR-016`. Document Control bumped to `0.2.2`. Status remains `REVIEW`; Security gate unaffected and still `FAIL`/blocking (1 Critical, 4 High); owner remains `unassigned`. | AUDIT-H2 (`AUDIT-REPO-2026-07-14`). | None — status REVIEW, not approved; Security gate remains `FAIL`/blocking pending code fix(es) or an authorized Risk Assessment per Constitution §12; G2 freeze remains reserved to human authority. |
| 0.2.2 (forward-note, recorded not versioned) | 2026-07-20 | **Forward-note per `ADR-022`** (Accepted, ratified by merge of PR #166, 2026-07-20 — retirement of `backend-hotel-workers` into Employee Management, `SPEC-EMP-001`/`backend-hr`). The already-disclosed `checkHotelAccess` admin/manager/checker bypass (`OQ-AUTH-06`/`REQ-AUTH-013`, High, security `FAIL`) is the same `HotelWorker` ACTIVE-membership authorization primitive `ADR-022` migrates away from, replacing it with the role×scope JWT model (`TREQ-008`/`REQ-USERS-022..024`). No requirement, rule, or open-decision content in this document is changed by this note: `ADR-022`'s authorization migration is prerequisite-gated (EMP employment-record build, Hotel-Group model `OD-EMP-05`, role×scope JWT authz built in parallel behind a flag before cutover) and not yet underway; `checkHotelAccess`/`HotelWorker` remain unchanged in the interim. This note exists so a future correction pass repoints `OQ-AUTH-06`'s fix path to "migrate to role×scope JWT per `ADR-022`" rather than a standalone bypass patch, once the JWT-scope authz prerequisite lands. No version bump — nonsemantic forward-note (`LOOP_CONTROL.md` §7 exemption), mirroring this document's own `AUDIT-H2` precedent. | None — forward-note only, no finding resolved or reopened. | — (nonsemantic annotation; no approver action required; Security gate `FAIL`/blocking status and G2 freeze reservation unaffected). |
| 0.2.4 | 2026-07-28 | **Amended (Correction), per `GD-09`/`ADR-033`** (GDPR retention-tier assignment, Decided via the Governance Resolution workflow, Option (c)). `OQ-AUTH-11` marked RESOLVED (provisional) — `User`/`Session` assigned Tier 2 (5-year general); `AuditLog` explicitly excluded from all three tiers, retained indefinitely per CRR §30. Pending tax-advisor sign-off (`OD-RETENTION-01`) for the `User`/`Session` tier only, non-blocking. Also corrects a pre-existing Document Control drift: the `Spec ID / version` field previously read `0.3.0` with no corresponding Change Log row (the log's actual last entry before this one was `0.2.3`, a nonsemantic forward-note); corrected to `0.2.4` here rather than perpetuating the gap. No other requirement, rule, interface, or open decision touched. FROZEN status retained; Security gate `FAIL`/blocking status from prior versions unaffected. | `OQ-AUTH-11` RESOLVED (provisional, `ADR-033`) | Commissioning human (2026-07-28, Governance Resolution workflow, Decision #2) |
| 0.2.5 | 2026-07-28 | **Amended (Correction), per `GD-08`/`ADR-038`** (MFA design & data model, Decided via the Governance Resolution workflow, Option (c): explicit deferral). `OQ-AUTH-01`'s MFA portion and `OQ-AUTH-02` (MFA data model) both marked RESOLVED (deferred) — MFA is explicitly deferred to a post-MVP hardening milestone; no mechanism (TOTP vs. OTP) is selected. `TREQ-AUTH-006` remains a confirmed, unimplemented requirement, not silently dropped. `OQ-AUTH-01`'s remaining milestone question for `TREQ-AUTH-005`/`TREQ-AUTH-007` is untouched, still OPEN. No other requirement, rule, interface, or open decision touched. FROZEN status retained; Security gate `FAIL`/blocking status from prior versions unaffected. | `OQ-AUTH-01` (MFA portion), `OQ-AUTH-02` RESOLVED (deferred, `ADR-038`) | Commissioning human (2026-07-28, Governance Resolution workflow, Decision #8) |
| 0.2.6 | 2026-07-29 | **Amended (Correction), per `GD-03`/`ADR-060`** (Org-chart/reporting-relationship model, Decided via the Governance Resolution workflow, ratifying the commissioning human's explicit verbatim disposition). `OQ-AUTH-08`'s data-model half — left explicitly open by `ADR-030` §7/§8 (the 2026-07-26 forward-note above) — now resolves: flat, hotel-scoped; no explicit `reports_to`/hierarchy field or table is introduced. Org-chart visibility (Admin + Regional Manager, already granted by `ADR-030`'s permission half) is derived implicitly from existing hotel/hotel-group scope membership, reusing the same discriminated JWT `scope` claim `ADR-023`/`ADR-030` already established — no new authorization primitive. Explicit reporting chains/approval hierarchies/escalations remain deferred until a confirmed business requirement needs one (Constitution §12). `OQ-AUTH-08` is now fully resolved on both halves. This also completes `GD-03` (5-role model & Regional-Manager authority) in full, and satisfies `ADR-058`'s named architectural-eligibility gate for Job-Dispatch (`GD-20`/Epic 9) — implementation eligibility only, not scheduling. No other requirement, rule, interface, or open decision touched. FROZEN-equivalent content change; Security gate `FAIL`/blocking status from prior versions unaffected (untouched by this amendment). | `OQ-AUTH-08` RESOLVED (data-model half, `ADR-060`); `GD-03` fully resolved | Commissioning human (2026-07-29, Governance Resolution workflow) |
| 0.2.6 (forward-note, recorded not versioned) | 2026-08-02 | **Forward-note, `backend-compliance` epic PR 1.** `IF-AUTH-GetAuditTrail`'s `[TARGET STATE]` marker removed — `AuthService.getAuditTrail()` is now implemented (`backend/src/modules/auth/{service,types}.ts`), closing `docs/03-modules/compliance/MODULE_SPEC.md`'s `OD-COMPLIANCE-004` from this module's side. Also corrected the interface's own framing: the prior text named `backend-compliance` as the specific consumer this interface exists "for"; reworded to state the interface is deliberately generic and caller-agnostic (matching `ADR-016`'s own anticipated "`IF-AUTH-*`/`IF-AUDIT-*` contract" phrasing, not a Compliance-shaped one), with Compliance disclosed as one consumer, not the interface's sole intended caller. Service-only (no HTTP route) — no external caller was identified for this capability; `backend-compliance` itself consumes it via a direct in-process call (`complianceService` importing `authService`), the same pattern `backend-hr` already uses for `documentService`, per `ADR-032`. No requirement, rule, or open decision touched; no other interface, route, or Security-gate item affected. Security gate `FAIL`/blocking status from prior versions unaffected (untouched by this note). No version bump — nonsemantic forward-note (`LOOP_CONTROL.md` §7 exemption), mirroring this document's own `AUDIT-H2`/`ADR-022` precedents above. | `OD-COMPLIANCE-004` closed from this module's side (interface now implemented) | — (nonsemantic annotation; no approver action required; Security gate `FAIL`/blocking status and G2 freeze reservation unaffected). |
| 0.2.3 (forward-note, recorded not versioned) | 2026-07-26 | **Forward-note per `ADR-030`** (Accepted, ratified 2026-07-25, session `claude/gd-02-manager-write-authority-b2g7rx` — Manager Write Authority / Capability-Based Permission Model). `TREQ-AUTH-002` gains its RM counterpart token: `REGIONAL_MANAGER` (D-5) resolves to `{type:'hotel_group'}` scope from `HotelGroup.regional_manager_user_id` (D-7), reusing the unchanged claim shape `{type:'hotel'|'hotel_group'|'global'}` established by `ADR-023`. `OQ-AUTH-13` (RM role token, exact string) **closes** — the token is `REGIONAL_MANAGER`, uppercase-enum/lowercase-claim convention preserved. `OQ-AUTH-08` (org-chart visibility) **resolves to its permission half only**: `org_chart:read` granted to Admin + Regional Manager (C-33), matching CONFIRMED §1:23; the org-chart data model itself is explicitly left open by `ADR-030` §7/§8 and **is not closed by this note**. Corrected in place at the referencing rows (`TREQ-AUTH-002`, `OQ-AUTH-13`, `OQ-AUTH-08` above) rather than left showing "unbuilt"/"OPEN". No requirement or rule identifier is renumbered; no G4 dimension re-run; the Security gate `FAIL`/blocking status from prior versions is unaffected (`ADR-030` neither fixes nor touches those findings). No version bump — nonsemantic forward-note (`LOOP_CONTROL.md` §7 exemption), mirroring this document's own `ADR-022` forward-note precedent above. | `OQ-AUTH-13` — closed by `ADR-030`; `OQ-AUTH-08` — permission half closed, data-model half remains OPEN. | — (nonsemantic annotation; no approver action required; Security gate `FAIL`/blocking status and G2 freeze reservation unaffected). |
| 0.2.6 (forward-note, recorded not versioned) | 2026-08-05 | **Forward-note, Regional Manager V1 (PR #338/#339) — build completion of the design/decision the 2026-07-26 and 2026-07-29 forward-notes above recorded.** `TREQ-AUTH-002`'s "Target; gains its RM counterpart token" language and `REQ-USERS`-adjacent "4 lowercased string tokens" current-state framing (`:167`, "Role (current)" row) are now stale as statements of repository fact: `REGIONAL_MANAGER` is a live fifth token (`prisma/schema.prisma:31`), `AuthService.resolveScope()` issues its `{type:'hotel_group'}` claim unconditionally on login/refresh (`backend/src/modules/auth/service.ts`), and `resolveHotelAccess()`/`resolveWorkerScope()` (`middleware/permissions.ts`) both special-case `regional_manager` via `isScopedManagerRole()` (`lib/scope.ts`) — closing `SIR-AUTH-021`'s prior gap (no RM branch existed at ratification time) and the analogous gap `resolveWorkerScope()` independently had (found and closed during PR #338's own review, not previously tracked by a named `OQ-AUTH-*`/`SIR-AUTH-*` row). Corrected in place at `TREQ-AUTH-002` and the "Role (current)" row above rather than left showing "Target"/"4 tokens". `OQ-AUTH-06` (the `checkHotelAccess` admin/manager/checker bypass) is UNCHANGED by this note — still open, still Confirmed High, unrelated to the RM build. No requirement or rule identifier renumbered; no G4 dimension re-run; Security gate `FAIL`/blocking status from prior versions unaffected. No version bump — nonsemantic forward-note (`LOOP_CONTROL.md` §7 exemption), mirroring this document's own `ADR-030`/`ADR-060` forward-note precedents above. | `TREQ-AUTH-002`, "Role (current)" row — corrected to reflect the shipped build, not a new decision. | — (nonsemantic annotation; no approver action required; Security gate `FAIL`/blocking status and G2 freeze reservation unaffected). |
