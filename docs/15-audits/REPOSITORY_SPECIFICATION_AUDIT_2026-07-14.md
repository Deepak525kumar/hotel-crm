# Repository-Wide Specification Audit

**Audit ID:** AUDIT-REPO-2026-07-14
**Audit revision:** `eff2ebb6be9238397e0a5ed1a2deefb71e6ada2a` (`eff2ebb`, HEAD of `main` at audit time)
**Framework version:** 1.3.0 (`.claude/VERSION.yaml`)
**Date:** 2026-07-14
**Type:** Repository-wide, read-only. Validates the repository as one complete, implementation-ready specification set. No specification, index, or register was modified by this pass; all corrections are *recommended* and routed to the appropriate workflow.
**Authoritative frameworks used:** `.claude/constitution/`, `.claude/workflows/`, `.claude/knowledge/`, `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`, and the `.claude/agents/` specialist contracts. This report does not restate their logic.

## Method & Agent Deployment

The Lead Architect assembled the authoritative framework state (constitution, all knowledge indexes, the governance register, `SYNC_STATE.yaml`) and then dispatched four specialist agents in parallel, per the reasoning-complexity mapping:

| Agent | Class | Dimension | Independent verdict |
|---|---|---|---|
| architecture-reviewer | Opus | Boundaries, ownership, state, dependency graph, APIs/events | FAIL (cross-index contradiction + completeness-claim violation) |
| consistency-reviewer | Opus | Cross-spec terminology, references, ADR-vs-spec conformance | Not freeze-ready; 2 ADR-vs-spec drifts + 2 minor |
| consistency-reviewer | Sonnet | Index synchronization, registry completeness, SIR consistency | Functionally accurate but stamp-stale; content/stamp divergence |
| documentation-validator | Sonnet | Citations, version/status integrity | Core citations solid; 2 undisclosed missing specs, register citation drift |

All four converged independently on the same two structural problems (ADR-016 partial propagation and stamp-vs-content drift), which raises confidence that these are real and not artifacts of a single reviewer.

---

## 1. Freeze Readiness Assessment (G2)

**Verdict: NOT READY for G2 Specification Freeze — of any module, and of the set as a whole.**

G2 (Specification Freeze) is reserved human authority (Constitution §12; Review Gates G2). Independent of that reservation, freeze is **technically blocked** on three tiers:

1. **Live blocking security/architecture findings** (already tracked, unresolved): two open Criticals and a set of open Highs against already-deployed code (see §5 inventory). Per Constitution §12 these force `FAIL` until a code fix or an authorized, time-bounded Risk Assessment exists — none is authorized.
2. **Reserved human-authority decisions** never made: no module or contract owner is assigned anywhere (`SIR-GLOB-001`/`SYNC-001`, BLOCKED); the `state-user` dual-writer authoritative writer is undecided (`SIR-GLOB-006` residual); the accept-transaction cross-owner coupling still needs a Decision Record (`SIR-GLOB-003`); platform ADR-001..010 remain `Proposed`, never ratified `Accepted` (`SIR-GLOB-008`).
3. **Specification-set integrity defects surfaced by this audit** (new, agent-performable to fix): the knowledge layer is not internally coherent at HEAD — an Accepted ADR is only partially propagated across the derived indexes, two G4/G6-reviewed specifications are missing and undisclosed from the registry, and the revision-binding stamps no longer bound their own content.

No specification anywhere declares itself `FROZEN` — verified by exhaustive grep across `docs/03-modules/**/MODULE_SPEC.md` (every occurrence of `FROZEN` is a negation). The repository correctly respects the G2 reservation. But the set is not yet a *coherent* implementation-ready whole: tier 3 must be cleared to restore integrity, and tiers 1–2 are the substantive gates a human approver would face.

**Freeze-readiness by dimension:**

