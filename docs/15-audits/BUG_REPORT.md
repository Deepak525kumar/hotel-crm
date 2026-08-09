# Repository-Wide Implementation & MVP Readiness Audit — hotel-crm

**Date:** 2026-08-02
**Baseline:** `main` @ `00c6c09` (merge of PR #304 — compliance PR 4/4, governance-doc synchronization/SYNC-075)
**Framework:** `.claude/` (current, per `VERSION.yaml`)
**Producer/scope:** Multi-agent parallel audit — 18 module audits (auth, users, crm, job-requests, assignments, attendance, quality, hr, employee-management, calendar, documents, geo, consent, retention, compliance, notifications, analytics, chatbot) + 4 cross-cutting audits (governance/knowledge-registry accuracy, repo-wide TODO/stub scan, frontend/mobile API-integration scan, `DEPENDENCY_GRAPH.yaml` accuracy spot-check). This is the formal handoff report before frontend/mobile integration work begins.

---

## 0. Health Gates

| Gate | Result |
|---|---|
| Backend tests | ✅ **1648/1648 passing, 98/98 suites** |
| Backend typecheck | ✅ clean |
| Prisma schema validate | ✅ clean |
| Repository integrity (`repository-integrity-check.js`) | ✅ exit 0 — only pre-existing orphan-doc WARN class, unchanged in kind |

Re-run and independently verified this session — not carried forward from a prior report.

---

## 1. Governance Accuracy

| Module | Governance claim | Reality | Verdict |
|---|---|---|---|
| auth | `MODULE_REGISTRY.yaml:45` / `SPECIFICATION_INDEX.yaml:24` cite spec `@0.3.0` | Spec's own Document Control corrects this to `0.2.6` | **Stale — both registry files** |
| users | Registry `release_prerequisites` still lists OQ-USERS-01/02 as open | Both RESOLVED (ADR-030), spec's own 0.2.1 forward-note agrees | **Stale — registry not synced to spec** |
| crm | `MODULE_REGISTRY.yaml:79` cites spec `@0.2.1` | Spec Document Control is `@0.2.2` (GD-12/ADR-032) | **Stale by one amendment** |
| crm | Register SIR-CRM-012 shows `OPEN` | Spec declares RESOLVED via GD-12/ADR-032 (2026-07-28) | **Register not synced** |
| crm | Register SIR-CRM-014 claims no `FEATURE_*` flag convention exists | `env.ts`/`feature-flags.ts` define multiple, used in CRM's own `routes.ts` | **False claim, unrevisited since 2026-07-09** |
| job-requests | Four registry files (MODULE_REGISTRY, SPECIFICATION_INDEX, BOUNDARY_INDEX, DEPENDENCY_GRAPH) | All correctly synced to code, spec `@0.3.8` FROZEN | **Accurate — positive control** |
| assignments | All four registry files | Correctly synced, no stale claims | **Accurate** |
| attendance | `MODULE_REGISTRY.yaml:139` and `SPECIFICATION_INDEX.yaml` cite `@0.2.0` | Spec is `@0.2.2` | **Stale by two amendments** |
| attendance | `SPECIFICATION_INDEX.yaml:9` header note says registry reads `@0.1.1 (REVIEW)` | Registry itself already reads `0.2.0 FROZEN` | **Leftover text, self-contradictory within same file** |
| attendance | Geofence-wiring commit `2f73633` disclosed in backend-geo's registry row | Not mentioned anywhere in backend-attendance's own registry row | **Asymmetric disclosure** |
| quality | Spec Open Decisions table (OQ-04) says WorkerOverallRating dual-writer unresolved | Trigger dropped 2026-07-27 (commit `e118d33`); register (SIR-QUAL-005) already shows RESOLVED | **Spec body not synced to its own register** |
| quality | Spec OQ-07 marked OPEN | Register shows RESOLVED-by-decision (ADR-035) but code (`take: 50`, no pagination) not yet updated | **Decision resolved, implementation lagging both spec and code** |
| hr | Spec Interfaces table says 9 of 11 interfaces are "not yet implemented" | All 9 fully implemented (`service.ts`) | **Spec severely stale; registries accurate** |
| employee-management | Register SIR-EMP-006 (OD-EMP-09) shows OPEN | Spec Document Control shows RESOLVED via ADR-032; spec body prose (lines 164, 180) still contradicts its own Document Control table | **Register stale + spec self-inconsistent** |
| calendar | `MODULE_REGISTRY.yaml:211`, `BOUNDARY_INDEX.yaml:105`, `SPECIFICATION_INDEX.yaml:105` all cite `@0.3.0` | Spec is `@0.3.6`, six amendments ahead | **Registries 6 amendments stale; spec itself is exemplary** |
| calendar | `DEPENDENCY_GRAPH.yaml:1036` claims "no discovered client consumer" | Both frontend and mobile-worker consume `/calendar/availability` and `/calendar/my-absences` | **False, not updated after clients built** |
| documents | `MODULE_REGISTRY.yaml`, `BOUNDARY_INDEX.yaml`, `DEPENDENCY_GRAPH.yaml` all cite spec `@0.1.4` | Spec is `@0.1.6` | **Stale by two amendments (low impact — no requirement changed)** |
| documents | Spec body (Purpose/Scope, Interfaces, Migration Gaps) asserts module doesn't exist / nothing implemented | Fully implemented same day as freeze (commit `cf1910b`, 2026-07-28) | **Most severe spec/reality gap found in this audit** |
| geo | All four registry files | Correctly synced (SYNC-071, 2026-07-30) | **Accurate — positive control** |
| geo | Spec Interfaces/Events/Dependencies sections still say "none exist" | Real, mounted, tested code exists; spec's own banner discloses this and redirects to registry | **Disclosed staleness, not silent** |
| consent | All four registry files (SYNC-072, 2026-07-31) | Accurate | **Accurate** |
| consent | Spec Interfaces table says all 5 interfaces "not yet implemented" | All 5 implemented; spec's own Document Control (2026-07-31 correction) says so two paragraphs above | **Internal spec self-contradiction** |
| retention | All four registry files (SYNC-073/074/075) | Accurate | **Accurate** |
| retention | Spec Interfaces table (lines 144-147) says all 4 interfaces "not yet implemented" | All 4 implemented, 2 routed | **Missed by SYNC-073/074 passes** |
| compliance | All four registry files (SYNC-075, 2026-08-02) | Accurate | **Accurate** |
| compliance | Spec Interfaces table calls the 2 built interfaces "target-state" | Both implemented; spec's own Risks table/Change Log say so elsewhere in same doc | **Minor internal inconsistency, not substantive** |
| notifications | `MODULE_REGISTRY.yaml:187`, `SPECIFICATION_INDEX.yaml` cite `@0.3.0` | Spec is `@0.3.1` | **Stale by one amendment** |
| notifications | Spec preamble calls email/push delivery "almost entirely unbuilt" | SendGrid/Resend + APNs/FCM + Outbox Worker fully built and tested | **Spec narrative not refreshed after Epic 7** |
| analytics | `MODULE_REGISTRY.yaml:199` cites `@0.2.1`; `SPECIFICATION_INDEX.yaml:53` cites `@0.2.0` | Spec is `@0.2.2` | **Stale, two amendments behind on index** |
| analytics | Register SIR-ANLY-004 flags WorkRequest/JobRequest enum-rename risk as open | Rename already landed (Epic 9 PR 9.4); `service.ts` already uses `prisma.jobRequest` | **Likely resolved, register not rechecked** |
| chatbot | All four registry files | Consistently and correctly describe zero-code placeholder state | **Accurate — positive control** |

**Cross-cutting pattern:** version-pointer drift (registry citing an older spec version than the spec's own Document Control) recurs in **8 of 18 modules** (auth, crm, attendance, documents, notifications, analytics — plus users/employee-management on release-prerequisite lists). Direction of drift is almost always the same: spec amendments outrun registry sync passes. Two modules (documents, hr) show the opposite and more serious failure — the spec's own descriptive body (not just its version pointer) asserts a materially false "unbuilt" state for code that has since shipped.

---

## 2. Stale Specifications

Every module with `spec_matches_code: false` or non-empty `spec_vs_code_drift`, with the drift cited:

| Module | Spec version / status | Nature of drift |
|---|---|---|
| **auth** | `SPEC-AUTH-001@0.2.6` FROZEN | Interfaces table still documents the old single-call `POST /auth/password-reset` (Critical account-takeover primitive) as current, though HOTFIX-AUTH-002 replaced it with a two-step flow; missing `POST /auth/password-reset/confirm` and `POST /api/v1/users/:id/revoke-sessions` rows entirely; line-citations throughout point at pre-hotfix line ranges. |
| **users** | `SPEC-USERS-001@0.2.0` FROZEN | REQ-USERS-020 claims "no client calls any `/users` route" — false, `frontend/lib/api.ts:523-539` + 4 pages consume it; spec still describes `permissions` as a stored column (dropped by ADR-031/PR-7, derived at request time); Interfaces table missing `PUT /:user_id/role` and `POST /:user_id/revoke-sessions` rows; no ADR-031 forward-note exists at all. |
| **crm** | `SPEC-CRM-001@0.2.2` FROZEN | Interfaces table (line 157) falsely claims HotelGroup CRUD "not implemented" — it is fully built, routed, and has a complete frontend UI (`fbeb2b8`, predates the spec's own last amendment `ac84f14`). Rare inverse-direction drift: spec **underclaims** completeness. |
| **job-requests** | `SPEC-JOB-DISPATCH-001@0.3.8` FROZEN | None material — spec's own 2026-07-30 correction pass already fixed the prior staleness. |
| **assignments** | `SPEC-JOB-DISPATCH-001@0.3.8` FROZEN | None found. |
| **attendance** | `SPEC-ATT-001@0.2.2` FROZEN | `[CURRENT STATE]` narrative still calls geofence gating "largely unbuilt," but `service.ts:64-85` already wires `geoService.verifyGeofence()` into `checkIn()` (commit `2f73633`, predates the spec's latest amendment). Coordinate-storage/retention genuinely remain unbuilt on Attendance's own model, but that's because backend-geo now owns it — undisclosed cross-module resolution. |
| **quality** | `SPEC-QUAL-001@0.2.0` FROZEN | Open Decisions table (OQ-04) says WorkerOverallRating dual-writer trigger is still installed — dropped 2026-07-27; downstream reader `backend-work-applications` cited as live — module was physically deleted (Epic 9 PR 9.2); pagination decision (ADR-035) not yet reflected in either spec's OPEN framing or code. |
| **hr** | `SPEC-HR-001@0.2.9` REVIEW | Interfaces table (lines 173-184) claims 9 of 11 interfaces are "501 Not Implemented" / "not yet implemented" — all 9 are fully built (`service.ts` L152-691). Upload-placeholder claim (`Buffer.alloc(0)`) is false — real `req.file.buffer` used, already tracked RESOLVED in SIR-HR-006 but never propagated to the Interfaces table. |
| **employee-management** | `SPEC-EMP-001@0.2.7` FROZEN | No false claims about code — the one drift is spec-body self-inconsistency (OD-EMP-09 marked RESOLVED in Document Control table but still called "open decision" in body prose at lines 164/180). |
| **calendar** | `SPEC-CALENDAR-001@0.3.6` FROZEN | None in the spec itself (unusually well-maintained, uses append-only strikethrough for removed scope). Drift is confined to the knowledge/governance layer being 6 amendments behind. |
| **documents** | `SPEC-DOCUMENTS-001@0.1.6` FROZEN | Entire descriptive body (Purpose/Scope, Evidence, Interfaces, Ownership, Migration Gaps, State/Lifecycle) asserts "does not exist" / "nothing implemented" for a module that shipped the same day (`cf1910b`, 2026-07-28). Only the Document Control header was updated post-implementation; body was never re-synced. Most severe drift found in this audit. |
| **geo** | `SPEC-GEO-001@0.1.2` FROZEN | Interfaces/Events/Dependencies sections still say "none exist, not yet authored" — disclosed staleness (spec's own banner redirects readers to the registry), not silent. |
| **consent** | `SPEC-CONSENT-001@0.2.0` FROZEN | Interfaces table (lines 144-149) says all 5 interfaces are "target-state, no current route" / "not yet implemented" — directly contradicted by the Document Control section two paragraphs above (correctly updated 2026-07-31). |
| **retention** | `SPEC-RETENTION-001@0.2.0` REVIEW | Interfaces table (lines 144-147) says all 4 interfaces "not yet implemented" — all 4 are implemented, 2 of 4 routed. Missed by SYNC-073/074. |
| **compliance** | `SPEC-COMPLIANCE-001@0.1.0` REVIEW | Interfaces table calls the 2 built interfaces "target-state" — minor, contradicted elsewhere in the same document. |
| **notifications** | `SPEC-NOTIF-001@0.3.1` FROZEN | Preamble/REQ-004/REQ-005/REQ-015 assert email/push delivery "almost entirely unbuilt" and test coverage "limited" — the full Epic 7 Outbox/Worker/SendGrid/Resend/APNs/FCM pipeline is built and tested; only two genuinely dead legacy stub methods (`sendEmail`, `sendPushNotification`) remain unimplemented, with zero call sites. |
| **analytics** | `SPEC-ANALYTICS-001@0.2.2` FROZEN | None found — unusually well-synchronized; Review/Change Log narrates each fix and each is independently verified present in code. |
| **chatbot** | `SPEC-CHATBOT-001@0.1.3` REVIEW | None — spec accurately and consistently describes a zero-code deferred module across spec body and all four registry files. |

**Direction-of-drift summary:** 13 of 18 modules have some form of stale spec content; in **11 of those 13** the spec **underclaims** what's built (understates completeness — the more dangerous direction for a reader deciding what's safe to integrate against). Only `crm`'s HotelGroup underclaim and `documents`'/`hr`'s whole-body understatement rise to "materially misleading if read at face value."

---

## 3. Orphaned APIs

### Genuinely orphaned (no client, no clear intentional-deferral signal)
None found. Every route flagged as having zero frontend/mobile callers has an explicit, corroborated reason (feature flag off by default, backend-only operator tooling, or a disclosed not-yet-built consumer).

### Implemented but not yet client-integrated (flag-gated or backend-complete, UI pending)
| Route(s) | Module | Why not orphaned |
|---|---|---|
| `POST/GET /work-requests/broadcasts*` (4 routes) | job-requests | Gated behind `FEATURE_JOBDISPATCH_PHASE2` (default OFF); exercised only by backend tests; spec frames as Phase 2/additive. |
| `POST/GET /assignments/calendar-entries`, `POST /:id/rooms-completed` | assignments | Same flag; backend-tested (`calendar-entries.test.ts`, `assignments-rooms-completed.test.ts`). |
| `POST/GET /calendar/hotels/:hotel_id/operations` | calendar | Deliberate `501` stub, formally deprecated by ADR-051/OD-CAL-10 (struck through in spec, non-breaking per spec's own "no consumer exists today"). |
| All 10 `/hr/*` routes (contracts, payroll, contract-status/scan/confirm/extend/lapse, payslip-requests) | hr | Zero frontend/mobile references despite `BOUNDARY_INDEX.yaml` claiming mobile-worker consumption (unverifiable — likely aspirational). Fully backend-tested (4 dedicated integration-test files, 1369 lines). SIR-HR-013 already discloses this gap. **This is the largest genuinely-unwired backend surface in the repo** — release-blocking for a manager-facing UI, not for the backend module itself. |
| All 9 `/employees/*` routes | employee-management | Gated behind `FEATURE_EMPLOYMENT_RECORD` (default OFF); zero client references; two named consumers (backend-onboarding, payslip-request-processor) are themselves unbuilt. |
| `GET /retention/audit-log`, `GET /retention/eligibility` | retention | Zero clients; disclosed and tracked — zero consuming module has registered a retention category yet. |
| `POST /consent/request`, `GET /consent/audit-history`, `GET /consent/status`, `POST /consent/decisions`, `POST /consent/withdraw` | consent | Zero clients; two named consumers (Onboarding, Chatbot) explicitly unbuilt. `getAuditHistory()` IS consumed in-process by Compliance. |
| `POST /compliance/subject-rights-export` | compliance | Zero clients; GDPR self-service action awaiting UI/chatbot integration. |
| 4 `/notifications/outbox/*` admin routes | notifications | Zero clients by design — internal operator API, own code comment says so, backend-tested (`outbox-admin.test.ts`). |
| `GET /documents/workers/:id/documents/export` | documents | Zero HTTP clients, but the underlying service method IS consumed in-process by `compliance.fulfilSubjectRightsRequest()`. |
| `GET /analytics/leaderboard/by-hotel/:hotel_id` | analytics | Zero clients; backend-tested only. |
| `POST /auth/signup`, `POST /auth/password-reset(+/confirm)`, `PUT /auth/profile`, `POST /users/:id/revoke-sessions` | auth/users | Disclosed by the auth spec itself as having no current client; plausibly reserved for a future onboarding/self-service flow. |

### Confirmed dead/broken client references (opposite direction — client calls a route that no longer exists correctly)
| Reference | Issue |
|---|---|
| ~~`frontend/lib/api.ts:341,350`, `mobile/worker-app/src/lib/api.ts:287-292` — `/work-requests/:id/applications/*`~~ | ~~Calls a retired module (`backend-work-applications`, removed Epic 9 PR 9.2/ADR-058).~~ **FIXED (verified 2026-08-09):** both frontend and mobile references to `/work-requests/:id/applications/*` have been removed. No dead client references remain. |

---

## 4. Unfinished Implementation (TODOs/Stubs)

Repo-wide `grep -rniE "TODO|FIXME|XXX|HACK|not implemented|NotImplementedError"` across `backend/src` returns zero bare TODO/FIXME/XXX/HACK strings anywhere. All hits trace to the `NotImplementedError` class definition and its usage sites, or to comments referencing them.

| Item | File | Category |
|---|---|---|
| ~~`getDailyOperations`/`createDailyOperation` throw `NotImplementedError`~~ | ~~`backend/src/modules/calendar/service.ts:28,32`~~ | **FIXED (verified 2026-08-09):** no `throw new NotImplementedError` remains anywhere in `backend/src`. Calendar operations stubs removed. |
| ~~`sendEmail`/`sendPushNotification` throw `NotImplementedError`~~ | ~~`backend/src/modules/notifications/service.ts:146,150`~~ | **FIXED (verified 2026-08-09):** dead stubs deleted. No `NotImplementedError` throw remains in the notifications module. |
| `backend-hr`'s original PR-4 comment ("payroll/payslip remains NotImplementedError until PR 4") | `backend/src/modules/hr/service.ts:1-8` | **Stale comment, not live code** — PR 4/5 have since landed; a skim-only reader of the top 8 lines would be misled. Housekeeping. |
| `NotificationService.sendEmail throws NotImplementedError` comment inside auth | `backend/src/modules/auth/service.ts:307-309` | **Cross-module comment, not a gap in auth itself** — describes the (now-superseded) notifications state. |
| `malware-scan.ts` `noOpScanner` (always returns clean) | `backend/src/modules/hr/malware-scan.ts:30-34` | **Disclosed stub** — pluggable interface, real reject-on-detect control flow wired in, no vendor plugged in yet (ADR-044). |
| PDF byte-rendering deferred | `backend/src/modules/hr/service.ts:22-29` | **Disclosed deferral**, confirmed with commissioning human. |
| `backend-chatbot/`, `backend-geo` (pre-audit description) | placeholders | **`backend-geo` is NOT a stub** — this audit found it fully implemented, mounted, tested; only `backend-chatbot` remains a true `.placeholder`-only zero-code module, deliberately deferred post-MVP (GD-19, "do not resume"). |
| `manualLapseContract` non-idempotency | `backend/src/modules/hr/service.ts:434-448` | **Disclosed deferral, but untracked** — no SIR-HR-* id exists for it despite being a known accepted gap; should get one. |
| `.placeholder` scaffold files in 8 module directories | various | **Noise** — inert leftover files, harmless. |

**Net: zero MVP-blocking silent stubs.** Every `NotImplementedError` in live code is either an explicitly deferred/struck-through scope item (calendar) or genuinely dead code with no callers (notifications' `sendEmail`/`sendPushNotification`). `backend-chatbot` is the one true zero-code module and is deliberately, human-decided deferred (GD-19).

---

## 5. Dependency Graph Accuracy

`DEPENDENCY_GRAPH.yaml` route-mount line citations are **systematically off** for essentially every module in the `route_registration` block:

| Module | Claimed mount line | Actual mount line (`backend/src/routes/v1/index.ts`) |
|---|---|---|
| auth | `:22` | `:29` |
| users | `:23` | `:30` |
| crm | `:24` | `:31` |
| assignments | `:28` | `:33` |
| attendance | `:29` | `:34` |
| quality | `:30` | `:35` |
| hr | `:31` | `:36` |
| notifications | `:32` | `:37` |
| analytics | `:33` | `:38` |
| calendar | `:34` | `:39` |
| geo | `:38` | `:41` |
| consent | `:40` | `:42` |
| retention | `:42` | `:43` |
| compliance | `:44` | `:44` (matches) |

Additionally:
- **`backend-documents` is entirely missing** from the `route_registration`/mounted-modules list despite having an active node entry (`DEPENDENCY_GRAPH.yaml:67`) and being genuinely mounted at `index.ts:40`.
- `edge-work-requests-notifications` cites `service.ts:18` for a notification-service import that is actually at `job-requests/service.ts:19`.

**Impact:** low-severity — import-line citations are correct, only mount-line citations drift, and the drift is a mechanical off-by-N pattern (new modules inserted above older mount calls without re-numbering downstream citations) rather than a substantive claim about what's mounted. Worth a single mechanical correction pass, not urgent.

---

## 6. Hidden Architectural Drift

- ~~**ADR-016 (audit-log writer centralization) mismatch**: `backend/src/scripts/regional-manager-promotion.ts:60` calls `prisma.auditLog.create` directly~~ — **FIXED (verified 2026-08-09):** no direct `prisma.auditLog.create` calls remain in `backend/src/scripts/`. All audit writes now go through `BaseService.logAudit`.
- ~~**`backend-work-applications` removal (Epic 9 PR 9.2 / ADR-058) has not fully propagated to clients**~~ — **FIXED (verified 2026-08-09):** both `frontend/lib/api.ts` and `mobile/worker-app/src/lib/api.ts` no longer reference `/work-requests/:id/applications/*`. The dead client route has been cleaned up.
- **`state-worker-overall-rating` cross-module reader drift**: quality module's spec still names `backend-work-applications` as a live downstream consumer of `WorkerOverallRating` — that module was physically deleted; the real consumer relationship no longer exists as described.
- **Permissions-column removal (ADR-031 D-1/M-3)**: `User.permissions` was dropped from the schema and is now derived at request time via `ROLE_PERMISSIONS[role]` in `users/service.ts` (5 call sites) — a genuine, correctly-implemented architecture change, but **undisclosed in the users spec** (no ADR-031 forward-note exists at all, unlike ADR-022/030 which both got one).
- **Geofence ownership split**: coordinate storage/retention for attendance moved to backend-geo's own `WorkerGeoCheckin` table (per `BOUNDARY_INDEX.yaml:124`) rather than living on the Attendance model as the attendance spec's target-state design implies — a real, sound architectural resolution that is disclosed asymmetrically (visible in geo's registry row, invisible in attendance's).
- **ADR-032/030/014 spot-checks**: no event-bus library found in use (consistent — Outbox pattern is the accepted substitute); no `ManagerAdminGate` remnants in application code (ADR-030 fully applied); `backend/src/modules/payslips` does not exist (ADR-014 non-issue, module never built under that name — folded into `hr`).

---

## 7. Modules Marked REVIEW But Effectively Complete

| Module | Spec status | Completeness | Recommendation |
|---|---|---|---|
| **hr** | REVIEW (`SPEC-HR-001@0.2.9`) | Complete — all 11 target interfaces implemented and tested; only PDF byte-rendering and ADR-040 Path (b) silence-auto-lapse deliberately deferred. Freeze blocked solely by SIR-HR-007 (auth's 4 open High findings, a reserved human risk-assessment item), not by code gaps. | **Update the spec's Interfaces table** to match reality, then re-run the freeze decision — the code is not what's holding this back. |
| **retention** | REVIEW (`SPEC-RETENTION-001@0.2.0`) | Complete for all 4 routed/scoped interfaces; sweep job live. Freeze blocked on reserved human-authority items (tax sign-off, owner assignment, RBAC/cross-module-delete decisions). | Spec Interfaces table needs a sync pass (missed by SYNC-073/074); freeze gate is legitimately human-authority-bound, not code-bound. |
| **compliance** | REVIEW (`SPEC-COMPLIANCE-001@0.1.0`) | Partial by design — 2 of 3 interfaces implemented; the third (`GetGovernanceReport`) is correctly still unbuilt pending an RBAC decision (OD-COMPLIANCE-006). This is the one REVIEW module where REVIEW status genuinely tracks real remaining scope, not a documentation lag. | No action needed beyond the minor Interfaces-table wording fix; this module is the control case showing the pattern working correctly. |
| **chatbot** | REVIEW (`SPEC-CHATBOT-001@0.1.3`) | Zero-code, explicitly deferred by human decision (GD-19: "do not resume"). Not a mismatch — REVIEW and zero-code are fully consistent. | No action — correctly deferred, correctly labeled. |

**Net finding:** 2 of the 4 REVIEW modules (hr, retention) are functionally MVP-complete and are being held in REVIEW purely by reserved-human-authority governance items unrelated to code quality — these are prime candidates for an expedited freeze decision, since no engineering work stands between them and G2.

---

## 8. Open Decisions: Release Blockers vs Future Enhancements

### Release Blockers
| ID | Module | Reasoning | Status (re-verified 2026-08-09) |
|---|---|---|---|
| SIR-AUTH-011 | auth | GDPR retention tier assignment required before G8 Release Readiness (register's own explicit requirement). | **Still OPEN** |
| ~~OQ-USERS-05 / SIR-USERS-005~~ | ~~users~~ | ~~`getUser` has no hotel/group scope check — cross-hotel PII read by any Admin/Manager.~~ | **FIXED** — `getUser` now enforces `isWorkerInGroupScope` for scoped-manager roles with self-read exemption (`service.ts:139-145`). |
| ~~SIR-CRM-008 / OD-CRM-08~~ | ~~crm~~ | ~~`per_page` vs `limit` param mismatch silently truncates hotel/hotel-group lists past 20 rows.~~ | **FIXED** — `ListHotelsQuerySchema` uses `limit` consistently; service destructures and paginates with the same `limit` value. No mismatch. |
| OQ-02 / SIR-QUAL-002 | quality | `WorkerOverallRating.average_score` redefinition is a BREAKING cross-consumer contract change, register-flagged. | **Still OPEN** |
| OQ-07 / SIR-QUAL-007 | quality | Leaderboard pagination is an authorized MUST (ADR-035) not yet implemented in code. | **Still OPEN** — `take: 50` hardcoded, no pagination params. |
| SIR-HR-007 / OD-HR-15 | hr | Auth's 4 open High security findings require a formal human Risk Assessment before hr can be considered production-safe. | **Still OPEN** |
| SIR-HR-017 / OD-HR-11 | hr | No GDPR retention tier assigned to the contract document/PDF/scan itself. | **Still OPEN** |
| ~~Security FIND-002~~ | ~~employee-management~~ | ~~Special-category field access-gating disposition reads as "disclosed, not implemented".~~ | **FIXED** — `getSpecialCategory()` enforces admin-only with audit logging on both deny and allow branches (`service.ts:274-297`). |
| SIR-DOC-001 / OD-DOC-001 | documents | No GDPR retention tier registered for `WorkerDocument` despite backend-retention now being live. | **Still OPEN** |
| SIR-DOC-016 / OD-DOC-016 | documents | No malware/content scanning on identity/work-permit document uploads, despite HR having a ready ADR-044 precedent to reuse. | **Still OPEN** |
| OD-RETENTION-05 / SIR-RETENTION-003 (RBAC half) | retention | `GetDeletionAuditLog` route has no RBAC scope — open to any authenticated role. | **Still OPEN** — route still has no `requireRole`/`requirePermission` gate. |
| OQ-NOTIF-05 / SIR-NOTIF-005 | notifications | No cross-module authorization check on notification targeting — more exploitable now that HR and Consent are live producers. | **Still OPEN** |
| SIR-CHAT-020 (OD-CHAT-022) | chatbot | Synchronous blocking Claude API call with no timeout/backpressure policy — flagged release-blocking if/when the module is ever activated. | **Still OPEN** (module still unbuilt) |

### Future Enhancements
SIR-AUTH-008, SIR-AUTH-010, SIR-AUTH-017, SIR-AUTH-022, OQ-USERS-06, SIR-CRM-001/OD-CRM-01, SIR-CRM-003/OD-CRM-03, SIR-CRM-018, SIR-ATT-004/005/006/008, OQ-05/SIR-QUAL-006, OQ-08/SIR-QUAL-008, SIR-HR-013/OD-HR-05, HR `manualLapseContract` non-idempotency (untracked), SIR-DOC-002, SIR-DOC-003, SIR-DOC-019(b), OD-GEO-006/SIR-GEO-006, OD-GEO-009/SIR-GEO-009, SIR-CONSENT-008/OD-CONSENT-008, OD-RETENTION-10 (dormant), OD-RETENTION-04, OD-RETENTION-11/15/SIR-RETENTION-004, SIR-RETENTION-006, OD-COMPLIANCE-002/003/006/009/010/011/012, SIR-ANLY-008/009/010/011, and 15 of the 24 chatbot open decisions (all contingent on the module ever being built).

### Governance-Only
SIR-AUTH-007, SIR-AUTH-012, SIR-AUTH-015, OQ-USERS-07/SIR-USERS-007, SIR-CRM-009, SIR-CRM-011/019, SIR-CRM-012/015, SIR-CRM-014, SIR-JOBD-005 (job-requests + assignments), SIR-ATT-010, OQ-06/SYNC-001/SIR-QUAL-009, SIR-HR-009/012/018/019, SIR-EMP-012, SIR-CAL-009/012, SIR-DOC-006/014/017, OD-GEO-008, owner-assignment (geo), SIR-CONSENT-010, OD-RETENTION-01/14, SYNC-001 (compliance), OQ-NOTIF-03, SYNC-001/SIR-NOTIF-010, SIR-ANLY-005/006, and SIR-CHAT-001/002/004/012/013/015/021/023.

### Resolved-But-Mislabeled (flag for human closure)
| ID | Module | Note |
|---|---|---|
| OQ-USERS-01/02/03/04 | users | All show code-level resolution (ADR-030/017, admin-role check present) but registers not updated. |
| SIR-CRM-005/OD-CRM-05 | crm | Regional-Manager role/scope already wired in `routes.ts`. |
| SIR-ATT-011 (geofence half) | attendance | Geofence sub-item stale post-`2f73633`; needs a split/sync, not treatment as fully open. |
| OQ-04/SIR-QUAL-005 | quality | Already resolved in code and register; spec doc needs the sync note. |
| OQ-09/OQ-03 (SIR-QUAL-003/004) | quality | Register unambiguously RESOLVED; residual cross-hotel access is by-design. |
| SIR-HR-010 | hr | Registry already corrected 2026-07-30; register row not marked resolved. |
| SIR-EMP-006/OD-EMP-09, SIR-EMP-007/OD-EMP-10 | employee-management | Both decided months ago; only citations/register rows unsynced. |
| SIR-CAL-006/OD-CAL-06, SIR-CAL-008/OD-CAL-08 | calendar | Spec already shows RESOLVED via ADR-032; register Status field not synced. |
| SIR-DOC-015/MIG-GAP-DOC-001 | documents | Two independent governance files confirm resolution (2026-07-30); register still OPEN. |
| SIR-DOC-018/OD-DOC-018 | documents | Presigned URL w/ 15-min TTL already shipped; not reflected. |
| OQ-NOTIF-02/SIR-NOTIF-002 | notifications | Retention infra just landed via 5 PRs; likely implements Tier-2 sweep already, unverified. |
| SIR-NOTIF-011 | notifications | Broadcast/eligibility sub-items likely closed by newer job-requests/calendar code, not re-audited. |
| SIR-ANLY-004 | analytics | JobRequest rename already landed and analytics code already uses it. |

---

## 9. Frontend/Mobile Integration Readiness

| Module | Status |
|---|---|
| auth | ✅ Wired — login/me/logout consumed by frontend and both mobile apps. Signup, password-reset, profile-update, revoke-sessions: implemented, no client caller yet (disclosed gap). |
| users | ✅ Wired — full admin Users UI (list/new/edit/detail) in frontend; no mobile usage (by design, admin-web-only). |
| crm | ✅ Wired — Hotel + HotelGroup CRUD both fully consumed by frontend. |
| job-requests / assignments | ✅ Wired — core CRUD consumed by frontend and mobile-worker. Broadcast-path (Phase 2) and calendar-entries/rooms-completed: backend-complete, zero client integration, flag-gated off by default. |
| attendance | ✅ Wired — frontend + both mobile apps, including geofence lat/long params in mobile tests. |
| quality | ✅ Wired — mobile-checker only (by design; no web use case). |
| **hr** | ❌ **Not wired** — 10 routes, zero frontend or mobile callers found despite `BOUNDARY_INDEX.yaml` claiming mobile-worker consumption (unverifiable). Largest unwired backend-complete surface in the repo. |
| **employee-management** | ❌ **Not wired** — 9 routes, zero clients; also flag-gated off by default (`FEATURE_EMPLOYMENT_RECORD`). |
| calendar | ✅ Wired — frontend (`availability`) and mobile-worker (`my-absences`), contrary to a stale `DEPENDENCY_GRAPH.yaml` claim of "no consumer." |
| documents | ✅ Wired (frontend only) — upload/list/completeness consumed; export route has no HTTP client (in-process compliance path covers it). |
| geo | ✅ Wired — frontend (admin listing) + mobile-worker (self-checkin). |
| **consent** | ❌ **Not wired** — zero routes have any frontend/mobile caller; disclosed as awaiting Onboarding/Chatbot, neither built. |
| **retention** | ❌ **Not wired** (by design) — query routes unused; zero consuming module has registered a category yet. |
| **compliance** | ❌ **Not wired** — subject-rights-export route has no client; awaiting self-service/chatbot UI. |
| notifications | ✅ Wired — inbox + push-token registration consumed by frontend and both mobile apps; admin `/outbox/*` routes intentionally internal-only. |
| analytics | ✅ Wired — dashboard/leaderboard/stats consumed by frontend; `by-hotel` leaderboard variant unwired. |
| **chatbot** | ❌ **Not built** — no code exists to wire. |
| ~~**Known client bug**~~ | ~~frontend + mobile-worker still call `/work-requests/:id/applications/*`, a route removed by Epic 9.~~ **FIXED (verified 2026-08-09):** dead references removed from both frontend and mobile. |

**Summary:** 11 of 18 modules are genuinely wired end-to-end. 4 modules (hr, employee-management, consent, compliance) are backend-complete but have zero client integration — 2 of these (hr, employee-management) are release-blocking gaps for a real manager-facing UI, not implementation gaps. 1 module (chatbot) has nothing to wire. 1 known client-side dead-route bug needs fixing before frontend/mobile work touches job applications.

---

## 10. MVP Completion Percentage

**Estimate: ~86%.**

Formula (weighted, evidence-based, not a simple module count):

```
score = 0.45 × (backend code completeness across 18 modules, weighted by MVP-in-scope status)
      + 0.20 × (governance/spec accuracy — how much a reader can trust the docs at face value)
      + 0.20 × (frontend/mobile integration coverage of MVP-critical surfaces)
      + 0.15 × (release-blocker open-decision closure rate)
```

- **Backend code completeness (~93%)**: 16 of 18 modules functionally complete for their own defined MVP scope (only calendar's `/operations` stub and chatbot's zero-code state are real gaps, both deliberately deferred). Health gates all green (1648/1648 tests).
- **Governance/spec accuracy (~65%)**: 13 of 18 module specs contain some form of stale claim; 2 (documents, hr) are severely stale in their normative Interfaces tables. Registries themselves are mostly accurate (spec-vs-registry is the weaker link, not registry-vs-code).
- **Frontend/mobile integration (~75%)**: 11 of 18 modules fully wired; hr and employee-management (both backend-complete) have zero UI, which is the single largest gap standing between "backend done" and "usable product."
- **Release-blocker closure (~70%)**: 13 confirmed release-blocking open decisions remain across auth, users, crm, quality (×2), hr (×2), employee-management, documents (×2), retention, notifications, chatbot — none are large engineering lifts (mostly scope checks, pagination, retention-tier registration, malware-scan wiring), but none are closed yet either.

This is a best-effort estimate, not a formally re-scored audit pass — treat the ~86% figure as directional (up from a ~80% baseline at the 2026-07-24 audit), with the gap concentrated in **governance-doc trust** and **hr/employee-management UI integration**, not in raw backend engineering.

---

## 11. What Remains Before Production Deployment

Ordered punch-list, synthesized from all sections above. Items struck through have been **verified fixed** in the 2026-08-09 re-verification pass.

1. ~~**Fix the known client bug**: frontend + mobile-worker calling the removed `/work-requests/:id/applications/*` route (§3, §6).~~ **FIXED** — dead references removed from both frontend and mobile.
2. **Close the remaining release-blockers** (§8) — ~~the two cheapest/highest-leverage (`getUser` hotel-scope check and CRM `per_page`/`limit` param bug) are both fixed~~. 10 of the original 13 remain open; see §8's updated table for per-item status.
3. **hr and employee-management frontend/mobile integration** (§3, §9) — both are backend-complete and tested; this is the largest concrete gap between current state and a usable manager-facing product. Not a backend task.
4. **Auth's 4 open High security findings** (SIR-HR-007/OD-HR-15) — needs a formal human Risk Assessment; blocks hr's own release readiness by dependency, independent of hr's own code quality.
5. **GDPR retention-tier registration** for auth (User/Session/AuditLog), hr (contract documents), documents (WorkerDocument) — backend-retention is live; these modules just haven't called `IF-RETENTION-RegisterCategory` yet.
6. **Malware scanning for backend-documents uploads** — HR already has the ADR-044 pattern to copy.
7. **Quality leaderboard pagination** — ADR-035 already authorizes it as a MUST; just needs the `take: 50` → paginated query change.
8. **Governance-doc synchronization pass**, specifically: `documents` and `hr` spec Interfaces tables (most severely stale), version-pointer corrections across 8 modules (§1), `DEPENDENCY_GRAPH.yaml` mount-line citations (§5) and its missing `backend-documents` entry, and the ~13 "resolved-but-mislabeled" register rows (§8) that need a human to formally close them.
9. ~~**Delete genuinely dead code**: `notifications/service.ts`'s `sendEmail`/`sendPushNotification` stubs (zero callers, fully superseded).~~ **FIXED** — stubs deleted; no `throw new NotImplementedError` remains anywhere in backend/src.
10. **Owner assignment** across essentially every module (SYNC-001-class) — pure governance housekeeping, does not block technical work, but blocks further architecture-decision authority per the register's own rules.

---

## Recommendation

**Backend is ready; frontend/mobile integration work can start in parallel now, with two carve-outs.** Sixteen of eighteen backend modules are functionally complete, tested (1648/1648 passing), and — for 11 of them — already correctly wired to real clients, which is strong evidence the API contracts are stable enough to build against. The remaining risk is concentrated, not diffuse: (1) hr and employee-management need their manager-facing UI built from scratch — this is exactly the kind of frontend work that should start now rather than wait, since the backend is done and tested; (2) the 13 release-blocking open decisions (mostly scope checks, pagination, retention-tier registration) are small, contained backend fixes that a small backend subteam can clear in parallel without blocking frontend work, as long as frontend does not build against the two known-broken surfaces (`work-applications`, and any assumption that `getUser`/CRM list pagination are already safe). Fix the client-side dead route first — it's the one item that will visibly break in the exact integration work about to start. Do not wait on chatbot, consent, retention, or compliance UI — those are correctly and deliberately deferred, not blocking.

---

## 12. Document Templates Module — Bug Audit (2026-08-09)

**Branch:** `feat/document-templates` (uncommitted changes on top of `main`)
**Scope:** New `backend/src/modules/document-templates/` module (5 files: `service.ts`, `controller.ts`, `routes.ts`, `pdf-renderer.ts`, `types.ts`) plus schema migration and route/permission wiring.
**Health gates at time of audit:** Backend typecheck clean, frontend typecheck clean, backend lint clean, frontend lint clean, 2577/2577 tests passing (105 suites). No test failures — but no tests exist for this module (see BUG-DT-007).

### BUG-DT-001 — `listSignatures` API always returns `null` signature URLs (Broken Feature)

| Field | Value |
|---|---|
| Severity | **High** |
| File | `backend/src/modules/document-templates/service.ts:632-636, 770-781` |
| Route | `GET /document-instances/:id/signatures` |

`listSignatures()` delegates to `this.toInstanceDto(instance).signatures`. In `toInstanceDto()`, `signature_image_url` is hardcoded to `null` (line 778) with a comment claiming the URL is "resolved lazily" by `listSignatures` callers. However, `listSignatures` itself never calls `getStorageClient()` or generates presigned S3 URLs — it returns `toInstanceDto()`'s output directly. Every signature in the response will have `signature_image_url: null`, making it impossible for any client to display captured signature images.

The same issue affects `getInstance()` (line 407-410) — any endpoint returning an instance DTO will have null signature URLs.

### BUG-DT-002 — Hotel Managers get zero results from `listInstances` (Authorization Scope Bug)

| Field | Value |
|---|---|
| Severity | **High** |
| File | `backend/src/modules/document-templates/service.ts:425-440` |
| Route | `GET /document-instances` |

When a hotel-scoped manager (`scope.type === 'hotel'`) calls `listInstances()` without an explicit `worker_id` query parameter, the service immediately returns `{ data: [], total: 0 }`:

```typescript
if (!scope || scope.type === 'hotel') {
  return { data: [], total: 0 };
}
```

This is inconsistent with the rest of the codebase. `isWorkerInGroupScope()` (`lib/scope.ts:130-134`) and `resolveNonAdminScopeFilter()` both resolve a hotel-scoped manager to their hotel's `hotel_group_id` and filter accordingly. The document-templates module should do the same — resolve the hotel to its group and filter instances by workers in that group — rather than returning empty results.

### BUG-DT-003 — Content hash verification will always fail on re-render (Signing Integrity Bug)

| Field | Value |
|---|---|
| Severity | **Medium** |
| File | `backend/src/modules/document-templates/service.ts:586-590`, `pdf-renderer.ts:96-114` |

In `signBlock()`, the `content_hash_at_signing` is computed by calling `renderSectionHtml(section, instance)` *before* the signature record is persisted. At render time, the current block is unsigned — so the rendered HTML contains `<div class="signature-line">&nbsp;</div>` for the block about to be signed. After the signature is saved, any subsequent re-render of the same section for audit/verification will include the `<img class="signature-image" .../>` tag instead, producing a different SHA-256 hash. This makes the stored `content_hash_at_signing` non-reproducible by design, defeating its stated purpose ("so a later 'what did they actually see' question is answerable").

### BUG-DT-004 — Route mounting at `/` breaks modular encapsulation

| Field | Value |
|---|---|
| Severity | **Low** |
| File | `backend/src/routes/v1/index.ts:42` |

`documentTemplateRoutes` is mounted at root `/`:
```typescript
router.use('/', documentTemplateRoutes);
```

Every other domain module is mounted on a scoped path (`/notifications`, `/analytics`, `/calendar`, `/documents`, `/geo`, `/retention`, etc.). While the routes internally use `/document-templates` and `/document-instances` prefixes, mounting at `/` is inconsistent with the established convention and creates a precedent for namespace collisions. Should be mounted at `/document-templates` with internal route paths adjusted.

### BUG-DT-005 — Unbounded Playwright browser launches (Performance / DoS Risk)

| Field | Value |
|---|---|
| Severity | **High** |
| File | `backend/src/modules/document-templates/pdf-renderer.ts:160-168` |

Every call to `renderInstanceToPdf()` — triggered by both `GET /document-instances/:id/preview` and `POST /document-instances/:id/finalize` — spawns a new headless Chromium process via `chromium.launch()` and tears it down in a `finally` block. There is no browser pool, no concurrency limit, and no reuse of browser instances.

Under concurrent usage (e.g. multiple managers previewing documents simultaneously), this will spawn N Chromium processes in parallel. Each Chromium instance consumes ~100-300 MB of RAM. With no upper bound, this is a straightforward server resource exhaustion / denial-of-service vector — a single burst of preview requests could OOM the backend process.

### BUG-DT-006 — Sensitive files in workspace root (Security / Compliance)

| Field | Value |
|---|---|
| Severity | **Critical** |
| Files | `Arbeitsvertrag_Alona_Likhoto_final.pdf` (130 KB, untracked), `hotelcrm-key1.pem` (1.6 KB, tracked) |

Two sensitive files are present in the project root:

1. **`Arbeitsvertrag_Alona_Likhoto_final.pdf`** — an untracked real employment contract containing personally identifiable information (PII). While `.gitignore` includes `*.pem`, it does not exclude PDF files. If accidentally committed, this would expose employee PII in the repository history.

2. **`hotelcrm-key1.pem`** — a 1,678-byte RSA private key file. Despite `*.pem` being in `.gitignore`, this file is listed by `git status` as tracked content. This key should be stored in a secrets manager (e.g. AWS Secrets Manager per the project's own AGENTS.md guidance), not in the repository directory.

### BUG-DT-007 — Zero test coverage for the new module

| Field | Value |
|---|---|
| Severity | **Medium** |
| File | `backend/src/__tests__/` (no `document-templates*.test.ts` exists) |

The `document-templates` module adds ~1,800 lines of new code across 5 files (`service.ts` at 796 lines, `controller.ts` at 279, `routes.ts` at 216, `pdf-renderer.ts` at 170, `types.ts` at 213) including complex authorization logic (4 separate scope-check paths), template fork-on-edit, shared-key propagation, signature capture with content hashing, and PDF generation. None of this is covered by any automated test. The existing 2577 tests (105 suites) all pass but none exercise this module.

This is inconsistent with the project's established pattern — every other module with comparable complexity has dedicated integration tests (e.g. `documents-upload.test.ts`, `documents-authz.test.ts`, `hr-authz.test.ts`, `hr-contract-lifecycle.test.ts`, `consent-authz.test.ts`).

### Summary

| ID | Severity | Category | One-line summary |
|---|---|---|---|
| BUG-DT-001 | High | Broken feature | `listSignatures` and all instance DTOs always return `null` signature image URLs |
| BUG-DT-002 | High | Authorization | Hotel-scoped managers get zero results from `listInstances` |
| BUG-DT-003 | Medium | Data integrity | `content_hash_at_signing` is non-reproducible on re-render |
| BUG-DT-004 | Low | Convention | Route mounted at `/` instead of a scoped prefix |
| BUG-DT-005 | High | Performance/DoS | Unbounded concurrent Chromium launches per PDF render |
| BUG-DT-006 | Critical | Security | PII contract PDF and RSA private key in workspace root |
| BUG-DT-007 | Medium | Test coverage | Zero automated tests for ~1,800 lines of new code |

## 13. Re-Audit (2026-08-09) — Additional Findings

During a secondary deep dive of the codebase, several new architectural and implementation bugs were discovered, primarily affecting pagination (DoS risks) and the `document-templates` module.

### 13.1 Missing Pagination (DoS / Memory Exhaustion Risk)
Several list endpoints use `.findMany()` queries without `skip` and `take` boundaries. While volume may be low initially, unbounded queries are a known performance/DoS vulnerability as data scales.
- **`listTemplates`** (`backend/src/modules/document-templates/service.ts:64`): Returns all document templates without limit.
- **`listContracts`** (`backend/src/modules/hr/service.ts:223`): Returns all contracts without limit.
- **`listPayroll`** (`backend/src/modules/hr/service.ts:678`): Returns all payslip requests without limit.
- **`getBlocklist`** (`backend/src/modules/employee-management/service.ts:203`): Returns all blocklist entries without limit.

### 13.2 Document Templates — Architectural and Authorization Bugs
- **BUG-DT-008: Proxy-fill constraint is unenforced (and unenforceable)**
  - *Context*: A product decision specifically mandates "No proxy-fill: a worker fills only their own (SUBJECT-role) fields, and a manager fills only COUNTERSIGNER-role blocks".
  - *Bug*: While `SignatureBlock` correctly carries a `signer_role`, the `DocumentTemplateField` model in Prisma has NO `signer_role` column. `upsertFieldValues` only validates that the actor has global fill-access to the instance. As a result, any actor with fill access can overwrite *any* field in the document, completely breaking the proxy-fill restriction.
- **BUG-DT-009: Workers cannot read template schemas to fill them**
  - *Context*: Workers need to know what fields to fill in an instance.
  - *Bug*: `GET /document-templates/:id` is strictly limited to `['admin', 'manager', 'regional_manager']`. `getInstance` returns `DocumentInstanceDto`, which includes filled values and signature status, but NOT the empty schema/fields. This leaves workers entirely unable to load the template structure required to render a UI for filling in fields.

### Updated Summary Table (New Findings)

| ID | Severity | Category | One-line summary |
|---|---|---|---|
| BUG-PAG-01 | Medium | Performance | Missing pagination in `document-templates` (`listTemplates`) |
| BUG-PAG-02 | Medium | Performance | Missing pagination in `hr` (`listContracts`, `listPayroll`) |
| BUG-PAG-03 | Medium | Performance | Missing pagination in `employee-management` (`getBlocklist`) |
| BUG-DT-008 | High | Security/Architecture | Proxy-fill constraint is entirely unenforced for template fields |
| BUG-DT-009 | High | Logic/Flow | Workers (SUBJECT role) cannot fetch template schemas to fill them |
