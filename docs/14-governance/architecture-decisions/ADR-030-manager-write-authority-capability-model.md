# ADR-030: Manager Write Authority — Capability-Based Permission Model

- **Status:** **Accepted.** Ratified directly by the project owner (human decision, recorded 2026-07-25, session `claude/gd-02-manager-write-authority-b2g7rx`) — Constitution §20 human/product authority. §7's four blockers were closed by owner decision on the same date (see §7); this statement is the separate, required ratification of the record's status itself, per the ADR-021/024/025/027/028/029 convention. This decision governs PR-2 through PR-8's implementation; it does not itself authorize code beyond what PR-1 already shipped — each subsequent PR still requires its own gate (§6).
- **Date:** 2026-07-25
- **Scope:** Authorization model — resolves `GD-02` (Manager write-permission authority) and the permission-set half of `GD-03` (5-role model & Regional-Manager authority). Establishes **capability** as the unit of authorization design, sitting above the existing `resource:action` permission tokens.
- **Supersedes:** none. Amends `ADR-024` D3/D5 (§5, M-4). Reverses the non-binding recommendation recorded against `GD-02` in `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` for the hotel half (§1, D-3).
- **Change class:** Material authorization-model decision requiring a Decision Record per Constitution §6/§7 — same class as `ADR-023`/`ADR-025`.
- **Companion record (not this ADR):** `ADR-031` — permission derivation (resolving stored/JWT-embedded permissions at request time). Explicitly **out of scope** here; see §6.

---

## 1. Problem

Three route families gate on `requireRole([...,'manager'])` **and** `requirePermission('<resource>:write')` while `ROLE_PERMISSIONS.MANAGER` holds no such token — so managers pass the role gate and are denied by the permission gate. Hotel and user writes are net Admin-only, with `manager` left in the route as dead intent (`backend/src/modules/crm/routes.ts:12,14`; `backend/src/modules/users/routes.ts:11,13`; `backend/src/config/constants.ts:103-125`).

Resolving it either way changes the effective authorization set, which is a product decision. Two facts make it more than a one-line fix:

1. **One role token serves two business roles.** `UserRole` has four values; Hotel Manager and Regional Manager are both `MANAGER`, distinguished only by which JWT scope claim they receive (`schema.prisma:22-27` vs CRR §1:15,19). Any grant to `MANAGER` reaches both.
2. **Permissions are stored, not derived.** `User.permissions` is snapshotted at create/update time and copied into the JWT (`users/service.ts:108,147`; `middleware/auth.ts:24-30`). Editing `ROLE_PERMISSIONS` alone changes nothing for existing users. The matrix change requires a backfill migration.

Full evidence, the 18-item contradiction register, and the investigation that produced them are **not restated here** — see the GD-02 investigation report. This record contains decisions only.

---

## 2. Decision — capability model

Authorization is designed at the **capability** layer and enforced at the permission/route layer:

```
Capability  →  Permission token(s)  →  Route gate(s)  →  Service scope check  →  Test
```

A capability is a business action a person performs. It is the unit the product owner reasons about and the unit tests are named after. Permission tokens remain the enforcement primitive; the mapping between them is declared once, in code, and is test-pinned.

**D-1 — Capability register.** The capabilities below are exhaustive for the current surface. Adding a capability requires adding a row here.

**D-2 — Master data vs. operations.** Every capability is classified `MASTER` or `OPS`.
- **MASTER** — the existence and identity of an organizational entity: create/delete/rename a hotel or group, move a hotel between groups, activate/deactivate, appoint a manager or regional manager. **Admin only, always, regardless of scope.**
- **OPS** — the day-to-day state of a hotel: assignments, work requests, calendar, attendance, blocklist, HR records, operational toggles. **Scoped-role capable.**

This split is the reconciliation of the owner's directive ("a manager should not be allowed to add hotel, edit or delete it — only admin can do that") with CRR §11:180 ("Regional/Property Managers may manage their assigned properties"). Managers *operate* hotels; they do not *administer* them.

**D-3 — Hotel writes are Admin-only.** `POST /crm/hotels` and `PATCH /crm/hotels/:hotel_id` narrow to `requireRole('admin')`. `MANAGER` is **not** granted `hotels:write`. Grounded in CRR §11:180, CRR:429 ("Hotel-creation permission → RESOLVED, Admin/HQ only"), PDD §5.4, and the owner's directive. This reverses `GD-02`'s recorded recommendation (a) for hotels.

**D-4 — User writes are scoped-manager capable, with three carve-outs.** `MANAGER` and `REGIONAL_MANAGER` gain `users:write`, constrained by:
- scope filtering on reads and writes (D-7);
- **role assignment of any kind remains Admin-only** — a scoped role may never set or change `User.role`;
- account creation and deletion remain Admin-only.
A manager may edit the profile fields of a user within their scope. Nothing more.

