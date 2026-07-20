# Implementation Execution Plan

Scope: sequencing only. All behavior, architecture, and requirements are frozen elsewhere
(ten G2 specs, ADR-001..023). This document assumes the reader already holds them and does
not restate spec content, ADR rationale, or requirements. It sequences implementation of the
already-decided defects and target-state builds.

Baseline: `main` @ `b16cc33` (working HEAD `446e82d`). Framework `.claude/` 1.2.0.
Evidence base: `.claude/knowledge/MODULE_MEMORY.yaml`, `MODULE_REGISTRY.yaml`,
`DEPENDENCY_GRAPH.yaml`; live code in `backend/src/`.

---

## 0. Sequencing challenge to the proposed framing (read first)

The commissioning brief proposed: Epic 1 = Critical PATCH fix; Epic 2 = shared
`checkHotelAccess()` / scope-model redesign (because it de-risks downstream modules). Verified
against evidence, that ordering needs one correction:

**The behavior-changing half of the shared `checkHotelAccess()` fix cannot precede the
Hotel-Group epic — it is DATA-blocked, not just risk-ordered.**

- `permissions.ts:105-108` bypasses membership for `admin | manager | checker`. Closing the
  sibling findings (OQ-AUTH-06, ATT OQ-02 manager-half, QUAL OQ-03/OQ-09, CRM OQ-CRM-17,
  ANALYTICS OQ-ANALYTICS-12) means enforcing *deny-by-default scoping for managers*.
- To scope a manager you must know which hotels a manager governs. `checkHotelAccess()` today
  reads `hotelWorker` ACTIVE membership (`permissions.ts:122-131`) — but managers are
  deliberately not on the worker roster (that is *why* they bypass). There is **no existing
  column, claim, or table** linking a manager to hotels. `User.scope` / `Session.scope` and
  `Hotel.hotel_group_id` do not exist in `schema.prisma` yet; ADR-023's discriminated JWT
  `scope` claim (`{type:hotel|hotel_group|global}`) is target-only.
- Therefore the *only* data that lets `checkHotelAccess()` correctly allow-or-deny a manager is
  produced by Epic 5 (Hotel-Group / ADR-023). The behavior flip belongs **inside Epic 5**.

Consequence for the plan:
- Epic 1 (Critical) is **independent of** the shared redesign and ships first, using the
  in-service deny-by-default pattern already present in `assignments/service.ts::getById()` — it
  does **not** wait for, and does **not** consume, `checkHotelAccess()`.
- The shared-primitive work is split: an early, unblocked **centralization seam** (Epic 3, pure
  refactor, no allow/deny change) and the **behavior flip** (folded into Epic 5, gated on the
  scope claim existing).
- The two self-contained Auth High findings (OQ-AUTH-04, OQ-AUTH-15) have no HotelGroup
  dependency and are pulled forward (Epic 2), runnable in parallel with Epic 1.

Open question escalated, not decided (see Epic 3 / Epic 5): OQ-AUTH-06 is an exploitable-now
High whose *correct* fix is data-blocked on Epic 5. Whether to ship an interim mitigation
(e.g. deny manager cross-tenant entirely until the scope model lands, accepting a functional
regression for legitimate multi-hotel managers) is a risk-acceptance decision reserved for the
human. This plan does not choose it.

---

**Numbering note (2026-07-20):** Epic 4 was superseded as a no-op by implementation verification
(see §2). Epic IDs are stable identifiers assigned at planning time, not sequence positions —
Epic 4's slot is retired in place and Epic 5/6/7 keep their original numbers rather than shifting
down. Do not renumber.

## 1. Epic order (dependency-ordered)

