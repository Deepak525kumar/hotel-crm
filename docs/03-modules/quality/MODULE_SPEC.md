# Module Specification: `quality` (backend-quality)

> Specification of ONE bounded backend capability — **Quality Management** — implemented by the
> single module `backend-quality`. This capability is **MID-PIVOT**. It carries labeled layers:
> `[CURRENT STATE]` — already-implemented quality-verification / rating / leaderboard behavior,
> reverse-specified at code revision `6e404ab`; `[TARGET STATE]` — the confirmed 0–100 (no-5-star)
> quality model with rating tiers, recency-weighted averaging, warnings, and a rework loop with
> 20-minute escalation that was authoritative but largely unbuilt **at authoring time**; `[MIGRATION
> GAP]` marks the delta;
> `[OPEN DECISION]` marks genuine human-authority items. Current-state claims cite `path:line
> @6e404ab`. Target-state claims cite `CONFIRMED_REQUIREMENTS_REGISTER.md` (CONFIRMED §x) and
> `PIVOT_DESIGN_DOCUMENT.md` (PIVOT §x). This document records behavior and confirmed contract; it
> does not create product policy and does not resolve any open decision. Nothing here is frozen: G2
> freeze is reserved human authority.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-QUAL-001 / 0.2.0` |
| Status | `FROZEN` |
| Owner | `unassigned (OQ-06 / SYNC-001, human authority required)`. No CODEOWNERS entry; MODULE_REGISTRY `owner: unassigned` (`.claude/knowledge/MODULE_REGISTRY.yaml:129-139`). Owner assignment is NOT invented here. |
| Authors / reviewers | Author: Module Author agent. Reviewers: all five G4 independent-review dimensions complete — Architecture, Dependency, Consistency, and Security (`PASS_WITH_ACTIONS`, dispositions applied at v0.1.1) AND Performance (`PASS_WITH_ACTIONS`, dispositions applied at v0.1.2) — zero Critical/High findings across all five (see Review and Change Log). G6 Documentation Validator: `PASS_WITH_ACTIONS` at v0.1.2 — 20/20 template-compliance criteria PASS, zero orphaned ids, two non-blocking nonsemantic citation corrections applied directly (FIND-DOCVAL-001/002, this version); a Specification Issues Register synchronization action (FIND-DOCVAL-003) is tracked for the next Documentation/Post-flight pass, not a defect in this document. |
| Repository revision | Code base described: `6e404ab9d52daf04f144673030de731bbe1af5d6` (`6e404ab`). |
| Approved by / at | FROZEN at G2 Specification Freeze on 2026-07-20 by the commissioning human (standing session authorization to freeze each spec once its G4 gate is clean), reusing the existing G4 evidence — zero Critical/High findings across all five dimensions. `OQ-01..09` and owner assignment (`OQ-06`/`SYNC-001`) are implementation/release prerequisites reviewed by G8, not freeze blockers; `OQ-03`/`OQ-09` (Medium cross-tenant findings) are routed to a Risk Assessment for human acceptance, matching the `SPEC-AUTH-001`/`SPEC-ATT-001`/`SPEC-USERS-001`/`SPEC-CALENDAR-001`/`SPEC-EMP-001`/`SPEC-CRM-001`/`SPEC-NOTIF-001` precedent. |
| Supersedes | None. First specification for `backend-quality` (registry `specification: UNKNOWN` prior, `MODULE_REGISTRY.yaml:129-139`). |

## Purpose and Scope

**Outcome:** Define the contract for the hotel's quality-management capability across its pivot arc.
This is ONE bounded capability implemented by a single backend module; it owns three state-domains —
`state-quality-verification`, `state-rating`, and `state-worker-overall-rating` — and the inspection,
rating, and worker-standing lifecycle of a worker against a confirmed assignment.

- `[CURRENT STATE]` (implemented @6e404ab): a **quality-verification + rating + leaderboard** flow. A
  checker/admin submits a **0–100 verification** against an assignment (status derived from the
  score), and separately submits a **1–5 star rating** against the same assignment; the rating write
  recomputes a **plain rolling-average** `WorkerOverallRating` aggregate in application code; a
  **leaderboard** query returns workers ordered by that 1–5 average, paginated (default 25, max
  100 per page — `ADR-035`/`SIR-QUAL-007`, resolved 2026-07-28). Notifications are
  fire-and-forget. Dormant schema columns (`photo_urls`, `rework_*`) exist but are never
  written/read.
- `[TARGET STATE]` (confirmed, largely unbuilt — CONFIRMED §14/§15/§16/§18, PIVOT §4.6/§7.5/§9.1):
  a **0–100 quality model with NO 5-star system**; a **photo uploaded WITH the rating**; **rating
  tiers** (Elite/High/Standard/Low/Probation) shown as a label on top of the 0–100 score; a
  **recency-weighted overall rating** leaning on the last 10 jobs; **warnings** (first <70, second
  <50 → manager); and a **rework loop** (checker→worker via inbox + push, worker uploads photo +
  "done", checker notified) with **20-minute** auto-escalation to Manager + Checker; notifications
  are push-only (CONFIRMED §18).

**In scope:**
- `backend/src/modules/quality/{service.ts,controller.ts,routes.ts,types.ts}` — createVerification,
  createRating, getLeaderboard (global + by-hotel).
- Data contract for the Prisma `QualityVerification`, `Rating`, and `WorkerOverallRating` models
  (`schema.prisma:395-459`) and the `VerificationStatus` enum (`schema.prisma:74-78`).
- `[TARGET]` 0–100-only rating, photo-with-rating, rating tiers, recency-weighted average, warnings,
  and the rework loop with 20-minute escalation — UNBUILT at `6e404ab`; specified only to the extent
  the confirmed authorities settle them. **The rework loop, its photo evidence, and the 20-minute
  escalation have since been BUILT — see the Status Addendum (2026-08-22) below.**

**Out of scope:**
- Assignment lifecycle (`backend-assignments`), attendance (`backend-quality` reads assignment +
  attendance only), notification delivery mechanics (`backend-notifications`), analytics
  aggregation (`backend-analytics` — a downstream CONSUMER of all three quality domains), and the
  work-applications apply-time rating snapshot (`backend-work-applications` — a downstream CONSUMER).
  Referenced only as consumed state, delivery sink, boundary, or consumer.
- Object-storage / S3 photo wiring (PIVOT infra ~line 164) and the scheduled-job runtime for the
  20-minute rework timer (PIVOT infra ~line 165,190) — target infrastructure, UNBUILT at `6e404ab`.
  **Both have since been BUILT — see the Status Addendum (2026-08-22) below.**

**Non-goals:** Requirements discovery, product-policy invention, code planning, independent review,
or resolving any open decision below.

## Evidence and Traceability

`[CURRENT STATE]` requirements (REQ-001..018) — reverse-specified at `6e404ab`:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-001` all quality routes require `authMiddleware`; mounted at `/api/v1/quality` | `quality/routes.ts:7`; `routes/v1/index.ts:30` @6e404ab | Code | Observed (High) |
| `REQ-002` `POST /verifications` requires `quality:write` | `quality/routes.ts:9` @6e404ab | Code | Observed (High) |
| `REQ-003` createVerification requires an existing assignment (else NotFound) | `quality/service.ts:19-22` @6e404ab | Code | Observed (High); UNTESTED |
| `REQ-004` createVerification rejects a second verification for the same `assignment_id` | `quality/service.ts:24-27`; `schema.prisma:397` @6e404ab | Code | Observed (High) |
| `REQ-005` verification status derived from score: `>=70 PASSED`, `>=40 NEEDS_REWORK`, `<40 FAILED` | `quality/service.ts:30-35` @6e404ab | Code | Observed (High); thresholds UNTESTED |
| `REQ-006` verification copies `hotel_id` from assignment; sets `verified_by_id=actor`, `notes ?? null` | `quality/service.ts:39-48` @6e404ab | Code | Observed (High) |
| `REQ-007` P2002 on verification create → ConflictError (409), not 500 | `quality/service.ts:49-61` @6e404ab | Code | Observed (High) |
| `REQ-008` createVerification audits `CREATE_VERIFICATION` / `QUALITY_VERIFICATION` | `quality/service.ts:63-70` @6e404ab | Code | Observed (High); UNTESTED |
| `REQ-009` fire-and-forget notification to worker per status (PASSED/NEEDS_REWORK/FAILED) | `quality/service.ts:75-84` @6e404ab | Code | Observed (High); branches UNTESTED |
| `REQ-010` `POST /ratings` requires `quality:write` | `quality/routes.ts:12` @6e404ab | Code | Observed (High) |
| `REQ-011` createRating validates `assignment_id`,`worker_id` present and `score` int 1..5 (redundant with Zod) | `quality/service.ts:92-97`; `types.ts:15-21` @6e404ab | Code | Observed (High) |
| `REQ-012` createRating requires assignment (NotFound) and `assignment.worker_id === worker_id` (else Forbidden) | `quality/service.ts:100-109` @6e404ab | Code | Observed (High); UNTESTED |
| `REQ-013` Rating created in a `$transaction` with `hotel_id` from assignment, `rated_by_id=actor`, `criteria_scores` JSON or JsonNull; P2002 → ConflictError | `quality/service.ts:99-133` @6e404ab | Code | Observed (High) |
| `REQ-014` same transaction recomputes and upserts `WorkerOverallRating` by `worker_id` | `quality/service.ts:136-178` @6e404ab | Code | Observed (High); math UNTESTED |
| `REQ-015` createRating audits `CREATE_RATING` / `Rating`; fire-and-forget `RATING_RECEIVED` to worker | `quality/service.ts:183-198` @6e404ab | Code | Observed (High); RATING_RECEIVED tested, audit UNTESTED |
| `REQ-016` `GET /leaderboard` requires `quality:read`; returns workers by `average_score desc`, paginated (default 25, max 100 — `ADR-035`) | `quality/routes.ts:15`; `quality/service.ts:263-296` @2026-08-02 (`SIR-QUAL-007`) | Code | Observed (High); ordering UNTESTED |
| `REQ-017` `GET /leaderboard/by-hotel/:hotel_id` requires `quality:read` + `checkHotelAccess()`; filters ACTIVE `HotelWorker` at hotel | `quality/routes.ts:18`; `quality/service.ts:204-212` @6e404ab | Code | Observed (High); scope no-op for privileged roles (OQ-03); UNTESTED |
| `REQ-018` responses use the shared envelope `{status,data,pagination,meta}`; inline Zod `safeParse`; leaderboard paginated (default 25, max 100 — `ADR-035`/`SIR-QUAL-007`) | `quality/controller.ts` (envelope + safeParse); `types.ts:3-7,15-21,32-38` @2026-08-02 | Code | Observed (High) |
| Every mutation writes an `AuditLog` via `BaseService.logAudit` | `quality/service.ts:63-70,183-187` @6e404ab | Code | Observed (High) |
| No event bus; notifications synchronous fire-and-forget | `quality/service.ts:75-84,191-198`; MODULE_REGISTRY `published_events: none-observed` (`MODULE_REGISTRY.yaml:129-139`) | Code + registry | Observed (High) |
| Modular-monolith (ADR-003), Prisma-over-PostgreSQL (ADR-004) | ADR-003, ADR-004 (Proposed); `schema.prisma` @6e404ab | Architecture decision | Anchor (Proposed) |

