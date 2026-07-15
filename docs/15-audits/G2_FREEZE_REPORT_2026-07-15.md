# G2 Specification Freeze Report

**Report ID:** G2-FREEZE-2026-07-15
**Workflow:** G2 Approval Workflow
**Date:** 2026-07-15
**Framework version:** 1.3.0 (`.claude/VERSION.yaml`)
**Authorizer:** the commissioning human (approvals recorded in-session via the G2 Approval Workflow)
**Basis (authoritative, not re-audited):** Repository Audit (`AUDIT-REPO-2026-07-14`), Verification Audit (`VERIFY-REPO-2026-07-15`), Packages A/B/C, SYNC-036, SYNC-037, SYNC-038, and the approved G2 Decision Package.

---

## 1. Approved human decisions

| # | Decision | Approved outcome | Record |
|---|---|---|---|
| 1 | Governance baseline ratification | **Batch-ratify ADR-001..010** (`Proposed → Accepted`) | `DECISION_INDEX.md`; each ADR Status block |
| 2 | `state-user` authoritative writer | **`backend-auth` authoritative; `backend-users` bounded profile writer/reader** | **ADR-017** (new, Accepted) |
| 3 | Accept-transaction cross-owner coupling | **Superseded-by-pivot** (not adopted as approved permanent coupling) | **ADR-018** (new, Accepted) |
| 4 | Freeze scope | **Freeze only modules fully cleared by decisions 1–3**; leave open-product-decision modules at `REVIEW` | §3 below |
| 5 | Security-gate ruling | **Specifications freeze independently of implementation security findings.** Open security findings are **release/implementation prerequisites** (review by G8), **not** specification-freeze blockers. **No temporary Risk Assessments created.** | Applied throughout; §4 |

## 2. Repository changes applied

**Governance (ADR ratification + two new Decision Records):**
- `ADR-001..010` — Status `Proposed → Accepted`, ratified 2026-07-15; ratification bullets and §20 "Human Decision Required" sections updated to SATISFIED.
- `ADR-017` — new: `state-user` ownership (`backend-auth` authoritative writer). Resolves the `state-user` half of `SYNC-005`/`SIR-GLOB-006` left OPEN by `ADR-016`.
- `ADR-018` — new: accept-transaction cross-owner coupling classified superseded-by-pivot. Disposes `SIR-GLOB-003` (job-dispatch/attendance items), `SIR-JOBD-003`, `SIR-ATT-003`.
- `DECISION_INDEX.md` — ten statuses flipped to `Accepted`; ADR-017/018 rows added.

**Knowledge layer (ownership/state sync required by the decisions):**
- `STATE_OWNERSHIP_INDEX.yaml` — `state-user.authoritative_writer: backend-auth` (ADR-017); `state-work-request` coupling note → superseded-by-pivot (ADR-018).
- `OWNERSHIP_INDEX.yaml` — `state-user` authoritative writer set; stale dual-writer `collision_flags` entry removed.
- `BOUNDARY_INDEX.yaml` — `state-user` shared-write note + `unregistered_or_shared` entry updated to ADR-017.
- `DEPENDENCY_GRAPH.yaml` — `remaining_human_decisions` accept-transaction coupling item marked RESOLVED (ADR-018).
- `MODULE_REGISTRY.yaml` / `SPECIFICATION_INDEX.yaml` — frozen-module `specification` pointers and statuses updated (see §3); header comment updated to list the FROZEN set.

**Specifications transitioned REVIEW → FROZEN** (see §3).

**Governance register (`SPECIFICATION_ISSUES_REGISTER.md`):**
- `SIR-GLOB-008` → RESOLVED (ADR ratification).
- `SIR-GLOB-006` → RESOLVED (both halves: `ADR-016` + `ADR-017`).
- `SIR-GLOB-003` → job-dispatch/attendance coupling items closed by `ADR-018`; quality `OQ-01` remains OPEN.
- `SIR-JOBD-003`, `SIR-ATT-003` → RESOLVED (`ADR-018`).
- `SIR-GLOB-002` → partially resolved (three specs now FROZEN).
- Global-section "last verified" marker appended for this G2 pass.