| # | Epic | Resolves (spec / finding IDs) | Blocked by | Notes |
|---|------|-------------------------------|-----------|-------|
| 1 | Critical: guard `PATCH /assignments/:id` | SPEC-JOB-DISPATCH-001 FIND-SEC-001 / OQ-01 | none | Ship first. In-service guard, no shared-file touch. |
| 2 | Auth self-contained High findings | SPEC-AUTH-001 OQ-AUTH-04, OQ-AUTH-15 | none | Parallel with Epic 1. No HotelGroup dependency. |
| 3 | Shared authorization centralization seam | (closes nothing yet) precondition for OQ-AUTH-06 & siblings | none | Pure refactor + characterization tests. No allow/deny change. Optional but de-risks Epic 5's flip. |
| 4 | ~~Attendance worker-side hotel-scoping (partial)~~ | SPEC-ATT-001 OQ-02 | — | **SUPERSEDED by implementation verification (2026-07-20) — no-op, see §2.** |
| 5 | Hotel-Group / EMP / CRM migration (ADR-022 + ADR-023) | OD-EMP-05; ADR-022 retirement; **behavior-flip closure of** OQ-AUTH-06, ATT OQ-02 (manager half), QUAL OQ-03/OQ-09, CRM OQ-CRM-17, ANALYTICS OQ-ANALYTICS-12 | Epic 3 (seam) recommended; ADR-022/023 (ratified) | The large epic. Schema migration = highest rollback risk. |
| 6 | Quality / CRM / Analytics remaining G8 mediums/lows | QUAL OQ-01/02/04/05/07/08; CRM OD-CRM-02..17 (non-blocked); ANALYTICS OQ-ANALYTICS-02..11 (non-blocked) | headline OQs (QUAL OQ-01, ANALYTICS OQ-ANALYTICS-03) need a Decision Record first | Only sequence items not gated on an open Decision Record. |
| 7 | Notifications G8 cleanup | SPEC-NOTIF-001 OQ-NOTIF-02..09 (non-blocked) | OQ-NOTIF-01 Decision Record blocks push-channel (TREQ-002/TREQ-012) | Fully independent of the auth epics; parallelizable throughout. |

Deferred / not sequenced here (blocked on human authority, correctly excluded):
- **ATT OQ-03** — cross-owner EXPECTED-row seed. Architecture BLOCKED; needs a Decision Record
  before the coupling may be touched. Sequencing dependency only; not an implementation task in
  this plan. (Note: ADR-018 classified the accept-transaction coupling SUPERSEDED-BY-PIVOT — the
  live-code removal lands as part of the Job-Dispatch pivot build, which is itself out of the
  current defect-remediation scope; flag if it enters scope.)
- **SYNC-001** owner assignment (platform-wide) — reserved human authority, not implementation.
- **SPEC-CHATBOT-001, SPEC-GEO-001** — REVIEW stubs, out of scope.
- **Headline open decisions** (QUAL OQ-01 1-5 vs 0-100 rating; ANALYTICS OQ-ANALYTICS-03 metric
  definition; NOTIF OQ-NOTIF-01 channel enum) — each blocks its module's *implementation
  planning* per its ART-MEM open_prerequisites; the dependent PRs cannot be authored until the
  Decision Record lands. Escalate, do not invent the decision.

---

## 2. PR order within each epic

### Epic 1 — Critical: `PATCH /assignments/:id`
- **PR 1.1** — Authorization guard on `AssignmentService.update()`.
  - Files: `backend/src/modules/assignments/service.ts` (add deny-by-default check in `update()`
    mirroring the existing `getById()` block, lines 60-81); no route/controller signature change.
  - Pattern: non-admin/non-manager actor may transition only an assignment where
    `assignment.worker_id === actor.userId`, else an ACTIVE `hotelWorker` membership on
    `assignment.hotel_id` — identical shape to `getById()`. Deny-by-default (throw
    `ForbiddenError`) otherwise.
  - Do **not** widen scope: keep this PR to the guard + its regression test only. No refactor of
    `checkHotelAccess()`, no route-middleware change (`assignments/routes.ts` intentionally does
    not import `permissions-middleware`).
  - Test: `backend/src/__tests__/assignments-update-authz.test.ts` (see §7).
- (No second PR. A Critical guard is its own PR, not bundled.)

> Interim-vs-target note: the frozen target direction is role×scope deny-by-default per ADR-023's
> JWT `scope` claim. That claim does not exist yet (Epic 5). PR 1.1 is the **interim closure**
> using the already-shipped in-service membership pattern; migrating this guard onto the ADR-023
> scope claim is a task inside Epic 5's authz-flip PR, not a reason to delay the Critical.