`[TARGET STATE]` requirements (TREQ-001..010) — confirmed authorities, largely unbuilt:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `TREQ-001` quality/rating score is **0–100, NOT a 5-star system** | CONFIRMED §15; PIVOT §4.6 | Confirmed authority | Target; contradicts shipped 1–5 Rating (MIG-GAP-01) |
| `TREQ-002` checker/supervisor **uploads a photo WITH the rating** onto the worker's profile | CONFIRMED §15; PIVOT §4.6 | Confirmed authority | Target; unbuilt (MIG-GAP-06) |
| `TREQ-003` **rating tiers** Elite/High/Standard/Low/Probation shown as a label on top of the 0–100 score | CONFIRMED §15; PIVOT §4.6 | Confirmed authority | Target; unbuilt (MIG-GAP-03) |
| `TREQ-004` overall rating is **recency-weighted** — leans on the last 10 jobs more than older | CONFIRMED §15; PIVOT §4.6, §7.5 | Confirmed authority | Target; unbuilt (MIG-GAP-02) |
| `TREQ-005` inspection checklist items are **dust, bathroom, bed linen, mirror, floor, minibar/restocking, fragrance/amenities, other** | CONFIRMED §15 | Confirmed authority | Target; unbuilt (MIG-GAP-07) |
| `TREQ-006` **first warning** to worker when rating **falls below 70**; **second warning** when **below 50** | CONFIRMED §16; PIVOT §4.6, §7.5 | Confirmed authority | Target; unbuilt (MIG-GAP-04) |
| `TREQ-007` after the second warning (<50) the **manager** receives a specific notification and handles it manually; no auto-suspension | CONFIRMED §16; PIVOT §7.5 | Confirmed authority | Target; unbuilt (MIG-GAP-04) |
| `TREQ-008` rework loop: checker assigns rework to a specific worker; worker notified via **in-app inbox AND push (BOTH)** with a stored readable inbox entry; worker uploads photo + "done"; checker notified | CONFIRMED §14; PIVOT §4.6, §9.1 | Confirmed authority | Target; unbuilt (MIG-GAP-05, MIG-GAP-08) |
| `TREQ-009` if rework not completed within **20 minutes**, notify **BOTH Manager and Checker** (auto-escalation) | CONFIRMED §14; PIVOT §4.6, §7.5, §9.1 | Confirmed authority | Target; unbuilt (MIG-GAP-05) |
| `TREQ-010` quality notifications are push-only system-wide | CONFIRMED §18 | Confirmed authority | Target; not enforced in code (MIG-GAP-08) |

Explicitly-excluded target scope (recorded so it is NOT invented as a requirement): ❌ no 14-day
dispute window; ❌ no formal dispute-resolution process; ❌ no auto-reward engine; ❌ no backend
matching logic for who-did-which-room (CONFIRMED §15).

## Actors and Terminology

Role-token casing: quality routes gate on RBAC permissions (`quality:read`/`quality:write`) rather
than raw role literals (`quality/routes.ts:9,12,15,18`). "Quality-permitted roles" below means the
set granted those permissions in `config/constants.ts:88-129`.

| Term/actor | Canonical definition | Source |
|---|---|---|
| Quality verification | The 1:1 inspection record for one `WorkerAssignment`; carries a 0–100 `score`, a derived `VerificationStatus` (PASSED/NEEDS_REWORK/FAILED), notes, and dormant photo/rework columns. | `schema.prisma:395-417`; `quality/service.ts:13-87` (TERMINOLOGY promotion proposed) |
| Quality score (0–100) | The inspection score. `[CURRENT]` stored on `QualityVerification.score` (0–100, `schema.prisma:403`); `Rating.score` also 0–100 as of `ADR-026`. `[TARGET]` remains the sole worker score. RESOLVED by `ADR-026` (was OQ-01). | `schema.prisma:403`; CONFIRMED §15; `ADR-026` |
| Rating | `[CURRENT]` a 1:1 **1–5 star** record for one assignment (`Rating.score` 1..5, `schema.prisma:429`; `types.ts:18`), with optional free-JSON `criteria_scores {punctuality,quality,attitude}`. `[TARGET]` a 0–100 result with a photo and the confirmed checklist (CONFIRMED §15). | `schema.prisma:419-441`; `quality/service.ts:89-201` |
| Worker overall rating | Materialised aggregate per worker: `average_score`, `total_ratings`, `total_assignments`, `completion_rate`, `on_time_rate`, `last_worked_at`. `[CURRENT]` a plain rolling average of 1–5 `Rating.score`. `[TARGET]` recency-weighted (last-10) 0–100 (OQ-02). | `schema.prisma:443-459`; `quality/service.ts:136-178` |
| `VerificationStatus` | Enum {PASSED, FAILED, NEEDS_REWORK}; `[CURRENT]` derived from the 0–100 score at write time (`>=70`,`>=40`,`<40`). | `schema.prisma:74-78`; `quality/service.ts:30-35` |
| Rating tier `[TARGET]` | A label — Elite / High / Standard / Low / Probation — displayed on top of the 0–100 score. No code representation today. | CONFIRMED §15; PIVOT §4.6 |
| Warning (<70 / <50) `[TARGET]` | First warning to worker when rating falls below 70; second when below 50, after which the manager is notified to handle it manually. No WARNING notification type or logic today. | CONFIRMED §16; PIVOT §7.5 |
| Rework task `[TARGET]` | A checker-assigned rework directed at a specific worker, with inbox+push notification, worker photo+"done" completion, checker notification, and a 20-minute escalation to Manager+Checker. Proposed `ReworkTask` model. | CONFIRMED §14; PIVOT §9.1 |
| Recency-weighted average `[TARGET]` | Overall-rating aggregation that weights the last 10 jobs more than older ones. | CONFIRMED §15; PIVOT §4.6 |
| Checker | Quality-permitted role holding `quality:read`+`quality:write`; submits verifications and ratings and (target) rework. `checkHotelAccess()` BYPASSES hotel-membership for checkers ("operate across hotels"). | `config/constants.ts:120`; `middleware/permissions.ts:103-108` |
| Manager | Holds `quality:read` only (no write); target recipient of the second-warning and 20-minute rework-escalation notifications. | `config/constants.ts:108`; CONFIRMED §14/§16 |

## Requirements and Acceptance Criteria