| Dimension | Posture |
|---|---|
| Individual spec authoring quality (template, requirements, G4 review depth) | Strong — the REVIEW-status specs are thorough and self-disclosing |
| Cross-spec consistency & terminology | Not ready — 2 ADR-vs-spec drifts (§3 H2, M4) |
| Architecture / boundary / ownership coherence | Not ready — cross-index contradiction (§3 H1) |
| Knowledge-index synchronization & completeness | Not ready — stamp/content drift + 2 undisclosed missing specs (§3 H1, M1, M2) |
| Citation / version integrity | Mostly sound — security citations verify; register line-pointer drift (§3 M5) |
| Reserved human-authority items | Blocked — ownership, state-writer, ADR ratification all pending |

---

## 2. Repository-Wide Findings, Grouped by Severity

IDs are audit-local (`AUDIT-*`); each maps to the specialist finding(s) and to any existing `SIR-*` row. "Tracked" = already in the Specification Issues Register; "NEW" = surfaced by this audit and not yet registered.

### CRITICAL (already tracked; block G2, live code)

| ID | Finding | Evidence | Register |
|---|---|---|---|
| AUDIT-C1 | `PATCH /assignments/:id` has no authorization guard — any authenticated user can drive any assignment's lifecycle. | `backend/src/modules/assignments/service.ts:83-119`, `routes.ts:14` (verified: router-level `authMiddleware` only, no `requireRole`) | `SIR-JOBD-001` (OPEN — BLOCKING) |
| AUDIT-C2 | `GET /analytics/leaderboard(/by-hotel/:hotel_id)` has no `requireRole`/`checkHotelAccess`, unlike sibling `/stats`/`/hotel-summary` and `/quality/leaderboard` guarding the identical `WorkerOverallRating` data. | `backend/src/modules/analytics/routes.ts:9-24` (verified: leaderboard routes unguarded; stats/summary wrapped in `requireRole(['admin','manager'])`) | `SIR-ANLY-001` / `SIR-GLOB-004` (OPEN — BLOCKING) |

### HIGH