**D-4b — `employees:write` confers no field-level edit right (ratified 2026-07-25, `OQ-030-A`).** `users:write` (D-4) governs the `User` *account* profile and is deliberately narrow. It must not be read across to the **employment record**, which is a different entity with a different owner (`backend-hr`/`SPEC-EMP-001`, `ADR-022`). Manager and Regional-Manager authority over an employment record is expressed **exclusively as discrete, named workflow transitions** — never as arbitrary field updates. The ratified transition set is:

1. Approve / reject an employment application
2. Mark a candidate suitable / unsuitable
3. Confirm a signed contract
4. Trigger onboarding / offboarding workflow where applicable

Every employment-record **field** — identity, legal, payroll, tax, compensation, and employment terms — remains **Admin-owned**. No manager-editable field list exists, and none may be introduced by inference from `employees:write` or `users:write`: field-level ownership requires its own governance decision (GD-15 or a successor ADR), not an implicit widening of an existing permission token. See D-4c for why none of the four transitions is deliverable inside this record's PR sequence, and §8's invariant test, which makes this prohibition executable rather than advisory.

**D-4c — the four transitions are owned elsewhere and are not in scope for this ADR.** Verified against the repository at `3f456c6`:

- **F-1 — Transitions 1, 2 and 4** belong to **`backend-onboarding`**. `SPEC-ONBOARDING-001` §1/§6.6/§6.7 assigns pool/claim review, approve/reject, and probation-suitability decisioning to that module; Employee Management owns the record and *executes* the resulting transition. Its `lifecycleSignal` endpoint is the internal receiver of that decision and is correctly `requireRole('admin')`-gated with a service guard reading *"Lifecycle signals are internal-only"* — a manager never calls it directly. **`backend/src/modules/onboarding` does not exist**; there is no code module to extend.
- **F-2 — Transition 3 (signed-contract confirmation) has an unbuilt route, not an ownership blocker.** `ADR-012` (Accepted, 2026-07-12) already settles the `OD-HR-01a`/`OD-HR-01b` ownership question this ADR's authoring pass initially (and incorrectly) treated as open: `backend-hr` owns contract generation, manager confirmation, and the full contract lifecycle; Onboarding is a **consumer** that coordinates/triggers, never an owner. `SPEC-HR-001`'s own Document Control text still reads architecture `BLOCKED` and `OD-HR-01a` "disclosed, not resolved" only because the spec predates `ADR-012` by 13 days and was never re-synchronized (a pre-existing documentation-sync gap, not created by this ADR — see §9's risk note). `IF-HR-ConfirmContractSigned` has no current route; it needs to be **built**, in `backend-hr`, not adjudicated.

Consequently C-16 is `✗` for Manager and Regional Manager **at this revision** (§3) — this removes nothing, because no employment-record edit path has ever existed (zero of the module's ten routes are `PATCH`/`PUT`). The transitions are deferred to GD-15 and the Onboarding build.

**D-4a — Split DTO/route, not a service-level `if`.** Today `PUT /users/:id` accepts a single `UpdateUserSchema` (`backend/src/modules/users/types.ts:12-18`) carrying `first_name`/`last_name`/`phone`/`is_active` **and** `role` in one object, enforced only by an incoming-value elevation guard inside `updateUser` (`service.ts:136-138`). That shape is the C-15 defect: whether a caller may touch `role` is decided by an `if` buried in a handler that also handles profile edits, not by the route or the schema. Extending `users:write` to a scoped role over that same DTO would make `users:write` **implicitly include role editing** for every manager, which is the opposite of what D-4 grants.

Required before `users:write` is extended to any scoped role (binds PR-5, not deferred to implementation discretion):
1. **Split the schema.** `UpdateUserProfileSchema` (`first_name`/`last_name`/`phone`/`is_active`) is the only body `MANAGER`/`REGIONAL_MANAGER` may submit to `PUT /users/:id`. `role` moves to its own schema and its own route (e.g. `PUT /users/:id/role`), gated `requireRole('admin')` only — no scoped role ever reaches a handler that can write `User.role`.
2. **The service method mirrors the split**, not just the schema: `updateUserProfile(...)` takes no `role` parameter at all — there is no field for an elevation guard to police, because the code path cannot express a role change. `updateUserRole(...)` remains a distinct, Admin-only method retaining the C-15 fix (target's-current-role check, PR-1).
3. **`permissions` and `scope` are never client-writable fields on any User DTO** — `permissions` is server-derived from `role` (`service.ts:147`) and `scope` is resolved at JWT issuance from `Hotel.manager_user_id`/`HotelGroup.regional_manager_user_id`, never a settable `User` column. No schema work needed here; recorded so the split above doesn't get "completed" by only handling `role` and missing an equivalent gap if one is later added.
4. **Test:** a dedicated case asserts `MANAGER`/`REGIONAL_MANAGER` calling `PUT /users/:id` with a `role` field present is rejected at the schema/route boundary (400/404 on the wrong route), not merely denied by service logic — the boundary itself must not parse the field for a scoped caller.

This is DTO-splitting, not a naming change: two schemas, two service methods, two routes, so `users:write` and role-assignment are structurally incapable of sharing an enforcement path.

**D-5 — `REGIONAL_MANAGER` is added to `UserRole`.** It holds `MANAGER`'s capability set at `hotel_group` scope, plus group read and org-chart read. It gains **no** MASTER capability: an RM may not create, delete, rename, re-parent, or otherwise modify hotel groups or hotel master data (CRR §11:180 is explicit), nor appoint managers. 

**Governing split, ratified 2026-07-25 (`OQ-030-B`, resolves conflict D-5):** CRR §1:20 grants RM *visibility* of all Hotel Manager data across the group; PDD §5.4:178 grants RM *all Hotel Manager actions* across the group. Both are satisfied by a single authority: **operational authority = Regional Manager at group scope; master-data authority = Admin only.** This reading:
1. Aligns CRR §1:20 (visibility is a subset of operational action authority) and PDD §5.4 (operational actions across the group) without conflict.
2. Preserves CRR §11:180 (RM may **not** create/modify hotel groups — these are master-data mutations, Admin-only).
3. Is behaviour-preserving, not a new grant: `resolveScope()` (`backend/src/modules/auth/service.ts:29-51`) already resolves an RM to `{type:'hotel_group'}` with documented precedence *"regional manager (hotel_group, broader scope wins)"*.

The Regional Manager is an **operational manager**, not a hotel-group administrator — it inherits every operational capability a Hotel Manager holds (employee operations, scheduling, attendance, onboarding approvals, quality, notifications, analytics), evaluated across every hotel in its assigned group, and holds no administrative authority over the group entity itself. Every operational `✓ᶜ` in §3's capability matrix already describes live behaviour.

**D-6 — Approve together, implement separately.** `GD-02` and `GD-03` are decided in this one record because the permission sets are inseparable. Their *implementation* is not coupled: the enum lands in its own PR (§6, PR-2) and nothing reads it until PR-5.

**D-7 — Scope rules.**
- Claim shape unchanged (ADR-023): `{type:'hotel'|'hotel_group'|'global'}`.
- `MANAGER` → `{type:'hotel'}` from `Hotel.manager_user_id` (ADR-025 §4), exactly one hotel (`TREQ-AUTH-002`).
- `REGIONAL_MANAGER` → `{type:'hotel_group'}` from `HotelGroup.regional_manager_user_id` (ADR-023).
- `hotel_group` scope subsumes every member hotel. It grants no capability the role lacks.
- **Null scope denies every scoped capability.** Already the behaviour of `isHotelInScope`; made explicit and test-pinned.
- `ADMIN` → `{type:'global'}`. `WORKER` continues on the roster path, not the scope claim.
- **List endpoints filter by scope; they do not deny.** A scoped manager's `GET /users` returns their scope's users, not a 403 — the pattern already used in `attendance/service.ts:97-107`.

**D-8 — Permission-token hygiene (narrowed).** A permission token must not exist unless at least one route checks it; a route must not check a token no role holds. A CI invariant test pins both directions. **`requirePermission` is not mandatory on every route** — where Admin is the only actor, `requireRole('admin')` alone is sufficient and adding a token is duplication. Consequence: `hotels:delete` and `users:delete` are **deleted** as tokens rather than wired up, since their routes are Admin-only.

**D-9 — `hotel_groups:*` is split out of `hotels:write`.** One token currently guards two capabilities with two different owners (`crm/routes.ts:12,14` vs `:23,25`). New tokens: `hotel_groups:read`, `hotel_groups:write`.

**D-10 — `super_admin` is removed.** `middleware/permissions.ts:20` grants a blanket permission bypass to a role string no enum, schema, or issuance path produces. Deleted.

---

## 3. Final capability matrix

`✓` = allowed · `✓ᶜ` = allowed within the actor's scope · `✗` = denied.
Class: **M** = master data (D-2), **O** = operations.

**Regional Manager column** — governed by D-5 (operational authority at group scope; no master-data capability). Every `✓ᶜ` below is an operational row; every RM `✗` below is a master-data row.

| # | Capability | Class | Permission token(s) | Admin | Regional Mgr | Manager | Checker | Worker |
|---|---|---|---|---|---|---|---|---|
| C-01 | Create hotel | M | `hotels:write` | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-02 | Edit hotel record | M | `hotels:write` | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-03 | Delete hotel | M | — (role only) | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-04 | Operate hotel (toggles, e.g. GD-05 pause) | O | `hotels:operate` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ |
| C-05 | View hotels | O | `hotels:read` | ✓ | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ |
| C-06 | Create / delete hotel group | M | `hotel_groups:write` | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-07 | Edit hotel-group composition | M | `hotel_groups:write` | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-08 | View hotel group | O | `hotel_groups:read` | ✓ | ✓ᶜ (own) | ✓ᶜ (own) | ✗ | ✗ |
| C-09 | Appoint RM / hotel manager | M | `hotels:write` / `hotel_groups:write` | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-10 | Create user account | M | — (role only) | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-11 | Edit user profile | O | `users:write` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ (self via `/auth/profile`) |
| C-12 | Assign / change user role | M | — (role only) | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-13 | Deactivate / delete user | M | — (role only) | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-14 | View users | O | `users:read` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ |
| C-15 | Create / bulk-import employee | M | `employees:write` | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-16 | Employee operational transitions ¹ ³ | O | `employees:write` (submit/approve/reject/deactivate/reactivate/rehire) | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ |
| C-17 | Edit employee record fields — identity, legal, payroll, tax, compensation, employment terms ² | M | `employees:write` | ✓ | ✗ | ✗ | ✗ | ✗ (self at signup) |
| C-18 | *(merged into C-16, see note ³)* | — | — | — | — | — | — | — |
| C-19 | View employee profile | O | `employees:read` | ✓ | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ self |
| C-20 | Read special-category fields | M | `employees:special_category:read` | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-21 | Subject-rights export | M | `employees:read` + role | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-22 | Manage hotel blocklist | O | `employees:write` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ |
| C-23 | Manage work requests | O | `staffing:write` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ |
| C-24 | Manage assignments | O | `staffing:write` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ own |
| C-25 | Write calendar operations | O | `staffing:write` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ |
| C-26 | Approve / correct attendance | O | `staffing:write` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ own, limited fields |
| C-27 | Submit quality rating / verification | O | `quality:write` | ✓ | ✗ | ✗ | ✓ᶜ | ✗ |
| C-28 | View quality / leaderboard | O | `quality:read` | ✓ | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ (ADR-067) |
| C-29 | Manage HR contracts / payroll | O | `hr:write` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ |
| C-30 | View HR records | O | `hr:read` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ |
| C-31 | View analytics | O | `analytics:read` | ✓ | ✓ᶜ | ✓ᶜ | ✗ | ✗ (GD-06) |
| C-32 | Export reports | M | — | ✓ | ✗ | ✗ | ✗ | ✗ |
| C-33 | View org chart | O | `org_chart:read` | ✓ | ✓ᶜ | ✗ | ✗ | ✗ |
| C-34 | Administer notification outbox | M | — (role only) | ✓ | ✗ | ✗ | ✗ | ✗ |

¹ C-16 was `✗` at authoring (2026-07-25, `OQ-030-A`, D-4b/D-4c) — see note ³ for the superseding amendment.

² No manager-editable employee field set exists or is introduced by this record (D-4b). Field-level ownership requires its own governance decision.

³ **Superseded note (employment-lifecycle rework, 2026-08-06, PR #354).** D-4c deferred employee-authority transitions to two future owners: application approve/reject and probation suitability to an unbuilt `backend-onboarding` module (F-1); signed-contract confirmation to `backend-hr` (F-2). `backend-onboarding` was never built. The employment-lifecycle rework (permanent, non-terminal `EmploymentStatus` — see the module's own decision record) instead builds every lifecycle transition — `submitForReview`, `approve`, `reject`, `deactivate`, `reactivate`, `rehire` — as one authorization seam (`assertLifecycleAuthority()`) inside `employee-management` itself, superseding D-4c's planned module split. This is not merely the same three actions arriving later: the module split D-4c anticipated turned out to conflict with the rework's own core invariant — a single `applyTransition()` seam must own every `EmploymentRecord.status`/`employment_cycle` write for the append-only `EmploymentStatusHistory` log and cycle-counter to stay correct (no other module may write these fields directly). Splitting transition ownership across `backend-onboarding`/`backend-hr`/`employee-management` would have made that invariant unenforceable across module boundaries.

Ratified outcome for these six transitions: **Admin unrestricted; Manager/Regional-Manager admitted `✓ᶜ`, scoped to the record's own `hotel_group_id`** (`isWorkerInGroupScope`) for a record that already has one, or to "does this actor manage a group at all" for a record that doesn't yet (submit-for-review/approve/reject/rehire only — a `PENDING`/`REJECTED` record has no group to scope against until its first approval). Checker/Worker remain denied. This still honors D-4b: none of these six actions is a field-level edit, and no manager-editable employee field list is introduced — they remain named, discrete workflow transitions, exactly D-4b's original constraint, just no longer deferred.

**C-18 ("Deactivate employee") is merged into C-16, not superseded independently.** Deactivate is now one of the six uniformly-authorized lifecycle transitions above, gated by the same `assertLifecycleAuthority()` code path — keeping it as a second, separately-ratified row invited exactly the kind of matrix/code drift this ADR's own capability-policy test exists to catch. `employees:delete` (C-18's former token) is retired from this row.

**Two genuinely new capabilities this rework introduces, deliberately NOT covered by C-16's `✓ᶜ` grant: `delete` and `restore`.** These are admin-only, unrestricted by scope — they cross the account boundary (the employment-lifecycle rework unifies `EmploymentStatus.DELETED` with `User`-level soft delete, touching `deleted_at`/`is_active`/`token_generation`), a strictly larger blast radius than an employment-status change. No existing C-id covers this pair (closest is C-13, "Deactivate / delete user", which predates this rework and is a distinct code path over the `User` account directly, not `EmploymentRecord`). Recorded here rather than left implicit: a future revision of this ADR should decide whether `delete`/`restore` warrant their own numbered row, or continue to ride alongside C-16 as the admin-only exception within employee lifecycle actions.

### Resulting `ROLE_PERMISSIONS`

```
ADMIN:            admin:* + all tokens (unchanged in effect) + hotel_groups:read/write, hotels:operate, org_chart:read
                  − hotels:delete, users:delete            (D-8: deleted, routes are role-only)
REGIONAL_MANAGER: MANAGER's set + hotel_groups:read + org_chart:read
MANAGER:          hotels:read, hotels:operate, hotel_groups:read,
                  users:read, users:write,                 ← new (D-4)
                  employees:read, employees:write,
                  staffing:read, staffing:write,
                  hr:read, hr:write,
                  quality:read, analytics:read,
                  rooms:read/write, tasks:read/write, notifications:read
CHECKER:          unchanged
WORKER:           unchanged
```

---

## 4. Final ownership matrix

| Entity / state | Authoritative writer | May be written by a scoped role? | Authority |
|---|---|---|---|
| `Hotel` — identity fields | `backend-crm` | **No** (Admin only) | ADR-011, D-2/D-3 |
| `Hotel` — operational fields | `backend-crm` | Yes, in scope | D-2, CRR §11:170 |
| `Hotel.manager_user_id` | `backend-crm` | **No** | ADR-025, D-2 |
| `Hotel.hotel_group_id` | `backend-crm` | **No** | ADR-023, D-2 |
| `HotelGroup` (all fields) | `backend-crm` | **No** | ADR-023, CRR §11:180 |
| `User.role`, credentials, permissions | `backend-auth` | **No** | ADR-017, D-4 |
| `User` profile fields | `backend-users` | Yes, in scope | ADR-017, D-4 |
| `EmploymentRecord` — identity/tax | `backend-hr` | **No** | CRR §7:73, D-2 |
| `EmploymentRecord` — lifecycle state | `backend-hr`/`backend-onboarding` (F-1, D-4c) | **No — action-only, deferred** (C-16, D-4b/D-4c) | CRR §10:161, §9:134 (corrected citation) |
| `EmploymentRecord.hotel_group_id` | `backend-hr` | **No** | ADR-022, `REQ-EMP-012` |
| `WorkerAssignment`, `WorkRequest`, `CalendarEntry` | owning module | Yes, in scope | PDD §5.4 |
| `Attendance` | `backend-attendance` | Yes, in scope | PDD §5.4 |
| `Rating`, `Verification` | `backend-quality` | Checker only | CRR §15 |
| `AuditLog` | `backend-auth` | append-only, all actors | ADR-016 |

Employment records remain group-grain with no per-hotel tie (`REQ-EMP-012`, ADR-022). No new entity is introduced by this record.

---

## 5. Final migration plan

| ID | Migration | Reversible | Notes |
|---|---|---|---|
| **M-1** | Add `REGIONAL_MANAGER` to the `UserRole` enum | **No** | Postgres `ALTER TYPE … ADD VALUE` must be its own migration and cannot run in the same transaction as a statement using the new value. Additive-only posture per ADR-024 D6. |
| **M-2** | Backfill `User.permissions` for every `ADMIN`, `MANAGER`, and (post-M-3) `REGIONAL_MANAGER` row from the new `ROLE_PERMISSIONS` | Yes (snapshot + restore) | **Load-bearing.** Without it the §3 matrix has no effect on existing accounts, because permissions are stored, not derived (§1, fact 2). Runs with PR-5 and re-runs on any later matrix change until `ADR-031` lands. |
| **M-3** | Promote users referenced by `HotelGroup.regional_manager_user_id` from `MANAGER` to `REGIONAL_MANAGER` | Yes | Without it, existing RMs silently keep hotel-grain authority. Must run **after** M-1 and **before** PR-5 flips the matrix. |
| **M-4** | Retire `FEATURE_SCOPE_AUTHZ` | **No** (intentional) | ADR-024 D3 makes flag-OFF mean "manager bypasses hotel scope." Retaining a switch that *widens* manager authority while this record *grants* manager write authority would be a privilege-escalation toggle. **Flag removal is a hard prerequisite of PR-5, not a follow-up.** Amends ADR-024 D5 (removal conditions now include this record) and satisfies D6 (roll-forward). |

**Operational envelope:** M-2 and M-3 are data-only and idempotent; both take a pre-migration snapshot of `(user_id, role, permissions)` to a backup table retained for one release. Rollback of the matrix decision itself is by feature flag (PR-5), not by reversing M-2 — reversing M-2 alone would leave roles and permissions inconsistent.

> **Superseded note (`ADR-031` PR-8, 2026-07-27):** M-2's backfill treadmill this row describes ("re-runs on any later matrix change until `ADR-031` lands") ended when `ADR-031` landed. Permissions are now derived request-time from `ROLE_PERMISSIONS[role]` (`ADR-031` D-1) rather than stored on `User.permissions`; the column itself is dropped (`ADR-031` M-3, PR-7, `#233`). `role-permissions-backfill.ts` (the script that performed M-2) is retired — deleted, not merely disabled — since it read/wrote a column that no longer exists. This note does not rewrite M-2's history above (it was load-bearing and correct for `ADR-030`'s own PR sequence); it records that the condition under which M-2 would need to re-run no longer exists.

---

## 6. Final PR sequence

Each PR is independently revertible except where noted. Gate column: **S** = Security Review blocking, **A** = Architecture Review blocking (Constitution §12 — the author cannot self-approve).

| PR | Goal | Depends on | Migrations | Rollback | Gate |
|---|---|---|---|---|---|
| **PR-0** | Characterization tests pinning today's net behaviour on the contradicted routes (manager denied on hotel and user writes) | — | — | revert | — |
| **PR-1** | Security hardening that is correct under **either** GD-02 outcome: scope + role gates on `hr/routes.ts`; role gate on `calendar/routes.ts`; delete `super_admin` (D-10); fix the `updateUser` elevation guard to test the **target's current role**, not only the incoming value | PR-0 | — | revert per file | **S** |
| **PR-2** | Add `REGIONAL_MANAGER` enum + scope-claim issuance, behind `FEATURE_RM_ROLE`. Nothing reads the token yet (D-6) | PR-1 | M-1, M-3 | flag off (enum value is not removable — accepted) | **S** |
| **PR-3** | Mobile + frontend role-union widening to accept `regional_manager`. **Also fixes F-3 (latent regression):** the hotel-group Regional Manager picker/display (`frontend/app/(protected)/hotel-groups/{new,[id]/edit,[id],page}.tsx`, 4 call sites) currently queries `useUserOptions({role:"manager"})` → `GET /users?role=manager`. After M-3 promotes existing RMs to `REGIONAL_MANAGER`, that query silently stops returning them — the picker and name-resolution views would show an incomplete/blank list for the exact users they exist to select. Fix: query `role=regional_manager` (or both roles during the transition) at all four sites. Without this, PR-2's M-3 creates a live production regression where existing RMs vanish from their own assignment interface. | PR-2 | — | revert | — |
| **PR-4** | Scope-bind the currently unscoped reads: `GET /users`, `GET /crm/hotel-groups*`, `GET /analytics/{stats,leaderboard}`. Filter, do not deny (D-7) | PR-2 | — | revert | **S** |
| **PR-5** | Enact §3: narrow hotel writes to Admin (D-3); **split `PUT /users/:id` into a profile route/schema/service-method and an Admin-only `PUT /users/:id/role` (D-4a) before extending any grant**; grant scoped `users:write` on the profile path only (D-4); add `hotel_groups:*`, `hotels:operate`, `org_chart:read`; delete `hotels:delete`/`users:delete` (D-8); retire `FEATURE_SCOPE_AUTHZ` (M-4). Behind `FEATURE_GD02_MATRIX` | PR-4 | M-2 | flag off | **S**, **A** |
| **PR-6** | Frontend capability gating: replace `ManagerAdminGate` with capability-named gates; hotel create/edit → admin only | PR-5 | — | revert | — |
| **PR-7** | Permission-matrix invariant test (D-8) + the generated route × role integration matrix | PR-5 | — | revert | — |
| **PR-8** | Documentation, register, and knowledge-graph synchronization; ratify this ADR's consequences into the affected specs | PR-7 | — | — | — |

**Ordering constraints that are not negotiable:**
- **PR-1 before PR-5.** Granting `users:write` before the elevation-guard fix would let a manager demote or deactivate an Admin.
- **PR-3 before PR-2's flag is enabled in production.** `ALLOWED_ROLES` in both mobile apps would otherwise lock out every Regional Manager, and (F-3) the hotel-group RM picker would silently drop them from its list the moment M-3 runs.
- **M-4 within PR-5, not after.** See §5.
- **The DTO/route split (D-4a) lands before the `users:write` grant is enabled, not after.** Extending the grant over the current single-schema `PUT /users/:id` first and splitting later would open exactly the window this record exists to close.
- **PR-1 may ship without ratifying this ADR.** It fixes defects that exist under either outcome.

**Out of scope — deferred to `ADR-031`:** resolving permissions from the role at request time instead of from the stored `User.permissions` array and the JWT claim. That change touches auth, token issuance, middleware, caching, revocation (GD-07), audit, and every authorization check; it is an authorization-architecture decision, not a permission-matrix decision, and it must not ride inside this record's PR sequence. Until it lands, M-2 is re-run on every matrix change — an accepted, explicit cost.

---

## 7. Open items — resolved by owner ratification, 2026-07-25

All four items below were open at authoring time and are now closed. None was resolved by assumption (Constitution §6) — each was investigated against repository evidence, presented with options and a recommendation, and decided by the project owner. Full investigation and decision record: `ADR-030-S7-INVESTIGATION.md` / `ADR-030-S7-GOVERNANCE-REPORT.md` (session `claude/gd-02-manager-write-authority-b2g7rx`, 2026-07-25).

| ID | Question | Resolution |
|---|---|---|
| **OQ-030-A** | Which employee fields may a scoped manager update (C-16)? | **RESOLVED — none.** Manager/RM employee authority is action-only, never field-level (D-4b/D-4c). No field list is introduced; field-level ownership requires its own governance decision (GD-15 or successor). |
| **OQ-030-B** | Does the RM hold group-wide *operational* authority, or is the RM purely a group administrator? | **RESOLVED — operational authority at group scope, no master-data authority** (D-5, amended). Conflict analysis (D-6): Initial session work proposed narrowing RM authority to group-admin-only, which contradicted CRR §11:180 and PDD §5.4. The owner's stated intent — "manage hotel groups" — was reconciled with the confirmed requirements by reading "group management" as operational stewardship (see, operate, coordinate within the group) rather than group-record administration (create/modify/delete groups). This reading is the PDD §5.4 interpretation; it is behaviour-preserving (`resolveScope()` already implements it); and it preserves CRR §11:180 (RM cannot modify hotel groups or master data). |
| **OQ-030-C** | Does "invite worker" exist in the target model? | **RESOLVED — no.** Replaced by self-signup (CRR §6:73) + pool/claim manager approval (CRR §10). No invite capability, token, endpoint, or permission is introduced. The dormant `HotelWorkerStatus.INVITED`/`invited_at` remnants on the `ADR-022`-retired `HotelWorker` model are out of this ADR's scope — their removal is gated by `ADR-024` D5 and tracked as its own PR (§6 note), not folded in here. |
| **OQ-030-D** | Is there a manager-facing report export beyond the GDPR subject-rights export (C-32)? | **RESOLVED — no.** Confirmed excluded three times independently (CRR §23:320, CRR:439, PDD §140). C-32 stays Admin-only. Any future export capability requires its own requirements decision, not inference from this ADR. |

Two further items are recorded rather than resolved, being genuinely outside this record's scope: `CHECKER` currently bypasses hotel scope entirely (`middleware/permissions.ts:131`), contradicting PDD §5.4; and worker analytics access is `GD-06`. Also outside scope: the org-chart reporting model (`OD-EMP-12`, `OQ-AUTH-08`) — `OQ-030-B` resolves the RM *permission*, not the org-chart *data model*, which remains open.

---

## 8. Compatibility

| Authority | Effect |
|---|---|
| `ADR-011`, `ADR-017`, `ADR-023`, `ADR-025` | Consumed unchanged. Ownership assignments and the JWT claim shape are reused, not altered. |
| `ADR-022` | Reinforced — no per-hotel employment tie is introduced (§4). |
| `ADR-024` | **Amended.** D5's removal conditions for `FEATURE_SCOPE_AUTHZ` gain this record as a trigger (M-4). D1, D2, D4, D6 unaffected. |
| `SPEC-CRM-001` (FROZEN) | `REQ-CRM-010` resolves **against** manager hotel-record writes and **for** scoped hotel operations (D-2/D-3). `OD-CRM-02`, `OD-CRM-07`, `OD-CRM-13` close. Correction-class forward-note at that spec's next revision — **not made by this record** (the ADR-023/ADR-025 precedent). |
| `SPEC-USERS-001` (FROZEN) | `OQ-USERS-01` (5-role) and `OQ-USERS-02` (write authority) resolve. `SIR-AUTH-019` closes via PR-1. Forward-note at next revision. |
| `SPEC-EMP-001` | `OD-EMP-08` resolves: creation stays Admin-only; manager/RM employee authority is action-only, never field-level (D-4b). **Superseded by the employment-lifecycle rework (2026-08-06, PR #354, C-16 note ³):** the three named transitions this row originally deferred to `backend-onboarding`/`backend-hr` were instead delivered inside `employee-management` itself, plus three more (deactivate/reactivate/rehire) the permanent-lifecycle redesign required. `EVT-EMP-ProfileUpdated` (`[OPEN]`) stays open — this rework is status transitions, not field-level edits, so it does not touch that event. **Drift artifact `marked_suitable` (D-3) remains dormant** — the rework's `restore()` writes it (clears it on rehire) but nothing yet sets it `true`; still awaits the CRR §10:163 capability, unaffected by this amendment. |
| `SPEC-ONBOARDING-001` | **Superseded by the employment-lifecycle rework (2026-08-06, PR #354):** this row's premise — that transitions 1, 2 and 4 await a `backend-onboarding` module — no longer holds; those transitions are delivered in `employee-management` (C-16 note ³). `backend-onboarding` remains unbuilt (F-1 still accurate as a *module* statement) but is no longer this ADR's basis for deferring the transitions themselves. `SPEC-ONBOARDING-001` §1/§6.6/§6.7's ownership claim over pool/claim review, approve/reject, and probation-suitability decisioning should be reconciled against this at that spec's next revision — not resolved here. |
| `SPEC-HR-001` (REVIEW) | Owns transition 3 (signed-contract confirmation, `IF-HR-ConfirmContractSigned`) once built — no ownership blocker; `ADR-012` (Accepted 2026-07-12) already settles `backend-hr` as owner, Onboarding as consumer. This ADR does not build the route (F-2). **Separately noted, not caused by this ADR:** `SPEC-HR-001`'s own Document Control still reads architecture `BLOCKED`/`OD-HR-01a` "disclosed, not resolved" because the spec predates `ADR-012` by 13 days and was never re-synchronized against it — a pre-existing documentation-sync gap (§9 risk note). |
| `SPEC-AUTH-001` (FROZEN) | `TREQ-AUTH-002` gains the RM counterpart token. `OQ-AUTH-13` (RM code token) resolves. `OQ-AUTH-08` (org-chart visibility) resolves to the permission (RM+Admin); the org-chart data model stays open. Forward-note at next revision. |
| `GD-03` | Permission-set half resolved here (D-5, ratified `OQ-030-B`). Org-chart reporting model (`OD-EMP-12`) and `OQ-AUTH-08`'s model half remain open in GD-03. |
| `GD-05`, `GD-06`, `GD-07`, `GD-09`, `GD-15` | Untouched, except: `GD-15` (HR & Employee-Management build scope) now explicitly owns D-4c's three deferred employee-authority transitions. `GD-07` (revocation) is the correct fix for the stale-token window this record accepts (§9). |

No blocking contradiction found against any checked authority.

---

## 9. Consequences and risks

- **Accepted (superseded — `ADR-031` PR-8, 2026-07-27):** an access-token-TTL window during which a changed matrix is not yet reflected in live tokens. There is no revocation mechanism (GD-07). Bounded, documented, not fixed here. **`ADR-031` is that mechanism**: request-time derivation (D-1) plus the `token_generation` revocation counter (D-3/D-4) close this window — a role change, deactivation, or soft delete now takes effect on the demoted/deactivated user's very next request, not at TTL expiry. `GD-07` is resolved.
- **Accepted (superseded — `ADR-031` PR-8, 2026-07-27):** M-2 must re-run on every future matrix change until `ADR-031` lands. **`ADR-031` has landed** (PR-1 through PR-8, `#225`-`#233`): permissions are derived request-time from `ROLE_PERMISSIONS[role]`, never stored, so a future matrix change is a source edit plus a test — no backfill, no per-user data change, no re-run of anything.
- **Irreversible:** M-1 (enum value) and M-4 (flag retirement), both by design.
- **Risk (Critical, mitigated by ordering):** granting `users:write` before PR-1's elevation-guard fix would permit manager→admin escalation.
- **Risk (High, mitigated by PR-3 ordering):** Regional Managers locked out of both mobile apps by `ALLOWED_ROLES`.
- **Risk (Medium):** `REQ-CRM-010` is a Confirmed requirement being narrowed by owner directive. This requires explicit ratification of D-2/D-3, not a silent specification edit.
- **Pre-existing documentation-sync gap (not caused by this ADR):** `SPEC-HR-001`'s Document Control still records architecture `BLOCKED` and `OD-HR-01a`/`OD-HR-01b` "disclosed, not resolved," even though `ADR-012` (Accepted, 2026-07-12) settled that ownership question 13 days before the spec's last text update. F-2 (§2 D-4c) surfaced this while investigating whether contract confirmation was deliverable in this ADR's PR sequence. Recommend a documentation-workflow pass re-synchronize `SPEC-HR-001` against `ADR-012` — out of this ADR's scope, but worth flagging so it isn't mistaken for a live blocker in future sessions.
- **Net effect on the current surface:** managers *lose* nothing they can exercise today (hotel and user writes are already denied in practice) and *gain* scoped user-profile editing plus explicitly bounded hotel operations. Five unscoped read surfaces close. Four security defects close in PR-1.

## 10. Scope note

This record settles the capability set, ownership boundaries, migration plan, and PR sequence. It authors no code, freezes or amends no specification, and performs no knowledge-layer reclassification beyond `DECISION_INDEX.md` registration. On ratification, the `SPEC-CRM-001`/`SPEC-USERS-001`/`SPEC-AUTH-001` forward-notes are deferred to those specifications' own next revisions, per the ADR-022/ADR-023/ADR-025 precedent.

**Known deferred dependencies (outside this ADR's scope):** 
- `SPEC-EMP-001` declares `EVT-EMP-ProfileUpdated` with status `[OPEN]` (§8), awaiting a producing interface that does not exist — it depends on the field-level employee-edit capability this ADR defers to GD-15. The event is correctly flagged open; no producer interface may be added without first resolving GD-15 and defining which employment fields a scoped role may edit.
- `HotelWorker` model dormancy (ADR-022-retired entity; `status=INVITED`, `invited_at` column): the `invited_at` column is written by zero code paths and "invite worker" capability is not introduced by this ADR (Q3, §7 and OQ-030-C). Cleanup of the dormant enum value and column is explicitly deferred to its own PR under ADR-024 scope, not stacked into this sequence.