`[CURRENT STATE]` requirements (all Observed @6e404ab unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| REQ-001 | All quality routes require authentication and are mounted at `/api/v1/quality`. | Must | `router.use(authMiddleware)`; mount `routes/v1/index.ts:30`. | RULE-001 |
| REQ-002 | `POST /verifications` requires `quality:write`. | Must | Actor lacking `quality:write` → route-level 403 before service. | RULE-001 |
| REQ-003 | createVerification requires an existing assignment. | Must | Missing assignment → NotFoundError. | RULE-002 |
| REQ-004 | Only one verification may exist per assignment. | Must | Existing verification (pre-check on unique `assignment_id`) → ConflictError. | RULE-002, RULE-003 |
| REQ-005 | Verification status is derived from the 0–100 score. | Must | `score>=70` → PASSED; `40<=score<70` → NEEDS_REWORK; `score<40` → FAILED. | RULE-004 |
| REQ-006 | Verification copies `hotel_id` from the assignment and records the verifier. | Must | Row created with assignment's `hotel_id`, `verified_by_id=actor.userId`, `notes ?? null`. | RULE-005 |
| REQ-007 | A create-race duplicate is surfaced as a conflict, not a 500. | Must | Prisma P2002 on create → ConflictError (409). | RULE-003 |
| REQ-008 | createVerification writes an audit row. | Must | AuditLog `CREATE_VERIFICATION` / `QUALITY_VERIFICATION`. | RULE-010 |
| REQ-009 | After a verification, a best-effort notification fires to the worker per status. | Should | PASSED → `QUALITY_VERIFICATION_SUBMITTED` "Quality Check Passed"; NEEDS_REWORK → `REWORK_REQUIRED` "Rework Required"; FAILED → `QUALITY_VERIFICATION_SUBMITTED` "Quality Check Failed" (FAILED reuses the SUBMITTED type). Fire-and-forget, `.catch(()=>{})`. | RULE-009 |
| REQ-010 | `POST /ratings` requires `quality:write`. | Must | Actor lacking `quality:write` → route-level 403. | RULE-001 |
| REQ-011 | createRating validates input at the service in addition to Zod. | Must | Missing `assignment_id`/`worker_id` or `score` not int 1..5 → ValidationError; Zod schema also enforces score int 1..5. | RULE-006 |
| REQ-012 | createRating requires the assignment and a matching worker. | Must | Missing assignment → NotFoundError; `assignment.worker_id !== worker_id` → ForbiddenError ("worker_id does not match the assignment worker"). | RULE-006 |
| REQ-013 | Rating is created in a transaction, one per assignment. | Must | Rating with `hotel_id` from assignment, `rated_by_id=actor`, `criteria_scores` JSON or JsonNull; P2002 → ConflictError ("Rating already exists for this assignment"). | RULE-006, RULE-003 |
| REQ-014 | The same transaction recomputes and upserts the worker's overall rating. | Must | `average_score=_avg.score ?? 0` (1–5); `completion_rate=completedAssignments/totalAssignments`; `on_time_rate=onTimeAttendanceCount/totalAssignments`; `last_worked_at` from last COMPLETED; upsert by `worker_id`. | RULE-007, RULE-008 |
| REQ-015 | createRating audits and best-effort notifies the worker. | Must/Should | AuditLog `CREATE_RATING` / `Rating`; fire-and-forget `RATING_RECEIVED` to `worker_id`. | RULE-009, RULE-010 |
| REQ-016 | `GET /leaderboard` returns workers by overall average, paginated. | Must | `quality:read`; `workerOverallRating.findMany` include worker {id,first_name,last_name,email}, `orderBy average_score desc`, `skip`/`take` from `page`/`per_page` (default 25, max 100 per `ADR-035`), `count()` for pagination meta. | RULE-001, RULE-008 |
| REQ-017 | `GET /leaderboard/by-hotel/:hotel_id` optionally scopes to a hotel's active workers. | Must | `quality:read` + `checkHotelAccess()`; filter workers with ACTIVE `HotelWorker` at `hotel_id`. NOTE: scope is a no-op for all quality-permitted roles because `checkHotelAccess()` bypasses membership for admin/manager/checker (OQ-03). | RULE-001, RULE-008 |
| REQ-018 | Responses use the shared envelope; validation is inline Zod; leaderboard is paginated (default 25, max 100 per `ADR-035`/`SIR-QUAL-007`). | Must | `{status:'success',data,pagination,meta:{timestamp,request_id}}`; create → 201, leaderboard → 200; `safeParse` failure → ValidationError; leaderboard `data` is a page-sized array, `pagination` carries `page,per_page,total,total_pages,has_next,has_prev`. | RULE-001 |

`[TARGET STATE]` requirements (confirmed authority; unbuilt unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| TREQ-001 | Quality/rating score is 0–100, not a 5-star system. | Must | The worker-facing score is a 0–100 value; no 1–5 star scale is presented or stored as the headline. | TRULE-001 |
| TREQ-002 | Checker uploads a photo WITH the rating onto the worker's profile. | Must | Rating write persists an associated photo (object storage); manager can view who did which room, no backend matching logic. | TRULE-002 |
| TREQ-003 | Rating tiers Elite/High/Standard/Low/Probation are shown as a label on the 0–100 score. | Must | A tier label is derived from the 0–100 value and presented; tier thresholds are a product decision (OQ-08). | TRULE-003 |
| TREQ-004 | Overall rating is recency-weighted (last 10 jobs weighted most). | Must | Aggregate weights recent jobs more; the exact weighting function is a product/architecture decision (OQ-02/OQ-08). | TRULE-004 |
| TREQ-005 | Inspection checklist items are the confirmed set. | Must | Checklist = dust, bathroom, bed linen, mirror, floor, minibar/restocking, fragrance/amenities, other. | TRULE-002 |
| TREQ-006 | Worker is warned when the rating falls below 70 (first) and below 50 (second). | Must | Below-70 → first warning to worker; below-50 → second warning to worker. | TRULE-005 |
| TREQ-007 | After the second warning (<50) the manager is notified to handle it manually. | Must | Manager receives a specific notification; no auto-suspension or further automated consequence. | TRULE-005 |
| TREQ-008 | Rework is assigned to a specific worker with inbox + push and a stored inbox entry; worker uploads photo + "done"; checker is notified. | Must | Rework record created; BOTH channels; a readable stored inbox entry persists; completion captures photo + done; checker notified. | TRULE-006, TRULE-007 |
| TREQ-009 | Incomplete rework escalates to Manager + Checker after 20 minutes. | Must | A scheduled timer fires 20 minutes after assignment; if not completed, both Manager and Checker are notified. | TRULE-006 |
| TREQ-010 | Quality notifications are push-only. | Should | Delivery channel is push; rework additionally requires a stored inbox entry (TREQ-008). | TRULE-007 |

## Business Rules

`[CURRENT STATE]` rules (RULE-001..010) — reverse-specified @6e404ab:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-001 | Any quality request | All routes require `authMiddleware`; writes require `quality:write`, reads require `quality:read`; `by-hotel` adds `checkHotelAccess()`. Responses use the shared envelope; leaderboard is paginated (default 25, max 100 per `ADR-035`/`SIR-QUAL-007`). | Missing permission → 403. Envelope is unversioned (baseline/UNKNOWN). | `unassigned (OQ-06/SYNC-001)`; `quality/routes.ts:7-18`; `config/constants.ts:88-129` |
| RULE-002 | createVerification | Requires an existing assignment; a verification is 1:1 with an assignment (`assignment_id @unique`). | Missing assignment → NotFoundError; existing verification → ConflictError. | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:19-27`; `schema.prisma:397` |
| RULE-003 | Any unique-constraint create (verification, rating) | A Prisma P2002 is caught and re-surfaced as ConflictError (409), never a 500. | Applies to both verification create (`service.ts:49-61`) and rating create (`service.ts:126-133`). | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:49-61,126-133` |
| RULE-004 | Verification create | `VerificationStatus` is DERIVED from the 0–100 score: `>=70`→PASSED, `>=40`→NEEDS_REWORK, else FAILED. Enum default is PASSED (`schema.prisma:404`). | Thresholds are hard-coded; UNTESTED. `[TARGET]` interplay with warnings (<70/<50) is a separate scale (OQ-08). | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:30-35` |
| RULE-005 | Verification/rating write | `hotel_id` is COPIED from the assignment (denormalized), never client-supplied; verifier/rater is the actor (`verified_by_id`/`rated_by_id=actor.userId`). | — | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:39-48,113-125` |
| RULE-006 | createRating | Requires assignment; `assignment.worker_id` MUST equal the supplied `worker_id`; `score` int 0..100 (service guard + Zod, rescaled by `ADR-026`, was 1..5). Rating is 1:1 with an assignment. | Missing assignment → NotFound; worker mismatch → Forbidden; duplicate → Conflict. `[TARGET]` 0–100 scale RESOLVED, matches `TRULE-001` (`ADR-026`, was OQ-01). | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:92-133`; `types.ts:15-21` |
| RULE-007 | Rating committed | `WorkerOverallRating.average_score` is a PLAIN rolling average of 1–5 `Rating.score` (`_avg.score ?? 0`), upserted by `worker_id` inside the rating transaction. | `[TARGET]` must become recency-weighted last-10 0–100 (TRULE-004, OQ-02). | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:136-178`; `schema.prisma:449` |
| RULE-008 | Overall-rating recompute / leaderboard | `completion_rate = completedAssignments / totalAssignments`; `on_time_rate = onTimeAttendanceCount / totalAssignments` (PRESENT-attendance count divided by ASSIGNMENTS, not attendance rows — observed formula). Leaderboard orders by `average_score desc`, paginated (default 25, max 100 per `ADR-035`/`SIR-QUAL-007`; was `take 50`). | `on_time_rate` denominator is assignments (observed). Leaderboard orders by the 1–5 average, not the 0–100 quality score (OQ-02). An INSTALLED DB trigger `Rating_refresh_overall_rating` (`migration.sql:588-631`) ALSO writes the aggregate (`average_score`/`total_ratings`/`last_worked_at` only), converging with the app upsert on createRating but diverging on any direct Rating UPDATE/DELETE — dual-writer hazard (OQ-04). | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:136-178,203-224`; `schema.prisma:443`; `migration.sql:588-631` |
| RULE-009 | Any notification emission | Best-effort synchronous fire-and-forget; never participates in or rolls back the write; `.catch(()=>{})`-swallowed. Types: `QUALITY_VERIFICATION_SUBMITTED`, `REWORK_REQUIRED`, `RATING_RECEIVED`. | FAILED verification REUSES `QUALITY_VERIFICATION_SUBMITTED` (no FAILED-specific type). Channel is not enforced push-only in code. `[TARGET]` push-only (TRULE-007). | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:75-84,191-198`; `schema.prisma:108-110` |
| RULE-010 | Any mutation (verification / rating) | Writes an immutable AuditLog row via `BaseService.logAudit` (`CREATE_VERIFICATION` / `CREATE_RATING`). | Audit writes are UNTESTED. | `unassigned (OQ-06/SYNC-001)`; `quality/service.ts:63-70,183-187` |

`[TARGET STATE]` rules (TRULE-001..007) — confirmed authority:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| TRULE-001 | Any worker score | The score is 0–100; NO 5-star system exists. | Now implemented for `Rating.score` (`ADR-026`, was OQ-01, formerly contradicted the shipped 1–5 `Rating`). | CONFIRMED §15; PIVOT §4.6; `ADR-026` |
| TRULE-002 | A rating/inspection write | A photo is uploaded WITH the rating to the worker's profile; the confirmed checklist (dust/bathroom/bed linen/mirror/floor/minibar/fragrance/other) is used; no backend matching logic for who-did-which-room. | Photo stored in object storage (S3 EU, PIVOT ~line 164). | CONFIRMED §15; PIVOT §4.6, §9.1 |
| TRULE-003 | Presenting a worker's standing | A rating tier label (Elite/High/Standard/Low/Probation) is shown on top of the 0–100 score. | Tier thresholds are a product decision (OQ-08). | CONFIRMED §15; PIVOT §4.6 |
| TRULE-004 | Overall-rating aggregation | Recency-weighted: the last 10 jobs weigh more than older ones. | Weighting function undecided (OQ-02/OQ-08). | CONFIRMED §15; PIVOT §4.6, §7.5 |
| TRULE-005 | Rating threshold crossing | Below 70 → first warning to worker; below 50 → second warning to worker AND a specific manager notification for manual handling; no auto-suspension. | No further automated consequence. | CONFIRMED §16; PIVOT §7.5 |
| TRULE-006 | Rework assigned | Checker assigns rework to a specific worker; if not completed within 20 minutes, BOTH Manager and Checker are notified (auto-escalation via scheduled timer). | Timer runtime = node-cron / BullMQ on Redis (PIVOT infra ~line 165,190). | CONFIRMED §14; PIVOT §4.6, §7.5, §9.1 |
| TRULE-007 | Any quality/rework notification | Delivered push-only; rework additionally requires a stored readable inbox entry (inbox + push BOTH). | — | CONFIRMED §14, §18 |

## Ownership and Boundaries

**Module owner:** `unassigned (OQ-06 / SYNC-001, human authority required)`. MODULE_REGISTRY records
`owner: unassigned` (`MODULE_REGISTRY.yaml:129-139`); no CODEOWNERS entry exists. `SYNC-001` is the
canonical cross-artifact owner token (`TERMINOLOGY.md:51`); in this artifact it is DEFINED by the
`OQ-06 / SYNC-001` row in the Open Decisions table below, to which every inline `SYNC-001` reference
resolves. Owner assignment is reserved human authority and is NOT invented here.

**Owned state (per DEPENDENCY_GRAPH state-domains):**
- `state-quality-verification` (`schema.prisma:395-417`, `DEPENDENCY_GRAPH.yaml:71`) — model
  `QualityVerification`; `authoritative_writer: backend-quality`, `writers: [backend-quality]`.
- `state-rating` (`schema.prisma:419-441`, `DEPENDENCY_GRAPH.yaml:72`) — model `Rating`; writer
  `[backend-quality]`.
- `state-worker-overall-rating` (`schema.prisma:443-459`, `DEPENDENCY_GRAPH.yaml:73,485-490`) — model
  `WorkerOverallRating`; writer `[backend-quality]`. NOTE (FIND-ARCH-001): this owned domain has TWO
  write mechanisms, both belonging to `backend-quality`'s data layer (a SAME-OWNER second write
  mechanism, NOT a cross-owner writer):
  1. A CONFIRMED, INSTALLED PostgreSQL trigger `Rating_refresh_overall_rating` — `CREATE TRIGGER ...
     AFTER INSERT OR UPDATE OR DELETE ON "Rating"` running `refresh_worker_overall_rating()`
     (`backend/prisma/migrations/20260613120000_v2_marketplace_init/migration.sql:588-631`). It
     writes ONLY `average_score`, `total_ratings`, `last_worked_at`.
  2. The application upsert (`service.ts:174`) inside the rating `$transaction`, which writes the
     FULL row (`average_score`, `total_ratings`, `total_assignments`, `completion_rate`,
     `on_time_rate`, `last_worked_at`).
  On the createRating path the two currently CONVERGE (the app upsert runs after `Rating.create` in
  the same transaction). But any direct `Rating` UPDATE/DELETE, or any non-createRating writer, lets
  the trigger REWRITE `average_score`/`total_ratings`/`last_worked_at` WITHOUT the app-only fields
  (`total_assignments`/`completion_rate`/`on_time_rate`) — a genuine dual-writer / source-of-truth
  hazard, since the aggregate is read downstream by work-applications (`work-applications/service.ts:64`)
  and the leaderboard. Which mechanism is authoritative stays `[OPEN DECISION]` OQ-04.

**Consumed state (read):**
- `state-worker-assignment` (owner `backend-assignments`) — read for verification/rating ownership
  and denormalization (`service.ts:19,100,150`); edge `edge-quality-reads-worker-assignment`
  (`DEPENDENCY_GRAPH.yaml:195-201`).
- `state-attendance` (owner `backend-attendance`) — read inside the overall-rating recompute
  (`attendance.count` where status PRESENT, `service.ts` recompute block) to derive `on_time_rate`.
  (Observed read; `edge-quality-reads-attendance` recorded in the dependency graph, `DEPENDENCY_GRAPH.yaml:211-217`.)
- `state-audit-log` (write, cross-cutting via `BaseService.logAudit`).

**Permitted writes:** This module writes ONLY its three owned domains
(`state-quality-verification`, `state-rating`, `state-worker-overall-rating`) and `state-audit-log`
(cross-cutting). No cross-owner INBOUND writers are observed on these domains (contrast attendance).
NOTE (FIND-ARCH-001): `state-worker-overall-rating` nonetheless has TWO SAME-OWNER write mechanisms —
the application upsert (`service.ts:174`) and the installed DB trigger `Rating_refresh_overall_rating`
(`migration.sql:588-631`); both are `backend-quality`'s data layer, so the single-authoritative-writer
(`backend-quality`) statement holds, but source-of-truth between the two mechanisms is OQ-04.

**Consumers of this module's state (downstream — NOT owned here):**
- `backend-work-applications` reads `state-worker-overall-rating` at apply time
  (`work-applications/service.ts:64`, `select average_score`); edge
  `edge-work-applications-reads-worker-overall-rating` (`DEPENDENCY_GRAPH.yaml:174-180`). This makes
  the semantics of `average_score` a cross-consumer contract question (OQ-02).
- `backend-analytics` reads all three domains (`analytics/service.ts:37,93,97,100,101,105,208,212,215`);
  edges `edge-analytics-reads-quality-verification` (`:238`), `edge-analytics-reads-rating` (`:245`),
  `edge-analytics-reads-worker-overall-rating` (`:252`).
- `mobile-checker` consumes `/quality` (`edge-mobile-checker-quality`, `DEPENDENCY_GRAPH.yaml:281`):
  `mobile/checker-app/src/app/quality/[id].tsx:49` (createVerification),
  `rating/[id].tsx:33` (createRating), `(app)/leaderboard.tsx:27` (leaderboard). No frontend-web or
  mobile-worker quality edge observed.

**Boundary/non-responsibilities:** This module does NOT own: assignment lifecycle
(`backend-assignments`); attendance capture (`backend-attendance` — read-only here for `on_time_rate`);
notification delivery mechanics (`backend-notifications` — this module only calls `sendNotification`);
analytics aggregation (`backend-analytics` — a downstream consumer); the work-applications rating
snapshot. `[TARGET]` it is the CANDIDATE owner (pending OQ-08) of the 0–100 scoring, rating-tier
derivation, recency-weighted aggregation, warning emission, and the rework loop + 20-minute escalation
timer (in concert with a scheduled-job runtime and object storage) — whether these live in the quality
service or a new job/module is left OPEN by OQ-08. It does NOT own the notification channel or the
timer infrastructure itself.

## Interfaces and Contracts

Base router mounts at `routes/v1/index.ts:30` (`/api/v1/quality`). All routes require
`authMiddleware` (`routes.ts:7`). Envelope: `{ status:"success", data, meta:{timestamp,request_id} }`
— the leaderboard additionally carries a top-level `pagination` sibling (`page,per_page,total,
total_pages,has_next,has_prev`; default 25, max 100 per page — `ADR-035`/`SIR-QUAL-007`, resolved
2026-08-02); no other quality endpoint is a list. Error types map to HTTP via the shared error layer:
`ValidationError` (400, inline Zod field details via `parsed.error.errors[0].message`),
`NotFoundError` (404), `ForbiddenError` (403), `ConflictError` (409), `UnauthorizedError` (when
`!req.auth`). Validation is performed INLINE in the controller via `safeParse`. Compatibility
vocabulary: these contracts are **unversioned** in code (no contract version / registry entry), so
their compatibility posture is recorded as **baseline/UNKNOWN**.

`[CURRENT STATE]` endpoints (implemented @6e404ab):

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `POST /quality/verifications` (unversioned) | inbound | `CreateQualityVerificationSchema` (`types.ts:3-7`): assignment_id string min1; score int 0..100; notes optional | 201 verification | ValidationError, NotFoundError(assignment), ConflictError(duplicate/P2002) | `authMiddleware` + `requirePermission('quality:write')` | baseline/UNKNOWN |
| `POST /quality/ratings` (unversioned) | inbound | `CreateRatingSchema` (`types.ts:15-21`): assignment_id min1; worker_id min1; score int 1..5; comment?; criteria_scores? record<string,number> | 201 rating | ValidationError, NotFoundError(assignment), ForbiddenError(worker mismatch), ConflictError(duplicate/P2002) | `authMiddleware` + `requirePermission('quality:write')` | baseline/UNKNOWN |
| `GET /quality/leaderboard` (unversioned) | inbound | query `page`/`per_page` (default 1/25, max per_page 100 — `ListLeaderboardQuerySchema`) | 200 page of `WorkerOverallRating[]` w/ worker {id,first_name,last_name,email}, `orderBy average_score desc`, `pagination` meta | ValidationError(rare) | `authMiddleware` + `requirePermission('quality:read')` | baseline/UNKNOWN |
| `GET /quality/leaderboard/by-hotel/:hotel_id` (unversioned) | inbound | path `hotel_id`; query `page`/`per_page` (same schema) | 200 page of `WorkerOverallRating[]` filtered to ACTIVE `HotelWorker` at hotel, `pagination` meta | NotFoundError, ForbiddenError | `authMiddleware` + `requirePermission('quality:read')` + `checkHotelAccess()` (BYPASSED for admin/manager/checker → scope no-op, OQ-03) | baseline/UNKNOWN |

`[TARGET STATE]` interfaces (unbuilt): a 0–100 rating submission with a photo (TREQ-001/002); a
rating-tier label on reads (TREQ-003); a rework-assignment endpoint + worker completion (photo +
"done") + checker notification (TREQ-008); leaderboard/tier ordering by the 0–100 score. Whether the
1–5 `Rating` endpoint is rescaled, replaced, or retired is UNDER OPEN DECISION (OQ-01). These
contracts are not specified beyond the confirmed behavior above and will be authored at milestone M3
(Field ops, PIVOT §12).

## Events

No event bus exists (MODULE_REGISTRY `published_events: none-observed`, `MODULE_REGISTRY.yaml:129-139`).
`[CURRENT]` "Events" below are synchronous, best-effort, fire-and-forget calls to
`notificationService.sendNotification` (edge `edge-quality-notifications`, `DEPENDENCY_GRAPH.yaml:105-112`,
evidence `service.ts:4,75,191`) — never transactional (RULE-009). Delivery failures are
`.catch(()=>{})`-swallowed.

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `QUALITY_VERIFICATION_SUBMITTED` | backend-quality | verification create with status PASSED or FAILED | `service.ts:75-84` (assignment worker_id) | Verified worker (`assignment.worker_id`) | Fire-and-forget; not idempotent; failure swallowed; FAILED reuses this type; UNTESTED |
| `REWORK_REQUIRED` | backend-quality | verification create with status NEEDS_REWORK | `service.ts:75-84` | Worker (`assignment.worker_id`) | Fire-and-forget; failure swallowed; UNTESTED |
| `RATING_RECEIVED` | backend-quality | rating committed | `service.ts:191-198` (worker_id) | Rated worker (`worker_id`) | Fire-and-forget; failure swallowed; TESTED (`quality.test.ts:353`) |

Declared `NotificationType` values (`schema.prisma:108-110`): `QUALITY_VERIFICATION_SUBMITTED`,
`RATING_RECEIVED`, `REWORK_REQUIRED`. No FAILED-specific or WARNING type is declared. Channel is not
enforced push-only in quality code (channel-agnostic `sendNotification`) — recorded as observed.

`[TARGET]` Channel becomes push-only (CONFIRMED §18, TRULE-007). New notifications are settled by the
authorities but have NO code representation: WARNING (first <70, second <50 → also manager,
CONFIRMED §16); rework-assignment via inbox + push BOTH (CONFIRMED §14); rework-completion to checker;
20-minute escalation to Manager + Checker (CONFIRMED §14). These require a WARNING notification type
and a stored inbox entry — unbuilt (MIG-GAP-04/05/08).

## Dependencies

`[CURRENT]` existing DEPENDENCY_GRAPH edges referenced (no new backend edges proposed for current
state):

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `edge-quality-reads-worker-assignment` (`DEPENDENCY_GRAPH.yaml:195-201`) | Ownership/denormalization for verification & rating; recompute inputs | Prisma read `state-worker-assignment` | baseline/UNKNOWN | Missing assignment → NotFoundError |
| `edge-quality-notifications` (`DEPENDENCY_GRAPH.yaml:105-112`) | Verification/rating notifications | `notificationService.sendNotification` | baseline/UNKNOWN | Best-effort; swallowed (RULE-009) |
| `edge-work-applications-reads-worker-overall-rating` (`DEPENDENCY_GRAPH.yaml:174-180`) | Apply-time rating snapshot | Prisma read `state-worker-overall-rating` (`work-applications/service.ts:64`) | baseline/UNKNOWN; contract OQ-02 | Consumer-side |
| `edge-analytics-reads-quality-verification` (`:238`), `edge-analytics-reads-rating` (`:245`), `edge-analytics-reads-worker-overall-rating` (`:252`) | Downstream analytics of all three domains | Prisma read | baseline/UNKNOWN | Consumer-side |
| `edge-mobile-checker-quality` (`DEPENDENCY_GRAPH.yaml:281`) | API client of `/quality` (verification, rating, leaderboard) | HTTP (unversioned) | baseline/UNKNOWN | Client-side; breaking-change risk if endpoints change |

Shared contracts consumed: `prisma-schema` (data), `base-service` (`logAudit` → `state-audit-log`),
`auth-middleware`, `permissions-middleware` (`requirePermission`, `checkHotelAccess`),
`notification-service`. An additional read of `state-attendance` is observed inside the overall-rating
recompute (`on_time_rate`) — recorded for the graph.

`[TARGET]` new dependencies (unbuilt): object storage (S3 EU) for rating/rework photos (PIVOT
~line 164); a scheduled-job runtime (node-cron / BullMQ on Redis) for the 20-minute rework timer
(PIVOT ~line 165,190); a new `ReworkTask` model (PIVOT §9.1); a WARNING notification type and a
stored inbox entry (CONFIRMED §14/§16). Architecture anchors modular-monolith (ADR-003, Proposed) and
Prisma-over-PostgreSQL (ADR-004, Proposed) are retained.

## State and Lifecycle

`[CURRENT STATE]` `VerificationStatus` machine (`schema.prisma:74-78`; `quality/service.ts`):
- **Entry:** a `QualityVerification` is created directly by a checker/admin (`service.ts:13-87`);
  status is DERIVED from the 0–100 score at write time (PASSED/NEEDS_REWORK/FAILED, RULE-004). There
  is NO post-create status transition path in code — status is set once. The dormant `rework_required`,
  `rework_notes`, `rework_completed_at`, and `photo_urls` columns (`schema.prisma:406-409`) are NEVER
  written or read by `service.ts` (dead fields; the rework loop is unbuilt).
- **Rating:** a `Rating` is created 1:1 with an assignment (`assignment_id @unique`,
  `schema.prisma:421`); no rating-status lifecycle exists.
- **Worker overall rating:** UPSERTED (create-or-update) per worker on each rating commit inside the
  transaction (`service.ts:174`). It is a materialized aggregate, not a state machine.
- **Invariants:** verification and rating are each 1:1 with an assignment
  (`schema.prisma:397,421`, onDelete Cascade); `hotel_id`/`worker_id` cascade from Hotel/User;
  `verified_by`/`rated_by` are `onDelete: Restrict` (`schema.prisma:402,428`) — a deletion-behavior
  asymmetry vs the Cascade relations (OQ-05).

**Concurrency:** verification create is a read-then-write pre-check (`service.ts:24-27`) BACKED by the
unique constraint + P2002→Conflict catch (RULE-003), so a duplicate race is safely a 409. Rating
create + overall-rating recompute run inside a single `$transaction` (`service.ts:99-181`), so the
aggregate is consistent with the committed rating. No optimistic version column exists on any model.

**Retention:** `[CURRENT]` verification/rating/overall-rating rows persist indefinitely; no
soft-delete, no TTL. Audit rows persist. `[TARGET]` rating/rework photos land in object storage
(retention policy for photos is UNKNOWN — not settled by authorities); the 20-minute rework timer is
transient scheduled state.

`[TARGET]` flows (CONFIRMED §14/§15/§16; PIVOT §4.6/§7.5/§9.1): (a) checker uploads a 0–100 score +
photo to the worker's profile → recency-weighted overall rating recomputed → tier label derived →
warning emitted if it crosses <70 or <50; (b) rework: checker→worker (inbox + push) → worker uploads
photo + "done" → checker notified; a 20-minute timer escalates to Manager + Checker if incomplete.
Where recency-weighting, tiers, and warnings live (quality service vs a new job) and whether they
mutate `WorkerOverallRating` or a new structure is UNDER OPEN DECISION (OQ-08).

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** `[CURRENT]` conflict/validation/not-found/forbidden surface as typed HTTP
errors. Verification create is a single write guarded by a pre-check and a P2002→Conflict catch
(RULE-003). Rating create + aggregate recompute are atomic within one `$transaction` (`service.ts:99-181`).
Notification delivery failures are swallowed and never affect the write (RULE-009) — a verification
or rating can persist while its notification is silently lost.

**Trust boundaries/authorization:** `[CURRENT]` route RBAC: writes require `quality:write` (ADMIN,
CHECKER); reads require `quality:read` (ADMIN, MANAGER, CHECKER); WORKER has no quality permission
(`config/constants.ts:88-129`). Current-state authorization observation (finding candidate, NOT
resolved here):
- `[OPEN DECISION]` OQ-03 (READ-side) — the `by-hotel` leaderboard's hotel scope is a NO-OP for every
  quality-permitted role: `checkHotelAccess()` BYPASSES the hotel-membership check for
  admin/manager/checker (`permissions.ts:103-108`, "Checkers operate across hotels"), and only
  workers (who lack quality permissions entirely) are ever scoped. So any quality-permitted actor
  reads ANY hotel's leaderboard regardless of the `:hotel_id` path segment. Intended cross-hotel
  visibility or a scoping defect — human decision (cross-tenant exposure class).
- `[OPEN DECISION]` OQ-09 (WRITE-side, FIND-SEC-002) — the write routes bind the actor to the
  ASSIGNMENT only, NOT to the assignment's hotel: `createVerification` (`service.ts:13-87`) and
  `createRating` (`service.ts:89-201`) copy `hotel_id` from the assignment (RULE-005) but perform no
  hotel-membership check, and `checkHotelAccess()` is applied ONLY to the by-hotel READ route
  (`routes.ts:18`), never to the write routes (`routes.ts:9,12`). So any actor with `quality:write`
  (ADMIN/CHECKER) can verify/rate ANY assignment at ANY hotel, mutating that worker's
  `WorkerOverallRating` / leaderboard / (target) warning state. `hotel_id`-from-assignment is NOT by
  itself an authorization control. Bounded by single-tenant-per-client deployment (PIVOT §5.1) and
  trusted staff. Intended or a defect — human decision; no control invented here.

**Data classification/retention:** `[CURRENT]` quality data carries worker performance data (scores,
ratings, notes/comments) and rater identity; audit rows persist actor id/role. Both leaderboard reads
(`GET /leaderboard`, `GET /leaderboard/by-hotel/:hotel_id`) return worker **email**
(`service.ts:216-219`) — contact PII / GDPR personal data disclosed to ALL `quality:read` holders
(ADMIN/MANAGER/CHECKER), and cross-hotel via the OQ-03 scope no-op (FIND-SEC-003). No photo/location
data is captured today (`photo_urls` dormant). `[TARGET]` inspection/rework photos are
worker-performance media stored in object storage (S3 EU, PIVOT ~line 164); their retention policy is
not settled by the authorities and must be decided (recorded under OQ-08 scope). Additionally, a
target photo-RETRIEVAL authorization obligation must be settled (FIND-SEC-004): who may VIEW personal
performance media and at what hotel scope, so the OQ-03/OQ-09 no-scope pattern is NOT silently
inherited by the M3 photo-serving path (recorded under OQ-08 scope). Warnings are worker-sensitive
notifications.

**Performance budgets/workload:** SLO baseline set by `ADR-035`/`GD-11` (2026-07-28): leaderboard
(cross-module aggregation class) targets p95 ≤ 800ms; owner assignment (`SYNC-001`) remains
separately open. Observations: the leaderboard is now PAGINATED (default 25, max 100 per page —
`ADR-035`/`SIR-QUAL-007`, implemented 2026-08-02) with `orderBy average_score desc`
(`service.ts:263-296`); `average_score` is
indexed (`@@index([average_score])`, `schema.prisma:457`). The overall-rating recompute issues several aggregate/count queries in
a `Promise.all` per rating (`service.ts:136-159`). `[TARGET]` recency-weighting, tier derivation,
warning checks, and a periodic rework-timer sweep add new workload; the timer runtime is
node-cron/BullMQ on Redis (PIVOT ~line 165,190). Single-tenant-per-client deployment (PIVOT §5.1)
suggests modest scale; no figures confirmed.

Independent performance review (`PASS_WITH_ACTIONS`, zero Critical/High, applied at v0.1.2) added the
following verified/static findings, distinguished from the unconfirmed-projection framing above:
- **FIND-PERF-001** (Medium) — the installed DB trigger `Rating_refresh_overall_rating`
  (`migration.sql:588-631`) re-scans a worker's full `Rating`/`WorkerAssignment` history and writes
  `WorkerOverallRating` on every `Rating` insert/update/delete, and the app's own `$transaction`
  (`service.ts:99-181`, upsert at `:174`) then re-runs an equivalent aggregate + upsert AFTER the
  trigger has already fired, in the SAME transaction. On every `createRating` call the trigger's two
  read-scans and one write are provably overwritten milliseconds later by the app upsert: ~2x
  avoidable read load, two physical writes (dead+live tuple) to the same row instead of one (MVCC
  bloat/autovacuum pressure scaling with rating volume), and a longer held row-lock window on
  `WorkerOverallRating` for that worker. Exact millisecond/lock-time magnitude is UNKNOWN (no
  benchmark environment available). This is additive workload evidence strengthening the already-open
  `OQ-04` dual-writer decision — it does not decide OQ-04 (see OQ-04 cross-reference below).
- **FIND-PERF-002** (Low) — `service.ts:138-159` and the trigger's equivalent full-history
  `AVG`/`COUNT`/`MAX` both recompute a worker's aggregate from their ENTIRE rating/assignment history
  on every single new rating, with no incremental counter or windowing; per-write cost grows O(n) with
  a worker's cumulative rating count, uncapped. Very unlikely to matter at the assumed pre-launch
  single-tenant "modest scale" (PIVOT §5.1), but the point at which it would matter is genuinely
  unconfirmed — no workload figures exist in any authority document (not invented here). Forwarded as
  a capacity note for TREQ-004/OQ-08 (see OQ-08 cross-reference below), not a requirement.
- **FIND-PERF-003** (Low, Confidence Low) — `service.ts:263-296` (`getLeaderboard(hotelId)`, by-hotel)
  filters via `HotelWorker.hotel_id`+`status` and orders by `average_score desc`, paginated, but
  `schema.prisma` gives `HotelWorker` only separate `@@index([hotel_id])` and `@@index([status])` —
  no compound `(hotel_id,status)` index, and nothing correlates hotel/status with `average_score`
  ordering. Query-plan cost is data-distribution-dependent (could stay roster-bounded-cheap or degrade
  toward a larger scan depending on how the planner drives the join) — a DISTINCT risk from the global
  leaderboard, which the global-only `average_score` index handles cleanly at any scale. No
  `EXPLAIN ANALYZE` was run (no reproducible DB environment authorized for this review). Not a
  restatement of OQ-07 (see OQ-07 note below).

Positive evidence (preserved from the review): the global leaderboard's `orderBy average_score desc`
+ paginated `skip`/`take` is an efficient index-scan-plus-limit pattern independent of total worker/rating volume;
the rating-transaction fan-out is entirely `worker_id`-scoped (not table-scoped) and every touched
model (`Rating`, `WorkerAssignment`, `Attendance`) carries a `worker_id` index; no N+1 pattern exists
anywhere in the module; the rating-create + aggregate-recompute atomicity via a single `$transaction`
is already correct. Required outcomes: FIND-PERF-001 → decision (fold into OQ-04); FIND-PERF-002 →
approved capacity note for the M3 recency-weighted aggregate author, non-blocking; FIND-PERF-003 →
approved action to capture an `EXPLAIN ANALYZE` under representative roster-size data pre/post-launch,
non-blocking.

**Observability/audit:** every mutation calls `BaseService.logAudit` → AuditLog
(`CREATE_VERIFICATION`, `CREATE_RATING`). No metrics/tracing observed. Responses carry `request_id`
in `meta`.

## Rollout and Compatibility

`[CURRENT]` behavior is already deployed at `6e404ab`; the current-state layer is a reverse
specification, not a change. The three models and the `VerificationStatus` enum are established
(`schema.prisma:74-78,395-459`). No feature flags observed for this module.

`[TARGET]` migration strategy — a **forward build** aligned to PIVOT §12 milestone **M3 (Field ops)**
("quality" — "rework 20m timer, warnings"; success criteria = all module tests green + envelope
conformance + RBAC/scope tests). Because the system is **pre-launch with no production quality data**,
the headline 1–5→0–100 reconciliation (OQ-01) is a design decision rather than a data-migration
constraint. `[MIGRATION GAP]` enumeration:

| Gap ID | Current state (evidence) | Target requirement (evidence) | Phase |
|---|---|---|---|
| MIG-GAP-01 | `Rating.score` is 0..100 (`schema.prisma`; `types.ts`), rescaled from 1..5 by `ADR-026`; leaderboard orders by the 0–100 average (`service.ts:214-223`) | Score is **0–100, NO 5-star system** (CONFIRMED §15; PIVOT §4.6) — TREQ-001. RESOLVED by `ADR-026` (was HEADLINE contradiction OQ-01, classified BREAKING vs the unversioned baseline, FIND-DEP-002) | M3 |
| MIG-GAP-02 | `WorkerOverallRating.average_score` = plain rolling average of 1–5 (`service.ts:161`; `schema.prisma:449`) | **Recency-weighted, last-10-weighted** 0–100 average (CONFIRMED §15; PIVOT §4.6, §7.5) — TREQ-004 | M3 |
| MIG-GAP-03 | No rating tiers anywhere in code | **Elite/High/Standard/Low/Probation** label on top of the 0–100 score (CONFIRMED §15) — TREQ-003 | M3 |
| MIG-GAP-04 | No warning logic and no WARNING notification type (`schema.prisma:108-110`) | Warnings <70 (first), <50 (second → also manager, manual) (CONFIRMED §16; PIVOT §7.5) — TREQ-006/007 | M3 |
| MIG-GAP-05 | Dormant `rework_*` columns (`schema.prisma:406-409`) but NO rework endpoint, NO `ReworkTask` model, NO 20-min timer/escalation job | Rework loop checker→worker→checker with 20-minute escalation to Manager+Checker (CONFIRMED §14; PIVOT §4.6, §9.1) — TREQ-008/009 | M3 |
| MIG-GAP-06 | `photo_urls` column dormant; no upload path / object-storage wiring in quality | Checker **uploads a photo WITH the rating** (CONFIRMED §15; PIVOT §4.6) — TREQ-002 | M3 |
| MIG-GAP-07 | `criteria_scores` is free JSON `{punctuality,quality,attitude}` (`schema.prisma:431-432`) | Confirmed checklist: dust, bathroom, bed linen, mirror, floor, minibar/restocking, fragrance/amenities, other (CONFIRMED §15) — TREQ-005 | M3 |
| MIG-GAP-08 | Notifications are channel-agnostic (`sendNotification`); no stored inbox entry | Push-only system-wide (CONFIRMED §18); rework requires **inbox + push BOTH** with a stored readable inbox entry (CONFIRMED §14) — TREQ-010/008 | M3 |

**Backward compatibility:** current `/quality` endpoints are consumed by mobile-checker
(`DEPENDENCY_GRAPH.yaml:281`) and the overall-rating aggregate is read by work-applications and
analytics (`:174,238,245,252`). The target 1–5→0–100 `Rating` change (OQ-01 / MIG-GAP-01) and the
`average_score` redefinition (OQ-02) are classified **BREAKING** against the current unversioned
baseline (FIND-DEP-002), gated on OQ-01/OQ-02 (no change made now). Two additional exposures the
current consumer list understated:
- `average_score` is re-exposed TRANSITIVELY to **mobile-worker** via `backend-analytics`
  (`/analytics/leaderboard`, `analytics/service.ts:20-56`) → `mobile/worker-app/src/app/ratings.tsx:19`
  → `api.ts:225`; edge `edge-mobile-worker-analytics` (`DEPENDENCY_GRAPH.yaml:275`) — a consumer NOT
  in the module's direct list. Redefining `average_score`'s scale is worker-visible.
- `backend-work-applications` PERSISTS a `worker_rating_snapshot` at apply time
  (`work-applications/service.ts:64,77-78,92-93`), so historical 1–5 snapshots would COEXIST with new
  0–100 values unless migrated — a data-coexistence hazard, not just a live-read change.
Because contracts are unversioned (baseline/UNKNOWN), any change must be assessed against a future
versioned baseline. **Rollback:** feature-flag the target scoring/rework paths per the existing
`FEATURE_*` convention. **Removal criteria:** none — quality is a core capability.

## Validation Plan

`[CURRENT STATE]` criteria (mapped to `backend/src/__tests__/quality.test.ts` @6e404ab):

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| REQ-002/010/016 RBAC gating (RULE-001) | Unit (middleware) | `quality.test.ts:81,88,95` | Deny leaderboard w/o `quality:read`; deny verifications w/o `quality:write`; allow leaderboard w/ read |
| REQ-018/011 Zod createVerification (RULE-001/006) | Unit | `quality.test.ts:111,122,133` | Missing assignment_id; score>100; non-integer rejected |
| REQ-011/018 Zod createRating (RULE-006) | Unit | `quality.test.ts:153,164,175,252,263,274,285` | Missing worker_id; score>5; non-integer; boundary score=0 rejected |
| REQ-004/007 verification concurrency (RULE-002/003) | Unit (mocked Prisma) | `quality.test.ts:200,213,231` | Pre-check Conflict; P2002→Conflict; non-P2002 re-throws |
| REQ-013 rating duplicate (RULE-003) | Unit | `quality.test.ts:309` | P2002→Conflict |
| REQ-015 `RATING_RECEIVED` notification (RULE-009) | Unit | `quality.test.ts:353` | Notification emitted after successful rating |
| REQ-005 status-derivation thresholds 70/40 (RULE-004) | — | — | **UNTESTED** — no test asserts PASSED/NEEDS_REWORK/FAILED boundaries |
| REQ-009 NEEDS_REWORK / FAILED notification branches (RULE-009) | — | — | **UNTESTED** — only RATING_RECEIVED asserted; verification branches not |
| REQ-003 createVerification assignment-NotFound (RULE-002) | — | — | **UNTESTED** |
| REQ-012 createRating assignment-NotFound + worker mismatch Forbidden (RULE-006) | — | — | **UNTESTED** |
| REQ-014 overall-rating math (average / completion_rate / on_time_rate) (RULE-007/008) | — | — | **UNTESTED** — aggregate formulas unverified |
| REQ-016/017 leaderboard ordering + hotel-scoping (RULE-008) | — | — | **UNTESTED** — ordering and by-hotel scope not asserted |
| REQ-017 by-hotel `checkHotelAccess` bypass (OQ-03) | — | — | **UNTESTED** |
| REQ-008/015 audit writes (RULE-010) | — | — | **UNTESTED** |

`[TARGET STATE]` criteria (to be authored at M3; recorded as expectations, not executable):
TREQ-001 0–100-only scoring; TREQ-002 photo-with-rating persistence; TREQ-003 tier-label derivation;
TREQ-004 recency-weighted (last-10) aggregate; TREQ-006/007 warning emission at <70 and <50 (+ manager
notification); TREQ-008/009 rework loop + 20-minute escalation to Manager + Checker; TREQ-010 push-only
delivery with a stored inbox entry. PIVOT §12 M3 success criteria require all module tests green +
envelope conformance + RBAC/scope tests.

## Risks, Assumptions, and Open Decisions

Genuine remaining human-authority items (status OPEN). These are NOT resolved here.

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OQ-01 | decision | Does the shipped 1–5 `Rating` model get **rescaled, replaced, or retired** under the confirmed 0–100 no-5-star model? Headline product/architecture decision. | `schema.prisma`; `types.ts` vs CONFIRMED §15; `ADR-026` | human/architecture | **RESOLVED — 2026-07-22, `ADR-026`: rescaled to 0–100, matches TRULE-001** |
| OQ-02 | decision | `WorkerOverallRating.average_score` currently aggregates 1–5 `Rating.score` but is read as the worker's headline rating by work-applications (`service.ts:64`), analytics, the leaderboard order, AND transitively by mobile-worker via `/analytics/leaderboard` (`analytics/service.ts:20-56`; `mobile/worker-app/src/app/ratings.tsx:19`→`api.ts:225`; `edge-mobile-worker-analytics` `DEPENDENCY_GRAPH.yaml:275`). Under the 0–100 target, what scale/definition/recency-weighting does it carry? Redefinition is BREAKING (FIND-DEP-002); work-applications also persists a `worker_rating_snapshot` (`work-applications/service.ts:64,77-78,92-93`) so historical 1–5 snapshots coexist unless migrated. Cross-consumer contract. | `service.ts:161,214-223`; `work-applications/service.ts:64,77-78,92-93`; `analytics/service.ts:20-56`; CONFIRMED §15 | human/architecture | **OPEN — cross-consumer, BREAKING** |
| OQ-03 | decision | READ-side: `getLeaderboard/by-hotel/:hotel_id` scope is a NO-OP for all quality roles (`checkHotelAccess` bypasses admin/manager/checker) and the global leaderboard orders by the 1–5 average. Intended cross-hotel visibility or a scoping defect? **Severity Medium** (FIND-SEC-001): cross-hotel read of worker-performance ranking + worker email PII, bounded to cross-hotel WITHIN one client tenant (single-tenant-per-client, PIVOT §5.1), NOT cross-client. Routed WITH OQ-09 to a Risk Assessment for human acceptance (owner unassigned, OQ-06/SYNC-001). | `service.ts:204-223`; `permissions.ts:103-108` | human | **OPEN — cross-tenant (Medium)** |
| OQ-09 | decision | WRITE-side cross-hotel authorization exposure (FIND-SEC-002): `createVerification`/`createRating` bind the actor to the assignment only, not its hotel. Any `quality:write` holder can verify/rate ANY assignment at ANY hotel. **RESOLVED via `ADR-065` Gap 5 (2026-08-11):** The fix is assignment-day-hotel-matching. A Checker may only create a `QualityVerification`/`Rating` for a `WorkerAssignment` if the Checker themselves has an active `WorkerAssignment` at that same `hotel_id`, on the same day (i.e., both parties physically at the same hotel when the check occurs). NOT a comparison against either party's static `primary_hotel_id`. | `service.ts:13-87,89-201`; `routes.ts:9,12,18` | human | **RESOLVED (Assignment-day matching)** |
| OQ-04 | decision | `state-worker-overall-rating` has TWO SAME-OWNER write mechanisms: an INSTALLED DB trigger `Rating_refresh_overall_rating` (writes `average_score`/`total_ratings`/`last_worked_at` only, `migration.sql:588-631`) AND the app upsert (writes the full row, `service.ts:174`). They converge on the createRating path but any direct Rating UPDATE/DELETE lets the trigger rewrite the aggregate without the app-only fields (`total_assignments`/`completion_rate`/`on_time_rate`) — dual-writer / source-of-truth hazard read downstream by work-applications + leaderboard. Which mechanism is authoritative? Performance review (FIND-PERF-001) adds WORKLOAD evidence to this same open decision (not a resolution): on every `createRating` call the trigger's two full-history read-scans + one write are provably overwritten milliseconds later by the app's own re-scan + upsert in the same transaction — ~2x avoidable read load, two physical writes (dead+live tuple) instead of one, and a longer held row-lock window; resolving OQ-04 should also eliminate whichever mechanism is not selected as authoritative. | `backend/prisma/migrations/20260613120000_v2_marketplace_init/migration.sql:588-631`; `service.ts:174`; `schema.prisma:443` | human/architecture | **OPEN** |
| OQ-05 | decision | `verified_by`/`rated_by` are `onDelete: Restrict` while worker/hotel are Cascade — deletion-behavior asymmetry to settle. | `schema.prisma:402,428` | human/architecture | **OPEN** |
| OQ-06 / SYNC-001 | decision | Owner is `unassigned` — blocks accountable ownership and SLO-setting. This row DEFINES the `SYNC-001` owner token for this artifact (canonical token: `TERMINOLOGY.md:51`); all inline `SYNC-001`/`OQ-06/SYNC-001` references resolve here. Cross-spec alignment with the attendance precedent (`attendance/MODULE_SPEC.md:461`) is routed to post-flight synchronization — the attendance spec is NOT edited here. | `MODULE_REGISTRY.yaml:129-139`; `TERMINOLOGY.md:51` | human | **OPEN** |
| OQ-07 | decision | **RESOLVED (SLO baseline + pagination half) `GD-11`/`ADR-035`, 2026-07-28; pagination itself IMPLEMENTED 2026-08-02** (`SIR-QUAL-007`): leaderboard targets p95 ≤ 800ms, pagination is default 25/max 100 per page. Performance review's DISTINCT, separately-tracked measurement item (FIND-PERF-003) remains its own open follow-on task: the by-hotel leaderboard (`getLeaderboard(hotelId)`) has no compound `HotelWorker(hotel_id,status)` index and its `average_score`-ordered query-plan cost is data-distribution-dependent (unlike the global leaderboard, which the global-only `average_score` index handles cleanly at any scale); no `EXPLAIN ANALYZE` was run. This is a measurement/indexing item, not a restatement of "no SLO defined". | `ADR-035`; `SIR-QUAL-007` | human/unassigned | **OPEN — compound-index measurement item only; SLO/pagination halves RESOLVED** |
| OQ-08 | decision | Where recency-weighting, tier derivation, and warnings LIVE (quality service vs a new job), whether they mutate `WorkerOverallRating` or a new structure, the tier thresholds, the photo-RETENTION policy, and the target photo-RETRIEVAL authorization (who may view personal performance media + its hotel scope, FIND-SEC-004 — so the OQ-03/OQ-09 no-scope pattern is not inherited by the M3 photo-serving path) — architecture decisions for M3. Performance review (FIND-PERF-002) adds a forward-looking capacity note, not a new requirement: today's full-history rescan (`service.ts:138-159`, and the trigger's equivalent) makes per-write cost grow O(n) with a worker's cumulative rating count, uncapped — unlikely to matter at assumed pre-launch scale but genuinely unconfirmed; whoever authors the M3 recency-weighted aggregate (TREQ-004) should prefer a bounded/incremental design (e.g. `ORDER BY ... LIMIT 10`) over a full-history rescan, which would likely resolve this by construction. | CONFIRMED §14/§15/§16; PIVOT §7.5, §9.1 | human/architecture | **OPEN** |

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| ASM-01 | assumption | RBAC permission tokens `quality:read`/`quality:write` are the gate for quality routes (not raw role literals); ADMIN/CHECKER hold write, ADMIN/MANAGER/CHECKER hold read. | `quality/routes.ts:9-18`; `config/constants.ts:88-129` | Assumption for current-state |
| ASM-02 | assumption | The dormant `photo_urls`/`rework_*` columns were provisioned FOR the confirmed rework/photo target but are not yet wired; they are treated as the intended landing site, not a requirement. | `schema.prisma:406-409`; CONFIRMED §14/§15 | Assumption, bounded by authority |

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate.

