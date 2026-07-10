# Module Specification: `users` (backend-users)

> Specification of ONE bounded backend capability — **User account management** (list/get/create/
> update/soft-delete of `User` records, role assignment, permissions-array administration) —
> implemented by the single module `backend-users`. This is distinct from **Authentication**
> (login/signup/session/token issuance/password-reset/MFA), which `backend-auth` owns and which
> `docs/03-modules/auth/MODULE_SPEC.md` (`SPEC-AUTH-001 / 0.2.1`) already specifies; that boundary
> is asserted, not re-derived, here (see Purpose and Scope, Out of scope). Current-state claims cite
> `path:line` at the repository revision below. Target-state claims cite
> `CONFIRMED_REQUIREMENTS_REGISTER.md` (CRR §n) and `PIVOT_DESIGN_DOCUMENT.md` (PDD §n). This
> document records behavior and confirmed contract; it does not create product policy, does not
> resolve any open decision, and is not FROZEN — G2 freeze is reserved human authority.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-USERS-001 / 0.1.0` |
| Status | `REVIEW` |
| Owner | `unassigned` — reserved human authority (SYNC-001); no `CODEOWNERS` file exists in the repository and `backend/package.json:23` `"author": ""` is empty |
| Authors / reviewers | Author: Module Author agent. Independent reviewers (G4, on v0.1.0, commit `84d880a`/`d5b986e`): Architecture = `PASS_WITH_ACTIONS` (Low + Medium — new `state-user`-adjacent token-revocation disclosure gap); Dependency = `PASS_WITH_ACTIONS` (Medium — missing `backend-users → state-hotel-worker` graph edge — + Low/Note); Performance = `PASS_WITH_ACTIONS` (2 Low + 3 Note — missing-index/pagination disclosures); Consistency = **`FAIL`** (High — `REQ-USERS-003`..`REQ-USERS-012` are each defined twice with unrelated meanings across the Evidence and Requirements tables; mechanical, author-fixable); Security = **`FAIL`** (**Critical** — `POST /api/v1/auth/signup` accepts an unauthenticated, self-selected `role` including `admin` with no guard anywhere in `backend-auth`'s signup path, `backend/src/modules/auth/validation.ts:12`, `service.ts:22-23` — a live, unauthenticated privilege-escalation-to-Admin defect in `backend-auth`'s code, not `backend-users`'; not previously tracked by any of `SPEC-AUTH-001`'s four existing security findings; independently reproduced by the Lead Architect, not merely reported — plus a Medium cross-hotel PII-read finding and three Low/Medium disclosure-completeness gaps). This document's `OQ-USERS-02`/`OQ-USERS-03` "Admin-only in practice" framing is undermined by the Critical finding above and requires correction in the next candidate version. **Correction cycle NOT yet run — see Review and Change Log.** |
| Repository revision | `fc698582b771f76989e4f398074f88a111a5c4f8` (`fc69858`, current `HEAD` at authoring time; worktree clean — `git status --porcelain` empty) |
| Approved by / at | — (G2 freeze requires the named human approver; not yet approved) — additionally **BLOCKED**: one open Critical security finding (live code, `backend-auth`) and one open High consistency finding (this document's own `REQ-USERS-*` ID collision) both remain unresolved, per Constitution §12 / `REVIEW_GATES.md` Merge Policy ("no critical/high finding is open"). Workflow termination state for this candidate: **Blocked** (`LOOP_CONTROL.md` §4), not Success/Failure — correction cycle paused by human instruction pending disposition of the security finding; see `SYNC-016` (`.claude/knowledge/SYNC_STATE.yaml`) and `SIR-GLOB-012`/`SIR-USERS-*` (`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`). |
| Supersedes | None. First specification for `backend-users`; `.claude/knowledge/MODULE_REGISTRY.yaml:56` records `specification: UNKNOWN` prior. |

## Purpose and Scope

**Outcome:** A single administrative surface for managing `User` account records — identity fields,
active/soft-deleted state, role assignment, and the derived `permissions` array — for use by
Admin/Manager-facing account-management UI, distinct from the credential/session lifecycle that
`backend-auth` owns (`SPEC-AUTH-001`).

**In scope:**

- **Current:** The five HTTP routes at `backend/src/modules/users/routes.ts:10-14`
  (`GET /`, `POST /`, `GET /:user_id`, `PUT /:user_id`, `DELETE /:user_id`), all mounted under
  `/api/v1/users` (`.claude/knowledge/DEPENDENCY_GRAPH.yaml:305`) and all behind `authMiddleware`
  (`routes.ts:8`).
- **Current:** `User` record CRUD — paginated list with role/hotel/search/active filters, single
  get, create (with password hashing), update (identity fields, `is_active`, role reassignment),
  and soft-delete — implemented in `backend/src/modules/users/service.ts`.
- **Current:** Role-driven `permissions` array assignment: on create and on role-changing update,
  `permissions` is set from `ROLE_PERMISSIONS[role]` (`backend/src/config/constants.ts:88-129`),
  which is also the same map `backend-auth` snapshots onto the JWT at login/signup (see Ownership
  and Boundaries, Dependencies).
- **Current:** Audit logging of view/create/update/delete actions via the shared audit framework
  (`service.ts:81,116,155,169`).
- **Target:** Nothing product-new is confirmed exclusively for this module by CRR/PDD beyond the
  5-role model and role×scope authorization that `SPEC-AUTH-001` already specifies as its own
  target (CRR §1; PDD §4.1, §5.4); this module's target-state obligation is to converge its role
  enum, permission checks, and scoping onto that model (see Requirements, State and Lifecycle →
  Migration Gaps).

**Out of scope:** (owned elsewhere and referenced, never redefined)

- **Authentication** — login, signup, JWT issuance/verification, session lifecycle, password
  reset, MFA, `req.auth` construction. Owned by `backend-auth`; canonically specified by
  `SPEC-AUTH-001`. `backend-auth`'s own `signup` endpoint also creates `User` rows
  (`backend/src/modules/auth/service.ts:15-35`) — this is the other half of the `state-user`
  shared-write fact disclosed under `SYNC-005` (Ownership and Boundaries; Risks/Open Decisions
  `OQ-USERS-04`); this spec does not re-specify `backend-auth`'s write path, only discloses the
  fact.
- **The RBAC/scope framework itself** (`requireRole`/`requirePermission`/`checkHotelAccess`,
  `backend/src/middleware/permissions.ts`) — a separate, `owner: unassigned` shared contract
  (`permissions-middleware`, `.claude/knowledge/DEPENDENCY_GRAPH.yaml:58,395-406`) consumed by this
  module, not owned by it. This spec documents how `backend-users` *uses* the contract, not the
  contract's own internal correctness beyond what bears directly on this module's routes.
- **The `HotelWorker` roster** (hotel↔worker affiliation, INVITED→ACTIVE→SUSPENDED→REMOVED
  lifecycle, rates). Owned by `backend-hotel-workers`. This module's `listUsers` merely *reads*
  `HotelWorker` as an optional join filter (`service.ts:16`); it does not manage roster membership.
- **Employee/HR domain data** (Personalfragebogen, contracts, documents, work-permit data). Owned
  by `employee-management`/`hr` modules (`docs/03-modules/employee-management/MODULE_SPEC.md`,
  `docs/03-modules/hr/MODULE_SPEC.md`).
- Cross-verified: every other already-authored `docs/03-modules/*/MODULE_SPEC.md` that mentions
  "backend-users" or "User Management" treats it as out of scope for itself and refers here (or to
  `SPEC-AUTH-001`) instead — `auth/MODULE_SPEC.md:65,93,161,265,277,429,432`;
  `calendar/MODULE_SPEC.md:38,175`; `crm/MODULE_SPEC.md:33,128,186`;
  `employee-management/MODULE_SPEC.md:23,37,89,149,195`; `hr/MODULE_SPEC.md:46,159`;
  `notifications/MODULE_SPEC.md:393`. No boundary collision was found.

**Non-goals:**

- Inventing a "Regional Manager" role, a `scope` field, or role×scope enforcement in this document.
  Those are confirmed target requirements (CRR §1; PDD §4.1, §5.4) with no code representation
  today; they are recorded as migration gaps and open decisions, not implemented or designed here.
- Resolving `SYNC-005` (the `state-user` dual-writer question) — disclosed only, per platform-wide
  tracking at `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-GLOB-006`.
- Redefining "soft-delete", "Regional Manager", or "Scope" — these are already-proposed canonical
  terms sourced to `SPEC-CRM-001` and `SPEC-AUTH-001` respectively (Actors and Terminology).

## Evidence and Traceability

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-USERS-001` `backend-users` exposes five `User` CRUD routes under `/api/v1/users`, all behind `authMiddleware` | `backend/src/modules/users/routes.ts:6-14`; `backend/src/routes/v1/index.ts:23` | Current repository | Confirmed current-state |
| `REQ-USERS-002` `User` has fields id, email (unique), password_hash, first_name, last_name, phone (unique, nullable), profile_photo_url, role (`UserRole`, default WORKER), permissions (`String[]`), is_active, email_verified_at, phone_verified_at, last_login_at, deleted_at, created_at, updated_at | `backend/prisma/schema.prisma:117-155` | Current repository | Confirmed current-state |
| `REQ-USERS-003` `UserRole` enum has exactly 4 values: WORKER, CHECKER, MANAGER, ADMIN | `backend/prisma/schema.prisma:22-27` | Current repository | Confirmed current-state; **gap vs 5-role target (`OQ-USERS-01`)** |
| `REQ-USERS-004` `User` is indexed on `role`, `is_active`, `deleted_at` | `backend/prisma/schema.prisma:152-154` | Current repository | Confirmed current-state |
| `REQ-USERS-005` create/update/delete/view each write an `AuditLog` row via the shared audit framework | `service.ts:81 (VIEW), 116 (MODIFY/create), 155 (MODIFY/update), 169 (DELETE)`; `backend/src/lib/base-service.ts:7-31` | Current repository | Confirmed current-state |
| `REQ-USERS-006` Delete is a soft-delete (`is_active=false`, `deleted_at=now()`), not a physical delete | `service.ts:159-170` | Current repository | Confirmed current-state |
| `REQ-USERS-007` `POST /` and `PUT /:user_id` gate on `requireRole(['admin','manager'])` AND `requirePermission('users:write')` | `routes.ts:11,13` | Current repository | Confirmed current-state |
| `REQ-USERS-008` `ROLE_PERMISSIONS.MANAGER` grants `users:read` but not `users:write`/`users:delete`; only `ADMIN` holds all three (plus the `admin:*` wildcard) | `backend/src/config/constants.ts:88-129`, specifically `:89-102` (ADMIN) vs `:103-114` (MANAGER) | Current repository | Confirmed current-state; **drives `RULE-USERS-05` / `OQ-USERS-02`** |
| `REQ-USERS-009` `requirePermission` reads `req.auth.permissions`, populated from the JWT access-token payload at `authMiddleware` time, not re-queried from the DB per request | `backend/src/middleware/auth.ts:23-28`; `backend/src/middleware/permissions.ts:7-27` | Current repository | Confirmed current-state |
| `REQ-USERS-010` The JWT `permissions` claim is a **snapshot** of `ROLE_PERMISSIONS[role]` taken at token-issuance time (login/signup/refresh), not re-derived on every request | `backend/src/modules/auth/service.ts:37-42,88-93,143-148`; `backend/src/lib/jwt.ts:5-12,27-33,44-51` | Current repository | Confirmed current-state |
| `REQ-USERS-011` `createUser` accepts `data.role` from `CreateUserSchema` (worker\|checker\|manager\|admin, default worker) and creates the row with that role directly; no role-elevation guard exists | `backend/src/modules/users/types.ts:3-10`; `service.ts:85-118` (no guard) | Current repository | Confirmed current-state; **`OQ-USERS-03`** |
| `REQ-USERS-012` `updateUser` blocks a non-admin actor from setting `role: 'admin'` | `service.ts:124-127` | Current repository | Confirmed current-state; contrasted with `REQ-USERS-011` (`OQ-USERS-03`) |
| `REQ-USERS-013` No `users` route calls `checkHotelAccess()`; `listUsers`'s `hotel_id` filter is an optional query parameter — omitted, it returns users across every hotel | `backend/src/modules/users/routes.ts:6-14` (grep confirms no `checkHotelAccess` import/call); `service.ts:9,16`; `types.ts:24` | Current repository | Confirmed current-state; **`OQ-USERS-05`** |
| `REQ-USERS-014` `GET /` and `GET /:user_id` gate on `requirePermission('users:read')` only (no `requireRole`); only ADMIN and MANAGER hold `users:read` per `ROLE_PERMISSIONS` — WORKER and CHECKER do not | `routes.ts:10,12`; `constants.ts:91,113` (present) vs `:115-128` (absent for CHECKER/WORKER) | Current repository | Confirmed current-state; feeds `OQ-USERS-05` |
| `REQ-USERS-015` `getUser` performs no hotel/roster check of any kind — it is a bare `findUnique` by `id` | `service.ts:61-83` | Current repository | Confirmed current-state; feeds `OQ-USERS-05` |
| `REQ-USERS-016` `deleteUser` gates on `requireRole('admin')` only, with **no** `requirePermission('users:delete')` guard, although that permission token exists and is granted to ADMIN | `routes.ts:14`; `constants.ts:91` | Current repository | Confirmed current-state; not independently exploitable (`RULE-USERS-06`) |
| `REQ-USERS-017` `deleteUser` refuses self-deletion | `service.ts:162` (`if (userId === actorId) throw ForbiddenError`) | Current repository | Confirmed current-state |
| `REQ-USERS-018` `User.deleted_at` carries the schema comment "GDPR soft delete — keep row, null PII via separate job"; no PII-nulling job or mechanism exists anywhere in the repository | `backend/prisma/schema.prisma:131`; repo-wide grep for `null.{0,20}PII\|anonymiz\|retention.{0,10}job` across `backend/src` → 0 matches | Current repository | Confirmed current-state; **gap (`OQ-USERS-06`)** |
| `REQ-USERS-019` `state-user` (the `User` model) has two writers: `backend-auth` (create at signup, `service.ts:25`; `password_hash` update at password-reset, `service.ts:205`; identity-field update at self-service `updateProfile`, `service.ts:218`) and `backend-users` (this module's full CRUD); `authoritative_writer: UNKNOWN` | `.claude/knowledge/DEPENDENCY_GRAPH.yaml:428-434` (records the aggregate line list `auth/service.ts:25,205,218` without per-line gloss; this spec independently verified and attributes each line above); `users/service.ts:93,132,164` (`93` create, `132` update, `164` delete — consistent with the graph) | Generated (repo-derived) | Confirmed current-state; already tracked platform-wide as `SYNC-005`/`SIR-GLOB-006` — **disclosed, not resolved (`OQ-USERS-04`)** |
| `REQ-USERS-020` No frontend or mobile client currently calls any `/users` route | repo-wide grep `-i "users"` on `frontend/lib/api.ts`, `mobile/checker-app/src/lib/api.ts`, `mobile/worker-app/src/lib/api.ts` → 0 matches in all three; `.claude/knowledge/DEPENDENCY_GRAPH.yaml` records no `consumes-api` edge targeting `backend-users` | Current repository | Confirmed current-state (absence of evidence, independently verified, not merely assumed) |
| `REQ-USERS-021` The confirmed target role model has exactly 5 roles (Staff/Worker, Checker, Hotel Manager, Regional Manager, Admin); no Supervisor role; Regional Manager is new | CRR §1 (lines 13-24, specifically 15,19) | Authoritative (business) | Confirmed target; **gap vs `REQ-USERS-003` (`OQ-USERS-01`)** |
| `REQ-USERS-022` Target role×scope table: Staff=self only; Checker=assigned hotel; Hotel Manager=one hotel; Regional Manager=all hotels in their group; Admin=all, including account deletion | PDD §4.1 (lines 84-90); §5.4 (lines 171-180, specifically the table at 173-179 and "account deletion" at 179) | Authoritative (business) | Confirmed target; **gap — no `scope` field on `User`/JWT (`OQ-USERS-05`)** |
| `REQ-USERS-023` Authorization target model is deny-by-default; cross-hotel access requires the actor's scope to include the target hotel; special-category fields sit behind a restricted, audit-logged sub-permission | PDD §5.4 (line 180) | Authoritative (business) | Confirmed target; not enforced today (`OQ-USERS-05`) |
| `REQ-USERS-024` Token claims target shape is `user_id`, `role`, `scope` | PDD §5.3 (line 170) — cited only for the claims-shape fact; Authentication itself is `SPEC-AUTH-001`'s scope | Authoritative (business) | Confirmed target; current JWT carries `sub,email,role,permissions,iat,exp` (`backend/src/lib/jwt.ts:5-12`), no `scope` |
| `Soft-delete` is canonically defined by `SPEC-CRM-001` as "sets `is_active=false` and records `deleted_at`" | `docs/03-modules/crm/MODULE_SPEC.md` Actors and Terminology; `.claude/knowledge/TERMINOLOGY.md:41` | Documentation (canonical, proposed) | `backend-users`' `deleteUser` matches this pattern exactly (`service.ts:164-167`); reused, not redefined |
| `Regional Manager` / `Scope` are already-proposed canonical terms sourced to `SPEC-AUTH-001` | `.claude/knowledge/TERMINOLOGY.md:36-37` | Documentation (canonical, proposed) | Reused, not redefined, here |
| No pending Decision Record in `DECISION_INDEX.md` currently names `backend-users` | `.claude/knowledge/DECISION_INDEX.md` (full read) — only `SPEC-CRM-001`-sourced pending decisions listed | Generated (repo-derived) | Confirmed absent |

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| `User` | The Prisma account record this module CRUDs: credential/identity fields, role, derived `permissions` array, active/soft-delete state. **Shared-write state** — see `REQ-USERS-019`. | `schema.prisma:117-155`; `DEPENDENCY_GRAPH.yaml:428-434` |
| Worker / Checker / Manager / Admin | Role tokens on `UserRole`; canonical terms already proposed by `SPEC-AUTH-001` (`TERMINOLOGY.md:25-28`) — definition unresolved pending human ratification. Reused here, not redefined. | `schema.prisma:22-27`; `SPEC-AUTH-001` |
| Regional Manager | `[TARGET]` new 5th role; no `UserRole` token exists yet. Canonical term proposed by `SPEC-AUTH-001` (`TERMINOLOGY.md:37`). Reused here, not redefined. | CRR §1; PDD §4.1; `SPEC-AUTH-001` |
| Scope | `[TARGET]` the hotel or hotel-group an actor may act within, to be carried on the access token. Canonical term proposed by `SPEC-AUTH-001` (`TERMINOLOGY.md:36`). Reused here, not redefined. | PDD §5.3, §5.4; `SPEC-AUTH-001` |
| `permissions` array | Denormalized `String[]` on `User`, set from `ROLE_PERMISSIONS[role]` at create/role-change time by this module (and independently at signup by `backend-auth`), and copied onto the JWT at token-issuance time by `backend-auth`. Not independently definable apart from `ROLE_PERMISSIONS`. | `schema.prisma:126`; `constants.ts:88-129`; `service.ts:90-91,129-130` |
| `ROLE_PERMISSIONS` | The static role→permission-token map this module reads (never writes) to derive `User.permissions`; the same map `backend-auth` reads for the JWT snapshot. Owner is `unassigned`; the map itself lives in shared config, not in either module. | `constants.ts:88-129` |
| Soft-delete | Deactivation that sets `is_active=false` and records `deleted_at`, preserving the row and its history. Canonically defined by `SPEC-CRM-001` (`TERMINOLOGY.md:41`); this module's `deleteUser` matches the pattern exactly. The schema's additional "null PII via separate job" comment (`schema.prisma:131`) names a GDPR-specific follow-on mechanism that is module-specific to `User` and has no implementation (`OQ-USERS-06`) — this module-specific fact does not alter the reused canonical definition. | `service.ts:159-170`; `schema.prisma:131`; `SPEC-CRM-001` |
| `auth-middleware` | In-process contract (`authMiddleware`/`optionalAuthMiddleware`) owned by `backend-auth`; consumed by this module on every route (`routes.ts:8`). Definition unresolved, proposed by `SPEC-AUTH-001`. | `middleware/auth.ts`; `TERMINOLOGY.md:34` |
| `permissions-middleware` | In-process contract (`requireRole`/`requirePermission`/`checkHotelAccess`) owner `unassigned`, distinct from `auth-middleware`; consumed by this module on every write/read-permission-gated route. Definition unresolved, proposed by `SPEC-AUTH-001`. | `middleware/permissions.ts`; `TERMINOLOGY.md:35` |
| Response envelope | `{ status, data, pagination?, meta:{ timestamp, request_id } }` — the platform response shape returned by this module's endpoints | `controller.ts:14-19,30-34,46-51,63-68` |

## Requirements and Acceptance Criteria

`REQ-USERS-001..020` describe **Current Repository Behaviour**. `REQ-USERS-021..024` describe
**Target Behaviour** confirmed by CRR/PDD. Migration gaps between them are enumerated in State and
Lifecycle → Migration Gaps and in Risks/Open Decisions.

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| `REQ-USERS-001` (Current) | Expose `User` CRUD under `/api/v1/users`, all authenticated. | MUST | The five routes at `routes.ts:10-14` require a valid bearer token (`authMiddleware`, `routes.ts:8`); an unauthenticated call to any of them returns 401. | `RULE-USERS-01` |
| `REQ-USERS-002` (Current) | Maintain the `User` entity with its confirmed field set. | MUST | A `User` row carries exactly the fields in `REQ-USERS-002`'s evidence row; `role` defaults to `WORKER`; `permissions` is a string array; `phone` is unique-when-present. | `RULE-USERS-01` |
| `REQ-USERS-003` (Current) | List users with pagination and filters. | MUST | `GET /` returns a paginated, `deleted_at:null`-filtered list; supports `role`, `hotel_id`, `search` (first/last name or email, case-insensitive), `is_active`; ordered by `created_at desc`; response includes `pagination{page,per_page,total,total_pages,has_next,has_prev}`. | `RULE-USERS-02` |
| `REQ-USERS-004` (Current) | Get a single user by id. | MUST | `GET /:user_id` returns the user with `role` lowercased and `deleted_at` stripped from the payload; a soft-deleted or missing user 404s; a `VIEW` audit row is written. | `RULE-USERS-03` |
| `REQ-USERS-005` (Current) | Create a user. | MUST | `POST /` validates via `CreateUserSchema` (email, password min 8, first/last name, optional phone, role enum default worker); rejects a duplicate email with 409; hashes the password with `BCRYPT_ROUNDS=12`; sets `permissions` from `ROLE_PERMISSIONS[role]`; writes a `MODIFY` audit row. | `RULE-USERS-04`, `RULE-USERS-05` |
| `REQ-USERS-006` (Current) | Update a user. | MUST | `PUT /:user_id` validates via `UpdateUserSchema` (all fields optional: first/last name, phone, role, is_active); 404 if missing/soft-deleted; a non-admin actor supplying `role:'admin'` gets 403; on role change, `permissions` is re-derived from `ROLE_PERMISSIONS[newRole]`; writes a `MODIFY` audit row naming the changed field keys. | `RULE-USERS-05`, `RULE-USERS-07` |
| `REQ-USERS-007` (Current) | Delete a user by soft-delete only. | MUST | `DELETE /:user_id` sets `is_active=false` and `deleted_at=now()`; the row persists; self-deletion is refused with 403; a `DELETE` audit row is written; no PII field is nulled by this or any other path. | `RULE-USERS-06`, `RULE-USERS-08` |
| `REQ-USERS-008` (Current) | Gate write routes on both role and permission. | MUST | `POST /` and `PUT /:user_id` require `requireRole(['admin','manager'])` **and** `requirePermission('users:write')` in sequence; **because `ROLE_PERMISSIONS.MANAGER` excludes `users:write` (`REQ-USERS-008` evidence row), a manager-role actor passes the role gate and is then denied by the permission gate — net effect, only Admin can reach `createUser`/`updateUser` over HTTP today** (`OQ-USERS-02`). | `RULE-USERS-05` |
| `REQ-USERS-009` (Current) | Gate delete on role only. | MUST | `DELETE /:user_id` requires `requireRole('admin')`; no `requirePermission` check is applied; net effect is unchanged (Admin-only) since only `admin` passes the role gate regardless. | `RULE-USERS-06` |
| `REQ-USERS-010` (Current) | Gate reads on permission only. | MUST | `GET /` and `GET /:user_id` require only `requirePermission('users:read')`; per `ROLE_PERMISSIONS`, only ADMIN and MANAGER hold this token — WORKER and CHECKER are denied with 403. | `RULE-USERS-02`, `RULE-USERS-03` |
| `REQ-USERS-011` (Current) | Enforce no hotel/roster scope on any route. | MUST (as observed) | No `users` route imports or calls `checkHotelAccess()`; `listUsers`'s `hotel_id` is optional (omitted ⇒ all hotels); `getUser` performs no hotel check at all. Combined with `REQ-USERS-010`, any actor holding `users:read` (Admin, Manager) can list or fetch any user at any hotel. **Recorded as a business-fact/risk (`OQ-USERS-05`); no control is invented here.** | `RULE-USERS-09` |
| `REQ-USERS-012` (Current) | `createUser` performs no role-elevation guard. | MUST (as observed) | `CreateUserSchema.role` accepts worker\|checker\|manager\|admin (default worker); the service creates the row with that role directly, with no analog to `updateUser`'s admin-only-can-grant-admin check. Under `REQ-USERS-008`'s current role/permission mismatch, only Admin can reach this route at all today, so the gap is not independently exploitable via the current route configuration; it is a defense-in-depth asymmetry that would become independently exploitable if `OQ-USERS-02` were resolved by granting `MANAGER` the `users:write` permission without also adding this guard. **Recorded as a business-fact/risk (`OQ-USERS-03`); no control is invented here.** | `RULE-USERS-05` |
| `REQ-USERS-021` (Target) | Support exactly 5 roles: Staff/Worker, Checker, Hotel Manager, Regional Manager, Admin. | MUST | `UserRole` (or its replacement) carries 5 tokens including Regional Manager; no Supervisor token exists. **Not implemented — enum has 4 (`OQ-USERS-01`).** | `RULE-USERS-10` |
| `REQ-USERS-022` (Target) | Enforce the confirmed role×scope data-visibility table. | MUST | Staff sees only self; Checker is scoped to their assigned hotel; Hotel Manager to one hotel; Regional Manager to all hotels in their group; Admin to all (including account deletion). **Not implemented — no `scope` concept exists on `User` or the JWT (`OQ-USERS-05`).** | `RULE-USERS-10`, `RULE-USERS-11` |
| `REQ-USERS-023` (Target) | Deny-by-default; audit special-category field access. | MUST | Every action is denied unless explicitly scoped-in; any special-category field (e.g. Konfession, disability — owned by HR/employee-management, not this module's own fields) is gated behind a restricted, audit-logged sub-permission. **`backend-users`' own fields carry no special-category data today; this row records the target authorization posture this module's checks must eventually satisfy.** | `RULE-USERS-11` |
| `REQ-USERS-024` (Target) | Carry `user_id`, `role`, `scope` on the token. | MUST | Access-token claims include a `scope` value in addition to `user_id`/`role`. **Not implemented — current JWT has no `scope` claim (`backend/src/lib/jwt.ts:5-12`); token issuance itself is `SPEC-AUTH-001`'s scope, cited here only for the claims-shape fact this module's authorization ultimately depends on.** | `RULE-USERS-11` |

## Business Rules

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| `RULE-USERS-01` | `User` row exists | Exactly the confirmed field set (`REQ-USERS-002`); `role` default WORKER; indexed on `role`/`is_active`/`deleted_at` | — | This module (Current: `schema.prisma:117-155`) |
| `RULE-USERS-02` | `GET /` requested by an actor holding `users:read` | Returns `deleted_at:null` rows only, filtered/paginated per query, ordered `created_at desc`; role values returned lowercased | Non-`users:read` actor (Worker, Checker) → 403 before the service runs | This module (Current: `service.ts:8-59`) |
| `RULE-USERS-03` | `GET /:user_id` requested by an actor holding `users:read` | Returns the user (role lowercased, `deleted_at` stripped) and writes a `VIEW` audit row; a missing or soft-deleted user 404s | Non-`users:read` actor → 403 before the service runs | This module (Current: `service.ts:61-83`) |
| `RULE-USERS-04` | `POST /` reaches the service (i.e. actor is effectively Admin — see `RULE-USERS-05`) | A duplicate email 409s; password is bcrypt-hashed at `BCRYPT_ROUNDS=12`; `permissions` is set from `ROLE_PERMISSIONS[role.toUpperCase()]` (fallback `ROLE_PERMISSIONS['WORKER']` if the map lookup is falsy); a `MODIFY` audit row is written | No role-elevation guard exists on this path (`OQ-USERS-03`) | This module (Current: `service.ts:85-118`) |
| `RULE-USERS-05` | `POST /` or `PUT /:user_id` requested | Route requires `requireRole(['admin','manager'])` **and** `requirePermission('users:write')` in sequence. Because `MANAGER` lacks `users:write` (`constants.ts:103-114`), a manager passes the first gate and fails the second — **net effect, only Admin (via the `admin:*` wildcard bypass in `requirePermission`, `permissions.ts:18`) can create or update users today.** The route's inclusion of `manager` in the role list is dead intent under the current permission map. | `manager`-role actors are denied with 403 at the permission gate, never reaching the service | This module + shared `ROLE_PERMISSIONS`/`permissions-middleware` (Current: `routes.ts:11,13`; `constants.ts:88-129`; `permissions.ts:7-27`) |
| `RULE-USERS-06` | `DELETE /:user_id` requested | Route requires `requireRole('admin')` only, no `requirePermission('users:delete')` gate (that permission token exists, `constants.ts:91`, but is unused by any route). Net effect is unchanged from a permission-gated route, since only `admin` can pass `requireRole('admin')` regardless. Soft-deletes (`is_active=false`, `deleted_at=now()`); refuses self-deletion (403); writes a `DELETE` audit row. | Missing/already-deleted user → 404; `userId===actorId` → 403 | This module (Current: `routes.ts:14`; `service.ts:159-170`) |
| `RULE-USERS-07` | `PUT /:user_id` reaches the service (i.e. actor is effectively Admin — see `RULE-USERS-05`) | `data.role==='admin' && actorRole!=='admin'` → 403 (`ForbiddenError`); on any role change, `permissions` is re-derived from `ROLE_PERMISSIONS[newRole]` (fallback: unchanged `user.permissions`); other fields (`first_name`,`last_name`,`phone`,`is_active`) default to the existing value when omitted; a `MODIFY` audit row names the changed field keys | Missing/soft-deleted target → 404 | This module (Current: `service.ts:120-157`) |
| `RULE-USERS-08` | User soft-deleted | Row persists; `is_active=false`, `deleted_at` set; no PII field is nulled by this module or by any other mechanism found in the repository (`REQ-USERS-018`), despite the schema comment naming a "separate job" | Re-activation path: none observed — `updateUser` on an already-soft-deleted target 404s before any field write (`service.ts:121-122`), so `is_active` cannot be flipped back via the update path either; no un-delete path exists | This module (Current: `service.ts:159-170`; `schema.prisma:131`) |
| `RULE-USERS-09` | Any `users:read`-gated route request | No hotel-membership or hotel-ownership check narrows the result: `listUsers`'s `hotel_id` filter is opt-in (omitted ⇒ every hotel); `getUser` performs no hotel check of any kind. The reachable actor set is exactly {Admin, Manager} (`RULE-USERS-02`/`03`). | `hotel_id` supplied ⇒ `listUsers` narrows via an ACTIVE `HotelWorker` join (`service.ts:16`); `getUser` has no equivalent narrowing parameter at all | This module (Current: `service.ts:8-16,61-83`); business-fact recorded under `OQ-USERS-05` |
| `RULE-USERS-10` | Target 5-role model in force (unimplemented) | `UserRole` carries 5 tokens; Regional Manager sees all Hotel-Manager-visible data across their group | Not enforced today (`OQ-USERS-01`) | Target (CRR §1; PDD §4.1) |
| `RULE-USERS-11` | Target role×scope authorization in force (unimplemented) | Every user-management action checks both role and whether the actor's scope includes the target user's hotel/group; special-category fields require an additional restricted, audit-logged sub-permission | Not enforced today; no `scope` claim, no 5th role (`OQ-USERS-01`, `OQ-USERS-05`) | Target (PDD §5.3, §5.4) |

## Ownership and Boundaries

**Module owner:** `unassigned` — accountable owner assignment is reserved human authority
(SYNC-001; no `CODEOWNERS`, empty `backend/package.json:23` author). Code home is
`backend/src/modules/users`, registered id `backend-users`, `lifecycle: active`,
`implementation_status: active`, `dependencies: []` (`.claude/knowledge/MODULE_REGISTRY.yaml:47-57`).

**Owned state:**

- **Current (shared — see below):** `User` (`schema.prisma:117`; `state-user`,
  `.claude/knowledge/DEPENDENCY_GRAPH.yaml:428-434`). All columns per `REQ-USERS-002`. This module
  performs the full administrative CRUD surface (list/get/create/update/soft-delete).
- **Target:** No new state domain is confirmed exclusively for this module; the target obligation
  is to converge the existing `User`/role/permissions fields onto the 5-role, scope-bearing model
  (`REQ-USERS-021..024`), not to introduce a new owned entity.

**Consumed state (owned elsewhere, referenced never redefined):**

- `HotelWorker` (owner `backend-hotel-workers`) — read only, as an optional join filter in
  `listUsers` (`service.ts:16`, `where.hotel_workers = { some: { hotel_id, status: 'ACTIVE' } }`).
  This module never writes `HotelWorker`.
- `ROLE_PERMISSIONS` (shared config, `constants.ts:88-129`) — read only, to derive `User.permissions`
  on create/role-change. This module does not own or write this map.

**Permitted writes:** only `User` (create/update/soft-delete) and `AuditLog` (append-only, via
shared `BaseService.logAudit`). This module never writes `HotelWorker`, `Session`, `Hotel`, or any
other module's state.

**Shared-write disclosure (`SYNC-005` / `SIR-GLOB-006`):** `state-user` has **two writers**:
`backend-auth` (creates `User` at signup, `auth/service.ts:25`; overwrites `password_hash` at
password-reset, `auth/service.ts:205`; also updates identity fields via self-service
`updateProfile`, `auth/service.ts:218`) and `backend-users`
(this module's full CRUD, `service.ts:93` create, `132` update, `164` delete).
`authoritative_writer: UNKNOWN` (`.claude/knowledge/DEPENDENCY_GRAPH.yaml:428-434`). This is already
tracked platform-wide (`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-GLOB-006`,
`SYNC-005`; also disclosed from the other side by `SPEC-AUTH-001` `auth/MODULE_SPEC.md:65,93,161,265`).
**This spec discloses the fact and does not resolve it** — single-authoritative-writer designation
is reserved human/architecture authority (`OQ-USERS-04`).

**Readers of owned state:** `backend-hotel-workers` reads `User`
(`.claude/knowledge/DEPENDENCY_GRAPH.yaml:217-223`, `hotel-workers/service.ts:40`,
`this.prisma.user.findUnique`). No other module or client is a recorded reader of `User` via this
module's contract. `backend-auth` also reads `User` as part of its own login/refresh/profile flows
(out of scope here; see `SPEC-AUTH-001`).

**Boundary/non-responsibilities:**

- This module does **not** implement authentication, JWT issuance/verification, session lifecycle,
  password reset, or MFA — all `backend-auth`/`SPEC-AUTH-001`.
- This module does **not** implement or own the RBAC/scope framework itself
  (`permissions-middleware`, owner `unassigned`) — it is a consumer of that contract, not its owner.
- This module does **not** implement hotel-membership scoping (`checkHotelAccess()` exists in the
  shared `permissions-middleware` file but is never imported or called anywhere in
  `backend/src/modules/users/routes.ts` — independently verified; `REQ-USERS-013`).
- **Ownership challenge (Boundary Loop):**
  - `User` — Owner: **UNKNOWN** (dual writer, `SYNC-005`). Writers: `backend-auth`,
    `backend-users`. Readers: `backend-hotel-workers`. Consumers: none observed
    (`REQ-USERS-020`). **Unproven single ownership — escalated, not invented (`OQ-USERS-04`).**
  - `AuditLog` (user-action rows) — Owner: **UNKNOWN** (shared writer via `BaseService`,
    identical to the platform-wide `state-audit-log` gap already tracked at `SIR-GLOB-006`
    for every module using `BaseService.logAudit`; not a `backend-users`-specific fact).
  - `ROLE_PERMISSIONS` map — Owner: **UNKNOWN** (lives in shared `config/constants.ts`, read by
    both `backend-auth` and `backend-users`; neither module writes it; no module is recorded as
    its owner in `MODULE_REGISTRY.yaml`).

## Interfaces and Contracts

All contracts are **Current Repository Behaviour**. Direction is relative to this module.
Transport is REST/JSON over the platform response envelope; the API is unversioned in code beyond
the `/api/v1` mount. Authorization tokens carry a lowercased role string
(`auth/service.ts:40,62,91,113,146` — `user.role.toLowerCase()`) and a `permissions[]` array
snapshotted at token-issuance time (`REQ-USERS-010`).

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `IF-USERS-ListUsers / v1` | Inbound (query) `GET /api/v1/users` | `page`(≥1, def 1), `limit`(1–100, def 20), `role?`(worker\|checker\|manager\|admin), `hotel_id?`, `search?`, `is_active?`('true'\|'false') | `{status, data:User[], pagination:{page,per_page,total,total_pages,has_next,has_prev}, meta}` | 401 unauthenticated; 403 missing `users:read`; 422 invalid query (Zod `validateQuery` → `ValidationError` → `UNPROCESSABLE_ENTITY`, `middleware/validation.ts:25-43`; `lib/errors.ts:21-27`) | `authMiddleware` + `requirePermission('users:read')` | Current (`routes.ts:10`; `controller.ts:8-24`; `service.ts:8-59`) |
| `IF-USERS-GetUser / v1` | Inbound (query) `GET /api/v1/users/:user_id` | path `user_id` | `{status, data:User, meta}`; writes a `VIEW` audit row | 401; 403 missing `users:read`; 404 not found/soft-deleted | `authMiddleware` + `requirePermission('users:read')` | Current (`routes.ts:12`; `controller.ts:26-38`; `service.ts:61-83`) |
| `IF-USERS-CreateUser / v1` | Inbound (command) `POST /api/v1/users` | body `{email, password(min 8), first_name, last_name, phone?, role?='worker'}` | `201 {status, data:User, meta}`; writes a `MODIFY`(create) audit row | 401; 403 (role-gate pass + permission-gate fail for non-admin — see `RULE-USERS-05`); 409 duplicate email; 422 invalid body | `authMiddleware` + `requireRole(['admin','manager'])` + `requirePermission('users:write')` — **net effect Admin-only** (`OQ-USERS-02`) | Current (`routes.ts:11`; `controller.ts:40-55`; `service.ts:85-118`) |
| `IF-USERS-UpdateUser / v1` | Inbound (command) `PUT /api/v1/users/:user_id` | path `user_id`; body any of `{first_name?, last_name?, phone?, role?, is_active?}` | `{status, data:User, meta}`; writes a `MODIFY`(field keys) audit row | 401; 403 (role-gate pass + permission-gate fail for non-admin, `RULE-USERS-05`; or a non-admin attempting `role:'admin'`, `RULE-USERS-07`); 404 not found/soft-deleted; 422 invalid body | `authMiddleware` + `requireRole(['admin','manager'])` + `requirePermission('users:write')` — **net effect Admin-only** (`OQ-USERS-02`) | Current (`routes.ts:13`; `controller.ts:57-72`; `service.ts:120-157`) |
| `IF-USERS-DeleteUser / v1` | Inbound (command) `DELETE /api/v1/users/:user_id` | path `user_id` | `204 No Content`; soft-delete; writes a `DELETE` audit row | 401; 403 (non-admin, or self-delete attempt); 404 not found/already-deleted | `authMiddleware` + `requireRole('admin')` (**no** `requirePermission` guard, `RULE-USERS-06`) | Current (`routes.ts:14`; `controller.ts:74-82`; `service.ts:159-170`) |

**Observed contract drift (Reconciliation) — see also Risks/Open Decisions for severity-neutral
disclosure of each:**

- **Manager write authority (`OQ-USERS-02`):** identical shape to `SPEC-CRM-001`'s `OD-CRM-02`/
  `OD-CRM-07` — the route-level role gate names `manager` but the permission map denies `manager`
  the corresponding write permission, so only Admin can actually reach `createUser`/`updateUser`.
- **No role-elevation guard on create (`OQ-USERS-03`):** `updateUser` explicitly blocks
  non-admin→admin role assignment; `createUser` has no equivalent, relying solely on the (currently
  Admin-only, per the above) route gate as its only defense.
- **No hotel scoping on any route (`OQ-USERS-05`):** unlike `checkHotelAccess()` usage in other
  modules (e.g. `crm`, `quality`, `attendance`), no `users` route calls it; Admin and Manager (the
  only `users:read` holders) can list or fetch any user at any hotel.

## Events

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| — (none) | — | — | — | — | — |

**No domain events are published or consumed by this module.** `MODULE_REGISTRY.yaml:54-55` records
`published_events: none-observed` / `consumed_events: none-observed` for `backend-users`; no event
bus, broker, or pub/sub mechanism exists anywhere in the repository
(`.claude/knowledge/DEPENDENCY_GRAPH.yaml:417-423`: "publishes/consumes relationships are: NONE —
verified absent"). The only externally-visible side effect of a user mutation is an append to
`AuditLog` (`RULE-USERS-04`/`06`/`07`), which is a state write, not an event. `backend-users`
performs no notification-service calls, unlike `quality`/`attendance` (no
`sendNotification` import in `service.ts`, independently confirmed by reading the full file).

## Dependencies

Classification per edge — **Owns / Reads / Writes / Consumes / Produces / Compatibility / Failure**.

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `prisma-schema` (`User` model) | **Owns/Writes** `User` (shared with `backend-auth`); **Reads** it back | `prisma-schema` (unversioned shared contract, `.claude/knowledge/DEPENDENCY_GRAPH.yaml:340-356`) | compatible (reuse); **shared-write hazard on `User` specifically** (`SYNC-005`, `OQ-USERS-04`) | DB unavailable → all user operations fail (500); no degraded mode |
| `base-service` | **Produces** audit rows via `logAudit`; obtains shared `PrismaClient` | `base-service` (unversioned; `DEPENDENCY_GRAPH.yaml:353-370`) | compatible (reuse) | Audit-write failure propagates after the mutation has already committed; no compensating rollback observed (`service.ts:116,155,169` each call `logAudit` after the Prisma write) |
| `auth-middleware` | **Consumes** authenticated identity (`req.auth`) on every route | `auth-middleware` (owner `backend-auth`; `DEPENDENCY_GRAPH.yaml:372-391`) | compatible (reuse) | No/invalid token → 401 before the service runs |
| `permissions-middleware` | **Consumes** `requireRole`/`requirePermission` guards on all five routes; does **not** consume `checkHotelAccess` (`REQ-USERS-013`) | `permissions-middleware` (owner `unassigned`; `DEPENDENCY_GRAPH.yaml:394-406`) | compatible (reuse); **conditional** where the role/permission map disagree (`OQ-USERS-02`) | Guard denial → 403 before the service runs |
| `validation-middleware` | **Consumes** `validateBody`/`validateQuery` (zod) on list/create/update | `validation-middleware` (`DEPENDENCY_GRAPH.yaml:409-415`) | compatible (reuse) | Invalid input → 422 before the service runs |
| `ROLE_PERMISSIONS` (shared config) | **Reads** the role→permission map to derive `User.permissions`; same map `backend-auth` reads for the JWT snapshot | in-process shared constant, no registry contract entry | compatible (reuse); shared with `backend-auth`, owner `unassigned` | A `role` not present in the map falls back to `ROLE_PERMISSIONS['WORKER']` on create (`service.ts:91`) or leaves `user.permissions` unchanged on update (`service.ts:130`) — no error path |
| `backend-hotel-workers` → `HotelWorker` | **Reads** an ACTIVE `HotelWorker` row, as an optional join filter in `listUsers` | reads-state (in-process Prisma relation query, `service.ts:16`) | compatible (reuse, read-only) | Missing/renamed `HotelWorker` fields would break this filter path (backward-compat constraint on any `hotel-workers` schema change) |
| `backend-auth` ↔ `User` (shared-write) | **Both modules write** `User`; `backend-auth` creates at signup and updates `password_hash` at reset; `backend-users` performs the full CRUD | shared Prisma model, no versioned contract between the two modules | **conditional — dual-writer, `authoritative_writer: UNKNOWN`** (`SYNC-005`) | Concurrent writes from both modules to the same row are last-write-wins (no version column on `User`); no coordination mechanism observed |
| `backend-hotel-workers` → `User` (downstream reader, outbound) | Downstream **Reads** `User` for roster display (`hotel-workers/service.ts:40`) | reads-state (`DEPENDENCY_GRAPH.yaml:217-223`) | not-applicable (read-only) | Missing/renamed `User` fields this module returns would break the consumer (backward-compat constraint on any target field change) |
| No client consumer observed | `frontend/lib/api.ts` and both `mobile/*/src/lib/api.ts` files contain zero `/users` references (`REQ-USERS-020`) | — | not-applicable | — |

**Dependency-loop conclusion:** `backend-users` has **no outbound cross-module service calls**
(`MODULE_REGISTRY.yaml:53` `dependencies: []`) and **one inbound cross-module read**
(`backend-hotel-workers` reading `User`). Its distinguishing coupling, unlike every sibling module
examined for this spec, is the **inbound shared write** on its own primary entity from
`backend-auth` — a coupling this module cannot resolve unilaterally (`OQ-USERS-04`). The static
import graph is otherwise acyclic for this module.

## State and Lifecycle

### `User` record lifecycle (Current)

- **States:** `active` (`is_active=true`, `deleted_at=null`) and `inactive/soft-deleted`
  (`is_active=false`, `deleted_at` set).
- **Transitions:**
  - `(none) → active` — `createUser` (Admin-only in practice, `RULE-USERS-05`; `service.ts:85-118`),
    or `backend-auth`'s `signup` (out of scope, disclosed under `SYNC-005`).
  - `active → active` — `updateUser` field edits, including toggling `is_active` and reassigning
    `role`/`permissions` (`service.ts:120-157`).
  - `active → inactive` — `deleteUser` soft-delete (`service.ts:159-170`).
  - `inactive → active` — **no path exists.** `updateUser` 404s before any write when
    `user.deleted_at` is set (`service.ts:121-122`), so a soft-deleted user cannot be reactivated
    through this module. No other reactivation route is registered.
- **Invariants:** rows are never physically removed; `deleted_at` is monotonic once set (no
  un-set path, consistent with the above); `email` and `phone` (when present) remain globally
  unique even after soft-delete (the unique constraints are on the live column, not scoped to
  `deleted_at IS NULL`); `permissions` is always re-derived from `ROLE_PERMISSIONS[role]` at
  create time and at any update that changes `role`, never independently client-supplied.
- **Concurrency:** no optimistic-locking column on `User` (unlike `WorkRequest.version`); both
  this module's `updateUser` and `backend-auth`'s writes read-then-write without a shared
  transaction or lock, so a lost-update race between the two writers, or between two concurrent
  calls to this module, is possible (repository fact, not a business rule; compounds the
  `SYNC-005` dual-writer concern — `OQ-USERS-04`).
- **Retention:** soft-deleted `User` rows persist indefinitely in-repo. The schema comment at
  `schema.prisma:131` names an intended "null PII via separate job" GDPR mechanism; no such job,
  scheduled task, or code path exists anywhere in the repository at this revision
  (`REQ-USERS-018`). PDD §5.6 (cited by `SPEC-CRM-001` as governing employee/shift/payroll
  retention tiers, not read in full here per this task's scoping instruction) is the likely home
  for such a mechanism if one is designed; this spec does not assert its content.

### Target additions

- **5-role model + Regional Manager:** a new `UserRole` token and its associated
  `ROLE_PERMISSIONS` entry (CRR §1; PDD §4.1). Undefined mechanism in the repo (`OQ-USERS-01`).
- **`scope` claim:** a hotel/hotel-group scope value carried on the access token and, presumably,
  persisted or derivable per user (PDD §5.3, §5.4). No schema field, no JWT claim exists
  (`OQ-USERS-05`).
- **Deny-by-default + audited special-category access:** a stricter default authorization posture
  than today's route-level allow-list gating (PDD §5.4, line 180). Not implemented.

### Migration Gaps (Current → Target)

| Gap | Current | Target | Evidence |
|---|---|---|---|
| G-USERS-1 | `UserRole` enum has 4 tokens (WORKER/CHECKER/MANAGER/ADMIN) | 5 roles including Regional Manager | `schema.prisma:22-27` vs CRR §1 (line 15), PDD §4.1 (line 85) |
| G-USERS-2 | No `scope` field on `User`; no `scope` JWT claim | Token carries `user_id`,`role`,`scope`; role×scope table governs visibility | `jwt.ts:5-12` vs PDD §5.3 (line 170), §5.4 (lines 171-180) |
| G-USERS-3 | Route-level allow-list gating (`requireRole`/`requirePermission`), no hotel/group scope check on any route | Deny-by-default; cross-hotel access requires scope inclusion | `routes.ts:10-14` vs PDD §5.4 (line 180) |
| G-USERS-4 | `manager`-role actor cannot actually create/update users (`RULE-USERS-05`) despite Hotel Manager being a confirmed target actor with (unspecified) user-management-adjacent scope | Target role×scope table does not explicitly name user-account-management as a Hotel Manager action; whether Hotel Manager should manage users at their own hotel is unsettled by CRR/PDD | `routes.ts:11,13`; `constants.ts:103-114` vs PDD §5.4 table (lines 173-179) — **the target authorities do not resolve this gap either (`OQ-USERS-02`)** |
| G-USERS-5 | `createUser` has no role-elevation guard (`RULE-USERS-04`) | Target deny-by-default posture implies every privilege-granting write should be independently guarded | `service.ts:85-118` vs PDD §5.4 (line 180) — **`OQ-USERS-03`** |
| G-USERS-6 | No PII-nulling mechanism for soft-deleted users despite the schema's stated intent | GDPR-compliant retention/erasure mechanism (exact shape undefined by CRR/PDD at the sections read for this spec) | `schema.prisma:131` vs repo-wide absence — **`OQ-USERS-06`** |
| G-USERS-7 | `state-user` has two writers, `authoritative_writer: UNKNOWN` | A single authoritative writer per state domain (implied by the platform's stated architecture, not a specific CRR/PDD line) | `DEPENDENCY_GRAPH.yaml:428-434` — **`SYNC-005`/`OQ-USERS-04`** |

These are **pre-launch, additive/reconciling** changes (PDD §10: no production data, no dual-run
migration). None requires a destructive rewrite of existing `User` rows.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:**

- DB unavailable → all user operations return 500; no degraded/cached mode (single Prisma
  dependency).
- Get/update/delete on a missing or soft-deleted user → `NotFoundError` → 404
  (`service.ts:62-64(implicit via findUnique+check),79,122,161`).
- Duplicate email on create → `ConflictError` → 409 (`service.ts:86-87`).
- Concurrent updates (including races with `backend-auth`'s own writes to the same row) →
  last-write-wins; no version column, no transaction (see State and Lifecycle → Concurrency;
  `OQ-USERS-04`).
- Audit-write failure after a mutation has already committed → error surfaces post-write, no
  compensating rollback observed (`service.ts:116,155,169` call `logAudit` after the Prisma
  write/update/delete, not inside a shared transaction with it).

**Trust boundaries/authorization:** every route sits behind `authMiddleware`; per-route
`requireRole`/`requirePermission` enforce allow-list gating (`routes.ts:10-14`). Tokens carry a
lowercased role and a flat `permissions[]` snapshot taken at issuance time (`REQ-USERS-009`,
`REQ-USERS-010`); `admin:*` short-circuits `requirePermission` (`permissions.ts:18`) — ADMIN's
explicit permission list includes `admin:*` (`constants.ts:90`), so Admin always passes every
`requirePermission` gate on this module regardless of the specific token checked. **Current
authorization facts (recorded severity-neutral; a security reviewer assesses severity, not this
document):**
- The role-gate/permission-map mismatch on `POST /` and `PUT /:user_id` (`RULE-USERS-05`,
  `OQ-USERS-02`), structurally identical to `SPEC-CRM-001`'s `OD-CRM-02`/`OD-CRM-07`.
- The absent role-elevation guard on `createUser`, contrasted with `updateUser`'s explicit guard
  (`RULE-USERS-04`/`07`, `OQ-USERS-03`).
- The absence of any hotel/roster scoping on any route, combined with the actor set {Admin,
  Manager} who hold `users:read` and can therefore list or fetch any user at any hotel
  (`RULE-USERS-09`, `OQ-USERS-05`) — the same shape already documented for this repository's other
  modules at `SIR-ANLY-001` (`OQ-ANALYTICS-01`, Critical — no permission gate at all on the
  analogous analytics leaderboard) and `SIR-QUAL-003`/`SIR-QUAL-004` (`OQ-03`/`OQ-09`, Medium —
  `checkHotelAccess` bypass makes hotel scope a no-op for privileged roles). This module's own
  fact pattern differs from both precedents in mechanism (no `checkHotelAccess` call exists on any
  `users` route at all, rather than an existing call being bypassed) but shares the same
  cross-hotel-read-surface shape; severity is not assessed here.
- The unused `users:delete` permission token (`constants.ts:91`) — `DELETE /:user_id` is gated by
  role only, mirroring the analogous, already-documented `FIND-04` pattern in `SPEC-CRM-001`
  (inconsistent but not independently exploitable, since only `admin` passes `requireRole('admin')`
  regardless of the missing permission gate).
- The `state-user` dual-writer fact (`SYNC-005`) is itself a trust-boundary-adjacent concern:
  two independently-authored code paths (`backend-auth`, `backend-users`) can both mutate the same
  credential/role/permissions row with no shared invariant enforcement between them.

**Data classification/retention:** `User` carries **personal data** — email, name, phone,
password hash, role, permissions, verification timestamps, `profile_photo_url`. No special-category
(GDPR Art. 9) field exists directly on `User` in the current schema (special-category fields such
as Konfession/disability are owned elsewhere, per PDD §5.4's restricted-sub-permission requirement,
which this module's own fields do not yet need to satisfy). Germany-only operation is assumed
platform-wide (consistent with `SPEC-CRM-001`'s reading of PDD §5.7; not independently re-verified
here). **Retention:** the schema's stated GDPR soft-delete intent ("keep row, null PII via separate
job", `schema.prisma:131`) has no implementing mechanism anywhere in the repository (`OQ-USERS-06`)
— soft-deleted `User` rows retain their PII fields (email, name, phone, password hash) indefinitely
under current behavior.

**Performance budgets/workload:** no explicit SLO is defined in the authoritative documents.
`User` reads are indexed on `role`, `is_active`, `deleted_at` (`schema.prisma:152-154`); `email` and
`phone` are unique-indexed. `listUsers`'s `search` filter (`first_name`/`last_name`/`email`
case-insensitive `contains`, `service.ts:17-23`) has no covering expression/trigram index and will
sequential-scan, structurally identical to `SPEC-CRM-001`'s already-documented `search`-filter
index-coverage caveat (`FIND-02`/`FIND-03` there); not independently benchmarked here. Every
mutation's `logAudit` call is a second, non-transactional sequential DB round-trip on the request
path — the same shared, platform-wide `base-service` pattern already documented in
`SPEC-CRM-001`/`SPEC-QUAL-001`, not specific to this module. The workload is small (an
administrative account-management surface with, per `REQ-USERS-020`, no current client consumer at
all); no concrete budget is asserted (Constitution §6).

**Observability/audit:** view/create/update/delete are individually audit-logged with actor, role,
action, resource id, and details via the shared immutable `AuditLog` (`RULE-USERS-03/04/06/07`);
there is no admin-facing log viewer in this module. Request logging and request-id propagation are
provided globally (`meta.request_id` in every envelope, `controller.ts:18,33,49,66`).

## Rollout and Compatibility

This module's current CRUD surface is already live. Target work is **additive/reconciling**:
extend the role model to 5 tokens including Regional Manager, add a `scope` concept to the token
and to authorization checks, and resolve the role-gate/permission-map and role-elevation-guard
inconsistencies (`OQ-USERS-01/02/03/05`) — coordinated with `backend-auth`/`SPEC-AUTH-001`, which
owns token issuance and the 5-role/scope target design at the platform level. This module does not
independently redesign the RBAC/scope framework.

**Feature flags:** no `FEATURE_*` env-flag mechanism exists anywhere in the repository — the
identical factual gap already documented for `SPEC-CRM-001` (`OD-CRM-14`), `SPEC-NOTIF-001`
(`SIR-NOTIF-003`), and `SPEC-AUTH-001` (`SIR-AUTH-012`); not independently re-verified by a fresh
repo-wide grep in this authoring pass beyond noting the cross-spec precedent, since this is a
platform-wide fact, not a `backend-users`-specific one. Target-state work here has no existing flag
mechanism to attach to.

**Backward compatibility:** the only recorded reader of `User` via this module's contract is
`backend-hotel-workers` (read-only); no client consumer exists (`REQ-USERS-020`). Additive fields
(a future `scope` column, a 5th role token) are safe; removing or renaming currently-returned
fields would be breaking against that one reader, though contracts are unversioned
(baseline/UNKNOWN) so any change must be assessed against a future versioned baseline.

**Rollback:** pre-launch, no production data (PDD §10) — rollback is a version-control revert and
redeploy, not a feature-flag toggle, consistent with the CRM/Auth/Notifications precedent.

**Removal criteria:** not applicable — user account management is a foundational, permanently-owned
platform capability.

## Validation Plan

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| `User` field set matches `REQ-USERS-002`; `role` defaults WORKER (`REQ-USERS-001/002`) | Unit + schema check | Seed users | Field presence/default assertions |
| Five routes respond per envelope; list filters/pagination correct (`REQ-USERS-003`) | Unit + integration | Multi-role, multi-hotel seed | Route-response and filter/pagination coverage |
| View/create/update/delete each emit the correct audit action (`REQ-USERS-005`) | Unit | Mock Prisma | Audit-call assertions per action |
| Delete is soft (`is_active=false`, `deleted_at` set); row retained; self-delete refused (`REQ-USERS-007`) | Unit | Seed user | Update-args assertion; self-delete 403 assertion |
| Manager cannot reach `createUser`/`updateUser` under the current role/permission gate combination (`REQ-USERS-008`) | Authorization | Manager vs admin tokens | 403-for-manager, 2xx-for-admin evidence; flags `OQ-USERS-02` for disposition, not a pass/fail target by itself |
| Non-admin actor cannot set `role:'admin'` via update; equivalent guard is absent on create (`REQ-USERS-012`) | Authorization | Non-admin token, admin-role payload | 403 on update; create-path behavior recorded as-is (`OQ-USERS-03`), not asserted as a defect fix |
| `listUsers`/`getUser` return cross-hotel results when `hotel_id` is omitted or absent from the get path (`REQ-USERS-011`) | Authorization / integration | Multi-hotel seed, Admin and Manager tokens | Result-set spans hotels; evidence for `OQ-USERS-05` disposition |
| Worker/Checker denied `GET /` and `GET /:user_id` (`REQ-USERS-010`) | Authorization | Worker/Checker tokens | 403 assertion |
| `permissions` array is re-derived from `ROLE_PERMISSIONS` on create and on role-changing update, never client-supplied (`RULE-USERS-04/07`) | Unit | Role-change fixtures | `permissions` value assertion post-write |
| No PII-nulling mechanism exists for soft-deleted users (`REQ-USERS-018`) | Static/repo audit | Repo-wide grep | Confirmed absent; **blocked pending `OQ-USERS-06` product decision, not a test to pass/fail today** |
| No test file for this module was located during authoring (`backend/src/__tests__/` inventory not exhaustively re-enumerated here beyond noting the gap) | — | — | **UNTESTED — no `users.test.ts`-equivalent evidence was found or asserted; a follow-on test-inventory pass should confirm presence/absence explicitly before G4 review relies on this row** |

## Risks, Assumptions, and Open Decisions

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| `OQ-USERS-01` | Migration gap / decision | **5-role model absent.** CRR §1 and PDD §4.1 confirm exactly 5 roles including a new Regional Manager; `UserRole` has 4 tokens. Structurally the same gap `SPEC-AUTH-001`/`SPEC-CRM-001` already record from their own angles (`SPEC-AUTH-001` Terminology row; `SPEC-CRM-001` Evidence table). | `schema.prisma:22-27` vs CRR §1 (line 15), PDD §4.1 (line 85) | Human/Architecture (coordinate with `SPEC-AUTH-001`, which owns role-token issuance) | **Open — blocks `REQ-USERS-021`** |
| `OQ-USERS-02` | Repository contradiction | **Manager write authority.** `POST`/`PUT` gate on `requireRole(['admin','manager'])` AND `requirePermission('users:write')`, but `MANAGER` lacks `users:write`; net effect is Admin-only. Structurally identical to `SPEC-CRM-001`'s `OD-CRM-02`/`OD-CRM-07`. Whether Hotel Manager should manage users at their own (future-scoped) hotel is not settled by CRR/PDD §5.4's role×scope table either (`G-USERS-4`). | `routes.ts:11,13` vs `constants.ts:103-114`; PDD §5.4 table (lines 173-179, no explicit user-management row) | Human authority | **Open — repository contradiction requiring decision** |
| `OQ-USERS-03` | Risk / asymmetry | **`createUser` has no role-elevation guard; `updateUser` does.** Not independently exploitable today because only Admin reaches `createUser` at all under the current `OQ-USERS-02` gate configuration, but becomes independently exploitable if `OQ-USERS-02` is resolved by granting `MANAGER` `users:write` without also adding this guard. Described severity-neutrally; a security reviewer assesses impact. | `service.ts:85-118` (no guard) vs `service.ts:124-127` (guard) | Human/Security | **Open — coupled to `OQ-USERS-02`'s eventual resolution** |
| `OQ-USERS-04` | Ownership / decision | **`state-user` shared-write (`SYNC-005`).** `User` is written by both `backend-auth` (signup create `service.ts:25`; password-reset update `service.ts:205`; self-service profile update `service.ts:218`) and `backend-users` (full CRUD); `authoritative_writer: UNKNOWN`. Already tracked platform-wide (`SIR-GLOB-006`); disclosed here from this module's side, not resolved. No coordination mechanism (transaction, lock, event) exists between the two writers. | `.claude/knowledge/DEPENDENCY_GRAPH.yaml:428-434`; `auth/service.ts:25,205,218`; `service.ts:93,132,164` | Human/Architecture | **Open — cross-repository, requires a single-authoritative-writer decision** |
| `OQ-USERS-05` | Risk / migration gap | **No hotel-scoping on any route.** No `users` route calls `checkHotelAccess()`; `listUsers`'s `hotel_id` filter is optional (omitted ⇒ all hotels); `getUser` has no hotel check at all. The reachable actor set for reads is {Admin, Manager} (`RULE-USERS-02/03`), both of whom can therefore see users across every hotel today. Same cross-hotel-read-surface shape as `SIR-ANLY-001` (`OQ-ANALYTICS-01`, Critical — no permission gate at all) and `SIR-QUAL-003`/`SIR-QUAL-004` (`OQ-03`/`OQ-09`, Medium — `checkHotelAccess` bypass), though this module's own mechanism differs (no `checkHotelAccess` call exists at all, vs. an existing call being bypassed) — described severity-neutrally, not assessed here. Also the concrete blocker for target `REQ-USERS-022`/`023` (role×scope enforcement) and `REQ-USERS-024` (`scope` JWT claim), neither of which exists today. | `routes.ts:10-14`; `service.ts:8-16,61-83`; PDD §5.4 (lines 171-180) | Human/Security/Architecture | **Open — cross-hotel read surface + target scope model absent** |
| `OQ-USERS-06` | Gap / decision | **No PII-nulling mechanism for soft-deleted users.** `schema.prisma:131`'s comment ("GDPR soft delete — keep row, null PII via separate job") names an intended mechanism that does not exist anywhere in the repository at this revision (`REQ-USERS-018`). Soft-deleted users retain email/name/phone/password-hash indefinitely under current behavior. | `schema.prisma:131`; repo-wide grep, 0 matches | Human/Product/Architecture | **Open — GDPR erasure mechanism undesigned** |
| `OQ-USERS-07` | Ownership | **Owner unassigned.** No `CODEOWNERS`; empty `backend/package.json:23` author (SYNC-001; `SIR-GLOB-001` class). `AuditLog` and `ROLE_PERMISSIONS` authoritative ownership also UNKNOWN, the same platform-wide shared-artifact gap already recorded for CRM (`SIR-CRM-011`) and Quality (`SIR-QUAL-009`), not specific to this module. | `.claude/knowledge/MODULE_REGISTRY.yaml:47-57` | Human | **Open — freeze requires a named owner/approver** |
| `OQ-USERS-08` | Note / assumption | **No client consumer exists.** `frontend/lib/api.ts` and both `mobile/*/src/lib/api.ts` files contain zero `/users` references, independently verified by repo-wide grep, not merely assumed from absence of a `DEPENDENCY_GRAPH.yaml` edge. This module is administrative/backend-only surface today; whether a future admin UI is planned is not stated by CRR/PDD at the sections read for this spec. | grep evidence in `REQ-USERS-020` | Product/Human | **Open — informational, non-blocking** |
| `OQ-USERS-09` | Repository observation | **`users:delete` permission token is defined but unused.** `constants.ts:91` grants `users:delete` to ADMIN, but `DELETE /:user_id` (`routes.ts:14`) gates on `requireRole('admin')` only, no `requirePermission` check. Not independently exploitable (only `admin` passes the role gate regardless), mirroring `SPEC-CRM-001`'s already-accepted `FIND-04` pattern for its own `DELETE` route. | `routes.ts:14`; `constants.ts:91` | Human/Security | **Open — low-impact consistency note, same class as `SPEC-CRM-001` `FIND-04`** |

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| `ASM-USERS-01` | assumption | The repository's `FEATURE_*` env-flag absence, established for CRM/Notifications/Auth, is assumed to hold for this module too rather than independently re-verified by a fresh full-repo grep in this authoring pass. | `OD-CRM-14`; `SIR-NOTIF-003`; `SIR-AUTH-012` | Assumption, low-risk (platform-wide, not module-specific fact) |
| `ASM-USERS-02` | assumption | No dedicated `users.test.ts`-equivalent test file was located or exhaustively confirmed absent during this authoring pass (Validation Plan, final row); its presence/absence should be independently confirmed before G4 review relies on any "UNTESTED" characterization here. | Not independently enumerated in `backend/src/__tests__/` during authoring | Assumption pending independent confirmation |

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate (this
module's author cannot self-apply registry/graph/terminology changes).

- **`MODULE_REGISTRY.yaml`:** set `specification` for `backend-users` (`:56`) from `UNKNOWN` to
  `SPEC-USERS-001@0.1.0 (REVIEW)`, mirroring the CRM/Quality/Auth precedent of pointing the
  registry at a REVIEW-status spec before freeze; set to `FROZEN` only on G2 human approval. Do
  not alter `owner: unassigned`, `lifecycle: active`, or `implementation_status: active` without
  human confirmation (SYNC-001).
- **`DEPENDENCY_GRAPH.yaml`:** no new edges are asserted — the existing `edge-hotel-workers-reads-user`
  edge (`:217-223`) and the `state-user` block (`:428-434`, writers `[backend-auth, backend-users]`,
  `authoritative_writer: UNKNOWN`) already reflect this module's observed current-state behavior as
  independently re-verified during authoring. If `OQ-USERS-04` (single-authoritative-writer
  decision) is ever resolved, update `state-user.authoritative_writer` accordingly — **not before**,
  and not by this module unilaterally.
- **`TERMINOLOGY.md`:** no new canonical terms are proposed by this spec. This module reuses,
  without redefining: **Soft-delete** (canonical source `SPEC-CRM-001`), **Regional Manager** and
  **Scope** (canonical source `SPEC-AUTH-001`), and the unresolved **Worker/Checker/Manager/Admin**
  role-token rows (also sourced to `SPEC-AUTH-001`). No reattribution of canonical-source authority
  is proposed.
- **`DECISION_INDEX.md`:** register `OQ-USERS-01` (coordinate with `SPEC-AUTH-001`'s own pending
  5-role/scope decision), `OQ-USERS-02`, `OQ-USERS-04` (coordinate with `SPEC-AUTH-001`'s
  `OQ-AUTH-03`, the other side of the same `SYNC-005` fact), `OQ-USERS-05`, and `OQ-USERS-06` as
  pending decision records requiring human/architecture disposition before target-state
  implementation or G2 freeze.
- **`SYNC_STATE.yaml`:** record this spec as `REVIEW`, G4 independent reviews pending (none begun),
  owner assignment blocked (SYNC-001); do not mark any G4 dimension as complete until it actually
  runs.
- **`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`:** add a new `## Module: Users
  (SPEC-USERS-001, docs/03-modules/users/MODULE_SPEC.md)` section, seeded from `OQ-USERS-01..09`
  above, per the register's Update Protocol (append, do not duplicate `SIR-GLOB-006`/`SIR-AUTH-007`
  — cross-reference `OQ-USERS-04` to those existing rows rather than re-stating the fact as new).

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-10 | Initial canonical-template authoring of `SPEC-USERS-001` from the current worktree (`fc69858`, `HEAD`) and CRR §1 / PDD §4.1, §5.3, §5.4 (Target Behaviour), per the specification-authoring workflow. Documents the five-route `User` CRUD surface as implemented; separates Current / Target / Migration Gap planes; discloses the `state-user` shared-write fact (`SYNC-005`/`SIR-GLOB-006`) without resolving it; records the role-gate/permission-map mismatch on write routes (`OQ-USERS-02`, structurally identical to `SPEC-CRM-001`'s `OD-CRM-02`/`OD-CRM-07`); the `createUser`/`updateUser` role-elevation-guard asymmetry (`OQ-USERS-03`); the absent hotel-scoping and resulting cross-hotel read surface (`OQ-USERS-05`, precedent-shaped after `SIR-ANLY-001`/`SIR-QUAL-003`/`SIR-QUAL-004`); and the unimplemented GDPR PII-nulling mechanism named by the schema comment but absent from the codebase (`OQ-USERS-06`). Independently verified, before module selection, that no other already-authored `docs/03-modules/*/MODULE_SPEC.md` claims ownership of `backend-users` or "User Management" — all treat it as out of scope for themselves. Freeze candidate submitted for G4 independent review and G2 human approval. Author cannot self-approve blocking findings (Constitution §12); **FROZEN status is withheld pending human approval and disposition of `OQ-USERS-01`, `OQ-USERS-02`, `OQ-USERS-04`, `OQ-USERS-05`, `OQ-USERS-06`, `OQ-USERS-07`.** | — (none dispositioned yet; G4 not yet begun) | — (pending) |
| 0.1.0 (G4 round 1, recorded not corrected) | 2026-07-10 | Lead Architect recorded the outcome of the first G4 independent-review round against v0.1.0 (commit `84d880a`, re-verified content-identical at `d5b986e`): Architecture `PASS_WITH_ACTIONS`, Dependency `PASS_WITH_ACTIONS`, Performance `PASS_WITH_ACTIONS`, Consistency **`FAIL`** (High — internal `REQ-USERS-003..012` ID collision), Security **`FAIL`** (**Critical** — a previously-undiscovered, unauthenticated privilege-escalation-to-Admin defect in `backend-auth`'s `POST /auth/signup` path, independently reproduced by the Lead Architect; plus a Medium cross-hotel PII-read finding routed to Risk Assessment, matching the `SIR-QUAL-003`/`004` precedent, and three Low/Medium disclosure-completeness gaps). Per explicit human instruction, the correction cycle (author fixes → re-review → G6) was **paused before starting** — this row records the finding only; no content in this document has been corrected yet, and no reviewer's findings have been applied. Workflow marked **Blocked** (`LOOP_CONTROL.md` §4) rather than continuing the Refinement sub-loop. Findings recorded in `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` (`## Module: Users` section, new; plus `SIR-GLOB-012` for the cross-module Critical) and `.claude/knowledge/SYNC_STATE.yaml` (`SYNC-016`). No version bump — this is a nonsemantic recording edit only (`LOOP_CONTROL.md` §7 exemption); the document's substantive content (including the now-known-inaccurate "Admin-only in practice" framing in `OQ-USERS-02`/`OQ-USERS-03`) is unchanged and must be corrected in v0.1.1 when the correction cycle resumes. | None resolved — all 5 reviewers' findings remain open, recorded for future correction | — (workflow blocked; no approver action taken) |
