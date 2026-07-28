# Governance Decisions Required — Product-Owner Decision Backlog

**Date:** 2026-07-23 **Baseline:** `main` @ `a160a92` (post PR #194/#195) **Framework:** `.claude/` 1.5.0
**Producer:** Repository Synchronization + backlog-collapse pass (read-only; no code, no ADR, no implementation).

## What this document is

Every remaining **governance blocker** — an open decision reserved for the human product owner (or
architect / tax advisor) under the Engineering Constitution — collapsed into one entry per *unique
decision*. Duplicate findings that resolve through a single decision are merged (e.g. the notification
enum, dispatch, failure-handling, and email-flow findings are one decision, not five).

**Sources (verified against current repository state, not summaries):**
`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` (264 open/blocked rows read row-by-row),
`docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md`, `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md`,
the ADR corpus (`docs/14-governance/architecture-decisions/`), module specs (`docs/03-modules/*`),
`.claude/knowledge/DEPENDENCY_GRAPH.yaml`, and `backend/src` / `frontend` / `mobile` code where a claim
needed confirmation.

**Deliberately excluded** (per task scope): already-implemented or superseded work (Epics 1–8, ADR-011..028
resolutions); documentation-only corrections (e.g. `SIR-HR-018/019`, `SIR-ANLY-005`, `SIR-GEO-008`, the
`FEATURE_*` factual-mismatch rows); knowledge-graph / registry-sync rows; owner assignment (`SYNC-001` /
`SIR-GLOB-001` and every `-owner-token` row); and revision rebinding. These are engineering/hygiene tasks,
not product decisions.

**Note on recommendations:** each recommendation is grounded in existing repository evidence (a CONFIRMED
requirement, an existing ADR pattern, or the lowest-risk reversible path). It is a *suggestion to inform your
decision*, not a decision — no requirement or architecture is invented here (Constitution §12, §6).

**Impact estimates** are order-of-magnitude (`backend/src` module count, Prisma migrations, web pages,
mobile screens) and assume the decision is made first — the decision itself is not a PR.

---

## Decision index (ROI-ranked — most engineering unlocked per decision, first)

| # | Decision | Priority | MVP? | Unlocks (est. PRs) |
|---|---|---|---|---|
| GD-01 | Notification dispatch & delivery model | **P0** | MVP | 4–6 | **✅ IMPLEMENTED 2026-07-24 → `ADR-029` decided 2026-07-23 (Option B: Transactional Outbox + Worker runtime); built and merged as Epic 7, PRs 7.1–7.8** |
| GD-02 | Manager write-permission authority | **P0** | MVP | 2–3 | **✅ DECIDED 2026-07-25 → `ADR-030` (capability-based model: hotel/group writes Admin-only; scoped `users:write`; manager/RM employee authority action-only, never field-level). PR-1 through PR-8 (security hardening, matrix flip, `REGIONAL_MANAGER` enum, capability-named gates, documentation/register sync) all merged 2026-07-25/26. `ADR-030` status: Accepted (ratified `c951cfb`).** |
| GD-03 | 5-role model & Regional-Manager authority | **P0** | MVP | 5–8 | **✅ PERMISSION SET DECIDED 2026-07-25 → `ADR-030` D-5 (`REGIONAL_MANAGER` token, operational authority at `hotel_group` scope, no master-data capability). Org-chart reporting model (`OD-EMP-12`, `OQ-AUTH-08`) remains open — this decision resolves the permission set only. Code migration (enum + scope-claim issuance) implemented via PR-2 through PR-5 (merged).** |
| GD-04 | Quality rating derivation, warning tiers & photo policy | **P1** | MVP | 5–7 | **✅ DECIDED 2026-07-27 → Split, per this row's own recommendation: (1) ship the single-writer + delete-behavior correctness fix now (app-owned writer replaces the DB-trigger/app dual-write divergence, `SIR-QUAL-005`); (2) recency-weighting, warning tiers, and photo-retention/retrieval-authorization are deferred as their own explicit product sub-decision (not decided by this session) — these are genuine new business rules the CRR does not fully specify (Constitution §6: do not assume). See [`MILESTONE_MVP_COMPLETION_DECISIONS.md`](MILESTONE_MVP_COMPLETION_DECISIONS.md) for the execution plan.** |
| GD-05 | Per-hotel "pause new jobs" toggle | **P1** | MVP | 2–3 | **✅ DECIDED 2026-07-27 → Option (a): boolean `Hotel.accepting_jobs`, enforced at work-request creation. Matches the confirmed CRR text and the lowest-risk reversible build; scheduling windows (option b) explicitly not adopted as unrequested scope. See [`MILESTONE_MVP_COMPLETION_DECISIONS.md`](MILESTONE_MVP_COMPLETION_DECISIONS.md) for the execution plan.** |
| GD-06 | Worker-facing analytics scope & metric definitions | **P1** | MVP | 3–5 | **✅ DECIDED 2026-07-27 → Option (a): a worker-scoped analytics endpoint (own stats only), resolving the silent 403. Warning-count and sick/vacation-count metrics remain deferred until `GD-04`'s tiers and `GD-18`'s Calendar land — this decision covers only the currently-derivable metrics (own completed jobs, own rating, own attendance-to-date). See [`MILESTONE_MVP_COMPLETION_DECISIONS.md`](MILESTONE_MVP_COMPLETION_DECISIONS.md) for the execution plan.** |
| GD-07 | Session/token revocation & auth rate-limiting | **P1** | Prod | 3–5 | **✅ DECIDED 2026-07-26 → `ADR-031` (Option (a): request-time permission derivation, `token_generation` revocation counter, Platform Worker session/reset-token sweep, Nginx-edge rate limiting per `TREQ-AUTH-008`). PR-0 through PR-8 (edge rate limiting, schema/claim, derivation+revocation cutover, write-path bumps, claim removal, client forced-re-auth, sweep job, flag retirement + `User.permissions` column drop, documentation/register/knowledge-graph sync) all merged 2026-07-26/27. `ADR-031` status: Accepted (ratified 2026-07-26). Rate-limiting resolved at the Nginx/Cloudflare edge, not in `backend/src`, per the Confirmed `TREQ-AUTH-008`/`TRULE-AUTH-002` requirement `ADR-031` consumes rather than amends. `FIND-004`/`SIR-AUTH-019` (admin-account-modification guard) was already resolved separately via `ADR-030` PR-1 and is not re-resolved here. `SIR-AUTH-017` (password-reset timing side-channel) remains explicitly OPEN — out of `ADR-031`'s scope (§9 Non-goals/§10 OI-1).** |
| GD-08 | MFA design & data model | **P2** | Prod | 3–5 | **✅ DECIDED 2026-07-28 → `ADR-038`** (Option (c): MFA explicitly deferred to a post-MVP hardening milestone — a deliberate scheduling decision, not a silent gap; no mechanism selected). Resolves `OQ-AUTH-01` (MFA portion, `SIR-AUTH-005`) and `OQ-AUTH-02` (`SIR-AUTH-006`). |
| GD-09 | GDPR retention-tier assignment & Retention module | **P1** | Prod | 6–10 | **✅ DECIDED (mapping half) 2026-07-28 → `ADR-033` (Option (c): every previously-unassigned record type provisionally mapped to one of CRR §25's three existing tiers now — `Notification`/`User`/`Session`/consent records/chatbot metadata → Tier 2; `AuditLog` excluded, retained indefinitely; HR contract docs/work-permit documents → Tier 3 — disclosed as provisional, tax-advisor sign-off, `OD-RETENTION-01`, tracked separately as a non-blocking follow-up, not a gate). Unlocks `OQ-NOTIF-02`, `OQ-AUTH-11`, `OD-HR-11`, `OD-DOC-001`, `OD-CHAT-019`, `OD-CONSENT-003`. `backend-retention`'s own build remains gated on its other open items (`OD-RETENTION-05/10/11/14/15`), none of which are tier-mapping questions.** |
| GD-10 | Platform concurrency / optimistic-locking pattern | **P2** | Prod | 3–4 | **✅ DECIDED 2026-07-28 → `ADR-036`** (optimistic concurrency adopted as the platform standard; attendance's `checkIn`/`update` race MUST be fixed, not accepted as residual risk; concrete mechanism explicitly deferred to implementation). Resolves `SIR-ATT-013`/`OQ-12`. **Verification found this row's own "Merges findings" line stale on two of three items: `OD-CRM-13`/`SIR-CRM-013` was already resolved 2026-07-25 via `ADR-030`; `OQ-QUAL-04`/`SIR-QUAL-005` was already resolved 2026-07-27 via `GD-04`+PR #237/#238. Neither reopened by `ADR-036`.** |
| GD-11 | Performance SLO & workload baseline | **P2** | Prod | 0 (unblocks G8) | **✅ DECIDED 2026-07-28 → `ADR-035`** (Option (a): platform-wide baseline — ~100 hotels, ~5,000 workers, ~300 concurrent users; p95 targets 150ms/400ms/800ms by query class; leaderboard pagination now a MUST; cross-module fan-out capped at 15 parallel queries, feeding `ADR-034`'s escalation trigger). Resolves `SIR-JOBD-004`, `SIR-ATT-009`, `SIR-QUAL-007`, `SIR-ANLY-012`, `SIR-EMP-014`, `SIR-GEO-006`, `SIR-DOC-019(a)`. **`SIR-CRM-013` was found mislabeled as a GD-11 item in this row's own "Merges findings" line below — it is actually a `GD-10` (optimistic-locking) item and was already separately resolved via `ADR-030`; not touched by this decision.** |
| GD-12 | Platform event-bus / inter-module transport | **P2** | Post | 0 (unblocks builds) | **✅ DECIDED 2026-07-28 → `ADR-032` (Option (a): direct in-process calls for synchronous cross-module effects; the existing `ADR-029` Outbox is the sole approved async/durable mechanism; no generic event bus/dispatcher exists or is introduced; any future pub/sub need requires a new ADR). Unblocks the transport-convention half of `OD-HR-04`, `OD-EMP-09`, `OD-CAL-06/08`, `OD-CONSENT-005`, `OD-CRM-12`, `OD-DOC-009`, `OD-CHAT-023` — each spec's own event/interface rows still require per-spec reclassification at that spec's next revision.** |
| GD-13 | Cross-module state-read boundary ADR | **P3** | Post | 2–4 | **✅ DECIDED 2026-07-28 → `ADR-034` (Option (c): direct read-only cross-module Prisma reads ratified as the platform standard for aggregator/reporting modules, subject to a three-point allow-list; a future read-model interface remains a named, unmet escalation trigger tied to `GD-11`'s SLO baseline). Resolves `OQ-ANALYTICS-11`/`SIR-ANLY-013`/`SIR-GLOB-010`. No code change; all existing `reads-state` edges already satisfy the criterion.** |
| GD-14 | Geofencing / location model (Geo + attendance) | **P2** | Post | 6–9 | **✅ DECIDED 2026-07-27 → Option (a): hotel coordinates as columns on `Hotel` (`state-hotel`, `backend-crm`-owned); `backend-geo` owns worker-coordinate columns and the 6-month hard-delete retention sweep (`OD-GEO-001/002`). Fail-closed on missing hotel coordinates or a distance-check service failure (`OD-GEO-003`). Hotel coordinates are admin-only manual entry, same `HotelWriteGate` MASTER-data surface as every other `Hotel` field — no geocoding-from-address service (`OD-GEO-004`). Admin/manager may view only the computed distance/pass-fail result, never a worker's raw stored coordinates (`OD-GEO-005`). Every geofence pass/fail result is audit-logged via the existing `BaseService.logAudit()` mechanism (`OD-GEO-007`). GPS-spoofing countermeasures (`OD-GEO-009`) are explicitly NOT included in this slice — disclosed and accepted as a known MVP-scope risk, not silently omitted. `OD-GEO-006` (performance budgets) remains OPEN, non-blocking (G8 release prerequisite, same precedent as every other frozen spec's performance-budget gaps). `OD-GEO-008` is a citation correction, not a decision item. Unlocks `SPEC-GEO-001` G2 freeze and geofenced attendance Start/Close gating.**|
| GD-15 | HR & Employee-Management module build scope | **P2** | Post | 10–14 | **✅ DECIDED 2026-07-28 → `ADR-039`–`ADR-048`** (10 sub-decisions, resolved one at a time). A standing architecture blocker (`OD-HR-01a`/`OD-HR-01b`, HR-vs-Onboarding boundary) was found already resolved by `ADR-012` (2026-07-12) — a documentation-synchronization gap, corrected during this audit. `OD-EMP-16` was separately found already resolved by `GD-11`/`ADR-035` — its own spec row corrected. `OD-HR-02b` and `GD-03`'s org-chart half remain genuinely open, not resolved by `GD-15`. |
| GD-16 | Documents module — RBAC & storage design | **P2** | Post | 6–9 | **✅ DECIDED 2026-07-27 → Option (a): self-upload + manager-upload only (the two confirmed actors), hotel-scoped read via existing `checkHotelAccess()`, presigned-URL retrieval, SSE-at-rest, malware-scan hook. Broader RBAC taxonomy (option b) explicitly not adopted as unrequested scope (Constitution §6). Unlocks `SPEC-DOCUMENTS-001` G2 freeze, HR's contract-scan upload, and onboarding document collection.** |
| GD-17 | Consent module — lifecycle & fail-safety | **P3** | Post | 5–7 | **✅ DECIDED 2026-07-28 → `ADR-037`** (`OD-CONSENT-002` Option (b): chatbot engagement requires consent, decline routes to manual onboarding path, does not block; `OD-CONSENT-006` resolved fail-closed; five smaller lifecycle/RBAC items also resolved in the same pass). Resolves `OD-CONSENT-001/002/004/006/007/009/011`. Directly informs Onboarding's `OPQ-3` and Chatbot's `OD-CHAT-008` (consent portion; transcript-persistence portion remains open). |
| GD-18 | Calendar module scope (M2) | **P3** | Post | 4–6 | **✅ DECIDED 2026-07-28 → `ADR-049`–`ADR-052`** (4 sub-decisions). `ADR-051` was informed by real-world weekly-planner evidence supplied mid-decision, surfacing two likely-missing requirements (arrivals, staffing-demand target) flagged for future Requirements Intake, not resolved here. |
| GD-19 | Chatbot module scope & LLM safety | **P3** | Post | 8–12 | **⏸ DEFERRED — POST-MVP, 2026-07-28.** Sub-decision 1 (`OD-CHAT-002`, orchestration-layer architecture) Decided → `ADR-053` (retained, not weakened). Remainder of `GD-19` explicitly deferred by commissioning-human decision, not resolved. Full resumption checkpoint: [`GD-19_CHATBOT_CHECKPOINT.md`](GD-19_CHATBOT_CHECKPOINT.md). Confirmed isolated from `GD-20`/`GD-21`/`GD-22` — no remaining MVP decision depends on it. |
| GD-20 | Job-Dispatch two-tier calendar+broadcast pivot | **P3** | Post | 12+ | **✅ DECIDED 2026-07-28 → `ADR-054`–`ADR-058`** (5 sub-decisions, resolved one at a time). Sub-decision 1 (Overall Job Dispatch Model) → `ADR-054` (two-tier Calendar+Broadcast ratified as permanent target architecture; marketplace is the current, not legacy, implementation; timing deferred to Sub-decision 5). Sub-decision 2 (Broadcast Lifecycle) → `ADR-055` (broadcast remains exclusively manager-initiated; assignment cancellation never implicitly creates/reopens a JobRequest; any re-broadcast is a brand-new JobRequest with its own lifecycle). Sub-decision 3 (Assignment Model) → `ADR-056` (direct WorkerAssignment creation from either assignment path, day-level exclusivity, bounded skill enum, no formal job-status machine, ratified as target architecture only; implementation/migration/retirement remain Sub-decision 5's exclusive responsibility). Sub-decision 4 (Background Execution) → `ADR-057` (auto-close runs on the Platform Worker/outbox per ADR-029; slot arbitration standardizes on optimistic concurrency — no BullMQ, no Redis mutex; evaluated against ADR-035's workload baseline, which did not justify introducing BullMQ or Redis). Sub-decision 5 (Migration Strategy) → `ADR-058` (existing Phase 1/Phase 2 forward-refactor plan ratified unmodified; ADR-054–057 introduce no new migration dependencies; implementation becomes architecturally eligible once GD-03 resolves, not the sole gate — actual scheduling remains implementation planning's responsibility). Sub-decision 6 (Analytics/Attendance follow-up) closed as MOOT — OQ-05/OQ-06 [attendance] and OQ-ANALYTICS-04 are mechanically resolved by ADR-054/056 (direct assignment creation, no application intermediary) with no genuine ambiguity remaining; these are implementation follow-ups, not GD-20 decisions. |
| GD-21 | Attendance operational automation | **P3** | Post | 2–4 | **✅ DECIDED 2026-07-28 → `ADR-059`.** Sole genuine sub-decision (`OQ-ATT-07`): automated reminders + automatic ABSENT/NO_SHOW marking ratified as permanent target architecture, implementation timing deferred (destination-vs-journey split, per `ADR-054`/`ADR-053`/`ADR-038`) — mechanism is the Platform Worker (`ADR-029`/`ADR-057`), no code authorized. Two consistency corrections applied directly, not treated as governance forks: `OQ-01` (checker `getById` aligned to `list`/`update`'s guard) and `OQ-11` (`BaseService.logAudit` extended platform-wide with optional `old_values`/`new_values`, attendance wired to use them). |
| GD-22 | Hotel-Group billing model | **P3** | Post | 3–5 | **✅ RESOLVED BY DISPOSITION 2026-07-28 — no new architecture introduced.** `ADR-023` already settled ownership (`backend-crm` owns `HotelGroup.billing_info`); no competing ownership model was ever proposed, so there was no genuine architecture fork to decide. CRR gives zero billing mechanics anywhere, so none were invented (Constitution §12). `billing_info` remains an opaque, unvalidated-beyond-length placeholder, schema/ownership unchanged. Any future billing implementation requires its own new decision grounded in a real requirement. |
| GD-23 | Platform ADR ratification (Constitution §20) | **P2** | Prod | 0 (governance) | **✅ DECIDED 2026-07-28 → Option (a): ratified as-is.** `ADR-019`/`ADR-020` flipped Proposed → Accepted. Verification found ADR-001..009 already ratified 2026-07-15 (this row's own "current repository state" line was stale on that point) — `SIR-GLOB-003`'s last remaining open element was already closed and is now corrected in the register. |

---

## GD-01 — Notification dispatch & delivery model

> **✅ RESOLVED 2026-07-23 by the project owner → `ADR-029` (Transactional Outbox + dedicated Worker
> runtime), Option (b).** Producers persist domain change + in-app `Notification` + `OutboxEvent` in one
> transaction; a dedicated Worker runtime (separate process over the same monolith, no external queue)
> polls the outbox (5s, configurable), delivers via transport handlers (`OutboxTransport`
> EMAIL/PUSH/WEBHOOK/SMS; EMAIL+PUSH first), runs the `OutboxStatus` PENDING→PROCESSING→DELIVERED/
> FAILED/DEAD_LETTER lifecycle with configurable exponential backoff (1m/5m/15m/1h), guarantees
> at-least-once + idempotent (`event_id`) delivery, hosts scheduled reminder/escalation jobs, and is
> the canonical producer for the future Event Bus (GD-12). Resolves `OQ-NOTIF-01` (dispatch half),
> `OQ-NOTIF-04/06/07/08/09` and the delivery half of `OQ-AUTH-01`. Build sequenced as Epic 7 PRs
> 7.1–7.7 in `IMPLEMENTATION_EXECUTION_PLAN.md` (mobile push registration split out as its own PR, 7.7,
> per reviewer feedback). Remaining NOTIF opens: `OQ-NOTIF-02` (retention/GD-09,
> now also covering `OutboxEvent`), `OQ-NOTIF-03`, `OQ-NOTIF-05`.
>
> **BUILT 2026-07-24:** all 8 PRs (7.1–7.8; a ninth, multi-app APNs topic support, was added as 7.8
> after 7.7 was already planned — see `IMPLEMENTATION_EXECUTION_PLAN.md`) are merged into `main`
> (`4079a0f`). `sendEmail`/`sendPushNotification` are superseded by the Worker's transport handlers,
> not left as dead stubs; backend suite 523/523 green, both mobile apps 37/37. This decision entry
> now records a shipped capability, not an open blocker — see `docs/15-audits/REPOSITORY_AUDIT_2026-07-24.md`.

- **Why a decision is required:** `NotificationChannel` values were fixed by ADR-027, but *how* email/push
  are actually delivered, how send-failures are handled, and which runtime hosts scheduled reminders were
  explicitly left open. Every path forward changes cross-module contracts, so it is reserved for the human.
- **Current repository state:** `backend/src/modules/notifications/service.ts` — in-app CRUD works;
  `sendEmail()` and `sendPush()` both `throw NotImplementedError`. Sends are fire-and-forget
  (`.catch(() => {})`, swallows all failures). No scheduled-job runtime exists. No APNs/FCM/SMTP client in
  the repo.
- **Merges findings:** `OQ-NOTIF-01` (dispatch half), `OQ-NOTIF-04` (failure control), `OQ-NOTIF-05`
  (cross-module send-authz), `OQ-NOTIF-06` (push milestone), `OQ-NOTIF-07` (`sendEmail` fate),
  `OQ-NOTIF-08` (scheduled-job host), `OQ-NOTIF-09` (fan-out latency), `MIG-GAP-NOTIF-01..12`; and the
  delivery half of `OQ-AUTH-01` (email-mediated password reset, failed-login-notify-manager).
- **Options:** (a) Synchronous in-request email/push via a provider SDK; (b) durable outbox table + a
  scheduled worker draining it (also hosts reminders/escalations); (c) external queue (SQS/Redis).
- **Recommended:** **(b) outbox + scheduled worker.** It is the only option that simultaneously fixes
  silent-failure swallowing, hosts the confirmed reminder/escalation jobs (`OQ-NOTIF-08`), and keeps the
  `work-requests` roster fan-out non-blocking (`OQ-NOTIF-09`) — without introducing external infra the repo
  doesn't yet run. Reversible: transport is swappable behind the outbox.
- **Artifacts blocked:** `backend-notifications` completion; auth email-reset & failed-login-notify
  (`TREQ-AUTH-005/007`); rework 20-min escalation; contract-expiry reminders (HR); mobile push.
- **Impact:** backend 1 module + a scheduled-job host · 1–2 migrations (outbox + delivery-status) ·
  frontend minimal · mobile push-token registration + permission flow (both apps). **~4–6 PRs.**
- **Priority:** **P0 (highest leverage — unblocks the widest surface).** **Owner:** Product Owner + Architect.

## GD-02 — Manager write-permission authority

> **✅ DECIDED 2026-07-25 by the project owner → `ADR-030` (capability-based permission model), reversing
> this row's own Option (a) recommendation for hotels.** Hotel and hotel-group writes narrow to
> `requireRole('admin')` — `MANAGER` is **not** granted `hotels:write` (CRR:429/§11:180 authority, plus the
> owner's explicit "manager may not add, edit or delete a hotel" directive). `MANAGER`/`REGIONAL_MANAGER` do
> gain scoped `users:write` (Option (a) as recommended, for users only), with role assignment, account
> creation, and deletion excluded, and a mandatory DTO/route split (`ADR-030` D-4a) so the grant cannot
> implicitly include role editing. Manager/RM authority over **employee records** (a separate question
> raised during ratification, not originally scoped by this row) is decided as action-only, never
> field-level — see `ADR-030` D-4b/D-4c. `PR-1` (HR/calendar authorization hardening, phantom-role removal,
> elevation-guard fix — all correct regardless of this decision) merged 2026-07-25. `PR-2`–`PR-8` (the
> capability-matrix flip itself, capability-named gates, invariant tests, documentation/register sync) are
> all merged as of 2026-07-26. `ADR-030`'s status: Accepted (ratified `c951cfb`, Constitution §20).
>
> Resolves `OQ-USERS-09` (`users:delete` — deleted as a token rather than wired up, since the route is
> role-gated only) in addition to the findings below.

- **Why a decision is required:** A direct repository contradiction: route role-gates admit `manager`, but
  the permission map denies the corresponding `*:write`, so writes are net Admin-only. Resolving it either
  way changes the effective authorization set — a product call, not a bug to silently "fix."
- **Current repository state:** CRM `POST/PUT /crm/hotels` gate on `requireRole(['admin','manager'])` **and**
  `requirePermission('hotels:write')`, but `MANAGER` lacks `hotels:write` → Admin-only. Identical shape in
  Users (`users:write`). `GET` list role-gating vs. broader `*:read` grants mismatch similarly.
- **Merges findings:** `OD-CRM-02` (`SIR-CRM-002`), `OQ-USERS-02` (`SIR-USERS-002`), `OD-CRM-07`
  (`SIR-CRM-007`), `OQ-USERS-09` (`users:delete` unchecked).
- **Options:** (a) Grant managers `hotels:write`/`users:write` (scoped to their hotels via the Epic-5 scope
  model); (b) keep Admin-only and tighten the role-gate to drop `manager`.
- **Recommended:** **(a), scoped.** CRR §11 treats hotel management as a manager capability, and Epic 5
  already ships the scope primitive (`isHotelInScope`) to bound it. Removes a contradiction rather than
  freezing an accidental one.
- **Artifacts blocked:** CRM hotel CRUD authorization finalization; Users write authorization; the web
  CRM-admin UI's permission assumptions.
- **Impact:** backend 2 modules (permission-map edits + scope guards) · 0 migrations · frontend gating on
  CRM admin pages · mobile none. **~2–3 PRs.**
- **Priority:** **P0 (small, unblocks CRM/Users write paths).** **Owner:** Product Owner.

## GD-03 — 5-role model & Regional-Manager authority

> **✅ PERMISSION SET DECIDED 2026-07-25 by the project owner → `ADR-030` D-5 (`OQ-030-B`), Option (a) as
> recommended.** `REGIONAL_MANAGER` is added to `UserRole`, holding `MANAGER`'s capability set evaluated at
> `hotel_group` scope (all Hotel-Manager operational actions across every hotel in the group — employee
> operations, scheduling, attendance, onboarding approvals, quality, notifications, analytics) plus
> org-chart read. It holds **no master-data capability**: it may not create, delete, rename, re-parent, or
> otherwise modify hotel groups or hotel master data, and may not appoint managers — the explicit
> operational-authority/master-data-authority split CRR §11:180 and PDD §5.4 both require. This is
> behaviour-preserving, not a new grant: `backend/src/modules/auth/service.ts`'s `resolveScope()` already
> resolves an RM to `hotel_group` scope with documented "broader scope wins" precedence.
>
> **This row's org-chart/reporting-model half is NOT resolved by this decision** — `OD-EMP-12` (the
> underlying reporting-relationship model) and `OQ-AUTH-08`'s data-model half remain open; only the RM
> *permission* (who may view an org chart) is settled. `OD-CAL-07` (RM scheduling scope) is settled in
> substance (RM inherits the Hotel-Manager scheduling capability at group scope) but not built.
>
> Code migration (enum addition, JWT scope-claim issuance, promoting existing RM users from `MANAGER`) is
> implemented via `ADR-030` PR-2 through PR-5 (merged). `SIR-USERS-012/020` and `SIR-AUTH-013` updated in the
> Specification Issues Register to reflect the decision.

- **Why a decision is required:** CRR §1 / PDD §4.1 confirm **five** roles including a Regional Manager, but
  `UserRole` has only four tokens (`WORKER/CHECKER/MANAGER/ADMIN` — verified in `schema.prisma:22`). Epic 5
  shipped `HotelGroup.regional_manager_user_id` and the JWT `scope` claim, but **no distinct RM role token or
  permission set exists**. The token identifier, permission matrix, and org-chart model are all reserved
  product/architecture calls.
- **Current repository state:** RM is representable only as a `User` FK on `HotelGroup`; no `REGIONAL_MANAGER`
  enum value, no RM permission rows, no org-chart/reporting model, no org-chart endpoint.
- **Merges findings:** `OQ-USERS-01` (5-role), `OQ-AUTH-13` (RM code token), `OQ-AUTH-08` (org-chart
  visibility), `OD-CRM-05` (scope+RM for `REQ-CRM-011`), `OD-EMP-12` (org-chart model), `OD-CAL-07` (RM
  scheduling scope), `SIR-USERS-012/020` (consolidation + migration).
- **Options:** (a) Add `REGIONAL_MANAGER` to `UserRole` with a `hotel_group`-scoped permission set on top of
  the existing scope claim; (b) model RM purely as `MANAGER` + a `hotel_group` scope (no new token).
- **Recommended:** **(a).** The scope claim already distinguishes `hotel_group` type (Epic 5/ADR-023), but a
  distinct token is needed for the confirmed RM-only capabilities (org-chart visibility, group-wide
  scheduling) that `MANAGER` must not get. Additive enum + permission rows; migration is low-risk.
- **Artifacts blocked:** `REQ-CRM-011` (RM authorization), `REQ-EMP-013` / `REQ-USERS-021` (org-chart),
  RM-scoped calendar scheduling, RM-scoped analytics.
- **Impact:** backend auth/users/crm/emp · 1 migration (enum + org-chart FK) · frontend org-chart + RM
  admin views · mobile minor (role display). **~5–8 PRs.**
- **Priority:** **P0.** **Owner:** Product Owner + Architect.

## GD-04 — Quality rating derivation, warning tiers & photo policy (M3)

**✅ DECIDED 2026-07-27 (split adopted, per this section's own recommendation).** See the summary
row above and [`MILESTONE_MVP_COMPLETION_DECISIONS.md`](MILESTONE_MVP_COMPLETION_DECISIONS.md) for
the execution plan. Detail below is retained as the decision record.

- **Why a decision is required:** The 0–100 scale (ADR-026) is shipped, but redefining the derived
  `WorkerOverallRating.average_score` under that scale is **BREAKING** for four consumers, and the target
  warning/tier model, recency-weighting, and photo-retention/retrieval-authorization are undecided.
- **Current repository state:** `Rating.score`/`Verification.score` are 0–100. `WorkerOverallRating.average_score`
  is a plain average read by `work-applications`, `analytics`, the leaderboard, and `mobile-worker`. A DB
  trigger and an app upsert both write the aggregate (can diverge). No warning tiers, no recency-weighting,
  no photo-retention/retrieval-auth policy.
- **Merges findings:** `OQ-02` (aggregate redefinition, BREAKING — `SIR-QUAL-002`), `OQ-04` (dual-write
  divergence — `SIR-QUAL-005`), `OQ-05` (delete-behavior asymmetry), `OQ-07` (SLO), `OQ-08` (recency-weight /
  tiers / warnings / photo policy — `SIR-QUAL-008`), `MIG-GAP-QUAL-01..08` (7 remaining).
- **Options:** (a) Recency-weighted aggregate + explicit warning tiers + app-owned single writer + defined
  photo-retention/retrieval-auth; (b) keep the simple average, defer tiers/warnings post-MVP.
- **Recommended:** **Split:** adopt (a)'s single-writer + delete-behavior fix now (correctness), but treat
  recency-weighting/warning-tiers/photo policy as an explicit product sub-decision — those are genuine new
  business rules the CRR does not fully specify (Constitution §6: do not assume).
- **Artifacts blocked:** quality M3; analytics warning-count metric (GD-06); mobile rating display.
- **Impact:** backend quality + 4 consumers · 1–2 migrations (aggregate + warning-tier columns) · frontend
  quality-review UI (not yet built) · mobile rating display update. **~5–7 PRs.**
- **Priority:** **P1.** **Owner:** Product Owner + Architect.

## GD-05 — Per-hotel "pause new jobs" toggle

**✅ DECIDED 2026-07-27 (option (a) adopted).** See the summary row above and
[`MILESTONE_MVP_COMPLETION_DECISIONS.md`](MILESTONE_MVP_COMPLETION_DECISIONS.md) for the execution
plan. Detail below is retained as the decision record.

- **Why a decision is required:** A CRR §11-confirmed feature (`REQ-CRM-008`) is unimplemented, and its
  enforcement is a one-sided cross-module contract that needs the human to ratify the enforcement boundary.
- **Current repository state:** No field, no route. `RULE-CRM-09` says enforcement lives in the
  job/work-request module, but `job-dispatch/MODULE_SPEC.md` carries no reciprocal obligation.
- **Merges findings:** `OD-CRM-04` (`SIR-CRM-004`), `OD-CRM-16` (bilateral enforcement contract —
  `SIR-CRM-016`).
- **Options:** (a) Boolean `Hotel.accepting_jobs` enforced at work-request creation; (b) status enum with
  scheduled pause windows.
- **Recommended:** **(a).** Matches the confirmed CRR text (a simple toggle) and the lowest-risk reversible
  build; scheduling windows are unrequested scope.
- **Artifacts blocked:** `REQ-CRM-008`; work-request creation guard.
- **Impact:** backend crm + work-requests · 1 migration (1 column) · frontend hotel-admin toggle · mobile
  none. **~2–3 PRs.**
- **Priority:** **P1.** **Owner:** Product Owner.

## GD-06 — Worker-facing analytics scope & metric definitions

**✅ DECIDED 2026-07-27 (option (a) adopted, scoped to currently-derivable metrics).** See the
summary row above and
[`MILESTONE_MVP_COMPLETION_DECISIONS.md`](MILESTONE_MVP_COMPLETION_DECISIONS.md) for the execution
plan. Detail below is retained as the decision record.

- **Why a decision is required:** `mobile-worker`'s dashboard calls an admin/manager-only route and silently
  403s for every worker — so whether workers get *any* analytics is an unresolved product decision — and
  several target metrics have no agreed definition against current-state data.
- **Current repository state:** `mobile-worker` calls `GET /analytics/stats` unconditionally; route requires
  `admin`/`manager` → always 403 for workers. "Active workers/day", "warning counts", and "sick/vacation
  counts" have no current-state definition (the last two depend on GD-04 and GD-18).
- **Merges findings:** `OQ-ANALYTICS-02` (worker 403 — `SIR-ANLY-002`), `OQ-ANALYTICS-09` (active-workers
  definition), `OQ-ANALYTICS-08` (warning counts — needs GD-04), `OQ-ANALYTICS-07` (sick/vacation — needs
  GD-18 Calendar), `MIG-GAP-ANALYTICS` (remaining).
- **Options:** (a) Define a worker-scoped analytics endpoint (own stats only); (b) hide analytics from the
  worker app entirely and remove the dead call.
- **Recommended:** **(a) if a worker self-stats view is wanted, else (b).** Either resolves the silent-403;
  the choice is purely product-intent. The dependent metric definitions (warning/sick-vacation) should be
  deferred until GD-04/GD-18 land, to avoid defining metrics against data that doesn't exist yet.
- **Artifacts blocked:** mobile-worker dashboard; analytics target metrics.
- **Impact:** backend analytics · 0 migrations · frontend dashboard tweak · mobile-worker dashboard.
  **~3–5 PRs.**
- **Priority:** **P1.** **Owner:** Product Owner.

## GD-07 — Session/token revocation & auth rate-limiting

- **Why a decision is required:** Deactivating or role-changing a user does **not** revoke their already-issued
  JWT, no auth endpoint has rate-limiting, and a non-admin can modify an existing admin's non-role fields —
  each is a security-architecture posture reserved for the human before production.
- **Current repository state:** `authMiddleware` builds `req.auth` solely from the JWT payload (no
  server-side check). Sessions are never proactively swept. **No rate-limiting exists anywhere** in
  `backend/src` (only an unused `RATE_LIMIT_EXCEEDED` error constant). `updateUser` restricts only *assigning*
  `admin`, not *modifying* an existing admin.
- **Merges findings:** `SIR-USERS-015` (token revocation), `OQ-AUTH-14` (session sweep — `SIR-AUTH-014`),
  security-review `FIND-02` (rate-limiting — `SIR-AUTH-018`), `FIND-004` (admin-account protection —
  `SIR-AUTH-019`), `FIND-01` (password-reset timing — `SIR-AUTH-017`).
- **Options:** (a) Short access-token TTL + a token-version/`token_generation` claim checked per request
  (cheap revocation) + a session sweep job + per-IP/account rate-limit middleware; (b) full server-side
  session store / denylist.
- **Recommended:** **(a).** Token-version invalidation is the standard low-cost fix that composes with the
  existing JWT model; (b) is heavier and reversible-later if needed. Rate-limiting is table-stakes before any
  public deploy.
- **Artifacts blocked:** production release readiness; the account-lifecycle security posture.
- **Impact:** backend auth/users middleware + sweep job · 1 migration (token-version column) · frontend
  handle forced re-auth · mobile handle forced re-auth. **~3–5 PRs.**
- **Priority:** **P1 (production security).** **Owner:** Product Owner + Architect (security).

## GD-08 — MFA design & data model

**✅ DECIDED 2026-07-28, by the commissioning human.**

- **Why a decision was required:** MFA (`TREQ-AUTH-006`) is a CONFIRMED requirement, but *where MFA state
  persists* (secret / enrollment / recovery-code storage) appeared nowhere in the model lists — the data
  model needed to be decided before planning, or the deferral itself needed to be made explicit.
- **Current repository state at decision time:** No MFA-related model, field, or endpoint anywhere in the
  repository.
- **Decided — resolves, per Option (c):** MFA is explicitly deferred to a post-MVP hardening milestone —
  it is not in near-term scope. This is a deliberate scheduling decision, not a silent gap: `TREQ-AUTH-006`
  remains a confirmed requirement, just not scheduled for the current build horizon. No data model or
  mechanism (TOTP vs. OTP) is selected by this decision — that choice is intentionally left open until MFA
  is re-prioritized, at which point it should be revisited fresh rather than defaulted to whichever option
  this decision's own prior analysis leaned toward. Full record: `ADR-038`.
- **Explicitly NOT decided by this record:** the MFA mechanism (TOTP vs. email/SMS OTP vs. any other
  approach) — deferred until MFA re-enters scope.
- **Merges findings:** `OQ-AUTH-01` (MFA portion — `SIR-AUTH-005`), `OQ-AUTH-02` (MFA data model —
  `SIR-AUTH-006`) — both resolved as deferred.
- **Artifacts unblocked:** none functionally (MFA remains unbuilt); the requirement's status is now
  disclosed and traceable rather than an ambiguous open item with no stated intent.
- **Impact:** **0 PRs** now (deferred); the original ~3–5 PR estimate applies whenever MFA is re-prioritized
  and a mechanism is chosen.
- **Priority:** **P2.** Decided by the commissioning human 2026-07-28. **Owner:** Product Owner. Full
  decision record: `ADR-038`.

## GD-09 — GDPR retention-tier assignment & Retention module

**✅ DECIDED (mapping half) 2026-07-28, by the commissioning human.**

- **Why a decision was required:** CRR §25 defines three retention tiers, but **most record types were not yet
  assigned to a tier**, the automatic-deletion Retention module is unbuilt, and the tier mapping carries an
  explicit `[ACTION]` for the client's tax advisor to sign off before lock-in. Retention gates G8 Release
  Readiness across many modules.
- **Current repository state at decision time:** Tiers defined (6mo coords / 5yr general / 6yr payroll-adjacent) in CRR §25,
  but `Notification`, `User`/`Session`/`AuditLog`, HR contract docs, documents, chatbot records, and consent
  records were unassigned. Geo coordinates (`OD-GEO-002`) had already been separately resolved by `GD-14`
  (2026-07-27). No Retention module code; no `backend-retention` id registered.
- **Decided — resolves the mapping question only, per Option (c):** every previously-unassigned record type is
  provisionally assigned to one of CRR §25's three existing tiers now, disclosed as provisional pending
  tax-advisor sign-off (not asserted as legally final): `Notification` → Tier 2; `User`/`Session` → Tier 2;
  `AuditLog` → excluded from all three tiers, retained indefinitely (CRR §30 accountability record); HR
  contract document → Tier 3; uploaded documents → Tier 2 (general) / Tier 3 (work-permit); chatbot
  conversation metadata/spend counters → Tier 2 (transcripts contingent on `OD-CHAT-008`); consent records →
  Tier 2. Full record: `ADR-033`.
- **Explicitly NOT decided by this record:** the tax-advisor sign-off itself (`OD-RETENTION-01`/
  `SIR-RETENTION-002`) — reclassified from "blocks the mapping decision" to "blocks legal certification of an
  already-decided provisional mapping, non-blocking for engineering," but still open and still tracked to
  closure. Also not decided: `backend-retention`'s own remaining open items (`OD-RETENTION-05/10/11/14/15` —
  RBAC scope, cross-module delete authorization, sweep query design, owner assignment, fan-out workload), none
  of which are tier-mapping questions.
- **Merges findings:** `SIR-RETENTION-002` (tax-advisor sign-off, reclassified non-blocking, still open),
  `SIR-RETENTION-006` and the per-module tier rows it aggregated (`OQ-NOTIF-02`, `OQ-AUTH-11`, `OD-HR-11`,
  `OD-DOC-001`, `OD-CHAT-019`, `OD-CONSENT-003` — each now individually RESOLVED provisional at its own
  module; `OD-GEO-002` already resolved separately by `GD-14`, not by this decision).
- **Artifacts unblocked:** `SPEC-NOTIF-001`, `SPEC-AUTH-001` (amended, both FROZEN), `SPEC-HR-001`,
  `SPEC-DOCUMENTS-001` (amended, FROZEN), `SPEC-CHATBOT-001`, `SPEC-CONSENT-001` (each module's own tier row
  resolved provisional). `backend-retention`'s own build remains gated on its other open items, unaffected by
  this decision.
- **Impact:** backend new retention module + per-module `retention_tier`/`delete_after` fields · several
  migrations · frontend none · mobile none. **~6–10 PRs.**
- **Priority:** **P1 (production/compliance blocker).** Decided by the commissioning human 2026-07-28 rather
  than gated indefinitely on the tax advisor's external, uncontrollable timeline. **Owner:** Product Owner →
  client's tax advisor (legal certification only, no longer a mapping blocker). Full decision record: `ADR-033`.

## GD-10 — Platform concurrency / optimistic-locking pattern

**✅ DECIDED 2026-07-28, by the commissioning human.**

- **Why a decision was required:** Multiple modules had unguarded read-then-write races with no agreed
  platform pattern; picking one (and where it applies) is an architecture decision.
- **Current repository state at decision time:** `WorkRequest` has a `version` column. `Hotel.updateHotel`'s
  lost-update risk was already independently resolved 2026-07-25 via `ADR-030` (`REQ-CRM-010`'s own
  re-evaluation trigger fired; no schema change needed — Admin-only, low-churn writer population confirmed
  unchanged). The quality rating aggregate's divergence risk was already independently resolved 2026-07-27
  via `GD-04` + PR #237/#238 (DB trigger dropped; app-level `refreshWorkerOverallRating` is the sole writer).
  Only attendance's `checkIn`/`update` double-submit window remained a genuinely open race.
- **Decided — resolves:** optimistic concurrency is adopted as the **platform-wide standard** for mutable-
  entity read-then-write races, ratifying the pattern `WorkRequest.version` already establishes. Attendance's
  `checkIn`/`update` race (`OQ-ATT-12`/`SIR-ATT-013`) MUST be fixed, not accepted as residual risk — this is a
  routine occurrence for a field-worker mobile app, not a rare edge case. The **concrete mechanism** (a
  `version` column mirroring `WorkRequest`, a transactional row-level lock, or another optimistic-concurrency-
  consistent approach) is **explicitly deferred to implementation** — the implementing engineer verifies which
  mechanism best fits attendance's own write shape and records that choice at implementation time, rather than
  it being mandated at the governance level. Full record: `ADR-036`.
- **Explicitly NOT decided by this record:** the specific mechanism for the attendance fix (deferred to
  implementation, per above).
- **Merges findings — verified, not assumed:** `OQ-ATT-12`/`SIR-ATT-013` (attendance concurrency) — the one
  genuinely open item, resolved by this decision. **`OD-CRM-13`/`SIR-CRM-013` (hotel lost-update) and
  `OQ-QUAL-04`/`SIR-QUAL-005` (aggregate divergence) were found, on verification, to already be resolved by
  other decisions (`ADR-030` and `GD-04`+PR #237/#238 respectively) before this decision was made — this
  row's own "Merges findings" line was stale on both. Neither is reopened or re-decided by `ADR-036`.**
- **Artifacts unblocked:** attendance write-path robustness now has a mandated fix + platform standard;
  no feature was blocked, this is a correctness commitment.
- **Impact:** the attendance fix requires 1 migration (mechanism-dependent) + mobile conflict-retry handling,
  scoped at implementation time. **~1–2 PRs** (narrower than the original ~3–4 estimate, since CRM/quality
  needed no further work).
- **Priority:** **P2.** Decided by the commissioning human 2026-07-28. **Owner:** Architect (with Product
  Owner sign-off) for the platform standard; implementing engineer for the attendance mechanism choice.
  Full decision record: `ADR-036`.

## GD-11 — Performance SLO & workload baseline

**✅ DECIDED 2026-07-28, by the commissioning human.**

- **Why a decision was required:** No module defines a latency/throughput/cardinality SLO; several unpaginated
  hot paths exist. G4 performance reviews recorded these as required-before-implementation, and setting an
  SLO needed confirmed workload assumptions the human had to supply.
- **Current repository state at decision time:** Leaderboard/stats/hotel-summary/dispatch/attendance/HR/emp/geo
  all lacked SLOs; the leaderboard is an unpaginated `take 50`; dashboard stats fan out to 8–11 parallel queries.
- **Decided — resolves, per Option (a):** a platform-wide workload baseline (~100 hotels, ~5,000 workers,
  ~300 concurrent users at peak) and p95 latency targets by query class (simple single-entity reads ≤150ms;
  scoped list/filter queries ≤400ms; cross-module aggregation ≤800ms). Pagination is now a MUST for any
  unbounded list endpoint (leaderboard, audit log, notification history — default page size 25, max 100).
  Cross-module aggregation fan-out is capped at 15 parallel queries per request, directly feeding `ADR-034`'s
  (`GD-13`) named escalation trigger for when a read-model interface becomes the correct call instead of a
  direct cross-module read. Full record: `ADR-035`.
- **Explicitly NOT decided by this record:** per-endpoint conformance to these targets (whether a specific
  query actually meets its p95) is an implementation/G8 verification activity, not settled here. The baseline
  is disclosed as provisional, revisable once real production traffic data exists.
- **Merges findings:** `SIR-JOBD-004`, `SIR-ATT-009`, `SIR-QUAL-007`, `SIR-ANLY-012`, `SIR-EMP-014`,
  `SIR-GEO-006`, `SIR-DOC-019(a)` — all resolved at the baseline level. **`SIR-CRM-013` was found, on
  verification, to be a `GD-10` (optimistic-locking/concurrency) item mislabeled in this row — it concerns
  `Hotel`'s missing version column, not an SLO/workload question, and was already separately resolved via
  `ADR-030`. Not touched by this decision; flagged here rather than silently resolved under the wrong topic.**
- **Artifacts unblocked:** G8 for every module carrying a perf row now has a baseline to verify against;
  the leaderboard pagination fix is now a named, required follow-on task, not merely a disclosed risk.
- **Impact:** backend pagination/index PRs follow the SLO but the decision itself is 0 code. **~0 PRs to
  decide; ~3–5 follow-on.**
- **Priority:** **P2.** Decided by the commissioning human 2026-07-28. **Owner:** Product Owner + Architect.
  Full decision record: `ADR-035`.

## GD-12 — Platform event-bus / inter-module transport

**✅ DECIDED 2026-07-28, by the commissioning human.**

- **Why a decision was required:** No event bus exists; many modules' Interfaces/Events sections are
  "candidate-level only" because the transport (in-process call vs. real event) is undecided platform-wide.
  This blocks freezing and building the event-driven modules.
- **Current repository state at decision time:** Only an in-process `notification-service` singleton pattern
  exists (backed by the `ADR-029` Outbox). HR, Employee-Management, Calendar, Consent, CRM, Documents, Chatbot
  all declare events with no ratified transport. No repository convention distinguishes in-process calls from
  Outbox-backed delivery.
- **Decided — resolves `OD-HR-04`, `OD-EMP-09`, `OD-CAL-06/08`, `OD-CONSENT-005`, `OD-CRM-12`, `OD-DOC-009`,
  `OD-CHAT-023` at the transport-convention level:** **Option (a)**, with an explicit clarification from the
  commissioning human folded into the ratifying record — see `ADR-032`:
  - **Direct, in-process service-to-service calls** are the platform standard for synchronous cross-module
    operations (an effect that must complete atomically with, or immediately after, its trigger). No new
    dispatcher/wrapper abstraction is introduced — a producer calls the consumer's service class directly,
    exactly as `backend-calendar` already does for its same-day auto-cancel.
  - **The existing `ADR-029` Outbox is the sole approved mechanism for asynchronous, durable work** — anything
    that must survive a crash, may be retried, or fans out to an external delivery channel (push/email/SMS/
    webhook).
  - **No generic event bus, message broker, or pub/sub dispatcher exists in this architecture, and none is
    introduced by this decision.** Every cross-module effect the platform needs today falls into one of the
    two categories above.
  - **Explicitly NOT decided by this record:** any future need for pub/sub, fan-out-to-unknown-consumers, or
    distributed messaging. Such a need requires **its own new ADR** — it must not be retrofitted onto either
    mechanism this decision ratifies.
- **Merges findings:** `OD-HR-04` (`SIR-HR-012`), `OD-EMP-09` (`SIR-EMP-006`), `OD-CAL-06/08`,
  `OD-CONSENT-005`, `OD-CRM-12`, `OD-DOC-009`, `OD-CHAT-023`/`SIR-GLOB-016` (in-process-vs-HTTP naming).
- **Artifacts unblocked:** HR, Employee-Management, Calendar, Consent, CRM, Documents, Chatbot event/interface
  contracts (freeze + build) — each spec's own `EVT-*`/`IF-*` rows still require per-spec reclassification into
  "direct call" or "Outbox-backed" at that spec's own next revision; this decision removes the platform-level
  blocker, it does not itself rewrite every row (tracked per-module in `GOVERNANCE_REGISTER.md`).
- **Impact:** decision was 0 code — both mechanisms it ratifies (`ADR-029`'s Outbox; `backend-calendar`'s
  direct call) were already shipped. **0 PRs to decide, as estimated.**
- **Priority:** **P2 (gated several builds).** **Owner:** Architect (with Product Owner sign-off) — ratified
  by the commissioning human 2026-07-28. Full decision record: `ADR-032`.

## GD-13 — Cross-module state-read boundary ADR

**✅ DECIDED 2026-07-28, by the commissioning human.**

- **Why a decision was required:** `backend-analytics` (and structurally, `backend-quality`'s own readers)
  read directly into Prisma state domains owned by other modules with no ADR governing this platform
  boundary (Constitution §7). A platform-wide decision was needed, not a per-module patch.
- **Current repository state at decision time:** analytics owns no state; ~100% of its contract is direct
  cross-module Prisma reads across seven domains owned by five modules. `backend-quality` discloses the
  structurally identical reverse pattern (read directly by `work-applications`/`analytics`).
- **Decided — resolves, per Option (c):** direct read-only cross-module Prisma reads are ratified as the
  platform standard for aggregator/reporting modules, subject to a three-point allow-list: (i) read-only,
  no write-back; (ii) a plain query, not a re-implementation or bypass of the owning module's own
  business-rule logic; (iii) display/reporting only, never another module's write-path decision source.
  All of analytics' existing seven read edges satisfy this — no code change required. Full record: `ADR-034`.
- **Explicitly NOT decided by this record:** a dedicated read-model/interface layer (Option (b)) is not
  built now — it remains the correct future escalation only if a named trigger is met (frequent
  schema-shape breakage, or a confirmed performance bottleneck once `GD-11`'s SLO baseline exists to
  measure against). Neither condition is met today; this is a forward-looking note, not new scope.
- **Merges findings:** `OQ-ANALYTICS-11` (`SIR-ANLY-013` / promoted `SIR-GLOB-010`) — resolved.
- **Artifacts unblocked:** analytics' cross-module read boundary is now ratified, not merely
  non-blocking-by-review; any future aggregator-shaped module (e.g. Compliance's subject-rights
  orchestration, if it exhibits the identical pattern) has a named precedent to check against rather than
  re-litigating the question.
- **Impact:** no code change. **0 PRs.**
- **Priority:** **P3.** Decided by the commissioning human 2026-07-28. **Owner:** Architect (Lead Architect,
  platform-wide). Full decision record: `ADR-034`.

## GD-14 — Geofencing / location model (Geo + attendance geofence)

**✅ DECIDED 2026-07-27, by the commissioning human.**

- **Why a decision was required:** The confirmed geofenced check-in/out feature had no data model and a chain
  of unresolved architecture questions (where coordinates live, retention owner, fail-open/closed, who edits
  coordinates, spoofing countermeasure, who may view raw coordinates).
- **Current repository state at decision time:** `backend/src/modules/geo` is empty; attendance has no
  coordinate fields or radius check; `SPEC-GEO-001` is a REVIEW stub, `0.1.1`. Not yet built as of this
  decision — implementation follows this record.
- **Decided — resolves `OD-GEO-001/002/003/004/005/007`:**
  - **`OD-GEO-001`** (coordinate storage location): **Option (a)** — hotel coordinates as columns on the
    existing `Hotel` model (`state-hotel`, `backend-crm`-owned). Not a new separate geo-owned state domain
    (option (b), not adopted).
  - **`OD-GEO-002`** (retention-job / coordinate-column ownership): `backend-geo` owns the worker-coordinate
    columns (a new, `backend-geo`-owned table/model) and the 6-month hard-delete retention sweep job (Tier 1,
    `GD-09`'s tier framework). Not `backend-attendance`. **Note:** this is the *stateful* fork of the choice
    the spec itself named (the alternative being `backend-geo` as a purely stateless distance-check service,
    with `backend-attendance` owning its own coordinate columns) — it introduces a second storage owner
    alongside `OD-GEO-001`'s CRM-owned `Hotel` coordinates (CRM: hotel coordinates; Geo: worker coordinates),
    a deliberate architecture choice, not a default.
  - **`OD-GEO-003`** (fail-open vs fail-closed): **Fail-closed.** Missing hotel coordinates, or a
    distance-check service failure, disables the Start/Close clock action — never silently allows it.
  - **`OD-GEO-004`** (who sets/edits hotel coordinates): **Admin-only manual entry**, via the same
    `HotelWriteGate` MASTER-data surface every other `Hotel` field already uses (`frontend/components/auth/
    RoleGate.tsx`, confirmed admin-only per D-2/D-3, PR #251). No geocoding-from-address service; a plain
    latitude/longitude form field.
  - **`OD-GEO-005`** (raw worker-coordinate visibility): Admin/manager may see only the **computed distance
    and pass/fail result** of a geofence check — never a worker's raw stored latitude/longitude. Minimizes
    exposure of precise personal location data (GDPR data-minimization), consistent with `CRR §17`'s
    worker-facing distance-only framing extended to the manager-facing side too.
  - **`OD-GEO-007`** (geofence pass/fail audit logging): **Yes** — every distance-check result (pass or fail)
    is recorded via the existing `BaseService.logAudit()` mechanism every other module already uses, distinct
    from Attendance's own `CHECK_IN`/`UPDATE_ATTENDANCE` audit rows.
- **Explicitly NOT decided by this record (remain OPEN, non-blocking or separately tracked):**
  - **`OD-GEO-006`** (performance budgets/SLOs for distance-check latency, retention-sweep volume/cadence):
    remains OPEN — a G8 release-readiness prerequisite, not a freeze blocker, same precedent as every other
    frozen spec's performance-budget gaps (e.g. `SPEC-ATT-001`, `SPEC-DOCUMENTS-001`).
  - **`OD-GEO-008`**: a citation correction (§37→§34), not a decision item — no action required.
  - **`OD-GEO-009`** (GPS-spoofing countermeasure): **explicitly, deliberately NOT included** in this MVP
    slice. Client-supplied device coordinates remain a known, disclosed, accepted risk (mock-location tooling
    can defeat the distance-check) — not a silently-omitted gap. Revisit post-MVP if abuse is observed;
    tracked, not resolved, by this decision.
- **Artifacts unblocked:** geofenced attendance Start/Close gating; `backend-geo` module build; `SPEC-GEO-001`
  G2 freeze (once the spec text is updated to reflect this decision and independently re-verified, per the
  same process `SPEC-DOCUMENTS-001`/`GD-16` followed).
- **Impact:** backend geo + attendance + crm · 2 migrations (Hotel lat/long columns + a new worker-coordinate
  table) · frontend hotel-coordinate entry field (admin-only) · mobile geolocation capture (both worker-app
  and checker-app, since both clock in/out). **~6–9 PRs**, matching the original estimate.
- **Priority:** **P2 (attendance is core, geofence is a confirmed enhancement).** **Owner:** Product Owner +
  Architect (unchanged — `SYNC-001` accountable-owner assignment remains separately open).

## GD-15 — HR & Employee-Management module build scope

**✅ DECIDED 2026-07-28, by the commissioning human. Resolved as 10 sub-decisions, one at a time, per the
Governance Resolution workflow — not a single bundled ADR.**

- **Why a decision was required:** HR (contracts/payroll/documents) and Employee-Management are stubs, and
  their security posture (IDOR, hotel-scoping, upload validation), payroll scope, contract-lifecycle
  transitions, and target field domains were undecided — each a product/architecture call before build.
- **Current repository state at decision time:** `hr/service.ts` throws `NotImplementedError` for all ops;
  `employee-management` is built for the Epic-5 slice only. Multiple High security findings recorded against
  the *future* HR routes (IDOR, missing `checkHotelAccess`, upload validation). **A pre-decision audit found
  a standing architecture blocker (`OD-HR-01a`/`OD-HR-01b`, the HR-vs-Onboarding module-boundary dispute) had
  actually already been resolved by `ADR-012` (Accepted, 2026-07-12) — sixteen days before this session —
  but neither `SPEC-HR-001`'s nor `docs/03-modules/onboarding/MODULE_SPEC.md`'s text had ever been updated to
  reflect it. This was corrected as a documentation-synchronization fix, not a new decision, before the ten
  genuine sub-decisions below were addressed.**
- **Decided — resolves, ten sub-decisions each with its own ADR:**
  1. `OD-HR-02` (payroll model conflict) → `ADR-039`: target types redesigned, zero payroll computation.
  2. `OD-HR-03`/`OD-HR-07` (contract lapse + continuation-capture) → `ADR-040`: manager-only confirmation, no worker veto.
  3. `OD-HR-09` (payslip escalation) → `ADR-041`: 3-business-day auto-escalation via the existing Outbox.
  4. `OD-HR-10` (worker-facing RBAC) → `ADR-042`: two new self-scoped permissions, no blanket extension.
  5. `OD-HR-13` (list-route hotel-scope, remainder) → `ADR-043`: `checkWorkerScope()` extended to list routes.
  6. `OD-HR-14` (malware-scan position) → `ADR-044`: synchronous scan-hook, reject on detection.
  7. `OD-EMP-04` (offboarding trigger) → `ADR-045`: hybrid — automatic for contract lapse, manual otherwise; re-engagement via new `EmploymentRecord`.
  8. `OD-EMP-06` (self-edit) → `ADR-046`: narrow contact/preference-field allow-list, recorded **platform-wide**.
  9. `OD-EMP-08` (bulk-CSV, remainder) → `ADR-047`: per-row isolation, duplicates always skipped.
  10. `OD-EMP-13`/`OD-EMP-14` (job-title/skill-tag governance) → `ADR-048`: Admin-managed lookup tables, retire-not-delete.
- **Explicitly NOT decided by this record:** `OD-HR-02b` (Personalfragebogen data-source ambiguity, Onboarding
  vs. employee-management) — `ADR-039` explicitly did not touch it, remains genuinely open. `GD-03`'s
  org-chart/reporting-model half (`OD-EMP-12`) — a standalone item, not folded into `GD-15`.
- **Merges findings:** all ten items above, resolved; `OD-EMP-16` (perf budget) was separately found already
  resolved by `GD-11`/`ADR-035` — its own spec row was stale and corrected in the same audit.
- **Artifacts unblocked:** both modules' product/architecture ambiguity is closed; the only remaining
  prerequisite is ownership assignment (`SYNC-001`) and each module's own remaining G4/G2 gate progression —
  no further governance decision blocks HR or Employee-Management build scoping.
- **Impact:** backend hr + employee-management (+ documents dependency) · 3–4 migrations · frontend HR/EMP
  admin UIs · mobile manager contract-confirm flow. **~10–14 PRs** (unchanged — this decision scopes the
  build, it does not itself implement it).
- **Priority:** **P2.** Decided by the commissioning human 2026-07-28. **Owner:** Product Owner + Architect.
  Full decision records: `ADR-039` through `ADR-048`.
- **Priority:** **P2 (post-MVP; large).** **Owner:** Product Owner + Architect.

## GD-16 — Documents module — RBAC & storage design

**✅ DECIDED 2026-07-27 (option (a) adopted, per this section's own recommendation).** See the
summary row above. Detail below is retained as the decision record.

- **Why a decision is required:** The Documents specification **cannot reach G2 freeze** until its
  document-level RBAC/permission model is decided; storage (S3 failure/encryption/retrieval), category
  taxonomy, expiry, and hotel-association are also open.
- **Current repository state:** No `Document`/`WorkerDocument` model, no module code; only HR's non-functional
  upload stub. `SIR-DOC-005`/`SIR-DOC-007` are High and explicitly freeze-blocking.
- **Merges findings:** `OD-DOC-005`/`OD-DOC-007` (RBAC — freeze-blocking), `OD-DOC-001/002/003/006/008`
  (retention/category/expiry/hotel-assoc/versioning), `OD-DOC-010/011/016/017/018/019` (S3/concurrency/
  malware/encryption/retrieval/indexing), `OD-DOC-015` (HR stub debt), `MIG-GAP-DOC-01..12`.
- **Options:** (a) Self-upload + manager-upload (the two confirmed actors) + hotel-scoped read via
  `checkHotelAccess`, presigned-URL retrieval, SSE-at-rest, malware scan hook; (b) broader RBAC taxonomy.
- **Recommended:** **(a) — the two confirmed actors only** (Constitution §6: don't invent broader access).
  This resolves the freeze-blocking RBAC gap minimally and defers taxonomy expansion.
- **Artifacts blocked:** `SPEC-DOCUMENTS-001` G2 freeze; HR contract-scan upload; onboarding document
  collection.
- **Impact:** backend new documents module + S3 client · 2 migrations · frontend upload/list UIs · mobile
  upload (worker app). **~6–9 PRs.**
- **Priority:** **P2 (blocks freeze; gates HR + onboarding).** **Owner:** Product Owner + Architect.

## GD-17 — Consent module — lifecycle & fail-safety

**✅ DECIDED 2026-07-28, by the commissioning human.**

- **Why a decision was required:** GDPR consent capture had unresolved lifecycle semantics and, critically, a
  **fail-open vs. fail-closed** decision when `backend-consent` is unavailable to a caller — an architecture
  posture that determines whether dependent onboarding/chatbot flows proceed or block.
- **Current repository state at decision time:** `SPEC-CONSENT-001` authored (v0.1.1); no module code.
  Highest-impact open item: whether chatbot engagement requires consent and whether a decline blocks
  onboarding.
- **Decided — resolves:** `OD-CONSENT-002` (chatbot consent gate) per **Option (b)**: chatbot engagement
  requires explicit consent; a decline does **not** block onboarding — it routes the worker to a
  manual/non-chatbot onboarding path instead. `OD-CONSENT-006` (fail-open/fail-closed) resolved
  **fail-closed**: dependent flows block, not silently proceed, when this module is unavailable — the safer
  default for a GDPR-integrity surface. Five smaller items resolved in the same pass: `OD-CONSENT-001`
  ("Renewed" persisted for the general verb only), `OD-CONSENT-004` (stale-notice submissions rejected,
  re-fetch required), `OD-CONSENT-007` ("Lapsed"/"Requested" computed, not persisted), `OD-CONSENT-009`
  (platform-default-language fallback), `OD-CONSENT-011` (no new RBAC permission — rides Compliance's
  existing governance-read path, mirroring `ADR-016`). Full record: `ADR-037`.
- **Explicitly NOT decided by this record:** the specific default fallback language for `OD-CONSENT-009`
  (implementation/configuration detail); `backend-consent`'s own build timeline/prioritization.
- **Merges findings:** `OD-CONSENT-001`, `OD-CONSENT-002` (highest-impact), `OD-CONSENT-004`,
  `OD-CONSENT-006`, `OD-CONSENT-007/009`, `OD-CONSENT-011` — all resolved.
- **Artifacts unblocked:** Onboarding's `OPQ-3` and Chatbot's `OD-CHAT-008` (consent-requirement portion
  only — transcript-persistence remains its own separate open question) may now be updated to reflect the
  concrete resolution instead of deferring to an undecided Consent-module question; `backend-consent`'s own
  build now has a scoped, unambiguous product/architecture basis.
- **Impact:** backend new consent module · 1–2 migrations · frontend consent UI · mobile consent capture.
  **~5–7 PRs** (unchanged — this decision scopes the build, it does not itself implement it).
- **Priority:** **P3 (post-MVP; gates onboarding/chatbot).** Decided by the commissioning human 2026-07-28.
  **Owner:** Product Owner + Architect. Full decision record: `ADR-037`.

## GD-18 — Calendar module scope (M2)

**✅ DECIDED 2026-07-28, by the commissioning human. Resolved as 4 sub-decisions, one at a time, per the
Governance Resolution workflow.**

- **Why a decision was required:** Calendar is a stub; timezone anchoring, the RM edit scope, the
  sick/vacation notification contract, and the auto-cancel/re-broadcast behavior were undecided. It also
  gates the Analytics sick/vacation metric.
- **Current repository state at decision time:** `calendar/service.ts` throws `NotImplementedError`; a
  `/operations` stub actually modeled reception data, not scheduling. `ADR-021` already fixed the
  Job-Dispatch↔Calendar ownership boundary; `GD-01`/`GD-12` (notification contract dependency) and `GD-03`'s
  permission-set half (RM edit scope dependency) were already decided before this decision, verified during
  audit — only `OD-CAL-06`/`OD-CAL-08` (already resolved via `GD-12`/`ADR-032` in an earlier session) needed
  no further action from `GD-18` itself.
- **Decided — resolves, four sub-decisions each with its own ADR:**
  1. `OD-CAL-04` (timezone anchor) → `ADR-049`: anchored to `Hotel.timezone` field (currently `Europe/Berlin`
     for all deployments), not a hardcoded constant — ratified permanent.
  2. `OD-CAL-07` (RM cross-hotel edit scope) → `ADR-050`: Calendar adopts the existing `ADR-030`/`ADR-023`
     authorization model (Hotel Manager hotel scope, RM hotel-group scope, Admin global); authorization-only,
     independent of `OD-EMP-12`/`GD-03`'s still-open org-chart half.
  3. `OD-CAL-10` (`/operations` stub disposition) → `ADR-051`: three-part resolution, informed by real-world
     weekly-planner ("Dienstplan") evidence the commissioning human supplied mid-decision — the write-capable
     stub is removed; the underlying occupancy/staffing-demand state remains unassigned pending future
     Requirements Intake; Calendar's weekly-plan view is established as a composite read model that may
     display that state once owned elsewhere, under `ADR-034`'s existing read-only allow-list.
  4. `OD-CAL-11` (auto-cancel re-broadcast) → `ADR-052`: Calendar's responsibility ends at cancellation;
     re-broadcast policy belongs entirely to Job Dispatch, addressed (if at all) during `GD-20` — not a
     prohibition on future dispatch-side automation, only a bounded-context boundary statement.
- **Explicitly NOT decided by this record:** whether arrivals-count and a persisted staffing-demand target
  become new confirmed requirements (flagged by `ADR-051` for a future Requirements Intake pass, which this
  Governance Resolution workflow is not positioned to perform — that activity confirms new requirements,
  this workflow resolves ambiguity in existing ones); `GD-20`'s own re-broadcast policy question.
- **Merges findings:** `OD-CAL-04/07/10/11`, all resolved. `OD-CAL-06`/`OD-CAL-08` required no action —
  already resolved by `GD-12`/`ADR-032`.
- **Artifacts unblocked:** Calendar's governance ambiguity is fully resolved; `REQ-CAL-T01` (manager
  weekly-plan placement view) and `REQ-CAL-T06` (today-only availability read-model) may now be planned
  against settled authorization/timezone/scope decisions — though both remain unbuilt, gated on ordinary
  implementation effort, not governance ambiguity. Analytics' `OQ-ANALYTICS-07` (sick/vacation counts) is
  similarly ungated at the governance level but still blocked on that same unbuilt view.
- **Impact:** backend calendar + notifications + analytics · 1–2 migrations · frontend calendar UI · mobile
  none (manager-web). **~4–6 PRs** (unchanged — this decision scopes the build, it does not itself implement
  it).
- **Priority:** **P3.** Decided by the commissioning human 2026-07-28. **Owner:** Product Owner + Architect.
  Full decision records: `ADR-049` through `ADR-052`.

## GD-19 — Chatbot module scope & LLM safety

**⏸ DEFERRED — POST-MVP, by explicit commissioning-human decision on 2026-07-28.** Sub-decision 1
(`OD-CHAT-002`) was Decided via the Governance Resolution workflow → `ADR-053`, ratifying the chatbot as
an AI orchestration layer with a tool-registry/plugin architecture. Immediately after that ADR merged, the
commissioning human directed that the remainder of `GD-19` be deferred until after MVP, to keep governance
effort focused on MVP-blocking decisions (`GD-20`/`GD-21`/`GD-22`). **`ADR-053` is retained in force,
unweakened, unreopened** — it is the governing architecture for whenever Chatbot work resumes. A complete
resumption checkpoint — every `OD-CHAT-*` item's exact current status, every dependency, every deferred
recommendation — is preserved at [`GD-19_CHATBOT_CHECKPOINT.md`](GD-19_CHATBOT_CHECKPOINT.md), so this
decision can resume with zero context loss.

- **Why a decision was required:** The Chatbot spec **cannot reach G2 freeze** until conversation-level RBAC
  and a prompt-injection-resistance posture are decided; tool-execution scope (now resolved, `ADR-053`),
  persistence, budget-guard model, and provider-outage fallback are also open.
- **Current repository state at deferral:** `backend/src/modules/chatbot` empty; no Claude/Anthropic SDK; no
  conversation model; `SPEC-CHATBOT-001` REVIEW, version 0.2.0. Three standing G2-freeze blockers remain:
  `OD-CHAT-005` (RBAC, partially resolved — worker-id provenance MUST closed, read-scope/initiation-scope
  open), `OD-CHAT-006` (prompt-injection, interim posture stated, not resolved), `OD-CHAT-013` (owner
  unassigned, `SYNC-001` — not resolvable by this workflow at all, requires an actual human/team assignment).
- **Merges findings:** `OD-CHAT-001..023`. **`OD-CHAT-002` (tool-execution scope) Decided → `ADR-053`.**
  `OD-CHAT-004` (routing), `OD-CHAT-008` (consent half), `OD-CHAT-019` (retention, provisional), `OD-CHAT-023`
  (transport) also resolved/partially resolved by this or other decisions — see the checkpoint for the exact
  status of every item. The remaining ~16 items (RBAC remainder, prompt-injection, file-handling
  registration, rate-limiting, budget-tracking mechanism, outage fallback, concurrency, encryption,
  cache-invalidation, timeout/backpressure, and others) are untouched and preserved in the checkpoint.
- **Decided — resolves:** `OD-CHAT-002` only, via `ADR-053` (see that record for full architecture). No other
  `GD-19` sub-decision is resolved by this record.
- **Explicitly NOT decided:** everything else in `GD-19` — deliberately deferred, not silently abandoned.
- **Artifacts blocked:** `SPEC-CHATBOT-001` freeze; onboarding chatbot flow. Both remain blocked until
  `GD-19` resumes post-MVP.
- **Impact:** backend new chatbot module + Anthropic SDK + budget-guard job · 2 migrations · frontend/mobile
  chat UI. **~8–12 PRs** (unchanged estimate; deferred, not reduced in scope).
- **Priority:** **P3 (post-MVP; out of the core staffing loop) — explicitly deferred, 2026-07-28.**
  **Owner:** Product Owner + Architect, to resume post-MVP.

## GD-20 — Job-Dispatch two-tier calendar+broadcast pivot

- **Why a decision is required:** 12 migration gaps separate the current marketplace apply/accept flow from
  the confirmed two-tier calendar+broadcast target. This is a large, breaking target-state rebuild reserved
  for explicit human authorization (deferred-by-design).
- **Current repository state:** current `WorkApplication` apply/accept flow live; target model unbuilt.
  ADR-018 already classified the accept-transaction coupling superseded-by-pivot.
- **Decomposition:** per the commissioning human's explicit direction (2026-07-28), GD-20 is resolved as
  5-6 independent sub-decisions rather than a single bundled decision, at product-decision granularity (each
  independently answerable by the Product Owner), not implementation/migration-gap granularity:
  1. **Overall Job Dispatch Model** — Decided → `ADR-054`.
  2. **Broadcast Lifecycle** (JobRequest, eligibility, first-acceptance, slot locking, auto-close,
     re-broadcast, notifications) — open.
  3. **Assignment Model** (WorkerAssignment/CalendarEntry, WorkApplication removal, assignment creation,
     daily exclusivity) — open.
  4. **Background Execution** (Platform Worker/outbox vs. node-cron/BullMQ/Redis; the sole `ADR-029`
     conflict point) — open.
  5. **Migration Strategy** (phasing/sequencing from current to target implementation) — open.
  6. **Analytics/Attendance follow-up** (`OQ-05`/`OQ-06` [attendance], `OQ-ANALYTICS-04`) — only if real unresolved
     downstream impact remains after 1-5; otherwise these are implementation follow-ups after GD-20, not
     GD-20 decisions themselves.
- **Sub-decision 1 — Decided 2026-07-28 → `ADR-054`:** the two-tier Calendar+Broadcast model is ratified as
  the **permanent target architecture**; the current marketplace flow is the **current** (not legacy)
  implementation, unchanged by this record. Implementation timing, phasing, and retirement are explicitly
  reserved for Sub-decision 5 — this decision took no position on build-now vs. build-later, deliberately
  separating destination from journey per the same pattern as `ADR-053` and `ADR-029`.
- **Sub-decision 2 — Decided 2026-07-28 → `ADR-055`:** broadcast (`TREQ-002..006`) ratified as already
  specified; closes `ADR-052`'s deferred re-broadcast question — a Calendar-cancelled slot does NOT
  auto-re-broadcast; broadcast remains exclusively manager-initiated; assignment cancellation never
  implicitly creates or modifies a `JobRequest`; any manager-initiated re-broadcast is a brand-new
  `JobRequest` with its own lifecycle, never a reopened prior request — preserving bounded-context ownership
  (`ADR-021`) and a clean audit trail.
- **Sub-decision 3 — Decided 2026-07-28 → `ADR-056`:** the assignment model
  (`TREQ-001/007/009/010/011/012/013`) ratified as target architecture — `WorkerAssignment` is created
  directly from either assignment path (calendar placement or broadcast accept), with no intermediating
  application/acceptance record; daily exclusivity enforced at the data layer (one active assignment per
  worker per day); worker skill is a bounded enum; no formal multi-state job-status machine. Framed around
  the architectural outcome (direct assignment creation) rather than specific implementation artifacts
  (model/endpoint removal). Explicitly establishes the target model only — implementation, migration, and
  retirement of the current marketplace implementation remain Sub-decision 5's (Migration Strategy)
  exclusive responsibility.
- **Sub-decision 4 — Decided 2026-07-28 → `ADR-057`:** background execution standardized —
  the 6h `JobRequest` auto-close (`TREQ-006`) runs on the Platform Worker/`state-outbox`, per `ADR-029`
  (no new mechanism, applies the already-accepted pattern). First-accept slot arbitration (`TREQ-004`)
  standardizes on optimistic concurrency (version column + transactional conditional update), matching the
  pattern already proven in `work-applications/service.ts` for the equivalent marketplace scenario;
  Redis-based slot locking is explicitly not part of the target architecture. `ADR-035` (GD-11 workload
  baseline) was checked directly and provides no evidence supporting a Redis distributed mutex; the burden of
  proof for introducing new infrastructure was placed on Redis, not on retaining it. A future ADR may
  introduce a distributed lock if production evidence later demonstrates the need. `MODULE_SPEC.md`'s
  `TREQ-004`/`TREQ-006` mechanism references corrected accordingly, and `PIVOT_DESIGN_DOCUMENT.md` received a
  Decision-Integration forward-note (matching the `ADR-029`/`SPEC-NOTIF-001` precedent).
- **Sub-decision 5 — Decided 2026-07-28 → `ADR-058`:** the existing Phase 1/Phase 2 forward-refactor
  migration plan (`MODULE_SPEC.md:495-506`) is ratified unmodified. `ADR-054` through `ADR-057` clarify the
  target architecture but introduce no new migration dependency, data-model concern, or ordering constraint
  the plan doesn't already account for — the two-phase forward-refactor, feature-flagged rollout, and
  trivial-rollback characteristics remain valid without modification. Implementation becomes
  architecturally eligible once `GD-03` (roles/org-chart) resolves — named because Phase 1 depends on the
  Regional Manager role, not because it is the only consideration bearing on implementation. Actual
  scheduling, prioritization, and sequencing against other work remain implementation planning's
  responsibility, not this record's.
- **Sub-decision 6 — Closed as MOOT, 2026-07-28:** `OQ-05`/`OQ-06` [attendance] (EXPECTED-seed re-ownership) and
  `OQ-ANALYTICS-04` (status-enum re-validation) were evaluated and found to have no genuine ambiguity
  remaining once `ADR-054`/`ADR-056` are applied — EXPECTED-seeding mechanically moves to whatever writes
  assignments directly in the target model (no `WorkApplication` intermediary), `expected_start/end` sources
  from the assignment/calendar entity, and analytics' status-enum reads mechanically re-point to the ratified
  target schema. These are implementation/migration follow-ups (Sub-decision 5's territory), not independent
  GD-20 governance decisions. One documentation defect was surfaced during this evaluation (`MODULE_SPEC.md`'s
  internally inconsistent claim that `WorkRequest` is both "repurposed as `JobRequest`" and that `JobRequest`
  is "newly added") — logged to the Specification Issues Register, not requiring a governance decision to
  resolve.
- **`GD-20` is now fully resolved — all five core sub-decisions decided (`ADR-054`–`ADR-058`), Sub-decision 6
  closed as moot.**
- **Merges findings:** `MIG-GAP-01..12` (`SIR-JOBD-006`, addressed across Sub-decisions 2/3/5, not
  individually), `OQ-05`/`OQ-06` [attendance] (Sub-decision 6), `OQ-ANALYTICS-04` (Sub-decision 6).
- **Artifacts unblocked:** target dispatch model (`ADR-054`–`ADR-058`); attendance EXPECTED-seed re-owner and
  analytics status metrics (Sub-decision 6, closed as moot). Actual implementation remains gated on `GD-03`
  (architectural eligibility, `ADR-058`) and subsequent implementation planning (scheduling).
- **Impact:** backend work-requests/applications/assignments/attendance/calendar · multiple migrations ·
  significant frontend + mobile rework. **~12+ PRs.**
- **Priority:** **P3 (large, strategic, explicitly deferrable).** **Owner:** Product Owner + Architect.

## GD-21 — Attendance operational automation

- **Why a decision is required:** Whether ABSENT/NO_SHOW marking is automated vs. manual, and the
  checker single-record-GET inconsistency, are product/consistency calls; audit `old_values`/`new_values`
  population is a small policy choice.
- **Current repository state:** `CHECK_IN_REMINDER`/`SHIFT_REMINDER` enums declared but no job fires them;
  `getById` treats only `{admin,manager}` privileged while list/update also privilege `checker`; audit writes
  populate only thin `{assignment_id}` payloads.
- **Merges findings:** `OQ-ATT-07` (auto-absence automation — `SIR-ATT-007`), `OQ-01` (checker GET
  inconsistency — `SIR-ATT-001`), `OQ-11` (audit old/new values — `SIR-ATT-012`).
- **Options:** (a) Automate ABSENT/NO_SHOW via a scheduled job (needs GD-01's job host); (b) keep manual
  manager override.
- **Recommended:** **(a) if the reminder enums are intended to fire, else (b) and delete the dead enums.**
  The checker-GET inconsistency should be aligned to list/update regardless (consistency).
- **Artifacts blocked:** attendance automation; audit completeness.
- **Impact:** backend attendance (+ GD-01 job host) · 0–1 migration · frontend minor · mobile none.
  **~2–4 PRs.**
- **Priority:** **P3.** **Owner:** Product Owner.

## GD-22 — Hotel-Group billing model

- **Why a decision is required:** `REQ-CRM-007` references shared billing for a Hotel Group, but no billing
  module/model exists and its ownership boundary is undefined.
- **Current repository state:** `HotelGroup.billing_info` is a free field; no billing entity, no billing
  logic.
- **Merges findings:** `OD-CRM-10` (`SIR-CRM-010`).
- **Options:** (a) Model billing as a CRM-owned sub-entity on HotelGroup; (b) a separate billing module; (c)
  defer — treat `billing_info` as opaque until a billing requirement is concrete.
- **Recommended:** **(c) defer.** CRR does not specify billing mechanics; building it now would invent
  requirements (Constitution §12).
- **Artifacts blocked:** `REQ-CRM-007` billing boundary (only if pursued).
- **Impact:** backend crm or new module · 1+ migration · frontend billing UI · mobile none. **~3–5 PRs (if
  pursued).**
- **Priority:** **P3 (defer).** **Owner:** Product Owner.

## GD-23 — Platform ADR ratification (Constitution §20)

**✅ DECIDED 2026-07-28, by the commissioning human.**

- **Why a decision was required:** Several platform ADRs and constitutional additions were implemented but
  still `Proposed`; formal ratification is reserved human authority (Constitution §20). No code was unblocked,
  but the governance record was incomplete until ratified.
- **Current repository state at decision time:** ADR-001..009 were verified already ratified Accepted on
  2026-07-15 (via the G2 Approval Workflow) — this row's own prior text was stale in describing that as
  still-pending. Only `ADR-019` (Repository Integrity Validation Gate) and `ADR-020` (Context Management
  Layer) remained genuinely `Proposed`, both already backward-compatible and already the operating reality.
- **Decided — resolves, per Option (a):** `ADR-019` and `ADR-020` are ratified as-is, Proposed → Accepted.
  `SIR-GLOB-003` (Specification Issues Register) — whose last remaining open element was exactly the
  ADR-001..009 ratification status — is corrected to RESOLVED, since that ratification was already
  confirmed complete as of 2026-07-15, prior to this decision.
- **Merges findings:** `SIR-GLOB-003` (ratification element, now RESOLVED), `VERSION.yaml` ADR-019/020 notes
  (updated to reflect Accepted status across all three locations: 1.5.0 entry, 1.4.0 entry, and the
  1.5.0-supersedes-1.4.0 summary comment).
- **Artifacts unblocked:** none functionally (no code was blocked); closes the `Proposed` governance debt.
- **Impact:** **0 PRs** (governance record only), as originally estimated.
- **Priority:** **P2.** Decided by the commissioning human 2026-07-28. **Owner:** Product Owner
  (Constitution §20).

---

## Decision dependency graph

Arrows mean "should be decided before." Leaf epics/modules shown in **bold**.

```
GD-01 Notification dispatch ──┬─────────────► Auth email-reset / failed-login-notify (part of GD-08)
                              ├─────────────► GD-18 Calendar (notifications) ──► GD-06 sick/vacation metric
                              ├─────────────► GD-21 Attendance auto-absence
                              └─────────────► GD-12 Event-bus (shares the outbox)

GD-03 5-role / Regional Mgr ──┬─────────────► GD-05 pause-jobs (RM authority)
                              ├─────────────► GD-16-adjacent CRM/EMP scoping
                              ├─────────────► GD-15 HR/EMP org-chart
                              └─────────────► GD-18 Calendar RM scheduling scope

GD-04 Quality rating model ───────────────► GD-06 analytics warning-count metric

GD-12 Event-bus ──────────────┬─────────────► GD-15 HR/EMP events
                              ├─────────────► GD-17 Consent events
                              └─────────────► GD-18 Calendar events

GD-16 Documents RBAC/storage ─┬─────────────► GD-15 HR contract-scan upload
                              └─────────────► Onboarding document collection

GD-09 Retention tiers ────────────────────► G8 Release Readiness (notif, auth, HR, docs, chatbot, consent, geo)
GD-11 Performance SLO ────────────────────► G8 Release Readiness (all perf rows)

GD-14 Geofencing ─────────────────────────► **Geofenced attendance (Geo module + attendance)**
GD-18 Calendar ───────────┬───────────────► GD-20 Job-Dispatch pivot
GD-03 roles ──────────────┘

GD-17 Consent ────────────────────────────► Onboarding / **Chatbot (GD-19)** flows
GD-20 Job-Dispatch pivot (strategic, deferrable) ──► attendance EXPECTED-seed re-owner, analytics status metrics
```

**Independent (no upstream decision):** GD-01, GD-02, GD-03, GD-04, GD-05, GD-07, GD-08, GD-09 (external:
tax advisor), GD-10, GD-11, GD-13, GD-22, GD-23.

---

## ROI ranking (engineering unlocked per single decision, highest first)

~~1. **GD-01 Notification dispatch**~~ — **IMPLEMENTED, not just decided** (Epic 7, PRs 7.1–7.8 merged
   2026-07-24; struck through rather than removed, per append-only convention — see the 2026-07-24 sync
   note above). Ranking below renumbered to reflect only open decisions.
1. **GD-02 Manager write authority** — tiny decision, immediately unblocks CRM/Users write paths. Now the
   cheapest open item on the board.
2. **GD-03 5-role / Regional Manager** — unblocks RM features across CRM, Calendar, Analytics, and EMP
   org-chart in one call.
3. **GD-09 Retention tiers** — a single mapping decision clears the G8 Release-Readiness blocker for seven
   modules at once (but has an external tax-advisor lead time — start early).
4. **GD-12 Event-bus** — zero code itself, yet unblocks the HR/EMP/Calendar/Consent builds.
5. **GD-04 Quality rating model** — unblocks quality M3 plus the downstream analytics warning metric.
6. **GD-16 Documents RBAC** — unblocks its own freeze *and* HR contract-scan + onboarding.
7. **GD-07 Session revocation & rate-limiting** — one decision closes several production-security gaps.
8. **GD-14 Geofencing**, **GD-15 HR/EMP**, **GD-05 pause-jobs**, **GD-06 analytics** — sizeable but more
   self-contained.
9. Remainder (GD-08, GD-10, GD-11, GD-13, GD-17..23) — narrower or explicitly deferrable.

---

# Executive Summary

- **Total remaining unique governance decisions: 23** (collapsed from 264 open/blocked register rows;
  owner-assignment, documentation-only, knowledge-sync, and already-implemented items excluded per scope).

> **Sync note (2026-07-24):** `GD-01` is no longer an open decision to make — it was decided
> 2026-07-23 (`ADR-029`) **and has since been fully built and merged** (Epic 7, PRs 7.1–7.8, `main`
> @ `4079a0f`; see `docs/15-audits/REPOSITORY_AUDIT_2026-07-24.md`). It is removed from the
> "highest-leverage" and "blocking MVP" lists below, which now reflect only genuinely open items.
> The "Total remaining unique governance decisions" count is unchanged at 23 in the historical
> per-item sections below (each `GD-*` section is append-only, per governance protocol), but with
> `GD-01` implemented, **22 remain open**.

> **Sync note (2026-07-28):** `GD-12` is no longer an open decision to make — it was decided
> 2026-07-28 (`ADR-032`, Option (a): direct in-process calls for synchronous cross-module effects;
> the existing `ADR-029` Outbox is the sole approved async/durable mechanism; no generic event bus
> exists or is introduced; a future pub/sub need requires its own new ADR). It is removed from the
> "highest-leverage" list below. Per the Governance Register (`docs/implementation/GOVERNANCE_REGISTER.md`,
> assembled 2026-07-28), `GD-02, 03, 04, 05, 06, 07, 14, 16` were also independently confirmed decided
> and built in that same session's audit — this document's historical per-`GD-*` sections and
> ROI/executive-summary lists below are append-only and have not been rewritten to reflect that
> broader finding beyond this note; `GOVERNANCE_REGISTER.md` Part 2 is the current authoritative count
> of genuinely-still-open decisions (9, not 22) until each is resolved via the Governance Resolution
> workflow and recorded here in its own right.

> **Sync note (2026-07-28, cont'd):** `GD-09`'s mapping half is also no longer an open decision to
> make — decided 2026-07-28 (`ADR-033`, Option (c): every previously-unassigned record type
> provisionally mapped to one of CRR §25's three tiers now; tax-advisor sign-off, `OD-RETENTION-01`,
> tracked separately as a non-blocking follow-up rather than a gate). Per the Governance Resolution
> workflow's per-decision approval sequence (`GD-12` was Decision #1, `GD-09` is Decision #2), this is
> recorded here as its own right per the same protocol as the note above. Genuinely-still-open count
> in `GOVERNANCE_REGISTER.md` Part 2 decrements accordingly.

> **Sync note (2026-07-28, cont'd 2):** `GD-13` is also no longer an open decision to make — decided
> 2026-07-28 (`ADR-034`, Option (c): direct read-only cross-module Prisma reads ratified as the
> platform standard for aggregator/reporting modules, subject to a three-point allow-list; a future
> read-model interface remains a named, unmet escalation trigger tied to `GD-11`'s still-open SLO
> baseline). Decision #3 in the Governance Resolution workflow's sequence. Genuinely-still-open count
> in `GOVERNANCE_REGISTER.md` Part 2 decrements accordingly.

> **Sync note (2026-07-28, cont'd 3):** `GD-11` is also no longer an open decision to make — decided
> 2026-07-28 (`ADR-035`, Option (a): platform-wide workload baseline, ~100 hotels/~5,000 workers/~300
> concurrent users; p95 targets 150/400/800ms by query class; leaderboard pagination now a MUST;
> cross-module fan-out capped at 15 parallel queries). Decision #4 in the Governance Resolution
> workflow's sequence. `SIR-CRM-013` was found mislabeled under this GD's "Merges findings" — it is
> actually a `GD-10` item, already resolved via `ADR-030`, and was left untouched by `ADR-035`.
> Genuinely-still-open count in `GOVERNANCE_REGISTER.md` Part 2 decrements accordingly.

> **Sync note (2026-07-28, cont'd 4):** `GD-10` is also no longer an open decision to make — decided
> 2026-07-28 (`ADR-036`: optimistic concurrency adopted as the platform standard; attendance's
> `checkIn`/`update` race MUST be fixed, mechanism deferred to implementation). Decision #5 in the
> Governance Resolution workflow's sequence. Verification found two of this GD's own three "merges
> findings" items already resolved by other decisions before `ADR-036` — `OD-CRM-13`/`SIR-CRM-013`
> (`ADR-030`, 2026-07-25) and `OQ-QUAL-04`/`SIR-QUAL-005` (`GD-04`+PR #237/#238, 2026-07-27) — neither
> reopened. Genuinely-still-open count in `GOVERNANCE_REGISTER.md` Part 2 decrements accordingly.

> **Sync note (2026-07-28, cont'd 5):** `GD-17` is also no longer an open decision to make — decided
> 2026-07-28 (`ADR-037`: `OD-CONSENT-002` resolved via Option (b) — chatbot engagement requires
> consent, decline routes to a manual/non-chatbot onboarding path, does not block onboarding;
> `OD-CONSENT-006` resolved fail-closed; five smaller lifecycle/RBAC items also resolved in the
> same pass). Decision #6 in the Governance Resolution workflow's sequence. Onboarding's `OPQ-3`
> and Chatbot's `OD-CHAT-008` (consent portion only) were updated to reflect the concrete
> resolution. Genuinely-still-open count in `GOVERNANCE_REGISTER.md` Part 2 decrements accordingly.

> **Sync note (2026-07-28, cont'd 6):** `GD-23` is also no longer an open decision to make — decided
> 2026-07-28, Option (a): `ADR-019`/`ADR-020` ratified Proposed → Accepted; `VERSION.yaml`'s three
> stale ADR-019/020 notes corrected accordingly. Verification found ADR-001..009 were already
> ratified 2026-07-15 (this GD's own "current repository state" line was stale) — `SIR-GLOB-003`
> is now marked RESOLVED in the register, closing its last open element. Decision #7 in the
> Governance Resolution workflow's sequence. Genuinely-still-open count in `GOVERNANCE_REGISTER.md`
> Part 2 decrements accordingly.

> **Sync note (2026-07-28, cont'd 7):** `GD-08` is also no longer an open decision to make — decided
> 2026-07-28 (`ADR-038`, Option (c): MFA explicitly deferred to a post-MVP hardening milestone, a
> deliberate scheduling decision, not a silent gap; no data model or mechanism selected). Decision
> #8 in the Governance Resolution workflow's sequence. Genuinely-still-open count in
> `GOVERNANCE_REGISTER.md` Part 2 decrements accordingly.

> **Sync note (2026-07-28, cont'd 8):** `GD-15` is also no longer an open decision to make — decided
> 2026-07-28 as ten sub-decisions, each with its own ADR (`ADR-039` through `ADR-048`), Decision #9
> in the Governance Resolution workflow's sequence. A pre-decision audit found `OD-HR-01a`/`OD-HR-01b`
> (the HR-vs-Onboarding module-boundary dispute this GD's own text never mentioned as a blocker) had
> already been resolved by `ADR-012` on 2026-07-12 — a documentation-synchronization gap corrected
> before the ten genuine sub-decisions were addressed. `OD-EMP-16` was separately found already
> resolved by `GD-11`/`ADR-035` — its own stale spec row corrected in the same audit. `OD-HR-02b`
> and `GD-03`'s org-chart half remain genuinely open, not resolved by `GD-15`. Genuinely-still-open
> count in `GOVERNANCE_REGISTER.md` Part 2 decrements accordingly (now 5: `GD-18/19/20/21/22`).

> **Sync note (2026-07-28, cont'd 9):** `GD-18` is also no longer an open decision to make — decided
> 2026-07-28 as four sub-decisions, each with its own ADR (`ADR-049` through `ADR-052`), Decision #10
> in the Governance Resolution workflow's sequence. `ADR-051` (the `/operations` stub disposition) was
> informed by real-world weekly-planner ("Dienstplan") evidence the commissioning human supplied
> mid-decision — the resolution path involved two rounds of correction (an initial "remove and treat
> as out of scope" recommendation, corrected first on evidence grounds and then on an ownership-vs-
> presentation distinction) before settling on: stub removed, underlying state unassigned pending a
> future Requirements Intake pass, and Calendar's weekly-plan view established as a composite read
> model under `ADR-034`'s existing allow-list. Two likely-missing requirements (arrivals count,
> staffing-demand target) were surfaced but not resolved — that requires confirming new requirements,
> outside this workflow's scope. `OD-CAL-11`'s resolution (`ADR-052`) explicitly defers re-broadcast
> policy to `GD-20`, not resolving it. Genuinely-still-open count in `GOVERNANCE_REGISTER.md` Part 2
> decrements accordingly (now 4: `GD-19/20/21/22`).

> **Sync note (2026-07-28, cont'd 10):** `GD-19`'s first sub-decision (`OD-CHAT-002`, tool-execution
> scope) was decided via the Governance Resolution workflow → `ADR-053` (chatbot ratified as an AI
> orchestration layer with a tool-registry/plugin architecture, risk-tiered confirmation policy).
> Immediately after, the commissioning human directed that the remainder of `GD-19` be **deferred to
> post-MVP** — an explicit product decision, not an abandonment. `ADR-053` is retained in force,
> unweakened. A full resumption checkpoint (every `OD-CHAT-*` item's exact status, every dependency,
> every preserved recommendation) lives at `GD-19_CHATBOT_CHECKPOINT.md`. Verified isolated from all
> remaining MVP decisions (`GD-20`/`21`/`22`) — no dependency exists either direction. `GD-19` is
> excluded from the "genuinely-still-open" count below going forward, tracked instead as
> deferred-not-open; the count for actively-open MVP decisions is now **3**: `GD-20/21/22`.

- **Highest-leverage decisions (make these first):**
  1. **GD-02 Manager write-permission authority** — smallest, highest ROI-per-effort remaining item;
     removes a live authorization contradiction on CRM/Users.
  2. **GD-03 5-role & Regional-Manager authority** — unblocks RM features across four modules.
  3. **GD-09 GDPR retention tiers** — clears G8 for seven modules; has external (tax-advisor) lead time.
  4. **GD-12 Event-bus transport** — zero-code decision that gates four module builds.

- **Decisions blocking MVP** (the core staffing loop + its web/mobile surfaces):
  GD-02, GD-03, GD-04, GD-05, GD-06. (`GD-01` is IMPLEMENTED, not just decided — see sync note above.
  The core loop already runs; these remaining items resolve the manager/role authorization
  contradictions, complete the quality rating surface, ship the confirmed pause-jobs toggle, and fix
  the worker analytics 403.)

- **Decisions blocking Production** (on top of MVP):
  GD-07 (session revocation + rate-limiting), GD-08 (MFA, if in scope), GD-09 (retention/compliance — **long
  external lead time**), GD-10 (concurrency), GD-11 (performance SLO), GD-23 (ADR ratification). Plus owner
  assignment (`SYNC-001`) — excluded from this backlog but a hard release-accountability gate the human must
  still resolve.

- **Decisions that can wait until post-MVP:**
  GD-13 (read-boundary ADR), GD-14 (geofencing), GD-15 (HR/EMP build), GD-16 (documents), GD-17 (consent),
  GD-18 (calendar), GD-19 (chatbot), GD-20 (job-dispatch pivot — explicitly deferrable), GD-21 (attendance
  automation), GD-22 (billing — recommend defer).

- **Bottom line:** the project is **decision-bound, not implementation-bound.** No unblocked application-code
  epic remains (post-Epic-8); the remaining engineering is well-scoped but almost every item waits on one of
  the 22 still-open decisions (23 total minus the now-implemented GD-01). Making the four highest-leverage
  remaining decisions (GD-02, GD-03, GD-09, GD-12) unblocks the
  large majority of the remaining roadmap.

---

*Read-only planning artifact. Makes no governance decision, freezes no scope, and invents no requirement or
architecture (Constitution §6, §12). Canonical open-issue authority remains
`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`; sequencing authority remains
`docs/implementation/IMPLEMENTATION_EXECUTION_PLAN.md`.*