- **MODULE_REGISTRY.yaml:** set `specification` for `backend-quality` from `UNKNOWN` →
  `SPEC-QUAL-001@0.1.2 (REVIEW)` (`MODULE_REGISTRY.yaml:129-139`). Do NOT alter `owner` (remains
  `unassigned`, OQ-06 / SYNC-001).
- **DEPENDENCY_GRAPH.yaml:** the `state-attendance` read that derives `on_time_rate`
  (`service.ts:147-149`, `tx.attendance.count` where status PRESENT), originally flagged as a
  genuine MISSING edge (FIND-DEP-001/FIND-ARCH-003), is **already applied** — `edge-quality-reads-attendance`
  exists (`DEPENDENCY_GRAPH.yaml:211-217`) and `state-attendance.readers` already includes
  `backend-quality` (`DEPENDENCY_GRAPH.yaml:503`), applied by an earlier repository-synchronization
  pass not previously reflected back into this document. The other existing edges (`edge-quality-reads-worker-assignment`,
  `edge-quality-notifications`, `edge-work-applications-reads-worker-overall-rating`, the three
  analytics-reads edges, and `edge-mobile-checker-quality`) already reflect current reality. NOTE
  (future, do not add yet): the target adds a new `ReworkTask` model, a 20-minute scheduled
  rework-timer job, object-storage (S3) photo edges, and WARNING notifications — these become graph
  edges when M3 is built.
