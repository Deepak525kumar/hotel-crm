# Implementation Execution Plan

Scope: sequencing only. All behavior, architecture, and requirements are frozen elsewhere
(ten G2 specs, ADR-001..028). This document assumes the reader already holds them and does
not restate spec content, ADR rationale, or requirements. It sequences implementation of the
already-decided defects and target-state builds.

Baseline: `main` @ `b16cc33` (working HEAD `446e82d`). Framework `.claude/` 1.2.0.
Evidence base: `.claude/knowledge/MODULE_MEMORY.yaml`, `MODULE_REGISTRY.yaml`,
`DEPENDENCY_GRAPH.yaml`; live code in `backend/src/`.

---

## Post-#194 re-verification & planning conclusion (2026-07-23, HEAD `9ca0eed`)

PR #194 (Epic 8) is merged into `main`. This pass re-verified the whole epic surface
**against `backend/src/` code at HEAD `9ca0eed`, not commit history**, recalculated the
dependency graph, and re-planned. Recorded as `SYNC-053`.

- **Code-verified complete:** Epics **1, 2, 3, 5, 8** and the **headline items of Epics 6
  and 7**. Spot checks: `assignments/service.ts` deny-by-default guard; `auth/service.ts`
  `hashRefreshToken` + refresh-secret fail-closed; `middleware/permissions.ts`
  `resolveHotelAccess()` seam + `FEATURE_SCOPE_AUTHZ`; `schema.prisma` `HotelGroup` /
  `Hotel.hotel_group_id` / `manager_user_id` / JWT `scope`; `Rating.score`/`Verification.score`
  `0–100`; `RoomsCompletedEntry`; `NotificationChannel.WEBHOOK`; `work-requests` +
  `work-applications` `service.ts` importing and calling `isHotelInScope()`. **Epic 4**
  remains SUPERSEDED (no-op).
- **Health gates at HEAD:** backend **367/367 tests** (39 suites) green; `tsc --noEmit`
  clean; `context-loader.js --validate` Errors:0; `repository-integrity-check.js` exit 0
  (0 new blocking; 56 pre-existing WARN orphan/link findings, unchanged in kind).
- **Dependency graph recalculated:** the Epic 8 consumer relationship
  (`backend-work-requests` / `backend-work-applications` → `isHotelInScope` shared scope
  primitive) is recorded in `DEPENDENCY_GRAPH.yaml`'s `permissions-middleware` note; all
  index `observed_revision` stamps rebound `09e0b16`/`2886267` → `9ca0eed` (SYNC-053),
  content re-verified coherent.
- **Planning conclusion — no autonomous implementation available.** After Epic 8, **no
  unblocked, spec-traceable application-code epic remains.** Of 210 open/blocked
  `SPECIFICATION_ISSUES_REGISTER.md` rows, 209 need `human` / `human/architecture` /
  `human/product` authority and 1 needs `architecture/human` (`SIR-EMP-014`). The only
  non-`human` rows (`SIR-HR-018`, `SIR-HR-019`, `SIR-USERS-017`) are documentation /
  knowledge-graph spec-revision items **locked under Implementation Mode**, not
  application epics. Every remaining epic (Epic 6 non-headline QUAL/CRM/ANALYTICS items;
  Epic 7 push/dispatch design + `OQ-NOTIF-02..09`; the `hr`/`calendar`/`chatbot`/`geo`
  module builds) is gated on a **Constitution-reserved governance decision** or a
  REVIEW-status spec. Per the task's own stop condition, this pass **stops at the
  governance gate** rather than inventing a requirement (Constitution §12).
- **Fresh baseline:** see `docs/implementation/COMPLETION_REPORT_2026-07-23.md`.

---

## Verification pass (2026-07-23, repository-wide re-planning)

Re-verified against `main` @ `ea7be36` (current `HEAD`), framework `.claude/` 1.5.0. Method:
`git log --oneline` cross-checked against each epic's stated PR set, plus a direct read of the
current `backend/src/` code for every epic below (not just the governance register, which was
independently found stale on one row — see note under Epic 1).

