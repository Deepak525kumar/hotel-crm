# Governance Register — Full Open-Decision Inventory

| Field | Value |
|---|---|
| Purpose | A single, exhaustive, per-module inventory of every unresolved governance item (`OD-*`, `OQ-*`, and cross-cutting `SIR-*`/`SYNC-*` rows) across all 16 platform modules, plus a consolidated cross-reference to the genuinely-still-open, actively-pursuable platform-level `GD-*` decisions (now **3** — `GD-20/21/22` — across the full `GD-01..23` numbering; `GD-19` is tracked separately as **deferred to post-MVP**, not open, per its own checkpoint — see the closing note below for the itemized list). This is **pure inventory** — Phase 2, Step 1–2 of the Governance Finalization roadmap. |
| Explicitly NOT in scope | **This document proposes zero resolutions.** No item below is answered, recommended, or defaulted here — every item remains exactly as open, and exactly under the authority its own source spec assigns, as of the baseline revision. Resolution (Step 3 of the roadmap) is a separate, explicitly human-gated activity, one decision at a time. |
| Live status | The Governance Resolution workflow is now underway. **`GD-12` (Decision #1)**, **`GD-09`'s mapping half (Decision #2)**, **`GD-13` (Decision #3)**, **`GD-11` (Decision #4)**, **`GD-10` (Decision #5)**, **`GD-17` (Decision #6)**, **`GD-23` (Decision #7)**, **`GD-08` (Decision #8)**, **`GD-15` (Decision #9, ten sub-decisions)**, **`GD-18` (Decision #10, four sub-decisions)**, and **`GD-19`'s first sub-decision (Decision #11)** were all decided 2026-07-28 (`ADR-032`, `ADR-033`, `ADR-034`, `ADR-035`, `ADR-036`, `ADR-037`, `ADR-019`/`ADR-020` ratification, `ADR-038`, `ADR-039`–`ADR-048`, `ADR-049`–`ADR-052`, `ADR-053` respectively). Immediately after `ADR-053` merged, the commissioning human explicitly **deferred the remainder of `GD-19` to post-MVP** — `ADR-053` is retained in force; a full resumption checkpoint is preserved at `docs/implementation/GD-19_CHATBOT_CHECKPOINT.md`, confirmed isolated from all remaining MVP decisions. This document's per-item rows and Part 2's table have been updated in place to reflect all eleven resolutions plus the `GD-19` deferral; every other item remains exactly as open as when this register was first assembled. Four items were found already resolved/closed by prior decisions during verification: `SIR-CRM-013`/`OD-CRM-13` (`ADR-030`), `SIR-QUAL-005`/`OQ-QUAL-04` (`GD-04`), `SIR-GLOB-003` (ADR-001..009 ratified 2026-07-15), and `OD-HR-01a`/`OD-HR-01b` (`ADR-012`, 2026-07-12 — a documentation-synchronization gap corrected during `GD-15`'s audit) — none reopened, all corrected in place. `GD-18`'s resolution (`ADR-051`) was informed by real-world weekly-planner evidence supplied mid-decision and surfaced two likely-missing requirements (arrivals count, staffing-demand target) flagged for a future Requirements Intake pass, not resolved by this workflow. Part 2 carries the current count of genuinely-still-open, actively-pursuable `GD-*` decisions (`GD-19` excluded, tracked as deferred). |
| Baseline | `origin/main` @ `13cf8d6` ("Merge pull request #260"), cross-referenced against `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` (dated 2026-07-23, header baseline `a160a92`) — that document's own decided/open status per GD has been re-verified directly against later-merged code in this session; see the "Corrections applied" section below for every place this register's status differs from a source document's literal text. |
| Method | Four independent extraction passes (one per module cluster) read every `docs/03-modules/*/MODULE_SPEC.md` Risks/Open-Decisions table verbatim; a fifth pass (this document's author) read `GOVERNANCE_DECISIONS_REQUIRED.md` directly in full and cross-checked every extraction against known-current code state established earlier in this session. Quotations are the source spec's own wording, not paraphrased, except where noted as a correction. |
| Categorization | Each item is tagged with one of **Product**, **Architecture**, **Security**, **UX** — inferred from the item's content and its own stated authority column (e.g. "human/security" → Security; "Product/Human" → Product; RBAC/ownership/interface-shape/event-transport items → Architecture; anything about notification routing, manager workflows, or deep-linking → UX). Some items straddle two categories; the dominant one is used and the other noted in parentheses. |

---

## Corrections applied during assembly (verify-before-trust)

Per this session's own established practice of never trusting a spec's self-description over direct code inspection, three factual corrections were made to what the raw extractions reported:

1. **`backend-geo` is fully built, not a stub.** The geo extraction pass repeated a stale claim from an earlier revision of `SPEC-GEO-001` ("no geo module code exists at all"). Directly verified this session (multiple times, across multiple tasks): `backend/src/modules/geo/{service,controller,routes,distance,retention-sweep-job,types}.ts` all exist and are real; the module is route-mounted at `/geo` in `backend/src/routes/v1/index.ts`. `OD-GEO-001/002/003/004/005/007` are genuinely Resolved per `GD-14` **and the resulting code has landed** — the register below reflects this. Only `OD-GEO-006` (performance/SLO, non-blocking) and `OD-GEO-009` (GPS-spoofing countermeasure, deliberately deferred) remain open.
2. **`OQ-USERS-04`/`SYNC-005` internal contradiction preserved, not silently resolved.** `SPEC-USERS-001`'s own Risks table lists this row `Open`, while the same document's Document Control section claims it was "cleared" by `ADR-017`. Both are quoted below rather than picking one — this is itself a governance-hygiene defect (an internally inconsistent frozen spec) worth surfacing, not resolving by fiat.
3. **`GD-02, 03, 04, 05, 06, 07, 14, 16` are DECIDED**, contrary to `GOVERNANCE_DECISIONS_REQUIRED.md`'s own decision-index table default read (which is dated 2026-07-23 and shows some of these as open in its earliest rows) — the same document's per-GD sections and later "Sync note" annotations confirm all eight were decided 2026-07-24 through 2026-07-27, and this session independently re-verified every one is actually built in code (not just decided on paper). Only the 9 GD rows genuinely still open are carried into the consolidated table in Part 2 below.

No existing frozen spec was edited to apply these corrections — they are recorded here, in this new document, only.

---

# Part 1 — Per-Module Inventory

## 1. `backend-auth` (`SPEC-AUTH-001 / 0.3.0`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OQ-AUTH-01 | MFA/email-reset/failed-login-notify named as confirmed requirements but not explicitly milestone-pinned by either authority doc | human/unassigned | Open | Product |
| OQ-AUTH-02 | No MFA data model (secret/enrollment/recovery-code storage) specified anywhere | human/unassigned | Open — required before `TREQ-AUTH-006` planning | Architecture |
| OQ-AUTH-03 | `state-user` has two writers, `authoritative_writer: UNKNOWN` (= `SYNC-005`) | human | Open (cross-repository) — **Document Control separately claims this is cleared by ADR-017; the Risks-table row itself still says Open (contradiction, see Corrections)** | Architecture |
| OQ-AUTH-04 | JWT refresh-secret fallback (`JWT_REFRESH_SECRET ?? JWT_SECRET`) shares one signing secret when unset | human/unassigned | Open — Confirmed High (security); contributes to blocking Security FAIL | Security |
| OQ-AUTH-05 | `resetPassword` (as originally specified): public, tokenless, direct overwrite — "a complete, self-service, zero-interaction account-takeover primitive" | human/unassigned | Open — Confirmed **Critical**, framed as MUST NOT be treated as routine | Security |
| OQ-AUTH-06 | `checkHotelAccess`'s blanket admin/manager/checker bypass — no enforced one-hotel scope | human/unassigned | Open — Confirmed High; implementation direction separately open | Security |
| OQ-AUTH-07 | `permissions-middleware` owner unassigned, distinct from `auth-middleware` | human/unassigned | Open | Architecture |
| OQ-AUTH-08 | Org-chart visibility confirmed but no model/endpoint exists | human/unassigned | **Permission half Resolved (`ADR-030`)**; data-model half remains Open | Product |
| OQ-AUTH-09 | Special-category field access-gating depends on an unspecified `PersonalData` model / owning module | human/unassigned | Open | Architecture |
| OQ-AUTH-10 | Module owner `unassigned` (= `SYNC-001`) | human | Open (cross-repository) | Architecture |
| OQ-AUTH-11 | No GDPR retention tier named for `User`/`Session`/`AuditLog` | human/unassigned | **RESOLVED (provisional) `GD-09`/`ADR-033`, 2026-07-28** — `User`/`Session` → Tier 2; `AuditLog` excluded, retained indefinitely. Tax-advisor sign-off tracked separately, non-blocking. | Security |
| OQ-AUTH-12 | PIVOT §10's `FEATURE_*` convention claim — zero matches found repo-wide (as of this spec's authoring) | human/unassigned | Open — factual mismatch, not silently accepted | Architecture |
| OQ-AUTH-13 | Regional Manager role token unstated | human/unassigned | Resolved (`ADR-030`, `REGIONAL_MANAGER` enum) | Architecture |
| OQ-AUTH-14 | `Session` rows never proactively swept, no sweep/TTL job | human/unassigned | Open | Security |
| OQ-AUTH-15 | `Session.refresh_token` stored in cleartext, no hashing | human/unassigned | Open — Confirmed High (new finding) | Security |
| SYNC-001 | Owner unassigned (no CODEOWNERS) | human | Open (cross-repository) | Architecture |

**Note:** items OQ-AUTH-04/05/06/15 (the four security defects) were independently re-verified this session as **fixed in current code** (hashed refresh tokens, two-step token-mediated password reset, `isHotelInScope` scoping via `ADR-024`/`ADR-030`). The spec's own Risks table has not been updated to reflect this — a documentation-drift issue, not a still-live vulnerability. Flagged here as a spec-freshness gap, not re-classified as Resolved without a human-authorized spec correction.

## 2. `backend-users` (`SPEC-USERS-001 / 0.2.0`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OQ-USERS-01 | 5-role model absent (4 tokens vs. confirmed 5) | Human/Architecture | Resolved (`ADR-030`) | Architecture |
| OQ-USERS-02 | Manager write authority — net effect Admin-only despite route intent | Human authority | Resolved (`ADR-030`) | Architecture |
| OQ-USERS-03 | Guard checks only incoming role, never target's pre-existing role (narrower than the resolved create/update asymmetry) | Human/Security | Open — tracked platform-wide as `SIR-AUTH-019` | Security |
| OQ-USERS-04 | `state-user` shared-write, `authoritative_writer: UNKNOWN` (= `SYNC-005`) | Human/Architecture | **Open per this spec's own Risks table — but Document Control separately claims cleared by `ADR-017` (internal contradiction, preserved not resolved, see Corrections)** | Architecture |
| OQ-USERS-05 | No hotel-scoping on any route; blocks target `REQ-USERS-022/023/024` | Human/Security/Architecture | Open | Security |
| OQ-USERS-06 | No PII-nulling mechanism for soft-deleted users | Human/Product/Architecture | Open — GDPR erasure mechanism undesigned | Product |
| OQ-USERS-07 | Owner unassigned (= `SYNC-001`) | Human | Open | Architecture |
| OQ-USERS-08 | No client consumer exists for a target capability | Product/Human | Open — informational, non-blocking | UX |
| OQ-USERS-09 | `users:delete` permission token defined but unused (only `requireRole('admin')` gates the route) | Human/Security | Open — low-impact consistency note | Security |

## 3. `backend-crm` (`SPEC-CRM-001 / 0.2.1`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-CRM-01 | Hotel Group/Organization data model | Architecture/Human | Resolved (Hotel Group facet, `ADR-023`) — dedicated-Hotel-Manager facet remains Open | Architecture |
| OD-CRM-02 | Manager hotel-write authority contradiction | Human authority | Resolved (`ADR-030`) | Architecture |
| OD-CRM-03 | `contact_email`/`contact_phone` exist but unused by service — wire in or remove | Product/Human | **Open** | Product |
| OD-CRM-04 | Pause-new-jobs toggle | Product/Human | Resolved (`GD-05`) | Product |
| OD-CRM-05 | Scope + Regional Manager role absent from enum/JWT | Architecture/Human | Open (implementation) — design settled by `ADR-023`, build remains a G8 prerequisite | Architecture |
| OD-CRM-06 | Module-naming conflict ("Hotels module" vs. `backend-crm`) | Docs owner/Human | Open — terminology reconciliation | Architecture |
| OD-CRM-07 | Who may list hotels | Human authority | Resolved (`ADR-030`) | Architecture |
| OD-CRM-08 | Frontend `per_page` vs. backend `limit` param mismatch | Human/Frontend | Open — API contract alignment | Architecture |
| OD-CRM-09 | `getHotel` does not filter `is_active`/`deleted_at` | Human/Security | Open — low impact; confirm intent | Security |
| OD-CRM-10 | Shared-billing ownership (= `GD-22`) | Product/Architecture/Human | Open | Product |
| OD-CRM-11 | Owner unassigned (= `SYNC-001`) | Human | Open | Architecture |
| OD-CRM-12 | Formal interface/event contract unversioned | Architecture/Human | **Transport convention Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — CRM's own events still need per-spec reclassification at this spec's next revision | Architecture |
| OD-CRM-13 | No optimistic-lock column on `Hotel` | Human | Resolved (`ADR-030` premise; no schema change needed). **`GD-10`/`ADR-036`, 2026-07-28: confirmed, not reopened** — optimistic concurrency is now the ratified platform standard, but this item required no further action. | Architecture |
| OD-CRM-14 | PDD §10's `FEATURE_*` convention claim — no matches found (as of authoring) | Human/Architecture | Open — same class as `SIR-NOTIF-003`/`SIR-AUTH-012` | Architecture |
| OD-CRM-15 | Route-nesting execution coupling (platform-wide) | Human/Architecture (Lead Architect) | Open — platform-wide Decision Record required | Architecture |
| OD-CRM-16 | Pause-jobs enforcement one-sided cross-module contract | Human/Architecture | Resolved (`GD-05`) | Architecture |
| OD-CRM-17 | `checkHotelAccess` admin/manager/checker bypass on Get/Update | Human/Security | Open — low impact given current sensitivity | Security |

## 4. `employee-management` (`SPEC-EMP-001 / 0.2.0`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-EMP-01 | Probation legal shape | Client | Resolved (CRR §9) | Product |
| OD-EMP-02 | Contract expiry length | Client | Resolved (CRR §9) | Product |
| OD-EMP-03 | Hotel-creation permission | Client | Resolved (CRR §11) | Product |
| OD-EMP-04 | Offboarding/termination + re-engagement workflow undefined | Product/Human | **RESOLVED (Option (c), hybrid) `GD-15`/`ADR-045`, 2026-07-28** — automatic for contract lapse, manual otherwise; re-engagement via new `EmploymentRecord` | Product |
| OD-EMP-05 | Hotel-Group association mechanism | Architecture/Human | Resolved (`ADR-023`) | Architecture |
| OD-EMP-06 | Staff self-edit after onboarding | Product/Human | **RESOLVED (Option (b)) `GD-15`/`ADR-046`, 2026-07-28, platform-wide boundary** — narrow contact/preference-field allow-list; all other fields Manager/Admin-controlled, not module-specific | Product |
| OD-EMP-07 | Availability-indicator ownership/derivation | Architecture/Human | **Resolved by `ADR-021`** (see Calendar `OD-CAL-01` — this session independently confirmed the read-model is built, `GET /calendar/availability`, merged) | Architecture |
| OD-EMP-08 | Bulk-import row handling + permission holder | Product/Human | **RESOLVED, both facets** — permission-holder (`ADR-030`); invalid-row/duplicate-handling (Option (b)) `GD-15`/`ADR-047`, 2026-07-28, per-row isolation, duplicates always skipped | Product |
| OD-EMP-09 | Formal domain-event/interface contract (= `GD-12`) | Architecture/Human | **Transport convention Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — every `EVT-EMP-*` row still needs per-spec reclassification into "direct call" or "Outbox-backed" at this spec's next revision | Architecture |
| OD-EMP-10 | Docs↔code module-id mapping (`backend-hr` plausible home, still a stub) | Human (`SYNC-001`) | Open | Architecture |
| OD-EMP-11 | Authoritative-doc location discrepancy | Docs owner | Note — no behavioral impact | Architecture |
| OD-EMP-12 | Org-chart/reporting-relationship model underlying `REQ-EMP-013` | Product/Human | **Open** — this session's own implementation of the org-chart endpoint deliberately did NOT resolve this; it exposed only the already-decided visibility half (RM+Admin) | Product |
| OD-EMP-13 | Job Title value domain (free-text vs. controlled list) | Product/Human | **RESOLVED (Option (a)) `GD-15`/`ADR-048`, 2026-07-28** — Admin-managed lookup table, retire-not-delete | Product |
| OD-EMP-14 | Skill-set governance (administratively editable?) | Product/Human | **RESOLVED (Option (a)) `GD-15`/`ADR-048`, 2026-07-28** — Admin-managed lookup table, retire-not-delete | Product |
| OD-EMP-15 | Owner unassigned (= `SYNC-001`) | Human | Open | Architecture |
| OD-EMP-16 | No performance budget for any `IF-EMP-*` interface (= `GD-11`) | Architecture/Human | **RESOLVED `GD-11`/`ADR-035`, 2026-07-28** — platform workload baseline + p95 targets by query class set | Architecture |

**Also applies platform-wide to this module:** `FEATURE_EMPLOYMENT_RECORD` defaults `false` in `backend/src/config/env.ts` — the entire `/employees/*` route tree (including the now-built org-chart endpoint) is unmounted (404) until this flag is flipped. Not an `OD-*`/`OQ-*` item in the spec's own text, but a live deployment gate, confirmed directly this session.

## 5. `backend-calendar` (`SPEC-CALENDAR-001 / 0.3.1`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-CAL-01 | Availability-read-model ownership | Architecture/Human | **Resolved (`ADR-021`)** — and built/merged this session (`GET /calendar/availability`) | Architecture |
| OD-CAL-02 | Daily-exclusivity enforcement locus | Architecture/Human | Resolved (`ADR-021`) — Job Dispatch enforces | Architecture |
| OD-CAL-03 | `CalendarEntry`/`WorkerAssignment` ownership, no Calendar cross-write | Architecture/Human | Resolved (`ADR-021`) | Architecture |
| OD-CAL-04 | "Today"/timezone + current-vs-future boundary | Product/Architecture/Human | **RESOLVED (Option (a)) `GD-18`/`ADR-049`, 2026-07-28** — anchored to `Hotel.timezone` field (currently `Europe/Berlin` for all deployments), not a hardcoded constant | Product |
| OD-CAL-05 | Registry lifecycle drift (`active` vs. actual `stub`/partial) | Human (`SYNC-001`) | Open — reconcile on human confirmation | Architecture |
| OD-CAL-06 | Manager-notification contract for sick/vacation (transport unspecified) | Architecture/Human | **Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — Outbox-backed via `notificationService.enqueue()`, now the ratified resolution, not merely an implementation default | UX |
| OD-CAL-07 | Which manager roles may edit the calendar / cross-hotel scope | Product/Human | **RESOLVED (Option (a)) `GD-18`/`ADR-050`, 2026-07-28** — existing `ADR-030`/`ADR-023` authorization model adopted (HM hotel scope, RM hotel-group scope, Admin global); independent of `OD-EMP-12` | Product |
| OD-CAL-08 | Formal interface/event schema (= `GD-12`) | Architecture/Human | **Transport convention Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — `EVT-CAL-SickVacationMarked` is Outbox-backed (already true in shipped code, `calendar/service.ts:113-142`); the auto-cancel is a direct call (already true, `calendar/service.ts:87-106`). No code change; ratifies the existing implementation | Architecture |
| OD-CAL-09 | Owner unassigned (= `SYNC-001`) | Human | Open | Architecture |
| OD-CAL-10 | Current-stub semantic drift (`/operations` models reception data, not scheduling) | Product/Architecture/Human | **RESOLVED (three-part) `GD-18`/`ADR-051`, 2026-07-28** — stub removed; underlying state unassigned pending Requirements Intake; Calendar reserves a future `ADR-034`-pattern composite read model, not ownership | Architecture |
| OD-CAL-11 | Auto-cancel ripple to broadcasts (re-open/re-broadcast a freed slot?) | Product/Human | **RESOLVED (Option (b)) `GD-18`/`ADR-052`, 2026-07-28** — Calendar's responsibility ends at cancellation; re-broadcast policy deferred entirely to Job Dispatch/`GD-20`, not prohibited | Product |
| OD-CAL-12 | Authoritative-doc location discrepancy | Docs owner | Note — no behavioral impact | Architecture |

**Note:** `REQ-CAL-T01` (manager weekly-plan placement view) and the broader RM cross-hotel edit scope remain unbuilt — gated on `OD-CAL-07` (Product/Human) plus Job Dispatch's own schema realignment (`WorkerAssignment.application_id` still mandatory), independently confirmed this session.

## 6. `backend-attendance` (`SPEC-ATT-001 / 0.2.0`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OQ-01 | `getById` privileges only `{admin,manager}` while list/update also privilege `checker` — asymmetry | human/unassigned | Open (Low per independent security review, fail-safe direction) | Security |
| OQ-02 | Management attendance actions have NO hotel-scoping (cross-tenant) | human/unassigned | **Open — flagged BLOCKING (High) in the spec's own text; independently confirmed this session as fixed in current code via `isHotelInScope`/`ADR-024` scoping — spec not yet updated to reflect this** | Security |
| OQ-03 | EXPECTED row seeded by cross-owner write from `work-applications` | human/architecture | Open — flagged BLOCKING (architecture); no Decision Record exists | Architecture |
| OQ-04 | Does geofenced Close (check-out) also require the 100m check? | human | Open | Product |
| OQ-05 | Under the calendar model, does EXPECTED-seeding move out of `work-applications`? (= `GD-20`) | human/architecture | **Closed as MOOT 2026-07-28 — `GD-20` Sub-decision 6.** Mechanically resolved by `ADR-054`/`ADR-056` (direct `WorkerAssignment` creation, no `WorkApplication` intermediary in the target model): EXPECTED-seeding moves to whatever writes assignments directly. No independent decision required; implementation detail under `GD-20` Sub-decision 5 (Migration Strategy). | Architecture |
| OQ-06 | Fate of `expected_start`/`expected_end` denormalization under calendar-direct-assignment (= `GD-20`) | human/architecture | **Closed as MOOT 2026-07-28 — `GD-20` Sub-decision 6.** Mechanically resolved by `ADR-056`: sources from the assignment/calendar entity in the target model. No independent decision required; implementation detail under `GD-20` Sub-decision 5 (Migration Strategy). | Architecture |
| OQ-07 | Is ABSENT/NO_SHOW automated or manual? (= `GD-21`) | human | Open | Product |
| OQ-09 | Terminology collision: `is_verified` (manager) vs. target geofence PRESENCE verification | human/architecture | Open | Architecture |
| OQ-10 | No performance SLO for check-in/list/verify latency (= `GD-11`) | human/unassigned | **RESOLVED `GD-11`/`ADR-035`, 2026-07-28** — p95 targets set (≤150ms simple, ≤400ms scoped list); ownership assignment remains separately open | Architecture |
| OQ-11 | `AuditLog.old_values`/`new_values` never populated (thin `{assignment_id}` payload only) | human/unassigned | **Open** (= `GD-21`) | Security |
| OQ-12 | No transaction/optimistic-lock guard on `checkIn`/`update` (= `GD-10`) | human | **RESOLVED (governance level) `GD-10`/`ADR-036`, 2026-07-28** — must-fix + optimistic-concurrency standard set; concrete mechanism deferred to implementation | Architecture |
| SYNC-001 | Owner unassigned | human | Open — also blocks `OQ-03`'s Decision Record | Architecture |

**Note:** unlike the spec's own framing, `TREQ-GEO-001..007` (geofenced Start/Close gating) are independently confirmed **built and merged** this session (`GD-14`, integrated into `attendance/service.ts`) — the spec's Requirements table still reads "Target; unbuilt" in places, a documentation-drift issue distinct from the OQ items above.

## 7. `backend-quality` (`SPEC-QUAL-001 / 0.2.0`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OQ-01 | 1–5 `Rating` model rescale/replace/retire under 0–100 target | human/architecture | Resolved (`ADR-026`, 2026-07-22) | Architecture |
| OQ-02 | `WorkerOverallRating.average_score` scale/definition/recency-weighting under 0–100 target | human/architecture | **Open — cross-consumer, BREAKING** (= `GD-04`'s deferred sub-decision) | Architecture |
| OQ-03 | By-hotel leaderboard scope is a no-op (`checkHotelAccess` bypass) | human | Open — cross-tenant (Medium); routed to Risk Assessment with OQ-09 | Security |
| OQ-04 | Dual same-owner write mechanisms (DB trigger vs. app upsert) for `WorkerOverallRating` | human/architecture | **Resolved** — trigger dropped, app-owned `refreshWorkerOverallRating` is sole writer (independently confirmed this session, migration `20260727020000_drop_rating_overall_trigger`); spec not yet updated | Architecture |
| OQ-05 | `verified_by`/`rated_by` `onDelete: Restrict` vs. worker/hotel `Cascade` asymmetry | human/architecture | **Open** | Architecture |
| OQ-06 / SYNC-001 | Owner unassigned | human | Open | Architecture |
| OQ-07 | No performance budget for verification/rating/leaderboard latency; no compound index for by-hotel leaderboard (= `GD-11`) | human/unassigned | **RESOLVED (SLO baseline + pagination requirement) `GD-11`/`ADR-035`, 2026-07-28** — compound-index task remains open as a follow-on implementation item | Architecture |
| OQ-08 | Where recency-weighting/tiers/warnings/photo-retention/photo-retrieval-authorization live (= `GD-04`'s deferred sub-decision) | human/architecture | Open — explicitly deferred product sub-decision | Product (Security for photo-authz facet) |
| OQ-09 | Write-side cross-hotel authorization exposure (`createVerification`/`createRating` bind to assignment only) | human | Open — cross-tenant (Medium); routed to Risk Assessment with OQ-03 | Security |

## 8. `backend-geo` (`SPEC-GEO-001 / 0.1.2`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-GEO-001 | Hotel-coordinate storage location | human/architecture | Resolved (`GD-14`) — columns on `Hotel` | Architecture |
| OD-GEO-002 | Worker-coordinate/retention-job ownership | human/architecture | Resolved (`GD-14`) — `backend-geo` owns both | Architecture |
| OD-GEO-003 | Fail-open vs. fail-closed on distance-check failure | human/architecture | Resolved (`GD-14`) — fail-closed | Security |
| OD-GEO-004 | Who sets/edits hotel coordinates | human | Resolved (`GD-14`) — admin-only manual entry | Product |
| OD-GEO-005 | May admin/manager view raw worker coordinates? | human/architecture | Resolved (`GD-14`) — computed distance only, never raw coordinates | Security |
| OD-GEO-006 | Performance budgets/SLOs for distance-check latency, retention-sweep volume (= `GD-11`) | human | **RESOLVED `GD-11`/`ADR-035`, 2026-07-28** — p95 target set (≤150ms, simple single-entity class) | Architecture |
| OD-GEO-007 | Are geofence pass/fail events audit-logged? | human/architecture | Resolved (`GD-14`) — yes | Security |
| OD-GEO-008 | Citation correction (§37→§34) | human/documentation | Open — not a decision item | Architecture |
| OD-GEO-009 | GPS-spoofing countermeasure | human/architecture | **Open — deliberately deferred** by `GD-14`, disclosed and accepted MVP risk | Security |

**Correction applied:** unlike what one extraction pass initially reported (repeating a stale spec claim), `backend-geo` **is fully built** — all of `OD-GEO-001..005/007` are not just decided but implemented in merged code, independently verified multiple times this session (service/controller/routes/distance/retention-sweep-job all real, route-mounted at `/geo`). Only `OD-GEO-006` and `OD-GEO-009` remain genuinely open.

## 9. `backend-notifications` (`SPEC-NOTIF-001 / 0.3.0`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OQ-NOTIF-01 | "Push-only" vs. rework's "in-app + push" reconciliation | human/unassigned | Resolved (`ADR-029`) — both channels co-exist | Architecture |
| OQ-NOTIF-02 | `Notification`/`OutboxEvent` rows not assigned a GDPR retention tier (= `GD-09`) | human/unassigned | **RESOLVED (provisional) `GD-09`/`ADR-033`, 2026-07-28** — Tier 2. Tax-advisor sign-off tracked separately, non-blocking. | Security |
| OQ-NOTIF-03 | PIVOT §10's `FEATURE_*` convention claim — zero matches (as of authoring; now factually superseded, real flags exist for other modules) | human/unassigned | Open — factual mismatch | Architecture |
| OQ-NOTIF-04 | Fire-and-forget `.catch(() => {})` swallows all send failures | human/unassigned | Resolved (`ADR-029`) — durable Outbox + Worker lifecycle | Architecture |
| OQ-NOTIF-05 | No authorization check on "may producer X notify user Y" | human/unassigned | **Open** | Security |
| OQ-NOTIF-06 | Push-delivery implementation milestone unpinned | human/unassigned | Resolved (`ADR-029`) | Architecture |
| OQ-NOTIF-07 | `sendEmail`'s fate (dead code vs. repurposed) | human/unassigned | Resolved (`ADR-029`) — EMAIL is a first-class transport | Architecture |
| OQ-NOTIF-08 | Which module hosts the scheduled-job runtime for rework-escalation/contract-expiry timers | human/unassigned | Resolved (`ADR-029`) — dedicated Worker runtime | Architecture |
| OQ-NOTIF-09 | Roster-fan-out synchronous-network-call risk if push wired directly into request path | human/unassigned | Resolved (`ADR-029`) — async Outbox, no sync fan-out | Architecture |
| SYNC-001 | Owner unassigned | human | Open | Architecture |

## 10. `backend-documents` (`SPEC-DOCUMENTS-001 / 0.1.4`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-DOC-001 | No GDPR retention tier assigned to uploaded documents (= `GD-09`) | Product/Human | **RESOLVED (provisional) `GD-09`/`ADR-033`, 2026-07-28** — split: work-permit documents → Tier 3; general uploads → Tier 2. Tax-advisor sign-off tracked separately, non-blocking. | Security |
| OD-DOC-002 | Whether any uploaded document type carries special-category status | Product/Human | Open | Security |
| OD-DOC-003 | No expiry warning schedule/blocking-consequence/re-upload rule | Product/Human | Open | Product |
| OD-DOC-004 | No `state-worker-document` id registered in `DEPENDENCY_GRAPH.yaml` | Human/architecture | Open — proposal only | Architecture |
| OD-DOC-005 | Document category taxonomy + permission granularity | Product/Architecture | **Resolved** (permission-granularity half, `GD-16`); category-taxonomy half remains Open | Architecture |
| OD-DOC-006 | Whether `WorkerDocument` carries an explicit hotel association | Product/Architecture | Open | Architecture |
| OD-DOC-007 | No document-level RBAC/permission model | Product/Architecture | Resolved (`GD-16`) | Security |
| OD-DOC-008 | Version history, document relationships, archival mechanics | Product/Human | Open — no acceptance criteria fabricated | Product |
| OD-DOC-009 | No formal event contract between Onboarding and Documents (= `GD-12`) | Human/architecture | **Transport convention Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — would be a direct call or Outbox-backed per `ADR-032`'s criterion; still Open pending Onboarding's own `MODULE_SPEC.md` existing to confirm which | Architecture |
| OD-DOC-010 | No S3 failure/retry/backoff behavior specified | Architecture | Open | Architecture |
| OD-DOC-011 | Concurrency behavior unaddressed | Architecture/Human | Open | Architecture |
| OD-DOC-012 | Documents/Compliance subject-rights boundary reasoned one-sidedly | Human/architecture | Open — pending Compliance spec confirmation | Architecture |
| OD-DOC-013 | `FEATURE_*` convention claim mismatch (inherited) | Human/architecture | Open | Architecture |
| OD-DOC-014 | Owner unassigned (= `SYNC-001`) | Human | Open — non-freeze-blocking, G8 prerequisite | Architecture |
| OD-DOC-015 | `backend-hr`'s document-upload stub remediation sequencing | Human/architecture | Open | Architecture |
| OD-DOC-016 | Malware/content-scanning position | Architecture/Human | Open — deferred position, disclosed | Security |
| OD-DOC-017 | S3 server-side encryption at rest; bucket-exposure assumption | Architecture/Human | Open — assumption stated, not yet human-confirmed | Security |
| OD-DOC-018 | Retrieval mechanism (presigned URL vs. app-proxied stream) | Architecture | Open | Architecture |
| OD-DOC-019 | (a) indexing capacity for list/completeness queries; (b) Retention sweep scan cost against `WorkerDocument` (= `GD-09`/`GD-11`) | Architecture (a); Architecture+Retention jointly (b) | (a) **RESOLVED `GD-11`/`ADR-035`, 2026-07-28** — p95 target set (≤400ms, scoped list class); compound-index requirement is the task to meet it. (b) Open, unaffected. | Architecture |

**Note:** independently confirmed this session — `storage.ts`'s `getStorageClient()` genuinely falls back to a disclosed no-op stub whenever `S3_BUCKET` is unset (uploaded bytes silently discarded while the DB row still succeeds). This is a real, code-level manifestation of `OD-DOC-010`, not merely a paper gap.

## 11. `backend-analytics` (`SPEC-ANALYTICS-001 / 0.2.1`, **FROZEN**)

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OQ-ANALYTICS-01 | No RBAC/tenant-boundary check on leaderboard routes | — (code fix) | Resolved (Sprint 0 S0-5) | Security |
| OQ-ANALYTICS-02 | Mobile-worker `/stats` 403 + type-shape mismatch | human | Resolved (`GD-06`) | Product |
| OQ-ANALYTICS-03 | "Rooms completed per worker" contradicted the no-room-layer decision | human/product | Resolved (`ADR-028`) | Product |
| OQ-ANALYTICS-04 | Status-enum re-validation needed once Job Dispatch pivots (= `GD-20`); internal PIVOT §9.1/§9.3 inconsistency | human/architecture | **Closed as MOOT 2026-07-28 — `GD-20` Sub-decision 6.** Status-enum reads mechanically re-point to the target schema ratified by `ADR-054`/`ADR-056`; the PIVOT §9.1/§9.3 inconsistency is logged separately as `SIR-GLOB-025` (documentation defect, not a decision gap). No independent decision required. | Architecture |
| OQ-ANALYTICS-05 | PIVOT §4.11 dangling "Section 7" cross-reference | human/documentation | Open — non-blocking | Architecture |
| OQ-ANALYTICS-06 / SYNC-001 | Owner unassigned | human | Open | Architecture |
| OQ-ANALYTICS-07 | Sick/vacation counts depend on unbuilt `CalendarEntry`/target Calendar model (= `GD-18`) | human/architecture | `GD-18`'s governance decisions are now all resolved (`ADR-049`–`ADR-052`), but the manager weekly-plan placement view (`REQ-CAL-T01`) this metric depends on remains unbuilt — still Open, now blocked on implementation, not on governance ambiguity | Architecture |
| OQ-ANALYTICS-08 | Rating/warning counts — no warning-tier state exists yet (= `GD-04`'s deferred sub-decision) | human/architecture | Open | Product |
| OQ-ANALYTICS-09 | "Active workers/day" derivation undecided (assignment- vs. attendance- vs. calendar-based) | human/architecture | **Open** — explicit design-choice gap, not resolvable by implementation alone | Architecture |
| OQ-ANALYTICS-10 | No performance budget; unpaginated leaderboard; unfiltered full-history aggregation when `hotelId` omitted (= `GD-11`) | human/unassigned | **RESOLVED (SLO baseline + fan-out cap) `GD-11`/`ADR-035`, 2026-07-28** — unfiltered/unwindowed-aggregation risk remains open as a follow-on implementation task | Architecture |
| OQ-ANALYTICS-11 | No ADR governs analytics' direct cross-module Prisma reads across 6+ domains (= `GD-13`) | human/architecture (Lead Architect, platform-wide) | **RESOLVED `GD-13`/`ADR-034`, 2026-07-28** — direct read-only reads ratified, subject to a three-point allow-list; read-model escalation remains a named, unmet trigger | Architecture |
| OQ-ANALYTICS-12 | Residual cross-tenant visibility after S0-5 fix (downstream of `SIR-AUTH-003`) | human/security | Open — non-blocking | Security |

**Note:** independently confirmed this session — `getLeaderboard`/`getDashboardStats` already accept `hotelGroupId`, and it is resolved server-side from the actor's own JWT scope (`resolveScopedFilter` in `analytics/controller.ts`), not client-supplied. This is not a frontend gap as one might assume from the raw code signature; no action needed here.

## 12. `backend-hr` (`SPEC-HR-001 / 0.2.1`, **REVIEW — NOT FROZEN**)

**Why REVIEW, not FROZEN (quoted):** "architecture re-review confirms `BLOCKED` (module-boundary Decision Record required, human/architecture authority only); consistency and security re-reviews returned `PASS_WITH_ACTIONS`."

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-HR-01a | Two active specs (HR and Onboarding) assign identical CRR §9 behavior (contract generation, manager-confirmation) to two different modules | Human/Architecture (ADR required) | **Open — BLOCKING**, freeze-blocking module-boundary dispute | Architecture |
| OD-HR-01b | Resolving OD-HR-01a requires a formal ADR/Decision-Index entry, not resolvable inside either spec | Human/Architecture | Open — a decision-record requirement itself | Architecture |
| OD-HR-02 | Current-state code types/routes don't match confirmed target model | Architecture/Human | **RESOLVED (Option (a)) `GD-15`/`ADR-039`, 2026-07-28** — target types redesigned, zero payroll computation. `OD-HR-02b` (Personalfragebogen data-source ambiguity) not resolved, remains open. | Architecture |
| OD-HR-02b | Personalfragebogen data-source ambiguity for contract pre-fill | Architecture/Human | Open | Architecture |
| OD-HR-03 | Contract lapse/non-renewal/offboarding workflow undefined | Product/Human | **RESOLVED (Option (a)) `GD-15`/`ADR-040`, 2026-07-28** — manager-only lapse trigger; downstream `OD-EMP-04` now also resolved (`ADR-045`), end-to-end mechanism fully settled | Product |
| OD-HR-04 | No formal domain-event/interface contract or transport (= `GD-12`) | Architecture/Human | **Transport convention Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — every `EVT-HR-*` row still needs per-spec reclassification at this spec's next revision, itself still gated on `GD-15` before HR can build at all | Architecture |
| OD-HR-05 | No frontend-web/mobile-checker consumer edge recorded | Architecture/Human | Open — client-integration gap | UX |
| OD-HR-06 | `uploadDocument` controller hardcodes `Buffer.alloc(0)` (no real file body wired) | Architecture/Human | Open — bundled with `RULE-HR-13` | Architecture |
| OD-HR-07 | Mechanism for "both parties wish to continue" (contract extension trigger) unspecified | Product/Human | **RESOLVED (Option (a)) `GD-15`/`ADR-040`, 2026-07-28** — manager-only confirmation | Product |
| OD-HR-08 | Concurrency behavior for contract confirmation unaddressed | Architecture/Human | Open | Architecture |
| OD-HR-09 | No escalation/reminder behavior for an unfulfilled payslip request | Product/Human | **RESOLVED (Option (a)) `GD-15`/`ADR-041`, 2026-07-28** — 3-business-day auto-escalation via Outbox | Product |
| OD-HR-10 | Current RBAC excludes WORKER/CHECKER from `hr:*`, conflicting with CRR §23's "worker can REQUEST a payslip" | Architecture/Human | **RESOLVED (Option (a)) `GD-15`/`ADR-042`, 2026-07-28** — `hr:payslip:request` + `hr:contract:read-own`, both self-scoped | Security |
| OD-HR-11 | No retention tier assigned to contract document/PDF/scan (= `GD-09`) | Product/Human | **RESOLVED (provisional) `GD-09`/`ADR-033`, 2026-07-28** — Tier 3. Tax-advisor sign-off tracked separately, non-blocking. | Security |
| OD-HR-12 | Owner unassigned (= `SYNC-001`) | Human | Open | Architecture |
| OD-HR-13 | Hotel Manager could read/write contract/payroll data for workers outside their hotel | Architecture/Human | **RESOLVED — write-path (`ADR-030` PR-1) + list-route (Option (a)) `GD-15`/`ADR-043`, 2026-07-28**, both via `checkWorkerScope()`; every not-yet-built target-state interface's own scoping remains an implementation detail, not reopened here | Security |
| OD-HR-14 | Malware/content scanning of uploaded contract scans | Architecture/Human | **RESOLVED `GD-15`/`ADR-044`, 2026-07-28** — synchronous scan-hook, reject on detection; ships with `OD-HR-06` fix | Security |
| OD-HR-15 | HR cannot be assessed safe to implement while Auth's Critical (`OQ-AUTH-05`) remains open | Human (explicit Risk Assessment required) | Open — sequencing dependency on Auth | Security |
| OD-HR-16 | `SPEC-EMP-001`'s own transition table omits the contract-signed precondition | SPEC-EMP-001 author/reviewers | Open — flagged for EMP's next revision, not HR's own defect | Architecture |

**Note:** `OD-HR-15`'s premise (Auth's Critical remaining open) is now stale — `OQ-AUTH-05` was independently confirmed fixed in code this session, though the Auth spec itself has not been updated. This sequencing blocker may be softer than the frozen text implies, but resolving it is still a documentation-workflow action, not something this register decides.

## 13. `backend-compliance` (`SPEC-COMPLIANCE-001 / 0.1.0`, **REVIEW — NOT FROZEN**)

**Why REVIEW, not FROZEN (quoted):** "G2 Specification Freeze is reserved human authority (Constitution §12) and has not been sought or granted here."

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-COMPLIANCE-001 | Whether Compliance writes, reads, or neither owns `state-audit-log` | — | Resolved (`ADR-016`) | Architecture |
| OD-COMPLIANCE-002 | Shape of any Compliance-owned governance-artifact/report entity | Human/Product | Open | Product |
| OD-COMPLIANCE-003 | Mechanism for enumerating "fields with a documented legal basis" | Human/Architecture | Open | Architecture |
| OD-COMPLIANCE-004 | `SPEC-AUTH-001` does not document exposing an `AuditLog`-read interface to Compliance | Human/Architecture | **Open** — blocks `IF-COMPLIANCE-GetAuditTrail`; requires a `SPEC-AUTH-001` documentation-workflow action | Architecture |
| OD-COMPLIANCE-005 | Partial-failure/retry/idempotency for subject-rights bundle assembly | Human/Architecture | Open | Architecture |
| OD-COMPLIANCE-006 | No RBAC scope defined for "Admin/DPO-equivalent" governance-reporting caller | Human/Architecture | Open — security gap, non-blocking pre-implementation | Security |
| OD-COMPLIANCE-007 | Event contract/transport for `EVT-COMPLIANCE-*` undefined (= `GD-12`) | Human/Architecture | **Transport convention Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — non-blocking, no Compliance code exists yet to apply it to | Architecture |
| OD-COMPLIANCE-008 | Whether Compliance's own actions produce `AuditLog` entries | Human/Architecture | Open | Security |
| OD-COMPLIANCE-009 | No formal interface between Onboarding and Compliance | Human/Architecture | Open — future bilateral Decision Record | Architecture |
| OD-COMPLIANCE-010 | Subject-rights fulfilment: synchronous vs. async/queued | Human/Architecture | Open | Architecture |
| OD-COMPLIANCE-011 | Concurrency for overlapping subject-rights/report requests | Human/Architecture | Open — non-blocking pre-implementation | Architecture |
| OD-COMPLIANCE-012 | No retention tier for any future Compliance-owned state (= `GD-09`) | Human/Product | Open — non-blocking | Security |

**Note:** this is the module most directly relevant if the "compliance AuditLog reader" slice is ever revisited — `OD-COMPLIANCE-004` is the specific, named blocker: the interface Compliance is specified to consume has never been exposed on Auth's side. Confirmed directly earlier this session.

## 14. `backend-consent` (`SPEC-CONSENT-001 / 0.1.1`, **REVIEW — NOT FROZEN**)

**Why REVIEW, not FROZEN (quoted):** "This is the first authored version of this specification."

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-CONSENT-001 | Withdrawal/renewal trigger mechanism unspecified | Product/Human | **RESOLVED `GD-17`/`ADR-037`, 2026-07-28** — "Renewed" persisted for the general verb only, daily gate stays computed | Product |
| OD-CONSENT-002 | Whether chatbot engagement requires consent, and whether decline blocks onboarding | Product/Human | **RESOLVED (Option (b)) `GD-17`/`ADR-037`, 2026-07-28** — consent required, decline routes to manual onboarding path, does not block | Product |
| OD-CONSENT-003 | No retention tier named for consent records (= `GD-09`) | Product/Human | **RESOLVED (provisional) `GD-09`/`ADR-033`, 2026-07-28** — Tier 2. Tax-advisor sign-off tracked separately, non-blocking. | Security |
| OD-CONSENT-004 | Behavior on stale/superseded notice-version submission | Architecture/Human | **RESOLVED `GD-17`/`ADR-037`, 2026-07-28** — rejected, re-fetch required | Architecture |
| OD-CONSENT-005 | No formal domain-event/interface contract (= `GD-12`) | Architecture/Human | **Transport convention Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — non-blocking, no Consent code exists yet to apply it to. `GD-17`/`ADR-037` (2026-07-28) has since resolved the module's own product/architecture scope; `backend-consent` build itself remains a separate prioritization question. | Architecture |
| OD-CONSENT-006 | Fail-open vs. fail-closed when consent module is unavailable | Architecture/Human | **RESOLVED (fail-closed) `GD-17`/`ADR-037`, 2026-07-28** | Architecture |
| OD-CONSENT-007 | Whether "Requested"/"Lapsed" are persisted states or transient concepts | Architecture/Human | **RESOLVED `GD-17`/`ADR-037`, 2026-07-28** — both computed/transient, not persisted rows | Architecture |
| OD-CONSENT-008 | Concurrency behavior unaddressed | Architecture/Human | Open | Architecture |
| OD-CONSENT-009 | Fallback when notice content unavailable in worker's preferred language | Product/Human | **RESOLVED `GD-17`/`ADR-037`, 2026-07-28** — platform-default-language fallback; specific default deferred to implementation | UX |
| OD-CONSENT-010 | Owner unassigned (= `SYNC-001`) | Human | Open | Architecture |
| OD-CONSENT-011 | Whether a `consent:*` RBAC permission is needed | Architecture/Human | **RESOLVED `GD-17`/`ADR-037`, 2026-07-28** — no new permission, rides Compliance's existing governance-read path (mirrors `ADR-016`) | Security |

## 15. `backend-retention` (`SPEC-RETENTION-001 / 0.2.0`, **REVIEW — NOT FROZEN**)

**Why REVIEW, not FROZEN (quoted):** "freeze remains blocked on reserved human authority items only (`OD-RETENTION-01` tax sign-off, `OD-RETENTION-14`/`SIR-RETENTION-005` owner assignment, and RBAC/cross-module-delete-authorization decisions `OD-RETENTION-05`/`OD-RETENTION-10`)."

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-RETENTION-01 | Tax-advisor sign-off on retention-tier mapping (= `GD-09`, external dependency) | human/client's tax advisor | **Reclassified `GD-09`/`ADR-033`, 2026-07-28** — the mapping decision itself is resolved (provisional); this item now blocks only legal certification, non-blocking for engineering. Still open, still not resolvable by this specification, still tracked to closure. | Product |
| OD-RETENTION-02 | No catch-up/backfill behavior if the daily sweep fails to run | human/architecture | Open | Architecture |
| OD-RETENTION-03 | Behavior on duplicate category registration with a conflicting tier | human/architecture | Open | Architecture |
| OD-RETENTION-04 | Per-record tagging vs. category-level sweep logic | human/architecture | Open | Architecture |
| OD-RETENTION-05 | No RBAC scope for "Admin" caller class on `IF-RETENTION-GetDeletionAuditLog` | human/architecture | Open — no implementation may grant Admin access until resolved | Security |
| OD-RETENTION-06 | `EVT-RETENTION-*` event contract/transport undefined (= `GD-12`) | human/architecture | **Transport convention Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — non-blocking, no Retention code exists yet to apply it to | Architecture |
| OD-RETENTION-07 | Concurrency behavior unaddressed | human/architecture | Open | Architecture |
| OD-RETENTION-08 | Retention's own state (deletion-audit log) has no assigned tier | human/product | Open | Security |
| OD-RETENTION-09 | No partial-failure/retry/idempotency for a consumer's delete execution failing mid-sweep | human/architecture | Open | Architecture |
| OD-RETENTION-10 | Retention's own internal authorization to call each consumer's delete mechanism | human/architecture | Open | Security |
| OD-RETENTION-11 | Sweep query design risks unbounded/full-table rescan | human/architecture | Open — required implementation-time design constraint | Architecture |
| OD-RETENTION-12 | No mechanism for surfacing sweep run completion/failure | human/architecture | Open | Architecture |
| OD-RETENTION-13 | `FEATURE_*` convention claim mismatch (inherited) | human/architecture | Open | Architecture |
| OD-RETENTION-14 | Owner unassigned; no `backend-retention` module id registered (= `SYNC-001`) | human | **Open — BLOCKED**, freeze requires named owner/approver | Architecture |
| OD-RETENTION-15 | Multi-module daily-sweep fan-out workload/budget unacknowledged (= `GD-11`) | human/architecture | Open — must be resolved before implementation assumes sequential synchronous calls. **Note `GD-11`/`ADR-035`, 2026-07-28:** this item was not in GD-11's own "Merges findings" list and is not resolved by that decision; `ADR-035`'s 15-parallel-query fan-out cap applies to aggregator *reads* (dashboard/leaderboard), not this sweep's cross-module *delete-execution* fan-out, a distinct workload shape — remains genuinely open. | Architecture |

**Also inherited (per-module tier-assignment gaps, each tracked in its own owning module's section, not duplicated here):** `SIR-NOTIF-002`, `SIR-ATT-009`, `SIR-ATT-011`, `SIR-AUTH-011`, `OD-HR-11`, `OD-DOC-001`, `OD-DOC-012`, `SIR-DOC-019(b)`, `OD-CHAT-019`, `OD-CONSENT-003`, `OD-GEO-002`. **Updated `GD-09`/`ADR-033`, 2026-07-28:** `SIR-AUTH-011`/`OQ-AUTH-11`, `OD-HR-11`, `OD-DOC-001`, `OD-CHAT-019`, `OD-CONSENT-003` are now individually RESOLVED (provisional) at their own owning modules, per the rows above; `OD-GEO-002` was separately resolved by `GD-14` (2026-07-27).

## 16. `backend-chatbot` (`SPEC-CHATBOT-001 / 0.1.3`, **REVIEW — NOT FROZEN**)

**Why REVIEW, not FROZEN (quoted):** "all five G4 dimensions now complete with zero Critical/High findings remaining anywhere... **G2 human approval remains outstanding; NOT FROZEN** (Constitution §12 — author cannot self-approve; G2 is reserved human authority; `OD-CHAT-005`, `OD-CHAT-006`, `OD-CHAT-013` remain the standing G2-blocking items)."

| ID | Description | Authority | Status | Category |
|---|---|---|---|---|
| OD-CHAT-001 | No confirmed conversation/AI-session entity in any authority doc | Product/Human | Open | Product |
| OD-CHAT-002 | Tool-execution scope (conversational-only vs. tool-executing agent) | Product/Architecture | **RESOLVED `GD-19`/`ADR-053`, 2026-07-28** — orchestration-layer/tool-registry architecture ratified, risk-tiered confirmation policy; no specific tool approved, architecture only | Architecture |
| OD-CHAT-003 | File-byte handling/storage-write mechanism | Architecture/Human | Open | Architecture |
| OD-CHAT-004 | Worker-facing routing/proxy question | Architecture | Resolved (v0.1.2 correction, two-part), subject to G2 ratification | Architecture |
| OD-CHAT-005 | Conversation-level RBAC (read-scope + write-path/initiation-scope) | Product/Architecture | **Open — blocks G2 Specification Freeze** | Security |
| OD-CHAT-006 | Prompt-injection-resistance guardrail | Architecture/Human | **Open — blocks G2 Specification Freeze**, "the single most central abuse vector" | Security |
| OD-CHAT-007 | Accepted-upload-type-enforcement double-attribution tension | Architecture | Open | Architecture |
| OD-CHAT-008 | Conversation persistence & consent (shared with Consent's `OD-CONSENT-002`) | Product/Human | **Consent portion RESOLVED `GD-17`/`ADR-037`, 2026-07-28** (via Consent's own `OD-CONSENT-002`); **transcript-persistence portion remains OPEN**, not decided by `ADR-037` | Product |
| OD-CHAT-009 | Malware/content-scanning for chatbot-mediated uploads | Architecture/Human | Open — contingent on `OD-CHAT-003` | Security |
| OD-CHAT-010 | Rate-limiting/abuse-prevention for the cost-incurring conversation endpoint | Architecture/Human | Open — non-blocking for G2 given fallback backstop | Security |
| OD-CHAT-011 | Cumulative-token-spend tracking + `JOB-CHATBOT-BudgetGuard` execution model | Architecture | Open | Architecture |
| OD-CHAT-012 | Claude API outage vs. budget-exhaustion fallback distinction | Architecture | Open | Architecture |
| OD-CHAT-013 | Owner unassigned (= `SYNC-001`) | Human | **Open — BLOCKED**, blocks G2 regardless of any other item's resolution | Architecture |
| OD-CHAT-014 | No `state-domain` id registered | Human/architecture | Open — proposal only | Architecture |
| OD-CHAT-015 | No failure-mode/retry/backoff for Claude API unavailability | Architecture | Open | Architecture |
| OD-CHAT-016 | Concurrency for simultaneous messages/turns | Architecture/Human | Open | Architecture |
| OD-CHAT-017 | `FEATURE_*` convention claim mismatch (inherited) | Human/architecture | Open | Architecture |
| OD-CHAT-018 | Encryption-at-rest for persisted conversation content | Architecture/Human | Open — contingent on `OD-CHAT-008` | Security |
| OD-CHAT-019 | Retention-tier assignment for conversation-adjacent records (= `GD-09`) | Product/Human | **RESOLVED (provisional, metadata/counters only) `GD-09`/`ADR-033`, 2026-07-28** — Tier 2; transcripts contingent on `OD-CHAT-008`. Tax-advisor sign-off tracked separately, non-blocking. | Security |
| OD-CHAT-020 | Indexing/capacity note for `ChatbotConversation` queries | Architecture | Open — forward-looking | Architecture |
| OD-CHAT-021 | Cache-staleness/invalidation for cached required-document list | Architecture | Open | Architecture |
| OD-CHAT-022 | Timeout/backpressure policy for synchronous Claude API call | Architecture | Open — required before launch | Architecture |
| OD-CHAT-023 | No repo-wide convention distinguishes in-process calls from HTTP contracts (= `GD-12`) | Architecture/Lead Architect (platform-wide) | **Resolved (`GD-12`/`ADR-032`, 2026-07-28)** — the convention now exists: direct call (synchronous) vs. Outbox (async/durable), no third option | Architecture |

---

# Part 2 — Consolidated Cross-Reference: the Genuinely-Still-Open `GD-*` Decisions

Per `GOVERNANCE_DECISIONS_REQUIRED.md`'s own canonical index (re-verified directly this session): `GD-01, 02, 03, 04, 05, 06, 07, 12, 14, 16` are **DECIDED** (several independently confirmed built in code this session, not merely decided on paper). **`GD-12` was decided 2026-07-28 via the Governance Resolution workflow** (`ADR-032`) — see Part 1's per-module rows for the item-level status. The following **8** remain genuinely open, each aggregating the module-level items listed:

| GD | Decision | Priority | Aggregates (per `GOVERNANCE_DECISIONS_REQUIRED.md`'s own "Merges findings" lines) |
|---|---|---|---|
| ~~**GD-08**~~ | ~~MFA design & data model~~ | — | **DECIDED 2026-07-28 → `ADR-038`** (Option (c): MFA explicitly deferred to a post-MVP hardening milestone; no mechanism selected). Struck through per append-only convention, not removed. Resolves `OQ-AUTH-01` (MFA portion), `OQ-AUTH-02`. |
| ~~**GD-09**~~ | ~~GDPR retention-tier assignment & Retention module~~ | — | **DECIDED (mapping half) 2026-07-28 → `ADR-033`.** Struck through per append-only convention (mirrors `GD-12`'s own precedent), not removed. `OD-RETENTION-05/10/11/14/15` remain open — none are tier-mapping questions, all still gate `backend-retention`'s own build. `OD-RETENTION-01` (tax-advisor sign-off) remains open, reclassified non-blocking. |
| ~~**GD-10**~~ | ~~Platform concurrency / optimistic-locking pattern~~ | — | **DECIDED 2026-07-28 → `ADR-036`.** Struck through per append-only convention, not removed. Resolves `OQ-ATT-12`. **`OD-CRM-13` and `OQ-QUAL-04` were verified already resolved by `ADR-030` and `GD-04`+PR #237/#238 respectively, before this decision — neither reopened.** |
| ~~**GD-11**~~ | ~~Performance SLO & workload baseline~~ | — | **DECIDED 2026-07-28 → `ADR-035`.** Struck through per append-only convention, not removed. Resolves `SIR-JOBD-004`, `OQ-ATT-10`, `OQ-QUAL-07`, `OQ-ANALYTICS-10`, `OD-EMP-16`, `OD-GEO-006`, `OD-DOC-019(a)`. **`OD-CRM-13` was found mislabeled here — it is a `GD-10` item, already resolved via `ADR-030`, untouched by `ADR-035`.** |
| ~~**GD-12**~~ | ~~Platform event-bus / inter-module transport~~ | — | **DECIDED 2026-07-28 → `ADR-032`.** Struck through per append-only convention (mirrors `GOVERNANCE_DECISIONS_REQUIRED.md`'s own GD-01 precedent), not removed. |
| ~~**GD-13**~~ | ~~Cross-module state-read boundary ADR~~ | — | **DECIDED 2026-07-28 → `ADR-034`.** Struck through per append-only convention (mirrors `GD-12`/`GD-09`'s own precedent), not removed. Resolves `OQ-ANALYTICS-11`. |
| ~~**GD-15**~~ | ~~HR & Employee-Management module build scope~~ | — | **DECIDED 2026-07-28 → `ADR-039` through `ADR-048` (10 sub-decisions).** Struck through per append-only convention, not removed. Resolves `OD-HR-02` (`ADR-039`), `OD-HR-03`/`07` (`ADR-040`), `OD-HR-09` (`ADR-041`), `OD-HR-10` (`ADR-042`), `OD-HR-13` (`ADR-043`), `OD-HR-14` (`ADR-044`), `OD-EMP-04` (`ADR-045`), `OD-EMP-06` (`ADR-046`), `OD-EMP-08` (`ADR-047`), `OD-EMP-13`/`14` (`ADR-048`). A standing architecture blocker (`OD-HR-01a`/`OD-HR-01b`, HR-vs-Onboarding module boundary) was found already resolved by `ADR-012` (2026-07-12) — a documentation-synchronization gap, corrected during this audit, not a new decision. `OD-EMP-16` was separately found already resolved by `GD-11`/`ADR-035` — its own spec row corrected to match. `OD-HR-02b` (Personalfragebogen data-source ambiguity) and `GD-03`'s org-chart half remain genuinely open, not resolved by `GD-15`. |
| ~~**GD-17**~~ | ~~Consent module — lifecycle & fail-safety~~ | — | **DECIDED 2026-07-28 → `ADR-037`.** Struck through per append-only convention, not removed. Resolves `OD-CONSENT-001/002/004/006/007/009/011`. Directly informs Onboarding's `OPQ-3` and Chatbot's `OD-CHAT-008` (consent portion only — transcript-persistence portion remains its own open question). |
| ~~**GD-18**~~ | ~~Calendar module scope (M2)~~ | — | **DECIDED 2026-07-28 → `ADR-049` (timezone), `ADR-050` (RM edit scope), `ADR-051` (`/operations` stub disposition + composite-read-model pattern), `ADR-052` (auto-cancel/re-broadcast boundary).** Struck through per append-only convention, not removed. Resolves `OD-CAL-04/07/10/11` (`OD-CAL-06/08` already resolved at the transport level by `GD-12`). `ADR-051` was informed by real-world weekly-planner evidence mid-decision and surfaced two likely-missing requirements (arrivals count, staffing-demand target) for a future Requirements Intake pass — not resolved here, since confirming new requirements is outside the Governance Resolution workflow's scope. The manager weekly-plan placement view (`REQ-CAL-T01`) and today-only availability read-model (`REQ-CAL-T06`) remain unbuilt — governance ambiguity is now fully resolved, but implementation has not occurred. |
| ⏸ **GD-19** | Chatbot module scope & LLM safety | P3 | **DEFERRED — POST-MVP, 2026-07-28** (explicit commissioning-human decision, not resolved). Sub-decision 1 (`OD-CHAT-002`) Decided → `ADR-053` (retained in force). Remainder — `OD-CHAT-001`, `003-022` minus already-resolved/partial items (`004`, `008` consent half, `019` provisional, `023`) — preserved, not discarded. Full checkpoint: `docs/implementation/GD-19_CHATBOT_CHECKPOINT.md`. Confirmed isolated from `GD-20`/`21`/`22` — no dependency either direction. |
| ~~**GD-20**~~ | ~~Job-Dispatch two-tier calendar+broadcast pivot~~ | — | **DECIDED 2026-07-28 → `ADR-054` through `ADR-058`** (5 sub-decisions). Struck through per append-only convention, not removed. Sub-decision 1 → `ADR-054` (two-tier target architecture ratified; marketplace is current, not legacy). Sub-decision 2 → `ADR-055` (broadcast manager-initiated only; no implicit JobRequest reopen). Sub-decision 3 → `ADR-056` (direct WorkerAssignment creation, target model only). Sub-decision 4 → `ADR-057` (Platform Worker + optimistic concurrency; no BullMQ/Redis, evidence-based per ADR-035). Sub-decision 5 → `ADR-058` (existing Phase 1/Phase 2 plan ratified unmodified; architecturally eligible on GD-03, scheduling deferred to implementation planning). Sub-decision 6 (`OQ-05`/`OQ-06` [attendance], `OQ-ANALYTICS-04`) closed as MOOT — mechanically resolved by `ADR-054`/`ADR-056`, no genuine ambiguity remained; one documentation defect (WorkRequest/JobRequest inconsistency in MODULE_SPEC.md) logged to SIR register, not a decision gap. Resolves `MIG-GAP-01..12` (`SIR-JOBD-006`). |
| **GD-21** | Attendance operational automation | P3 | `OQ-ATT-07`, `OQ-01` (checker-GET), `OQ-11` (audit old/new values) |
| **GD-22** | Hotel-Group billing model | P3 (recommend defer) | `OD-CRM-10` |
| ~~**GD-23**~~ | ~~Platform ADR ratification (Constitution §20)~~ | — | **DECIDED 2026-07-28 → Option (a): ratified as-is.** Struck through per append-only convention, not removed. `ADR-019`/`ADR-020` flipped Proposed → Accepted; `VERSION.yaml` corrected in three places. `SIR-GLOB-003` marked RESOLVED (its last open element, ADR-001..009 ratification, was verified already closed 2026-07-15, stale in this row's own prior text). |

**Note:** the original document lists 22 as "remaining open" as of 2026-07-24 (23 total minus GD-01 through GD-23). This session independently confirmed GD-02, 03, 04, 05, 06, 07, 14, 16 are now also decided (and built); **GD-12, GD-09 (mapping half), GD-13, GD-11, GD-10, GD-17, GD-23, GD-08, GD-15 (ten sub-decisions), and GD-18 (four sub-decisions) were all decided via the Governance Resolution workflow on 2026-07-28** (`ADR-032`, `ADR-033`, `ADR-034`, `ADR-035`, `ADR-036`, `ADR-037`, `ADR-019`/`ADR-020` ratification, `ADR-038`, `ADR-039`–`ADR-048`, `ADR-049`–`ADR-052`); **`GD-19`'s first sub-decision was also decided the same day** (`ADR-053`), after which the commissioning human explicitly **deferred the remainder of `GD-19` to post-MVP** — a product decision, not an unresolved item awaiting attention. Counting `GD-19` as deferred rather than open, this leaves **3** genuinely open, actively-pursuable decisions across the full GD-01..23 numbering: `GD-20` (Job-Dispatch pivot), `GD-21` (Attendance automation), `GD-22` (Hotel-Group billing). `GD-15`'s own resolution left two items genuinely unresolved, not part of `GD-15`'s scope: `OD-HR-02b` (Personalfragebogen data-source ambiguity — `ADR-039` explicitly did not touch it) and `GD-03`'s org-chart/reporting-model half (`OD-EMP-12`, `OQ-AUTH-08`'s data-model half — a standalone item, not folded into `GD-15`). `GD-18`'s resolution similarly surfaced, but did not resolve, two likely-missing requirements (arrivals count, staffing-demand target — CRR §19-adjacent but not confirmed) flagged for a future Requirements Intake pass; that same real-world planner evidence prompted `OD-CAL-11`'s explicit deferral to `GD-20` for re-broadcast policy. `backend-retention`'s own remaining open items (`OD-RETENTION-05/10/11/14/15`) are module-level `OD-*` rows, not a standalone `GD-*`, and are not part of this count. `GD-04`'s tiers/warnings/photo sub-decision remains open as a named exception carved out of that otherwise-decided item — tracked above under quality's `OQ-02/08`, not under a standalone GD row.

---

# Part 3 — Known Inconsistencies in the Source Specs (flagged, not resolved)

1. **`OQ-USERS-04`/`SYNC-005`** — `SPEC-USERS-001`'s own Risks table marks this `Open`; the same document's Document Control section separately claims it was "cleared" by `ADR-017`. Both statements are preserved above rather than one being silently chosen.
2. **Geo module status** — `SPEC-GEO-001`'s Risks/Interfaces text (authored around the freeze date) still describes the module in stub/not-yet-built language in places, while the module is now fully built and merged. This register's geo section reflects the built reality, corrected explicitly (see "Corrections applied").
3. **Attendance's four security defects (`OQ-AUTH-04/05/06/15`-equivalent, i.e. `OQ-02` here and the auth-side originals)** — independently confirmed fixed in current code this session, but the frozen specs' own Risks tables still describe them as open/blocking. A documentation-drift pattern, not a live vulnerability, but worth a dedicated documentation-workflow pass before this register is treated as the last word on any individual item's true current state.
4. **`OD-HR-15`'s premise** (HR's launch sequencing tied to Auth's Critical, `OQ-AUTH-05`) may be softer than stated, since that Critical is independently confirmed fixed — but re-sequencing HR is still a human/architecture call, not something this register decides.
5. **Every module's own "`FEATURE_*` convention" claim** is internally inconsistent across the corpus: several specs (auth, users, crm, notifications, documents, retention, chatbot, consent) each independently assert "no `FEATURE_*` flag exists" as of their own authoring — true at the time — while `backend/src/config/feature-flags.ts`/`env.ts` **now** define three real flags (`FEATURE_EMPLOYMENT_RECORD`, `FEATURE_RM_ROLE`, `FEATURE_GD02_MATRIX`), none of which is named inside any of those specs' own text. This is a real, systemic case where a design pattern was later adopted but no frozen spec was amended to reflect it — worth a documentation-workflow pass across all eight affected specs, not a one-off fix.

---

*This document is inventory only. It resolves nothing. Every item above remains exactly as open, and under exactly the authority named, as its own source specification states — pending a human decision, one item at a time, per the Governance Finalization roadmap's Step 3.*