- **TERMINOLOGY.md:** promote to canonical (no quality terms are canonical yet): `Quality
  verification`, `Quality score (0–100)`, `Rating`, `Worker overall rating`, `Rating tier`,
  `Warning (<70/<50)`, `Rework task`, `Recency-weighted average` — sourced to code + CONFIRMED
  §14/§15/§16.
- **DECISION_INDEX.md:** reference ADR-003 (modular monolith) and ADR-004 (Prisma ORM) as existing
  anchors (both Proposed). A NEW Decision Record MAY be requested for the 1–5-vs-0–100 `Rating`
  reconciliation (OQ-01) and for the `WorkerOverallRating` source-of-truth (DB trigger vs app upsert,
  OQ-04) — proposed, not created here.
- **SYNC_STATE.yaml:** none proposed by the author; the synchronization owner records spec issuance
  if/when this candidate advances.

## Status Addendum — 2026-08-22 (recorded, not versioned)

**Purpose.** This specification is `FROZEN` and its `[CURRENT STATE]` claims cite `path:line
@6e404ab` (2026-07-07). Per this repository's append-only correction convention (see `ADR-060`'s
own 2026-08-05 addendum), the original text above is left intact and this section records what has
been built since, so a reader is not left believing the rework loop is still a target. **No
requirement, rule, open-decision, or migration-gap id is renumbered or restated here.**