- **Epics 1, 2, 3, 5 are COMPLETE**, verified in code, not just by commit message:
  - Epic 1: `backend/src/modules/assignments/service.ts::update()` carries the deny-by-default
    guard (PR #178, `9495c5b`/`58f88d7`). **Governance-register drift found and corrected**:
    `SPECIFICATION_ISSUES_REGISTER.md` `SIR-JOBD-001` still read `OPEN — CRITICAL` despite the
    fix shipping well before this session's baseline; corrected to `RESOLVED` in this pass.
  - Epic 2: `backend/src/modules/auth/*` has no refresh-secret fallback and hashes
    `Session.refresh_token` at rest (`be1c4fd`).
  - Epic 3: `resolveHotelAccess()` is the single seam in `backend/src/middleware/permissions.ts`
    (`4c7437e`).
  - Epic 5: PR 5.1–5.8 all merged (`3cca62d`/`4cf91f2`/`914d6cd`/`c32d4fc`/`643d5fc`/`eaf17d0`/
    `04b2137`/`0fc7ab8`); `backend-hotel-workers` retired; JWT `scope` claim live; manager
    authz flip live (flag `FEATURE_SCOPE_AUTHZ`, default on).
- **Epic 4** stays SUPERSEDED (no-op) — unchanged from the 2026-07-20 correction, still accurate.
- **Epic 6 headline item (QUAL OQ-01) is COMPLETE**: `Rating.score` is 0–100 in
  `backend/prisma/schema.prisma:570`, migration `20260722180000_rescale_rating_score_to_0_100`
  applied with a paired `down.sql`. The Analytics headline item (OQ-ANALYTICS-03) is also
  COMPLETE: `RoomsCompletedEntry` shipped (`084e77e`, migration
  `20260723000000_add_rooms_completed_entry`, paired `down.sql` added by `d3389de`). **No other
  Epic 6 sub-item (QUAL OQ-02/04/05/07/08; CRM OD-CRM-*; ANALYTICS OQ-02/04-12) is
  implementable** — every one of those rows in `SPECIFICATION_ISSUES_REGISTER.md` is still
  `OPEN` with `Authority needed: human/architecture` or `human/product`, i.e. still genuinely
  gated on an unmade Decision Record, exactly as originally scoped. Re-verified row-by-row this
  pass, not re-derived from the register's own summary prose.
- **Epic 7 dispatch design is now DECIDED**: `OQ-NOTIF-01`'s enum-shape half was closed by `ADR-027`
  (`WEBHOOK` in `NotificationChannel`, `95b1364`); its **dispatch/delivery half, plus `OQ-NOTIF-04/06/07/08/09`,
  are RESOLVED 2026-07-23 by `ADR-029`** (GD-01, Transactional Outbox + dedicated Worker runtime). The
  Epic 7 build (`TREQ-002`/`TREQ-012` and the shared dispatch infrastructure) is now sequenced as PRs
  7.1–7.7 below — no longer blocked on an undecided transport/runtime. Remaining NOTIF opens
  (`OQ-NOTIF-02` retention, `OQ-NOTIF-03`, `OQ-NOTIF-05`) each ship under their own decision.
- **New finding, not covered by any existing epic: `SIR-JOBD-002` / `FIND-SEC-002`/`FIND-SEC-003`
  (High) was never picked up by Epics 1–7** despite being a sibling finding to Epic 1's Critical
  in the same spec section. `DEPENDENCY_GRAPH.yaml`'s `permissions-middleware` consumer list
  correctly lists `backend-work-requests`/`backend-work-applications` as consumers (both import
  `requireRole` from that file) — but verified in code, neither module's `routes.ts` or
  `service.ts` imports `checkHotelAccess`/`resolveHotelAccess`/`isHotelInScope`, so they were
  never routed through the seam Epic 3/5 built and Epic 5 PR 5.5 had nothing to flip for them;
  this is new scope-authz to add, not a missed flip. This is scheduled
  below as **Epic 8**, now unblocked (see that section for why the finding's own "remediate vs.
  accept risk pre-pivot" framing resolves itself once Epic 5's scope model is live, which it now
  is — this is a remediation decision, not a risk-acceptance decision, and does not require
  additional human sign-off under Constitution §11/§12; only accepting the risk would).
  **Epic 8 shipped this session** — see its §2 section for the PR content; `SIR-JOBD-002` is
  now `RESOLVED` in the governance register.
- No open item anywhere in the register maps to an unblocked, spec-traceable implementation task
  other than Epic 8. Every other open row is `decision-required`/`architecture`/`ownership` with
  `Authority needed: human*`, deferred-by-design pending another module (Calendar M2), or is
  `SYNC-001` (owner assignment, reserved human authority, unchanged since 2026-07-04 and not a
  new blocker introduced by this pass).

---

## Verification pass (2026-07-24, Epic 7 build-completion sync)

Re-verified against `main` @ `4079a0f` (merge of PR #208, Epic 7 PR 7.7 — mobile push-token
registration), the last commit in the Epic 7 chain. Method: `git log --oneline` cross-checked
against every Epic 7 PR (7.1–7.8) named in §2 below, plus a direct read of the corresponding
`backend/src/modules/notifications/`, `backend/worker/`, `mobile/*/src/` code and each PR's test
suite — not the register's own prior "awaiting implementation authorization" status, which this
pass found stale and corrects.

- **Epic 7 is COMPLETE, all 8 PRs merged and verified in code:** `OutboxEvent` model +
  transactional `enqueue()` (7.1, commits `1e9dad5`/`29f8a0b`); Platform Worker poll/claim/backoff/
  dead-letter runtime (7.2, `b59d352`); all 4 legacy producers (work-requests, work-applications,
  attendance, quality) migrated off `.catch(() => {})` onto `enqueue()` (7.3, `9f96a1b`); EMAIL
  transport via SendGrid/Resend provider abstraction (7.4, `1711c68`); `PushToken` schema + APNs/FCM
  clients + registration endpoint (7.5, `e58e280`/`a5c10b5`/`bb40648`/`b530a5e`); dead-letter
  observability + runbook (7.6, `861bcd2`/`dcf41d7`); multi-app APNs topic support via
  `PushToken.app`/`PushApp` enum (7.8, `efe3ddb`/`3572638`/`0bf74ce`); mobile push-token registration
  + OS permission flow in both Expo apps (7.7, `7c115f1`/`3e4a5b6`). Backend suite green at
  **523/523 tests, 51 suites** (up from 367/39 pre-Epic-7); mobile worker-app and checker-app each
  37/37; `tsc --noEmit` clean; `repository-integrity-check.js` exit 0, 0 blocking findings.
- **The §1 epic table's Epic 7 row and §2's Epic 7 PR table (below) are corrected in place** from
  "DESIGN DECIDED ... awaiting implementation authorization" to **COMPLETE** — that status was
  accurate at the 2026-07-23 write time but is now stale; implementation authorization was granted
  and executed in full between 2026-07-23 and 2026-07-24.
- **Governance register synchronized:** `SIR-NOTIF-004/006/007/008/009` already carried `RESOLVED —
  2026-07-23, ADR-029` dispositions naming the not-yet-merged Epic 7 PRs as the implementation
  vehicle; those PRs are now confirmed merged, so no further register edit is required — the prior
  entries were forward-looking and are now simply corroborated, not corrected.
  `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md`'s GD-01 entry and MVP-blocking list are
  synchronized in the same pass (see that file's own dated marker).
- **No new epic identified.** Epic 8 (from the 2026-07-23 pass) remains the last-numbered epic; no
  Epic 9 is opened by this pass. Full audit trail: `docs/15-audits/REPOSITORY_AUDIT_2026-07-24.md`.

---

## Verification pass (2026-07-29, post GD-19/20/21/22/23 governance resolution)

Re-verified against `main` @ `586a55d` (governance resolution + review-feedback commits,
2026-07-28/29 — the repository's final MVP governance decisions). Method: read `ADR-054` through
`ADR-059` directly (not summaries), cross-checked against `docs/implementation/GOVERNANCE_REGISTER.md`
Part 2 and `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`'s per-row status, confirmed against
live `backend/src/` code.

- **No new epic opened by GD-20 (Job-Dispatch two-tier pivot).** `ADR-054`–`ADR-058` ratify the
  target architecture, broadcast lifecycle, assignment model, background-execution mechanism, and
  migration strategy — but each closes with "no code changes are made or authorized by this
  record" (verbatim, all five). `ADR-058` names an explicit eligibility gate: implementation
  becomes architecturally eligible only "once `GD-03` (roles/org-chart) is resolved." `GD-03`'s
  org-chart/reporting-model half (`OD-EMP-12`) is independently confirmed still open
  (`GOVERNANCE_REGISTER.md` Part 2 closing note; `SPECIFICATION_ISSUES_REGISTER.md` `OD-EMP-12`
  row). `SIR-JOBD-006` (`MIG-GAP-01..12`) remains `OPEN — deferred by design`, unchanged in status
  by GD-20's resolution (which ratified the destination, not the journey). **This plan does not
  open an Epic 9 for Job-Dispatch.** When `GD-03`'s org-chart half is separately resolved, a future
  planning pass must open an epic sequencing `MODULE_SPEC.md`'s own Phase 1/Phase 2 forward-refactor
  plan (`ADR-058`, ratified unmodified) — that epic does not exist today because building it now
  would implement ahead of the named architectural prerequisite.
- **No new epic opened by GD-21 (Attendance operational automation).** `ADR-059` ratifies
  scheduled reminders + automatic ABSENT/NO_SHOW marking as permanent target architecture but is
  equally explicit: it does not authorize implementation and sets no grace-period or override
  policy; the current manual manager-override path continues unaffected until a future
  implementation decision. No grace-period/trigger-condition policy exists to build against;
  authoring one now would invent a requirement (Constitution §12). **Two small, non-automation
  items GD-21 also resolved were already implemented before this pass and require no new epic,
  only this retroactive record:**
  - `SIR-ATT-001`/`OQ-01` (checker `getById` role-guard alignment to `list`/`update`) —
    `backend/src/modules/attendance/service.ts:163`. Consistency correction, not a governance
    fork.
  - `SIR-ATT-012`/`OQ-11` (`AuditLog.old_values`/`new_values` population) — platform-level fix in
    `backend/src/lib/base-service.ts` (`logAudit()` gains optional `old_values`/`new_values`
    params, backward-compatible), consumed by `attendance/service.ts`'s `checkIn`/`update` audit
    calls.
  Both are already merged (register: `SPECIFICATION_ISSUES_REGISTER.md` lines 121, 132, 470, 472)
  — zero further action; neither is a "new epic."
- **No new epic opened by GD-22 (Hotel-Group billing).** Resolved by disposition; no architecture,
  no code implication. `billing_info` unchanged.
- **Numbering unaffected.** Epic 8 remains the last-numbered epic (per the plan's own §"Numbering
  note"); no Epic 9 is opened by this pass, for the same reason no Epic 9 was opened by the
  2026-07-24 pass — no unblocked, spec-traceable, human-authorized application-code epic exists
  for GD-19 (deferred post-MVP — see `docs/implementation/GD-19_CHATBOT_CHECKPOINT.md`; chatbot
  work must NOT resume), GD-20 (architecturally ineligible pending GD-03), or GD-21 (implementation
  not authorized, no policy to build against).

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

| # | Epic | Resolves (spec / finding IDs) | Blocked by | Notes | Status (2026-07-23) |
|---|------|-------------------------------|-----------|-------|-------|
| 1 | Critical: guard `PATCH /assignments/:id` | SPEC-JOB-DISPATCH-001 FIND-SEC-001 / OQ-01 | none | Ship first. In-service guard, no shared-file touch. | **COMPLETE** (PR #178) |
| 2 | Auth self-contained High findings | SPEC-AUTH-001 OQ-AUTH-04, OQ-AUTH-15 | none | Parallel with Epic 1. No HotelGroup dependency. | **COMPLETE** (`be1c4fd`) |
| 3 | Shared authorization centralization seam | (closes nothing yet) precondition for OQ-AUTH-06 & siblings | none | Pure refactor + characterization tests. No allow/deny change. Optional but de-risks Epic 5's flip. | **COMPLETE** (`4c7437e`) |
| 4 | ~~Attendance worker-side hotel-scoping (partial)~~ | SPEC-ATT-001 OQ-02 | — | **SUPERSEDED by implementation verification (2026-07-20) — no-op, see §2.** | SUPERSEDED (no-op) |
| 5 | Hotel-Group / EMP / CRM migration (ADR-022 + ADR-023) | OD-EMP-05; ADR-022 retirement; **behavior-flip closure of** OQ-AUTH-06, ATT OQ-02 (manager half), QUAL OQ-03/OQ-09, CRM OQ-CRM-17, ANALYTICS OQ-ANALYTICS-12 | Epic 3 (seam) recommended; ADR-022/023 (ratified) | The large epic. Schema migration = highest rollback risk. | **COMPLETE** (PR 5.1–5.8, all merged) |
| 6 | Quality / CRM / Analytics remaining G8 mediums/lows | QUAL OQ-01/02/04/05/07/08; CRM OD-CRM-02..17 (non-blocked); ANALYTICS OQ-ANALYTICS-02..11 (non-blocked) | headline OQs (QUAL OQ-01, ANALYTICS OQ-ANALYTICS-03) — **both now RESOLVED** (`ADR-026`, `ADR-028`); no remaining Decision Record blocker for this epic's headline items | Only sequence items not gated on an open Decision Record. | **Headline items COMPLETE**; all remaining sub-items OPEN, genuinely `human`-gated (re-verified 2026-07-23) |
| 7 | Notification dispatch & delivery (Transactional Outbox + Worker, `ADR-029`) | SPEC-NOTIF-001 dispatch build: PRs 7.1–7.8 (outbox model, worker runtime, producer migration, EMAIL, PUSH-backend, observability, multi-app APNs, mobile push registration) | none — `ADR-029` (GD-01) resolves `OQ-NOTIF-01` dispatch half + `OQ-NOTIF-04/06/07/08/09` | Fully independent of the auth epics; parallelizable throughout. `OQ-NOTIF-02/03/05` ship under their own decisions, outside this epic. 7.7 (mobile) is independently reviewable/revertible from 7.5 (backend push transport). | **COMPLETE** (PRs 7.1–7.8 all merged as of PR #208, 2026-07-24; 523/523 backend tests green) |
| 8 | Work-request / work-application hotel-scoping | SPEC-JOB-DISPATCH-001 FIND-SEC-002/003 / SIR-JOBD-002; MIG-GAP-07; target TREQ-008/TRULE-007 | none — Epic 5's scope model (PR 5.4/5.5) is the only prerequisite and is already merged | **New, identified by this pass.** Sibling High finding to Epic 1's Critical; never sequenced by the original plan. Same remediate-not-accept-risk precedent as Epics 1 and 5 PR 5.5. | **COMPLETE** (this session; 367/367 backend tests green, typecheck clean) |

Deferred / not sequenced here (blocked on human authority, correctly excluded):
- **ATT OQ-03** — cross-owner EXPECTED-row seed. Architecture BLOCKED; needs a Decision Record
  before the coupling may be touched. Sequencing dependency only; not an implementation task in
  this plan. (Note: ADR-018 classified the accept-transaction coupling SUPERSEDED-BY-PIVOT — the
  live-code removal lands as part of the Job-Dispatch pivot build, which is itself out of the
  current defect-remediation scope; flag if it enters scope.)
- **SYNC-001** owner assignment (platform-wide) — reserved human authority, not implementation.
- **SPEC-CHATBOT-001, SPEC-GEO-001** — REVIEW stubs, out of scope.
- **Headline open decisions:** QUAL OQ-01 (1-5 vs 0-100 rating) **RESOLVED 2026-07-22 by ADR-026**
  (rescaled to 0-100, matches TRULE-001/confirmed authority — corrected same session, see ADR-026's
  own Status section); NOTIF OQ-NOTIF-01 (channel enum) **RESOLVED 2026-07-22 by ADR-027**
  (IN_APP/EMAIL/PUSH/SMS/WEBHOOK). ANALYTICS OQ-ANALYTICS-03 (rooms-completed-per-worker metric
  definition) **RESOLVED 2026-07-22 by ADR-028** — retained, redefined as a manager-entered
  `RoomsCompletedEntry` count (1-to-1 with the worker's full-day `WorkerAssignment`, owned by
  `backend-assignments`), no room-level task layer, no `ReceptionData` field, "compared against
  task start" explicitly dropped (see SIR-ANLY-003, ADR-028 Decision item 3). Implemented in the
  same pass (schema/migration/service/route/analytics wiring); no dependent PR remains blocked on
  this Decision Record.

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
- **PR 5.1** — Schema: add `HotelGroup {id,name,billing_info,regional_manager_user_id}`,
  `Hotel.hotel_group_id` (nullable first), and `Hotel.manager_user_id` (nullable, per `ADR-025`)
  to `schema.prisma` + Prisma migration. Additive only, no backfill, no reads. (Isolation
  minimizes rollback blast radius — see §8.)
- **PR 5.2** — CRM: HotelGroup CRUD + RM assignment (`backend-crm` owns the entity per ADR-023
  §2). Files: `backend/src/modules/crm/*`.
- **PR 5.3** — Data backfill: assign existing hotels to groups via `PATCH /crm/hotels/:hotel_id
  {"hotel_group_id": ...}` (update-only — CRR §11: "after a hotel is created, it is assigned"),
  validated against an existing `HotelGroup`, plus a `findUngroupedHotels()` backfill-status
  tool (`npm run hotel-group:backfill-status`) that reports which hotels still lack a group
  (including soft-deleted ones) without inventing an assignment.
  > **Scope note (2026-07-21):** the `NOT NULL` flip this bullet originally named is
  > **deferred pending completion of the hotel-creation workflow** (a way to always have an
  > assignable group at hotel-creation time, without the fresh-deployment bootstrapping problem
  > of zero `HotelGroup` rows), **not shipped in PR 5.3, and not abandoned.**
  > `hotel_group_id`'s current nullability is a **temporary migration/sequencing state, not a
  > permanent domain property** — `ADR-023` §3's "nullable **until** assigned" (distinct from a
  > plain-optional field like `billing_info`) and its CRR citation ("after a hotel is created,
  > it is assigned") describe assignment as an expected, not optional, step. **The target
  > architecture is unchanged: one `HotelGroup` per `Hotel`, eventually mandatory.** Only the
  > *sequencing* changed — PR 5.3 ships the write path and backfill-status tooling now; the
  > `NOT NULL` migration itself, and whether hotel creation should then require a group, is
  > deferred to a follow-up PR, tracked as an open item in §9 (not a design reversal).
- **PR 5.4** — Auth scope-claim issuance: `backend-auth` computes the discriminated
  `{type:hotel|hotel_group|global}` claim at token issuance (read-only over HotelGroup /
  Hotel.hotel_group_id / Hotel.manager_user_id, ADR-023 §6 + ADR-025). Files:
  `backend/src/modules/auth/*`, `schema.prisma` (User/Session scope field if the claim is
  persisted).
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

> **Cutover mechanism & ordering — RESOLVED by ADR-024 (Accepted, 2026-07-22).** ADR-022/023
> define the target state and P2 prerequisites but did not prescribe the cutover *mechanism*.
> ADR-024 decides: **PR 5.5 lands before PR 5.7**; PR 5.7 is a **flag-gated cutover** over the
> retained `HotelWorker` compatibility layer (not a synchronous dual-write); **two independent
> additive feature flags** (both-off = current behavior) gate the authz and roster tracks
> separately; `HotelWorker` physical removal (PR 5.8) is gated on **no authz reader and no roster
> reader remaining**, with the JWT scope claim live before the membership branch is removed.
> Operational execution policy (parallel-run, rollback, snapshot, checkpoints) is §8 below, not the
> ADR. **Residual item surfaced by ADR-024 — RESOLVED by ADR-025 (Proposed, 2026-07-21):** the
> Hotel-Manager→hotel association source for the scope claim (not fixed by `ADR-023`) is
> `Hotel.manager_user_id`, a nullable FK owned by `backend-crm`, read-only by `backend-auth` at
> claim issuance — see §9.

### Epic 6 — Quality / CRM / Analytics remaining G8 items
- Sequence only items not gated on an open Decision Record. QUAL OQ-01's Decision Record
  (`ADR-026`, 2026-07-22, corrected same session) has landed — its dependent PR (rescale
  `Rating.score` to 0-100: schema/CHECK/data-migration/validation/spec forward-note, since the
  decision rescales the shipped 1-5 scale to match confirmed authority) may now be authored.
  ANALYTICS OQ-ANALYTICS-03's Decision Record (`ADR-028`, 2026-07-22) has now landed and its
  dependent implementation shipped in the same pass: `RoomsCompletedEntry` schema + migration,
  `backend-assignments`' manager-entry write path (`POST /assignments/:id/rooms-completed`), and
  the `backend-analytics` `rooms_completed` read-side aggregate on `getDashboardStats`/
  `getHotelSummary`. No dependent PR remains blocked for this item. One PR per finding, per
  module, sized to a single acceptance criterion.

### Epic 7 — Notification dispatch & delivery (Transactional Outbox + Platform Worker, `ADR-029`/GD-01)

`ADR-029` (2026-07-23) resolves the dispatch/delivery/scheduled-job-host design (`OQ-NOTIF-01` dispatch
half, `OQ-NOTIF-04/06/07/08/09`, and the delivery half of `OQ-AUTH-01`). The build is sequenced as the
following dependency-ordered, individually-reviewable, backward-compatible PRs. Each is independently
testable and reversible (additive schema, new process, no removal of the existing `Notification` REST
surface). Remaining `human`-gated items (`OQ-NOTIF-02` retention/GD-09, `OQ-NOTIF-03` `FEATURE_*`,
`OQ-NOTIF-05` cross-module send-authz) are **not** in Epic 7 and each ships under its own decision.

**All 8 PRs below are MERGED as of 2026-07-24** (verified against `main` @ `4079a0f`; see the
"Verification pass (2026-07-24, Epic 7 build-completion sync)" section above) — the table is
retained for its sequencing/scope record, not as an open work list.

| PR | Title | Scope | DB | Depends on |
|----|-------|-------|----|-----------|
| **7.1** | Outbox data model + transactional enqueue | `OutboxEvent` model + `OutboxStatus`/`OutboxTransport` enums (Prisma) + migration, including `payload_version` (starts `1`) and `processed_at`; `notification-service.enqueue()` persisting `Notification` + `OutboxEvent` in one transaction; `event_id` (UUID) idempotency key. Ownership is exclusive to `backend-notifications` — no other module writes `state-outbox` directly. **Defines the `OutboxEvent.payload` contract explicitly in this PR** (e.g. `{event_type, aggregate_type, aggregate_id, payload}`) — every producer from 7.3 onward uses this one shape; no producer invents its own. No delivery yet — events accumulate `PENDING`. | +1 migration (outbox table + 2 enums) | — |
| **7.2** | Platform Worker runtime | Dedicated `backend/worker` entrypoint (shared monolith codebase/Prisma) — the canonical **Platform Worker** (`ADR-029`); poll loop (configuration-driven, initial deployment default 5s); atomic claim (`PENDING→PROCESSING` via `FOR UPDATE SKIP LOCKED`); `DELIVERED`/`FAILED`/`DEAD_LETTER` lifecycle; configurable exponential backoff (1m/5m/15m/1h); transport-handler dispatch interface (no-op/log handler only — future handlers must be idempotent, `event_id` as provider-side key where supported); scheduled-job registration mechanism (no domain job yet); deploy topology (ecosystem/compose worker process). | — | 7.1 |
| **7.3** | Migrate existing producers to the outbox | Convert the four current producers (`work-requests`, `work-applications`, `attendance`, `quality`) from `.catch(() => {})` fire-and-forget to transactional `enqueue`, exclusively through `notificationService.enqueue()`; delivery is a no-op/log handler at this point (from 7.2) but failures are already durable/observable via `OutboxEvent.status`. Closes `OQ-NOTIF-04`/`OQ-NOTIF-09` in code. Per-producer tests. **Moved ahead of the transport PRs** so the whole application is on the outbox as soon as the runtime exists — email/push become pluggable handlers on an already-adopted pipeline, not a precondition for adopting it. | — | 7.1, 7.2 |
| **7.4** | EMAIL transport | SMTP client behind the `EMAIL` transport handler; env-driven config with explicit secret-storage/rotation/least-privilege (carries `MIG-GAP-11`); mocked-SMTP tests. Unblocks auth email-reset / failed-login delivery (wiring auth is a follow-on producer change, tracked with `SIR-AUTH-005`). | — | 7.2 (7.3 for live end-to-end coverage) |
| **7.5** | PUSH transport (backend only) | `PushToken` schema + migration; push-token registration endpoint; APNs/FCM clients behind the `PUSH` transport handler; mocked-provider tests. **No mobile/Expo changes in this PR** — deliberately backend-only so backend reviewers aren't reviewing client code, mobile can be reviewed independently, and either side can roll back without the other. | +1 migration (push-token table) | 7.2 (7.3 for live end-to-end coverage) |
| **7.6** | Delivery observability + dead-letter operability | Failure/audit logging for delivery (addresses the `AuditLog` gap RULE-005 for security-relevant sends), dead-letter listing/requeue for operators; minimum metric surface defined by `ADR-029` §9 — counts by status (`queued`/`processing`/`delivered`/`failed`/`dead_letter`), `retry_count`, `delivery_latency` (`processed_at - created_at`); runbook/docs. | — | 7.2, 7.3 |
| **7.8**¹ | Multi-app APNs topic support (backend only) | Found while scoping 7.7: APNs requires `apns-topic` to equal the bundle ID of the app that minted the device token; worker-app (`com.hotelcrm.workerapp`) and checker-app (`com.hotelcrm.checkerapp`) have distinct bundle IDs, and `manager`/`admin` may use BOTH, so a single `APNS_BUNDLE_ID` (as shipped by 7.5) could only ever be correct for one app. Adds `PushToken.app` (`PushApp`: `WORKER`\|`CHECKER`, NOT NULL — the table carries zero rows in every environment, so no backfill/nullable state is needed); `ApnsProviderClient` resolves `apns-topic` **per delivery** from the token's `app`, not from a client-held bundle ID — still one client, one team-scoped cached JWT for both apps (an APNs auth key is team-scoped, not app-scoped). `APNS_BUNDLE_ID` splits into `APNS_BUNDLE_ID_WORKER`/`APNS_BUNDLE_ID_CHECKER`. Registration endpoint requires `app`. FCM/Android unaffected — an FCM registration token is self-identifying, no equivalent header exists. Backend-only, same reviewability rationale as 7.5. | +1 migration (`PushToken.app` column + `PushApp` enum) | 7.5 |
| **7.7** | Mobile push-token registration (worker-app, checker-app) | Follow-on to 7.5/7.8, shipped as its own PR (one per app, or two small PRs): push-token registration (including `app`) against 7.8's endpoint + OS notification-permission flow. Independently reviewable/revertible from the backend transport. | — | 7.8 |

¹ Numbered 7.8 rather than renumbered into sequence: added *after* 7.7 was already planned (in this same
table), when scoping 7.7's implementation surfaced the APNs multi-app topic gap described in this row.
7.7's own dependency was repointed 7.5 → 7.8 to reflect the corrected build order (`7.5 → 7.8 → 7.7`),
but the PR is kept at 7.8 rather than renumbered, since other repository artifacts (commit messages,
this PR's branch history, `DEPENDENCY_GRAPH.yaml`) already cite it as 7.8 — preserving a stable
identifier across those references outweighs strict table-order aesthetics here.

Per-trigger notification *features* (`TREQ-001` failed-login, `TREQ-003` rework escalation, `TREQ-004`
rating warnings, `TREQ-006` sick/vacation, `TREQ-007` contract-expiry, `TREQ-008/009/010` broadcast)
remain owned by their respective epics (auth, quality, calendar, hr, job-dispatch); after Epic 7 they
each become "produce an `OutboxEvent`" changes rather than blocked-on-undecided-transport work.

`OutboxEvent` retention tier is a required-before-G8 disposition folded into `SIR-NOTIF-002` / GD-09.

### Epic 8 — Work-request / work-application hotel-scoping (new, 2026-07-23)
Closes `SIR-JOBD-002` / `FIND-SEC-002`/`FIND-SEC-003`: work-request create/patch and application
approve/reject are role-guarded (`admin`/`manager`) but not hotel-scoped — a manager at hotel A
can create, patch, approve, or reject requests/applications belonging to hotel B. Target is
`TREQ-008`/`TRULE-007` (role × scope, deny-by-default); `MIG-GAP-07` records the gap.

- **PR 8.1** — Mirror the exact pattern Epic 5 PR 5.5 already established for `backend-quality`
  and `backend-attendance` (in-service check, not route middleware, since the target hotel_id is
  either in the create body or must be looked up from the existing record before a PATCH):
  - Files: `backend/src/modules/work-requests/service.ts` (`create()`, `update()`),
    `backend/src/modules/work-requests/controller.ts` (thread `req.auth.scope` through),
    `backend/src/modules/work-applications/service.ts` (`update()`/`approve()`),
    `backend/src/modules/work-applications/controller.ts` (thread `req.auth.scope` through).
  - Pattern (verbatim from `quality/service.ts:28-35`): `if (isScopeAuthzEnabled() &&
    actor.role === 'manager') { const inScope = await isHotelInScope(actor.scope ?? null,
    target.hotel_id); if (!inScope) throw new ForbiddenError(...); }`. Admin keeps its
    cross-hotel bypass (unchanged, by-design). Flag-gated `FEATURE_SCOPE_AUTHZ`, default on —
    off reverts to the current cross-hotel-permitted behavior (ADR-024 D3 compatibility
    guarantee, same as every other Epic 5 PR 5.5 consumer).
  - Scope discipline: this PR touches only the four actions the finding names (work-request
    create, work-request patch, application approve, application reject/withdraw-review path).
    It does not add manager scoping to `list()`/`getById()` (a separate, not-yet-raised
    question; `RULE-011a`'s `[TARGET]` note already flags that as deferred, out of this finding).
  - Test: `backend/src/__tests__/work-requests-scope-authz.test.ts` and
    `work-applications-scope-authz.test.ts` (or one combined file, mirroring
    `quality-scope-authz.test.ts`'s supertest-over-real-router scaffolding), citing
    `SIR-JOBD-002`/`FIND-SEC-002`/`FIND-SEC-003`. Cases: manager in-scope → 200/201; manager
    out-of-scope → 403; admin cross-hotel → unchanged (200/201).
  - No schema change, no migration. Code-only, low rollback risk — `git revert`.
- Knowledge sync: extend `DEPENDENCY_GRAPH.yaml`'s `permissions-middleware` note to record that
  `backend-work-requests`/`backend-work-applications` now also import `isHotelInScope()`
  in-service (same shared primitive as `backend-attendance`/`backend-quality`), as part of this
  PR.

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
         [PR 5.5 before PR 5.7 — decided by ADR-024]

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
  cross-tenant and admin remains global. PR 5.1 needs migration up/down tests (shipped, via
  `migrate-harness.sh verify`); PR 5.3 ships `findUngroupedHotels()` unit tests and an
  `updateHotel` regression suite instead of a migration test, since its `NOT NULL` flip is
  deferred (see §2) — no new migration was authored in PR 5.3.
- **Epics 6/7** → one behavior test per finding PR, named for the module + finding.
- **Epic 8** → `work-requests-scope-authz.test.ts` / `work-applications-scope-authz.test.ts`,
  citing `SIR-JOBD-002`/`FIND-SEC-002`/`FIND-SEC-003`. Same supertest-over-real-router pattern as
  `quality-scope-authz.test.ts`.

---

## 8. Rollback strategy (per epic)

This is a live modular monolith on a shared PrismaClient / single PostgreSQL (BaseService,
`lib/db.ts`). Code-only PRs are low-risk; schema PRs are the high-risk case.

- **Epic 1, 2 (code path 2.1), 3, 4, 6, 7, 8 — code-only.** Rollback = `git revert` the PR /
  redeploy prior artifact. No data migration, no state shape change. Safe and immediate. Epic 3
  is a pure refactor so revert is fully behavior-neutral.
- **Epic 2 PR 2.2 (hash refresh token) — mixed.** If it changes the `Session.refresh_token` column
  format, rollback must handle in-flight sessions: prefer an additive column + dual-read window,
  or accept forced re-login on revert (document which). Do not do an irreversible in-place column
  rewrite without a down-migration.
- **Epic 5 — highest rollback risk (schema migration).**
  - PR 5.1 (additive, nullable `hotel_group_id` + new table): reversible via a down-migration
    dropping the column/table *provided no PR that reads it has shipped*. Keep additive and
    unread until 5.2+.
  - PR 5.3 (backfill write path): **the NOT NULL flip is deferred pending the hotel-creation
    workflow, not abandoned** (see §2 scope note — target remains one `HotelGroup` per `Hotel`,
    only the sequencing changed). PR 5.3 shipped only the `hotel_group_id` write path
    (`updateHotel`) and a status/verification tool (`findUngroupedHotels()`), no migration.
    Code-only revert, no schema risk. **The follow-up PR that flips NOT NULL must still
    satisfy:** (a) the `findUngroupedHotels()` check
    proving every hotel (including soft-deleted) has a group before flipping NOT NULL, (b) a
    down-migration that re-nullables and preserves data, (c) a DB snapshot/backup taken
    immediately before apply. Never destructive.
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
| ~~OQ-AUTH-06 interim mitigation vs wait-for-Epic-5~~ | Correct fix data-blocked; exploitable now | **RESOLVED 2026-07-21, Epic 5 PR 5.5** — the manager authz flip is the correct fix, not an interim mitigation; no risk-acceptance decision was needed once the scope model landed. See `SIR-GLOB-004`. |
| SIR-JOBD-002 / FIND-SEC-002/003 (work-request/application hotel-scoping) | Not blocked — listed here only to record that it is **not** an escalation. Sibling of the now-resolved OQ-AUTH-06: the finding's own "remediate vs. accept risk" framing predates Epic 5; now that the scope model is live, remediation is the safe default and does not require a fresh Risk Assessment. | None — scheduled as Epic 8, in progress this session. |
| ~~Epic 5 cutover mechanism + PR 5.5-vs-5.7 order~~ | Not prescribed by ADR-022/023 | **RESOLVED by ADR-024 (Accepted, 2026-07-22):** PR 5.5 before PR 5.7; flag-gated cutover (not dual-write) over the retained `HotelWorker` layer; two independent additive flags; removal gated on no authz/roster reader remaining. Hotel-Manager scope source remains open — see new row below. |
| ~~Hotel-Manager→hotel association source for the scope claim (PR 5.4/5.5)~~ | `ADR-023` fixes Regional-Manager/Admin scope but not the dedicated-Hotel-Manager-per-hotel association (`OD-CRM-01` residual `REQ-CRM-006`/`RULE-CRM-07`) or the `UserRole` RM distinction (`OD-CRM-05`); surfaced by ADR-024 | **RESOLVED by ADR-025 (Accepted, 2026-07-22):** `Hotel.manager_user_id` (nullable FK, `backend-crm`-owned, `backend-auth` read-only at claim issuance). Consumed at PR 5.1 (schema)/PR 5.4 (claim). `UserRole` enum split (`OD-CRM-05`'s remaining implementation gap) is unaffected — still a PR 5.4 build task, not a design question. |
| ATT OQ-03 cross-owner EXPECTED-seed | Architecture BLOCKED | Decision Record |
| QUAL OQ-01 (1-5 vs 0-100 rating) | Blocks QUAL implementation planning | **RESOLVED 2026-07-22, ADR-026 — 0-100, matches TRULE-001 (corrected same session; earlier "1-5, override" framing was wrong, see ADR-026 Status)** |
| ANALYTICS OQ-ANALYTICS-03 (metric definition) | Blocks ANALYTICS implementation planning | **RESOLVED 2026-07-22, ADR-028 — retained, redefined without a room-level task layer (manager-entered `RoomsCompletedEntry` count, 1-to-1 with the worker's full-day `WorkerAssignment`); implemented in the same pass, see SIR-ANLY-003** |
| NOTIF OQ-NOTIF-01 (channel enum shape) | Blocks TREQ-002/TREQ-012 | **RESOLVED** — enum shape 2026-07-22 (ADR-027); **dispatch-design half RESOLVED 2026-07-23, ADR-029** (Transactional Outbox + Worker runtime; GD-01) |
| NOTIF OQ-NOTIF-04/06/07/08/09 (failure control / push milestone / sendEmail fate / scheduled-job host / fan-out latency) | Blocked Epic 7 dispatch build | **RESOLVED 2026-07-23, ADR-029** (GD-01). Delivery half of AUTH OQ-AUTH-01 (SIR-AUTH-005) likewise unblocked (email-reset/failed-login delivery). Remaining NOTIF opens: OQ-NOTIF-02 (retention/GD-09, now also OutboxEvent), OQ-NOTIF-03, OQ-NOTIF-05 |
| SYNC-001 owner assignment | Platform-wide | Human authority |
| `Hotel.hotel_group_id` NOT NULL flip — **sequencing deferral, not a target-architecture change.** Target remains one `HotelGroup` per `Hotel` (`ADR-023` §3: "nullable **until** assigned", not permanently optional like `billing_info`); current nullability is temporary migration/sequencing state | Blocked on the hotel-creation workflow (a way to always have an assignable group at creation time, without the fresh-deployment bootstrapping problem of zero `HotelGroup` rows) — not blocked on a design question | Human/product decision on *when/how* the workflow lands; the *whether* is already decided by `ADR-023` |

Every G2 acceptance criterion for the in-scope findings is mapped to a PR in §2; every criterion
gated on an unresolved decision is listed above rather than silently assigned.