## 3. Specifications frozen

| Spec | Module id(s) | Version | Status | Cleared by |
|---|---|---|---|---|
| `SPEC-AUTH-001` | backend-auth | 0.2.2 → **0.3.0** | **FROZEN** | ADR-001..010 (ratified); ADR-017 (state-user) |
| `SPEC-JOB-DISPATCH-001` | backend-work-requests, backend-work-applications, backend-assignments | 0.2.0 → **0.3.0** | **FROZEN** | ADR-001..010; ADR-018 (coupling superseded-by-pivot → Architecture BLOCKED cleared) |
| `SPEC-ATT-001` | backend-attendance | 0.1.1 → **0.2.0** | **FROZEN** | ADR-001..010; ADR-018 (EXPECTED-seed coupling superseded-by-pivot → Architecture BLOCKED cleared) |

**Deliberately left at `REVIEW`** (open product/architecture decisions — genuine spec-content calls, not agent-decidable):

| Spec | Blocking decision (kept at REVIEW) |
|---|---|
| `SPEC-NOTIF-001` | Push-only vs in-app inbox + push (`SIR-NOTIF-001`) |
| `SPEC-QUAL-001` | Rating model 1–5 vs 0–100, BREAKING (`OQ-01`) |
| `SPEC-USERS-001` | 5-role RBAC model (`OQ-USERS-01`) |
| `SPEC-CRM-001` | Hotel-Group data model + `OD-CRM-01/02/05/10/11` |
| `SPEC-CHATBOT-001` | RBAC + prompt-injection guardrail (`OD-CHAT-005/006`) |
| `SPEC-ANALYTICS-001` | "rooms-completed" metric definition (`OQ-ANALYTICS-03`) |
| `SPEC-CALENDAR-001` | Availability-indicator ownership + enforcement locus (`OD-CAL-01/02/03`) |
| `SPEC-GEO-001` | Hotel-coordinate ownership split (`OD-GEO-001/002`) |

## 4. Security posture of the frozen specifications

Per the approving human ruling, these specifications are frozen **independently** of the open security findings in their live code. The findings remain **release/implementation prerequisites** (must be fixed or re-reviewed **before G8 Release Readiness**); **no Risk Assessment was created** to enable the freeze.

| Frozen spec | Open security findings (release prerequisites) | Urgency |
|---|---|---|
| `SPEC-AUTH-001` | 4 High — JWT refresh-secret fallback (`OQ-AUTH-04`), `checkHotelAccess` bypass (`OQ-AUTH-06`), cleartext `Session.refresh_token` (`OQ-AUTH-15`), absent MFA. **Critical (password-reset) already fixed in code by HOTFIX-AUTH-002.** | High — before G8 |
| `SPEC-JOB-DISPATCH-001` | **1 Critical** — `PATCH /assignments/:id` unguarded (`SIR-JOBD-001`/AUDIT-C1) + 2 High (cross-tenant scoping) | **Critical — immediate security-timeline remediation recommended** |
| `SPEC-ATT-001` | 1 High — cross-tenant hotel-scoping (`OQ-02`) | High — before G8 |

## 5. Gate status

- **G2 (Specification Freeze):** **PASS** for `SPEC-AUTH-001`, `SPEC-JOB-DISPATCH-001`, `SPEC-ATT-001` — versioned spec + acceptance criteria present; human approval recorded (this workflow). Remaining modules: **BLOCKED** on their own product/architecture decisions (not this pass's scope).
- **Cross-cutting G2 blockers:** all three **RESOLVED** (ADR ratification, ADR-017, ADR-018).
- No spec was frozen over an unresolved *specification* defect; every frozen spec is architecturally consistent and internally complete at its frozen revision.

---

*Produced by the Lead Architect under the G2 Approval Workflow. Human decisions were captured via the workflow's approval gate before any repository change was applied.*