Between 2026-08-18 and 2026-08-20 the rework loop moved from `[TARGET STATE]` to built, governed by
`ADR-069` (Accepted 2026-08-18 — *Rework Is a New Assignment Linked to the Original*). Rework is
modelled as a **new `WorkerAssignment` linked to the original**, not as a state on the original.

| Target-state item | Status at 2026-08-22 | Evidence |
|---|---|---|
| Rework loop (checker → worker → checker) | **BUILT** | `backend/src/modules/quality/routes.ts:51` — `POST /quality/rework`; service in `backend/src/modules/quality/service.ts` |
| 20-minute auto-escalation to Manager + Checker | **BUILT** | `backend/src/modules/quality/rework-escalation-job.ts`, registered on the Platform Worker scheduler (`backend/src/worker.ts`); migration `20260818140000_add_rework_escalated_at` |
| Rework ↔ original assignment link | **BUILT** | migration `20260818120000_add_rework_assignment_link` |
| Rework notification legs | **BUILT** | migration `20260818130000_add_rework_notification_types`; `NotificationType.REWORK_REQUIRED` and siblings (`schema.prisma:122-123`) |
| Photo evidence with the rating | **BUILT** | `backend/src/modules/quality/routes.ts:46` — `GET /quality/verifications/:verification_id/photos`; multipart upload on the verification path; S3-backed, fails closed when unconfigured |
| Worker-facing rework surface | **BUILT** | `mobile/worker-app/src/app/rework/[id].tsx`; web UI in the assignments surface |
| Worker view of own hotel group's leaderboard | **BUILT** | `backend/src/modules/quality/routes.ts:69` — `GET /quality/leaderboard/by-hotel/:hotel_id`, governed by `ADR-067` |