### Epic 2 — Auth self-contained High findings
- **PR 2.1** — OQ-AUTH-04: remove JWT refresh-secret fallback (fail closed if the dedicated
  refresh secret is unset). Files: `backend/src/modules/auth/*` (token issuance/verify),
  `backend/src/config/env.js`. Test: `auth-refresh-secret.test.ts` (assert startup/verify
  rejects when refresh secret absent; no fallback to access secret).
- **PR 2.2** — OQ-AUTH-15: hash `Session.refresh_token` at rest (store digest, compare on
  refresh). Files: `backend/src/modules/auth/service.ts`, `schema.prisma` (if a column
  rename/format change is needed — coordinate migration; see §8). Test:
  `auth-refresh-token-hash.test.ts` (assert stored value is not the raw token; refresh still
  validates).
- PR 2.1 and PR 2.2 are independent of each other and may land in either order; keep them
  separate for reviewability. **OQ-AUTH-06 is not in this epic** — it is data-blocked (see Epic 5).

### Epic 3 — Shared authorization centralization seam
- **PR 3.1** — Extract role→scope resolution from `checkHotelAccess()` into a single, unit-tested
  function without changing the effective allow/deny set (characterization tests lock current
  behavior first). Files: `backend/src/middleware/permissions.ts`. Every current consumer
  (users, crm, hotel-workers, work-requests, attendance, quality, hr, analytics, calendar per
  the `permissions-middleware` consumer list) keeps identical behavior. This PR closes no
  finding; it creates the single injection point the Epic 5 flip needs.

### Epic 4 — ~~Attendance worker-side hotel-scoping (partial)~~ SUPERSEDED (no-op)

**Status: SUPERSEDED by implementation verification, 2026-07-20.** This epic is not implemented
and is not carried forward with a renumbered successor — Epic 4's slot is retired in place; Epic
5 keeps its own number as a stable identifier (see §1 note).

This epic's premise — that a non-data-blocked "worker half" of OQ-02 exists and is closable today
via the `hotelWorker` ACTIVE-membership primitive (mirroring Epic 1) — does not hold up against
the authoritative sources it claims to resolve:

- **`SIR-ATT-002`** (`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md:121`) and **`RULE-008`**
  (`docs/03-modules/attendance/MODULE_SPEC.md:185`) both describe OQ-02 as a single-dimension
  finding: **admin/manager/checker have no hotel-scoping on management actions** (verify,
  status/minutes override, list). Neither names a worker-role gap.