| ID | Finding | Evidence | Register |
|---|---|---|---|
| AUDIT-H1 | **Accepted ADR-016 only partially propagated → cross-index contradiction.** `STATE_OWNERSHIP_INDEX.yaml` and `DEPENDENCY_GRAPH.yaml` record `state-audit-log` authoritative_writer = `backend-auth`; but `OWNERSHIP_INDEX.yaml` still records `UNKNOWN`/`no single owner` and `BOUNDARY_INDEX.yaml`'s `unregistered_or_shared` list still calls it a shared-write G1.5 collision. Two indexes derived from the same graph disagree on the same fact (violates knowledge/README Rule 3). G1.5 reads OWNERSHIP/BOUNDARY in one lookup and would still escalate a false collision that an Accepted ADR resolved. Root cause: `OWNERSHIP_INDEX.yaml` was last edited `51ffd3f` (2026-07-11), *predating* ADR-016 (`e60b040`); `BOUNDARY_INDEX.yaml` got the ADR-016 compliance note but its older stale line was left. | `OWNERSHIP_INDEX.yaml:39,43,116`; `BOUNDARY_INDEX.yaml:116` vs `STATE_OWNERSHIP_INDEX.yaml:27`, `DEPENDENCY_GRAPH.yaml:523-529,552`; `ADR-016` | Tracked pattern `SIR-GLOB-006` (partially-resolved) records the exact stale lines; the live contradiction at HEAD is **unremediated** |
| AUDIT-H2 | **Auth spec not synchronized to Accepted ADR-016.** `SPEC-AUTH-001` still records `state-audit-log` authoritative_writer = `UNKNOWN` and exposes no `AuditLog`-read interface, while `SPEC-COMPLIANCE-001` depends on an auth-exposed `IF-COMPLIANCE-GetAuditTrail`. The accepted (authoritative) decision is not reflected in the owning module's spec. | `docs/03-modules/auth/MODULE_SPEC.md:233,268-270` (no ADR-016 mention) vs `docs/03-modules/compliance/MODULE_SPEC.md:31,94,130,206` (`OD-COMPLIANCE-004` self-discloses the auth-side gap) | Half-tracked (`OD-COMPLIANCE-004`); auth-side authoritative-writer text untracked |
| AUDIT-H3 | **Registry/index registration gap for HR & Onboarding.** `SPEC-HR-001@0.2.1` exists and is cited by 5+ register sections, but `MODULE_REGISTRY.yaml`/`SPECIFICATION_INDEX.yaml` still read `UNKNOWN`/`none` for `backend-hr`; no `backend-onboarding` module id exists at all, so `SPEC-` (onboarding) cannot be indexed. | `MODULE_REGISTRY.yaml:163`; `SPECIFICATION_INDEX.yaml:78-80`; `docs/03-modules/{hr,onboarding}/MODULE_SPEC.md` | Tracked `SIR-GLOB-005` (OPEN — partially resolved) |
| AUDIT-H4 | **Content-vs-stamp divergence (integrity of the revision-binding mechanism).** `BOUNDARY_INDEX.yaml` and `STATE_OWNERSHIP_INDEX.yaml` carry current, dated, ADR-016-citing prose (edited `e60b040`) under a stale `observed_revision: 9142bee` stamp. A stamp-first staleness check (the framework's own fail-safe) is defeated: content and stamp are in different "time zones" within one file — strictly worse than uniform staleness. This is the exact defect class `SIR-GLOB-009` closed once at `9142bee`, silently recurred at `eff2ebb`. | `BOUNDARY_INDEX.yaml:13` + `:121-123`; `STATE_OWNERSHIP_INDEX.yaml:12` + `:27` | Pattern `SIR-GLOB-009` (RESOLVED for prior revision); this recurrence is **NEW/untracked** |

### MEDIUM

| ID | Finding | Evidence | Register |
|---|---|---|---|
| AUDIT-M1 | **Two G4/G6-reviewed specs missing *and undisclosed* from the registry.** `SPEC-COMPLIANCE-001@0.1.0` and `SPEC-RETENTION-001@0.2.0` have zero entry in `MODULE_REGISTRY.yaml`/`SPECIFICATION_INDEX.yaml` and — unlike `consent` — no rationale in `MODULE_REGISTRY.yaml`'s `unresolved:` block. Their zero-code-deferral status is documented only in `BOUNDARY_INDEX.yaml:122-123` (itself stale-stamped). A reader of the registry alone sees no trace they exist. | grep of both files returns zero `compliance`/`retention` matches; `MODULE_REGISTRY.yaml:276-285`; `BOUNDARY_INDEX.yaml:122-123` | NEW |
| AUDIT-M2 | **`SPECIFICATION_INDEX.yaml` CRM pointer contradicts `MODULE_REGISTRY.yaml`.** Registry has `backend-crm → SPEC-CRM-001@0.1.1 (REVIEW)`; the index still shows `spec: none / UNKNOWN`. The index's own purpose ("does a spec exist?") returns the wrong answer for CRM. Same defect class as the attendance/quality gaps closed by SYNC-015/019, not covered by `SIR-GLOB-005`'s scope (HR/Onboarding only). | `MODULE_REGISTRY.yaml:70-80` vs `SPECIFICATION_INDEX.yaml:72-74` | NEW |
| AUDIT-M3 | **Missing dependency edge `edge-analytics-reads-hotel-worker`.** `backend-analytics.getLeaderboard` reads `state-hotel-worker` via a Prisma relation filter; `DEPENDENCY_GRAPH.yaml` (declared `verified-edges`, "every edge repository-backed") has no such edge — only a caveat documenting its own gap. | `backend/src/modules/analytics/service.ts:26-35`; `DEPENDENCY_GRAPH.yaml:470` (caveat, no edge) | Tracked `SIR-ANLY-007` / `FIND-DEP-001` (OPEN, not applied) |
| AUDIT-M4 | **SIR-GLOB-018 terminology drift live.** `documents` and `hr` specs still name the retention-sweep executor "Compliance"; `SPEC-RETENTION-001` is the registered owner of the sweep/`RetentionLog`/tier engine. | `documents/MODULE_SPEC.md:114,128`; `hr/MODULE_SPEC.md:339`; `retention/MODULE_SPEC.md` (owner) | Tracked `SIR-GLOB-018` (OPEN) |
| AUDIT-M5 | **Register citation defects (SIR-USERS-004).** Evidence pointer `DEPENDENCY_GRAPH.yaml:428-434` lands on the unrelated `validation-middleware` block (correct block: `445-450`) — a BROKEN line-range; and the row's embedded code-line citations (`users/service.ts:93,132,164`; `auth/service.ts:25,205,218`) have drifted by a consistent offset (now `104,143,175` / `30,260,272`) after HOTFIX comment-block insertions. Likely recurs wherever HOTFIX-AUTH-00x comments were added without a citation sweep. | `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` `SIR-USERS-004`; verified current lines | NEW |
| AUDIT-M6 | **Register section-completeness gap.** `employee-management`, `calendar`, and `onboarding` have authored specs cited across the register but no dedicated `## Module:` section enumerating their own `OD-*`/`OPQ-*` items — defeating the register's single-source purpose for those three. | no `## Module: Employee Management/Calendar/Onboarding` headings; no `SIR-EMP-*`/`SIR-CAL-*`/`SIR-ONB-*` IDs exist | NEW |

### LOW / NOTE

| ID | Finding | Evidence | Register |
|---|---|---|---|
| AUDIT-L1 | `calendar` spec (`SPEC-CALENDAR-001@0.1.0`, REVIEW) unindexed; `MODULE_REGISTRY.yaml` `backend-calendar` still `specification: UNKNOWN`, and the row's comment "no frozen spec currently maps to it" is now stale (a REVIEW spec exists). | `MODULE_REGISTRY.yaml:190-200`; `calendar/MODULE_SPEC.md` | NEW |
| AUDIT-L2 | `state-hotel-worker` "true reader count is 8" not reconstructable from graph edges (4 present + 1 missing analytics edge = 5). | `STATE_OWNERSHIP_INDEX.yaml:18`; `DEPENDENCY_GRAPH.yaml:468,470` | NEW |
| AUDIT-L3 | Onboarding Document Control lags its own body: cites/applies `ADR-015` (Accepted 2026-07-13) but changelog stops at v1.1 / 2026-07-12 with no ADR-015 row. | `onboarding/MODULE_SPEC.md:526-529,607-608` vs `:619-627` | NEW |
| AUDIT-L4 | `employee-management` out-of-scope list names "Payslips module" as a standalone owner, contradicting ADR-014 (payslips owned by `backend-hr`; no standalone module). | `employee-management/MODULE_SPEC.md:45`; `ADR-014` | NEW (adjacent to RESOLVED `SIR-GLOB-017`) |
| AUDIT-L5 | Session marked `active: true` at `baseline_revision: e3607a9` while HEAD is `eff2ebb` — per the file's own invariant the session has invalidated but is not machine-flagged. | `SESSION_STATE.yaml:18-19`; `SYNC_STATE.yaml` `cache_state` (`e3607a9`) | NEW (mirrors prior SYNC rebind precedents) |
| AUDIT-N1 | Onboarding retains "Contracts/HR module"/"Hotels module" aliases (correct per ADR-011/012 alias rule, but normalized inconsistently vs the in-place Chatbot correction). Optional normalization. | `onboarding/MODULE_SPEC.md:66,67,73,180` | Alias usage, `SIR-GLOB-013/014` |

### Positive confirmations (no defect)

- **No spec is `FROZEN`** anywhere — G2 reservation correctly respected.
- **Alias → ADR-owner mappings are correct** (Hotels→crm, Scheduling→calendar, Contracts/Payslips→hr, Chatbot→chatbot, Consent→consent); no shadow module owns any aliased capability (`BOUNDARY_INDEX.yaml`).
- **Zero-code proposed modules correctly excluded** from `DEPENDENCY_GRAPH`/`MODULE_REGISTRY`; their target-state read-couplings are not (wrongly) present as graph edges.
- **No event bus; `EVT-*` events are target-state only** — `events: []` verified absent in graph and contract index; no spec claims an event is implemented.
- **Security-critical citations verify solidly** — the HOTFIX-AUTH-001/002/003 fixes are genuinely present in the live tree (signup hardcodes `WORKER` + `.strict()`; password-reset token model added; createUser admin-guard mirrors updateUser); all six ADR-011..016 files are present and `Accepted`.
- **ADR-013/015/016 conformance PASS** for Onboarding (first-person Chatbot claims removed, v1.1), Consent (standalone), and Compliance (read-only AuditLog consumer). The gaps are on the *counterpart* specs (Auth H2), not these.

---

## 3. Required Repository-Wide Corrections

Grouped by the workflow that owns the fix. None requires editing individual module specs opportunistically; each is a bounded, repository-wide pass.

### Package A — Repository Synchronization Workflow (agent-performable, no human authority)
Single pass, scoped to HEAD `eff2ebb`:
1. Propagate ADR-016 into `OWNERSHIP_INDEX.yaml` (state_owners, collision_flags, unregistered_or_shared) and `BOUNDARY_INDEX.yaml:116`, matching `STATE_OWNERSHIP_INDEX`/`DEPENDENCY_GRAPH`. **Clears AUDIT-H1.**
2. Rebind `observed_revision`/`baseline_revision` on all nine project-runtime indexes + `SESSION_STATE.yaml`/`cache_state` to `eff2ebb`, recording per-file whether it was a stamp-only rebind or a content change. **Clears AUDIT-H4, AUDIT-L5.**
3. Synchronize `SPECIFICATION_INDEX.yaml` CRM pointer to the registry; set `backend-calendar` spec pointers to `SPEC-CALENDAR-001@0.1.0 (REVIEW)`. **Clears AUDIT-M2, AUDIT-L1.**
4. Add `backend-compliance`/`backend-retention` zero-code-deferral rationale to `MODULE_REGISTRY.yaml`'s `unresolved:` block (mirroring the `backend-consent` precedent). **Clears AUDIT-M1.**
5. Apply `edge-analytics-reads-hotel-worker` to `DEPENDENCY_GRAPH.yaml` and re-derive reader sets; reconcile the `state-hotel-worker` reader count. **Clears AUDIT-M3, AUDIT-L2** (dependency-synchronization sub-pass).

### Package B — Documentation Workflow / module-author corrections (agent-performable, no human policy decision — canonical owner is unambiguous in every case)
6. `SPEC-AUTH-001`: record ADR-016's authoritative-writer assignment and the Compliance-facing `AuditLog`-read interface. **Clears AUDIT-H2.**
7. `documents` + `hr` specs: re-attribute the retention sweep to `backend-retention`/`SPEC-RETENTION-001`. **Clears AUDIT-M4.**
8. `employee-management`: reframe "Payslips module" as the HR-owned capability alias; `onboarding`: add the ADR-015 changelog row + version bump. **Clears AUDIT-L3, AUDIT-L4.**

### Package C — Specification Issues Register synchronization (governance, agent-performable)
9. Fix the `SIR-USERS-004` line-range citation (`428-434`→`445-450`) and refresh its code-line pointers; sweep the register for other HOTFIX-offset drift. **Clears AUDIT-M5.**
10. Add `## Module: Employee Management / Calendar / Onboarding` sections (`SIR-EMP-*`/`SIR-CAL-*`/`SIR-ONB-*`). **Clears AUDIT-M6.**
11. Register the new repository-wide findings that lack a home: the `eff2ebb` recurrence of the stamp/content drift (extend `SIR-GLOB-009` history), the CRM/calendar index gaps (extend `SIR-GLOB-005` scope), and the compliance/retention registry-disclosure gap.

### Package D — Reserved human authority (cannot be cleared by any agent; block G2)
12. Assign module/contract owners (`SIR-GLOB-001`/`SYNC-001`).
13. Decide the `state-user` dual-writer authoritative writer (`SIR-GLOB-006` residual).
14. Record the accept-transaction cross-owner coupling Decision Record (`SIR-GLOB-003`/`SIR-JOBD-003`).
15. Ratify platform ADR-001..010 (`Proposed`→`Accepted`) (`SIR-GLOB-008`).
16. Disposition the live Critical/High security findings (AUDIT-C1/C2 and the open Auth Highs) via code fix or authorized, time-bounded Risk Assessment.

---

## 4. Recommended Next Actions Before G2 Freeze (ordered)

1. **Run Package A (one synchronization pass).** Restores cross-index coherence and honest revision-binding — the cheapest, highest-value step; unblocks trustworthy reading of the whole knowledge layer. Everything else depends on the indexes being truthful first.
2. **Run Package C step 11** immediately after A, so the audit's newly-found issues are tracked in the register (not just this report) before context is lost.
3. **Run Package B** as a bounded documentation pass over the five named specs (`auth`, `documents`, `hr`, `employee-management`, `onboarding`) to close the ADR-vs-spec drifts.
4. **Run Package C steps 9–10** to restore register citation and section integrity.
5. **Escalate Package D to the human approver** — assemble the ownership assignment, `state-user` writer decision, coupling Decision Record, ADR ratification, and security-finding disposition as one decision brief. These are the true G2 gates; no amount of agent work clears them.
6. **Re-run this repository-wide audit at the post-Package-A/B/C revision** to confirm the integrity defects are closed, then attempt per-module G2 only for specs whose blocking findings (§5) are all resolved or risk-accepted. Candidate order (fewest blockers first): `notifications`, `quality` → then `crm`, `geo`, `consent` → security-blocked specs (`auth`, `analytics`, `attendance`, `job-dispatch`) last.

---

## 5. Appendix — Open Critical/High Register Items Gating G2

| SIR ID | Module | Severity | Status |
|---|---|---|---|
| SIR-JOBD-001 | Job Dispatch | Critical | OPEN — BLOCKING (`PATCH /assignments/:id` no authz) |
| SIR-ANLY-001 / SIR-GLOB-004 | Analytics / Global | Critical | OPEN — BLOCKING (leaderboard no authz gate) |
| SIR-JOBD-002 | Job Dispatch | High | OPEN (routes not hotel-scoped) |
| SIR-ATT-002 | Attendance | High | OPEN — BLOCKING (mgmt actions not hotel-scoped) |
| SIR-ATT-010 | Attendance | High | OPEN — BLOCKING (architecture; owner blocks OQ-03 DR) |
| SIR-AUTH-002 | Auth | High | OPEN (JWT refresh-secret fallback) |
| SIR-AUTH-003 | Auth | High | OPEN (`checkHotelAccess` blanket bypass) |
| SIR-AUTH-004 | Auth | High | OPEN (cleartext `Session.refresh_token`) |
| SIR-DOC-005 / SIR-DOC-007 | Documents | High | OPEN — blocks G2 (no document-level RBAC) |
| SIR-CHAT-005 / SIR-CHAT-006 | Chatbot | High | OPEN — blocks G2 (RBAC; prompt-injection guardrail) |
| SIR-CONSENT-006 / SIR-CONSENT-011 | Consent | High | OPEN (fail-open/closed; audit-history RBAC scope) |
| SIR-GLOB-001 | Global | High | OPEN — BLOCKED (no owner assigned anywhere; `SYNC-001`) |
| SIR-GLOB-006 | Global | High | OPEN — partially resolved (`state-user` dual-writer) |

**Register hygiene:** `SIR-*` IDs are monotonic with no observed renumbering; RESOLVED rows carry resolution notes + revision; no duplicate rows for one canonical source within a section. The register header baseline (`ba1d78c`, 25 merges behind HEAD) is stale, but the register's own per-section "Last verified" markers are the operative freshness signal and are current (2026-07-14) for the newest work (Global, Retention, Compliance, Consent, Geo sections).

---

*Produced by the Lead Architect from four independent specialist reviews (2× Opus, 2× Sonnet) at revision `eff2ebb`. Read-only audit: no specification, index, or register was modified. All findings are reproducible at the cited `path:line` locations.*