**Still target, not built** (unchanged by the above): the 0–100-only rating model with no 5-star
system, rating tiers (Elite/High/Standard/Low/Probation), recency-weighted averaging over the last
10 jobs, and the two-step warning thresholds (first <70, second <50 → manager). The dormant
`photo_urls`/`rework_*` schema columns noted in the original text are no longer dormant.

**Governing records added since freeze:** `ADR-067` (worker leaderboard visibility — own hotel
group, non-contact fields; amends `ADR-030` §3 row `C-28`) and `ADR-069` (rework as a linked
assignment). Neither amends a frozen clause of this specification; both are recorded here and in
`.claude/knowledge/DECISION_INDEX.md`.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-07 | Initial specification for `backend-quality` at `6e404ab`. Current-state reverse spec: REQ-001..018, RULE-001..010. Target layer from confirmed authorities: TREQ-001..010, TRULE-001..007 (all cited to CONFIRMED/PIVOT). MIGRATION GAP enumeration MIG-GAP-01..08. Recorded open decisions OQ-01 (1–5 vs 0–100 Rating reconciliation), OQ-02 (average_score semantics / cross-consumer), OQ-03 (by-hotel scope no-op / cross-tenant), OQ-04 (WorkerOverallRating trigger-vs-app source of truth), OQ-05 (Restrict-vs-Cascade deletion), OQ-06 (owner unassigned / SYNC-001), OQ-07 (no SLO / unpaginated leaderboard), OQ-08 (where tiers/weighting/warnings live + thresholds + photo retention). Flagged UNTESTED criteria: verification status thresholds, NEEDS_REWORK/FAILED notification branches, verification assignment-NotFound, rating assignment-NotFound + worker-mismatch, overall-rating aggregate math, leaderboard ordering + by-hotel scoping, checkHotelAccess bypass, audit writes. | None — REVIEW, not approved. | None — status REVIEW, G2 freeze reserved to human. |
| 0.1.1 | 2026-07-07 | Applied merged dispositions from four independent PASS_WITH_ACTIONS reviews (architecture, dependency, consistency, security). No REQ/TREQ/RULE/TRULE/MIG-GAP/OQ ids renumbered. **FIND-ARCH-001**: reframed `state-worker-overall-rating` from "schema comment claim" to a CONFIRMED installed DB trigger `Rating_refresh_overall_rating` (`migration.sql:588-631`, writes average_score/total_ratings/last_worked_at only) PLUS the app upsert (full row) — two SAME-OWNER write mechanisms; dual-writer hazard kept as OQ-04; single-authoritative-writer statement reconciled. **FIND-ARCH-002**: softened `[TARGET]` M3 ownership to "candidate owner, pending OQ-08". **FIND-DEP-001/FIND-ARCH-003**: promoted the `state-attendance` read (`service.ts:147-149`) to a REQUIRED graph delta — new `edge-quality-reads-attendance` + add `backend-quality` to `state-attendance.readers`. **FIND-DEP-002**: classified the 1–5→0–100 Rating change (OQ-01/MIG-GAP-01) and average_score redefinition (OQ-02) as BREAKING; recorded transitive mobile-worker consumer via analytics (`edge-mobile-worker-analytics`) and the work-applications `worker_rating_snapshot` coexistence hazard. **FIND-DEP-003**: noted DEPENDENCY_GRAPH `observed_revision` restamp 5b16be4→6e404ab. **FIND-SEC-001**: added OQ-03 severity (Medium) + routed to Risk Assessment. **FIND-SEC-002**: added OQ-09 (write-side cross-hotel exposure) + Trust-boundaries note. **FIND-SEC-003**: recorded leaderboard worker-email PII disclosure. **FIND-SEC-004**: recorded target photo-retrieval authorization obligation under OQ-08. **FIND-CONS-001**: made OQ-06 the defining `SYNC-001` tracking row; cross-spec alignment routed to post-flight. **FIND-CONS-002**: citation 73,445→73,485-490. **FIND-CONS-003**: average_score index citation schema.prisma:458→457. | FIND-ARCH-001, FIND-ARCH-002, FIND-ARCH-003, FIND-DEP-001, FIND-DEP-002, FIND-DEP-003, FIND-SEC-001, FIND-SEC-002, FIND-SEC-003, FIND-SEC-004, FIND-CONS-001, FIND-CONS-002, FIND-CONS-003. | None — status REVIEW, G2 freeze reserved to human. |
| 0.1.2 | 2026-07-10 | Applied disposition from the fifth and final independent G4 review dimension, Performance (`PASS_WITH_ACTIONS`, zero Critical/High), completing the G4 round begun at v0.1.1. No REQ/TREQ/RULE/TRULE/MIG-GAP/OQ ids renumbered. **FIND-PERF-001**: recorded that the installed DB trigger `Rating_refresh_overall_rating` (`migration.sql:588-631`) is provably overwritten milliseconds later by the app's own `$transaction` upsert (`service.ts:174`) on every `createRating` call — ~2x avoidable read scans, two physical writes instead of one, longer row-lock window; added as workload evidence to the already-open OQ-04 (does not resolve it). **FIND-PERF-002**: recorded that both the app recompute (`service.ts:138-159`) and the trigger rescan a worker's ENTIRE rating/assignment history on every rating (O(n), uncapped); added as a forward-looking capacity note under OQ-08 for whoever authors the M3 recency-weighted aggregate (TREQ-004), preferring a bounded/incremental query over a full-history rescan. **FIND-PERF-003**: recorded that the by-hotel leaderboard (`service.ts:204-212`) has no compound `HotelWorker(hotel_id,status)` index and its query-plan cost is data-distribution-dependent, distinct from the global leaderboard's efficient index-scan-plus-limit pattern; added as a distinct measurement item under OQ-07 (capture `EXPLAIN ANALYZE` pre/post-launch), not a restatement of "no SLO defined". Preserved positive evidence: efficient global-leaderboard index pattern, fully `worker_id`-scoped rating-transaction fan-out with worker_id-indexed models, no N+1 pattern, correct rating-create+recompute atomicity via `$transaction`. No new DEPENDENCY_GRAPH edge required (the rating-recompute's `state-attendance` read is already covered by the existing FIND-DEP-001 proposed `edge-quality-reads-attendance` delta from v0.1.1). | FIND-PERF-001, FIND-PERF-002, FIND-PERF-003. | None — status REVIEW, G2 freeze reserved to human. |
| 0.2.0 | 2026-07-20 | **G2 Specification Freeze,** preceded by a documentation-accuracy correction: the Proposed Knowledge Deltas' `edge-quality-reads-attendance` delta (recorded as REQUIRED at v0.1.1) and the Ownership-and-Boundaries `state-attendance` read note were both stale — the edge and the `backend-quality` reader entry were already applied to `DEPENDENCY_GRAPH.yaml` by an earlier repository-synchronization pass, not previously reflected back into this document; corrected to state the delta is already applied (`DEPENDENCY_GRAPH.yaml:211-217,503`), not merely proposed. No requirement/rule/decision content changed by this correction. Frozen at G2 by the commissioning human (standing session authorization), reusing the existing G4 evidence without reopening any of the five dimensions — all were `PASS_WITH_ACTIONS` with zero Critical/High across v0.1.0-0.1.2. Open decisions `OQ-01..09` and owner assignment (`OQ-06`/`SYNC-001`) are implementation/release prerequisites reviewed by G8, not freeze blockers; `OQ-03`/`OQ-09` (Medium, cross-tenant) are routed to a Risk Assessment for human acceptance, matching the established precedent. Knowledge synchronized in the same pass: `MODULE_REGISTRY.yaml`/`SPECIFICATION_INDEX.yaml` (→ `SPEC-QUAL-001@0.2.0 (FROZEN)`), `MODULE_MEMORY.yaml` (`ART-MEM-backend-quality` produced), `SYNC_STATE.yaml`, and the Specification Issues Register. | G2 freeze — no new findings; documentation-accuracy correction only | Commissioning human (2026-07-20, G2) |
| 0.2.0 (forward-note, recorded not versioned) | 2026-07-22 | **Forward-note per `ADR-026`** (Accepted, corrected same session, `claude/epic-5-verification-next-u5tet9`) — the headline open decision `OQ-01`/`MIG-GAP-01`/`TRULE-001` is now resolved: the shipped 1–5 `Rating.score` model is **rescaled to 0–100**, matching `CONFIRMED_REQUIREMENTS_REGISTER.md` §15/`TRULE-001` exactly (implementation of already-confirmed authority, not an override of it — an earlier, briefly-committed version of `ADR-026` had wrongly recorded the opposite outcome as a human-authorized override; corrected in place before merge, see `ADR-026`'s own Status section). `RULE-006`'s `score` bound moves from int 1..5 to int 0..100 (`quality/service.ts`, `quality/types.ts`); the `Rating_score_range` DB CHECK moves from `[1,5]` to `[0,100]`; existing rows are migrated ×20 by a real SQL migration (`prisma/migrations/20260722180000_rescale_rating_score_to_0_100`); `WorkerOverallRating.average_score`'s DB-trigger-maintained `AVG(Rating.score)` requires no trigger-function change since it hardcodes no 1–5 assumption. No requirement/rule/migration-gap id is renumbered by this note; `OQ-01`'s disposition and `MIG-GAP-01`'s classification are corrected in place at the referencing rows (RULE-006, TRULE-001, MIG-GAP-01, OQ-01 below) rather than left showing "1–5 retained" or "OPEN". No version bump — nonsemantic forward-note (`LOOP_CONTROL.md` §7 exemption), mirroring the `SPEC-ATT-001`/`ADR-022` forward-note precedent. | None — forward-note only, records a decision + its already-landed implementation. | — (nonsemantic annotation; no approver action required; G2 freeze status unaffected). |
| 0.2.0 (forward-note, recorded not versioned) | 2026-08-02 | **Forward-note per `ADR-035`/`SIR-QUAL-007`** (RESOLVED `GD-11`, 2026-07-28; implemented `claude/quality-leaderboard-pagination`, PR #306, commit `8baad9e`) — the leaderboard's SLO/pagination half of `OQ-07` is now implemented: `getLeaderboard(hotelId, page, perPage)` (`service.ts:263-296`) is paginated (default 25, max 100 per page, matching `ADR-035` exactly), replacing the prior unpaginated `take 50`; response envelope gains a top-level `pagination` object (`page,per_page,total,total_pages,has_next,has_prev`). REQ-016/017/018, RULE-001, RULE-008, the Interfaces table rows, the Performance-budgets narrative, FIND-PERF-003, and OQ-07's lead sentence are corrected in place to describe paginated (not unpaginated/"top 50") behavior and current `service.ts` line numbers; OQ-07 itself remains OPEN for its distinct, unresolved compound-`HotelWorker(hotel_id,status)`-index measurement item only. No requirement/rule id is renumbered by this note; implementation of an already-confirmed authority (`ADR-035`), not a new decision — no version bump, nonsemantic forward-note (`LOOP_CONTROL.md` §7 exemption), mirroring the `ADR-026` forward-note precedent directly above. | None — forward-note only, records already-authorized `ADR-035` + its now-landed implementation. | — (nonsemantic annotation; no approver action required; G2 freeze status unaffected). |
| 0.2.0 (forward-note, recorded not versioned) | 2026-08-22 | **Forward-note per `ADR-069`** (Accepted 2026-08-18) — the rework loop, its photo evidence, and the 20-minute auto-escalation moved from `[TARGET STATE]` to built (2026-08-18..20). Recorded in the Status Addendum (2026-08-22) above rather than by rewriting the frozen `[TARGET STATE]` text, per the append-only correction convention. No requirement, rule, open-decision, or migration-gap id renumbered or restated. | — (documentation-accuracy correction; no findings) | — (recorded, not a versioned amendment; G2 freeze is reserved human authority) |
| 0.2.0 (forward-note, recorded not versioned) | 2026-08-22 | **Forward-note per `ADR-067`** (Accepted 2026-08-14) — a Worker may view their own hotel group's leaderboard, non-contact fields only; `GET /quality/leaderboard/by-hotel/:hotel_id` shipped. Amends `ADR-030` §3 row `C-28` (WORKER cell), not this specification. Recorded for traceability. | — (documentation-accuracy correction; no findings) | — (recorded, not a versioned amendment) |