- Live code (`backend/src/modules/attendance/service.ts:85-89,111-115,129-134`, confirmed
  unchanged since `SPEC-ATT-001`'s repository-revision citation) already forces every non-management
  actor to `worker_id === actor.userId` in `list()`, `getById()`, and `update()` — strictly
  *tighter* than hotel-scoping, with no bypass. There is no worker-side defect to close.
- Of OQ-02's three named roles: **admin** stays global by design (not a defect); **checker** is
  confirmed cross-hotel by design (`docs/03-modules/attendance/MODULE_SPEC.md`'s own framing,
  consistent with this plan's Epic 5 note that "checker per its confirmed cross-hotel disposition"
  is a design decision, not a bug); **manager** is the one genuinely open case, and it is
  data-blocked on the same missing scope-claim data as the auth-wide `checkHotelAccess()` finding
  (see §0) — deferred to Epic 5 PR 5.5, not enforceable today.

No non-data-blocked, non-by-design slice of OQ-02 remains for a standalone PR 4.1 to close.
Implementing hotel-membership scoping on the worker path anyway would add a restriction no open
finding requires, while leaving the actual High-severity, G2-blocking gap (admin/manager/checker
management-action scoping) untouched — inventing a requirement rather than resolving one
(Constitution §12: "never convert an assumption into a requirement").

**Disposition:** OQ-02 remains OPEN in the Specification Issues Register, unchanged by this
correction — closure still requires Epic 5 PR 5.5 (the scope-claim-gated authz flip). No code was
written or merged for this epic; no regression test file (`attendance-scoping-authz.test.ts`) was
created. This section is retained (struck through, not deleted) per the register's append-only,
never-delete-history convention.

### Epic 5 — Hotel-Group / EMP / CRM migration (ADR-022 + ADR-023)
Ordered PRs (each independently reviewable; schema PRs isolated):
- **PR 5.1** — Schema: add `HotelGroup {id,name,billing_info,regional_manager_user_id}` and
  `Hotel.hotel_group_id` (nullable first) to `schema.prisma` + Prisma migration. Additive only,
  no backfill, no reads. (Isolation minimizes rollback blast radius — see §8.)
- **PR 5.2** — CRM: HotelGroup CRUD + RM assignment (`backend-crm` owns the entity per ADR-023
  §2). Files: `backend/src/modules/crm/*`.
- **PR 5.3** — Data backfill: assign existing hotels to groups; make `hotel_group_id` required
  after backfill verified. Separate reversible migration + a dry-run/verification script.
- **PR 5.4** — Auth scope-claim issuance: `backend-auth` computes the discriminated
  `{type:hotel|hotel_group|global}` claim at token issuance (read-only over HotelGroup /
  Hotel.hotel_group_id / manager assignment, ADR-023 §6). Files: `backend/src/modules/auth/*`,
  `schema.prisma` (User/Session scope field if the claim is persisted).
- **PR 5.5 — the authz flip (closes the shared findings).** Change `checkHotelAccess()` (via the
  Epic 3 seam) from blanket admin/manager/checker bypass to: admin=global; manager=scope-bound
  via the PR 5.4 claim; checker per its confirmed cross-hotel disposition. Closes OQ-AUTH-06,
  ATT OQ-02 (manager half), QUAL OQ-03/OQ-09, CRM OQ-CRM-17, ANALYTICS OQ-ANALYTICS-12. Requires
  a per-consumer regression test (one authz test file per affected module) because this is a
  high-blast-radius shared-middleware behavior change.
- **PR 5.6** — EMP employment-record build on `backend-hr` (currently a stub throwing
  `NotImplementedError`), repurposing the HotelWorker roster per ADR-022; `hotel_group_id` FK to
  CRM's HotelGroup.
- **PR 5.7** — Dual-write / cutover from `backend-hotel-workers` to `backend-hr`.
- **PR 5.8** — Retire `backend-hotel-workers` (physical removal), gated on PR 5.6/5.7 verified.

> **Open architecture question for Epic 5 (flag, do not decide):** ADR-022/023 define the target
> state and P2 prerequisites but do **not** prescribe the cutover *mechanism* — specifically
> whether PR 5.7 is a synchronous dual-write, a read-through shim, or a flag-gated hard cutover,
> and whether the authz flip (PR 5.5) must land before or after the roster cutover (PR 5.7).
> Both touch manager scoping. This is a genuine open sequencing decision not answered by
> ADR-022/023 — escalate for a Decision Record before PR 5.5/5.7 are authored.

### Epic 6 — Quality / CRM / Analytics remaining G8 items
- Sequence only items not gated on an open Decision Record. Author QUAL OQ-01 (1-5 vs 0-100) and
  ANALYTICS OQ-ANALYTICS-03 (metric definition) dependent PRs **after** their Decision Records
  land — do not pre-build. One PR per finding, per module, sized to a single acceptance criterion.

### Epic 7 — Notifications G8 cleanup
- Non-push items (OQ-NOTIF-02..09 not gated by OQ-NOTIF-01) each as their own small PR. Push /
  channel work (TREQ-002, TREQ-012) is blocked on the OQ-NOTIF-01 Decision Record (Notification
  channel enum shape) — do not author until it lands.

---

## 3. Dependency graph (epics / PRs)

```
Epic 1 (PR 1.1) ──────────────┐  (independent; ships first)
Epic 2 (PR 2.1, PR 2.2) ──────┤  (independent; parallel with Epic 1)
Epic 3 (PR 3.1) ──────────────┘──> Epic 5 PR 5.5 (seam is the injection point for the flip)
Epic 4 — SUPERSEDED (no-op, see §2): no edge into Epic 5; nothing to schedule.
                                       │
                                       ▼
Epic 5:  PR 5.1 ─> PR 5.2 ─> PR 5.3 ─> PR 5.4 ─> PR 5.5 (authz flip: closes OQ-AUTH-06,
                                                          ATT OQ-02 mgr-half, QUAL OQ-03/09,
                                                          CRM OQ-CRM-17, ANLY OQ-12)
         PR 5.1 ─> PR 5.6 ─> PR 5.7 ─> PR 5.8 (hotel-workers retirement)
         [PR 5.5 vs PR 5.7 relative order = OPEN — see Epic 5 escalation]

Epic 6, Epic 7: no edge into 1–5; gated only on their own module Decision Records.
```

Justification from real `DEPENDENCY_GRAPH.yaml` edges (not invented):
- **Epic 1 does not conflict with Epic 3/5's shared file.** `assignments` was removed from the
  `permissions-middleware` consumers list (2026-07-08, DEPENDENCY_GRAPH consumers note);
  `assignments/routes.ts` imports only `authMiddleware`. Epic 1 touches
  `assignments/service.ts`; Epic 3/5 touch `middleware/permissions.ts`. Disjoint files → no
  merge conflict, no ordering constraint between them. **Epic 1 correctly precedes Epic 3.**
- **Epic 5 PR 5.5 depends on the scope claim (PR 5.4), which depends on the HotelGroup entity
  (PR 5.1/5.2/5.3).** `state-hotel` is owned by `backend-crm`; `Hotel.hotel_group_id` and the
  JWT claim are net-new state. No existing edge supplies manager→hotel scope (confirmed absent).
- **checkHotelAccess() is consumed by 9 modules** (`permissions-middleware.consumers`): users,
  crm, hotel-workers, work-requests, attendance, quality, hr, analytics, calendar. PR 5.5 is
  therefore high-blast-radius and must land as one atomic behavior change with per-consumer
  regression coverage — it is why the Epic 3 seam is introduced first.
- **Notifications (Epic 7) shares no authz file and no shared state with the auth epics.** Its
  only cross-module edges are inbound `calls` to `notification-service` from work-requests,
  work-applications, attendance, quality (fire-and-forget). Fully parallelizable.

---

## 4. Parallelizable work (no shared-file / shared-state conflict)

Concurrent-safe tracks (verified disjoint file sets):
- **Epic 1** (`assignments/service.ts`) ∥ **Epic 2** (`auth/*`, `config/env.js`) ∥ **Epic 7**
  (`notifications/*`). No overlap.
- **Epic 3** (`middleware/permissions.ts`) can run alongside Epic 1 and Epic 2 (different files),
  but **serializes before** Epic 5 PR 5.5.
- ~~Epic 4~~ SUPERSEDED (no-op, see §2) — nothing to schedule.
- **Epic 6 and Epic 7** are mutually parallel and parallel to the entire auth track (Epics 1-3),
  provided their own Decision-Record-gated items are excluded.

Serialize (do **not** parallelize):
- Within Epic 5, the schema/backfill chain PR 5.1→5.3 and the claim→flip chain PR 5.4→5.5 must be
  ordered; PR 5.5 must not merge concurrently with any other PR editing `middleware/permissions.ts`
  (i.e. hold Epic 3 done, and quiesce that file during the flip).
- Any two PRs both editing `schema.prisma` (e.g. Epic 2 PR 2.2 if it needs a column, and Epic 5
  PR 5.1) must be serialized to avoid migration-history conflicts — sequence PR 2.2 before Epic 5
  opens, or rebase.

---

## 5. Branch strategy

Established repo pattern (confirmed from `git branch -a` and merge history #157/#166/#170-175):
**one branch per PR, named `claude/<slug>`, targeting `main` directly, merged via GitHub PR.**

Recommendation:
- **Epics 1-4, 6, 7: keep the established pattern** — each PR is a `claude/<slug>` branch onto
  `main`. These epics are 1-3 PRs each and independently shippable; no integration branch needed.
  Suggested slugs: `claude/fix-assignments-patch-authz` (1.1),
  `claude/auth-refresh-secret-no-fallback` (2.1), `claude/auth-hash-refresh-token` (2.2),
  `claude/permissions-scope-seam` (3.1), `claude/attendance-hotel-scoping` (4.1).
- **Epic 5: recommend a long-lived integration branch exception** — `claude/epic-hotel-group`.
  Reason: PR 5.1-5.8 form an ordered chain with a schema migration + backfill + cutover that is
  *not individually shippable to `main`* (a half-migrated `main` — HotelGroup table present but no
  backfill, or claim issued but flip not landed — is an inconsistent, partially-exploitable
  state). Land PRs 5.x onto the integration branch with review, run the full suite there, and
  merge the integration branch to `main` only at consistent checkpoints (e.g. after PR 5.3 the
  schema+backfill is coherent; after PR 5.5 the authz is coherent; after PR 5.8 retirement is
  coherent). This is the one justified deviation from direct-to-`main`.

---

## 6. Definition of Done (per PR, checkable)

A PR is Done only when all apply:
1. **Build + typecheck + full backend suite green.** Baseline is 149/149 (per SIR-ANLY-001 note);
   no net-new failures. Run the repo's existing test command over `backend/src/__tests__/`.
2. **Security finding closed with a named regression test.** For any PR resolving an OQ-*/FIND-*/
   SIR-* finding, a test asserting the closed behavior exists and its docstring cites the exact
   finding id (precedent: `analytics-leaderboard-authz.test.ts` cites S0-6 / OQ-ANALYTICS-01 /
   SIR-ANLY-001). Removing the guard must fail the suite.
3. **Spec acceptance criteria met, cited by section.** The PR references the frozen spec section /
   RULE-* / REQ-* it satisfies — e.g. Epic 1 cites SPEC-JOB-DISPATCH-001 RULE-set governing
   assignment-status transitions and FIND-SEC-001/OQ-01; Epic 5 PR 5.5 cites ADR-023 §5/§6 scope
   semantics, SPEC-ATT-001 RULE-008/OQ-02, and each closed sibling OQ (Epic 4 superseded, see §2 —
   its OQ-02 closure folds entirely into PR 5.5, there being no separate worker-side sub-part).
4. **No net-new repository-integrity findings.** No new unresolved item introduced into the
   Specification Issues Register; register synchronized (append/resolve, never delete) as a
   Documentation/Post-flight exit condition.
5. **Knowledge synchronized.** If owned-state / contract / dependency changed (Epic 5 schema PRs,
   the checkHotelAccess flip), update `.claude/knowledge/` (DEPENDENCY_GRAPH, MODULE_REGISTRY,
   and the affected ART-MEM invalidation keys) in the same or an immediately-following sync PR.
6. **Scope discipline.** No behavior outside the PR's stated finding/criterion; a Critical guard
   PR contains no refactor (Epic 1), a seam PR changes no allow/deny set (Epic 3).
7. **Rollback documented** in the PR body per §8 (especially any `schema.prisma` PR).

Partial-closure honesty rule: a PR that closes only part of a multi-part finding (Epic 1 as
interim-vs-ADR-023-target) must state which sub-part remains open and where it is sequenced, so no
finding is marked fully closed prematurely. (OQ-02 itself turned out not to be multi-part — see
Epic 4's supersession note in §2 — so it closes in full at Epic 5 PR 5.5, not partially at an
earlier epic.)

---

## 7. Testing strategy

Existing pattern in `backend/src/__tests__/` (verified): Jest + supertest, mounting the real
module router over a minimal express app, `jest.mock` of `authMiddleware` to inject a
test-controlled `req.auth`, `jest.mock` of `getPrisma` for the membership/DB lookups, `jest.mock`
of the controller to isolate authorization from business logic, asserting HTTP 403/200 and
`error === 'ForbiddenError'`. Security-regression files are named `<module>-<concern>-authz.test.ts`
with a docstring citing the finding id (canonical example: `analytics-leaderboard-authz.test.ts`).
General module behavior lives in `<module>.test.ts` (e.g. `assignments.test.ts`,
`attendance.test.ts`, `auth.test.ts`).

Per-epic test structure:
- **Epic 1** → `assignments-update-authz.test.ts`. Docstring cites FIND-SEC-001 / OQ-01.
  Cases: worker transitioning own assignment (200/allowed); worker transitioning another
  worker's assignment (403); worker with ACTIVE membership on the hotel (per `getById` parity —
  match whatever `getById` allows); admin/manager (allowed); deny-by-default for unknown role.
  Mirror the mock scaffolding of `analytics-leaderboard-authz.test.ts`. Also extend
  `assignments.test.ts` for the happy-path transition regressions.
- **Epic 2** → `auth-refresh-secret.test.ts` (no-fallback), `auth-refresh-token-hash.test.ts`
  (at-rest digest). Cite OQ-AUTH-04 / OQ-AUTH-15.
- **Epic 3** → characterization tests over `checkHotelAccess()` locking *current* allow/deny for
  each role before the refactor; the refactor must keep them green (proves no behavior change).
- ~~Epic 4~~ SUPERSEDED (no-op, see §2) — no test file authored; ATT OQ-02 test coverage moves
  entirely to Epic 5 PR 5.5 below.
- **Epic 5 PR 5.5** → one authz regression test per affected consumer module
  (`<module>-scope-authz.test.ts`) each citing its closed OQ (OQ-AUTH-06, ATT OQ-02, QUAL
  OQ-03/09, CRM OQ-CRM-17, ANALYTICS OQ-ANALYTICS-12), asserting manager is now scope-denied
  cross-tenant and admin remains global. PR 5.1-5.3 need migration up/down tests and a backfill
  verification script.
- **Epics 6/7** → one behavior test per finding PR, named for the module + finding.

---

## 8. Rollback strategy (per epic)

This is a live modular monolith on a shared PrismaClient / single PostgreSQL (BaseService,
`lib/db.ts`). Code-only PRs are low-risk; schema PRs are the high-risk case.

- **Epic 1, 2 (code path 2.1), 3, 4, 6, 7 — code-only.** Rollback = `git revert` the PR / redeploy
  prior artifact. No data migration, no state shape change. Safe and immediate. Epic 3 is a pure
  refactor so revert is fully behavior-neutral.
- **Epic 2 PR 2.2 (hash refresh token) — mixed.** If it changes the `Session.refresh_token` column
  format, rollback must handle in-flight sessions: prefer an additive column + dual-read window,
  or accept forced re-login on revert (document which). Do not do an irreversible in-place column
  rewrite without a down-migration.
- **Epic 5 — highest rollback risk (schema migration).**
  - PR 5.1 (additive, nullable `hotel_group_id` + new table): reversible via a down-migration
    dropping the column/table *provided no PR that reads it has shipped*. Keep additive and
    unread until 5.2+.
  - PR 5.3 (backfill + NOT NULL): the dangerous step. Require (a) a dry-run/verification script
    proving every hotel maps to a group before flipping NOT NULL, (b) a down-migration that
    re-nullables and preserves data, (c) a DB snapshot/backup taken immediately before apply.
    Never destructive.
  - PR 5.5 (authz flip): code-only revert, but reverting re-opens OQ-AUTH-06 & siblings — treat
    revert as a security-incident path, not a routine rollback; prefer roll-forward.
  - PR 5.7/5.8 (cutover + hotel-workers retirement): do **not** physically remove
    `backend-hotel-workers` (PR 5.8) until 5.6/5.7 have soaked; retirement should be the last,
    separately-gated, independently-revertible step. Keep a compatibility read-path until then.
  - Because a partially-applied Epic 5 leaves `main` inconsistent, this is precisely why Epic 5
    uses the integration branch (§5): rollback granularity is the whole coherent checkpoint, not
    an individual mid-chain PR on `main`.

---

## 9. Unmapped-criterion / escalation ledger (must be resolved before the affected PR is authored)

| Item | Why it blocks | Reserved to |
|------|---------------|-------------|
| OQ-AUTH-06 interim mitigation vs wait-for-Epic-5 | Correct fix data-blocked; exploitable now | Human risk acceptance |
| Epic 5 cutover mechanism + PR 5.5-vs-5.7 order | Not prescribed by ADR-022/023 | Architecture Decision Record |
| ATT OQ-03 cross-owner EXPECTED-seed | Architecture BLOCKED | Decision Record |
| QUAL OQ-01 (1-5 vs 0-100 rating) | Blocks QUAL implementation planning | Decision Record |
| ANALYTICS OQ-ANALYTICS-03 (metric definition) | Blocks ANALYTICS implementation planning | Decision Record |
| NOTIF OQ-NOTIF-01 (channel enum shape) | Blocks TREQ-002/TREQ-012 | Decision Record |
| SYNC-001 owner assignment | Platform-wide | Human authority |

Every G2 acceptance criterion for the in-scope findings is mapped to a PR in §2; every criterion
gated on an unresolved decision is listed above rather than silently assigned.
