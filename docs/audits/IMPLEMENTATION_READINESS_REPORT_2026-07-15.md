# Implementation Readiness Report (Post-G2)

**Report ID:** IMPL-READY-2026-07-15
**Companion to:** `G2_FREEZE_REPORT_2026-07-15.md`
**Date:** 2026-07-15
**Scope:** Readiness of the three G2-frozen specifications to enter implementation planning (G3), and the prerequisites gating their implementation and release.

---

## 1. Overall assessment

**The three frozen specifications are ready to enter implementation planning (G3).** Their integrity foundation is sound (per `VERIFY-REPO-2026-07-15`: cross-spec consistency, terminology, citation integrity, and knowledge-index synchronization all closed or benign-residual), and the cross-cutting architectural blockers that previously gated them are resolved (ADR-001..010 ratified; ADR-017; ADR-018). What remains before **code ships** is implementation-track work — chiefly security remediation — not further specification work.

## 2. Per-spec readiness

### `SPEC-AUTH-001` (backend-auth) — FROZEN @0.3.0
- **Plan-ready:** yes. Architecture baseline ratified; `state-user` ownership settled (ADR-017).
- **Release prerequisites (must close before G8):**
  - Fix 4 High findings: JWT refresh-secret fallback (`OQ-AUTH-04`), `checkHotelAccess` bypass (`OQ-AUTH-06`), cleartext `Session.refresh_token` (`OQ-AUTH-15`), MFA control (`REQ-AUTH-022`).
  - MFA storage model (`OQ-AUTH-02`) — implementation-time design decision.
  - `permissions-middleware` ownership reassignment (`SIR-GLOB-007`) — accountability encoding, tied to owner assignment.
- **Note:** the former Critical (password-reset takeover) is already fixed in code (HOTFIX-AUTH-002).

### `SPEC-JOB-DISPATCH-001` (work-requests / work-applications / assignments) — FROZEN @0.3.0
- **Plan-ready:** yes. Architecture BLOCKED cleared (ADR-018).
- **Release prerequisites (must close before G8):**
  - **Critical (urgent, security-timeline):** `PATCH /assignments/:id` unguarded (`SIR-JOBD-001`) — authorize/guard the endpoint.
  - 2 High: cross-tenant hotel-scoping on work-request/application actions (`SIR-JOBD-002`).
  - Migration-gap set (`MIG-GAP-01..12`) — deferred by design; the pivot retires the marketplace flow, so most are removals executed during the pivot implementation, not fixes.

### `SPEC-ATT-001` (backend-attendance) — FROZEN @0.2.0
- **Plan-ready:** yes. Architecture BLOCKED cleared (ADR-018).
- **Release prerequisites (must close before G8):**
  - 1 High: cross-tenant hotel-scoping (`OQ-02`) — note `checkHotelAccess` alone will not close it (it bypasses admin/manager/checker); needs a real scoping fix.
  - `EXPECTED`-seed re-homing under the target calendar model (`OQ-05`) — implementation-time re-home, now off the architecture-blocker path (ADR-018).
  - Geofence "Close" radius clarification (`OQ-04`) — single acceptance-criterion detail, resolve during planning.

## 3. Cross-cutting prerequisites (affect all implementation)

| Item | Class | Status |
|---|---|---|
| Live Criticals in frozen modules (`SIR-JOBD-001`; and analytics `AUDIT-C2`, non-frozen) | Security — **urgent** | OPEN — remediate on a security timeline independent of freeze |
| Ownership assignment / CODEOWNERS (`SIR-GLOB-001`/`SYNC-001`) | Accountability | OPEN — required before code-ownership enforcement, not before planning |
| ADR baseline (`ADR-001..010`) | Architecture baseline | **RESOLVED** — ratified 2026-07-15; now citable as frozen constraints |

## 4. Post-G2 backlog (non-gating, scheduled)

- Three platform-wide architecture DRs — `SIR-GLOB-010` (cross-module read access), `SIR-GLOB-011` (route-nesting coupling), `SIR-GLOB-016` (in-process vs HTTP interface convention). Lead Architect owns; none gates a single module.
- Notification retention-tier (`SIR-NOTIF-002`) — required by G8, not G2.
- HR/Onboarding registry registration (`SIR-GLOB-005` / `SIR-HR-010`) — knowledge-layer; blocked on a human joint-disposition.
- `VERIFY-02` revision-stamp lag — benign, self-correcting; fold into the next routine Repository Synchronization pass.

## 5. Recommended sequence

1. **Immediately:** remediate the live Criticals (`SIR-JOBD-001`; and analytics `AUDIT-C2`) on a security timeline — independent of any freeze or planning.
2. **G3 planning** for the three frozen specs may begin now; the ratified ADRs are citable constraints.
3. Assign module owners / CODEOWNERS (`SIR-GLOB-001`) before enforcing code-ownership review routing.
4. Close each frozen module's remaining High findings and implementation-time decisions before its **G8 Release Readiness**.
5. Continue per-module G2 for the `REVIEW` specs as their product/architecture decisions are made (blockers-fewest-first).

**Bottom line:** the frozen spec set is a clean, coherent basis for implementation. The only hard, time-sensitive item is security remediation of the open Criticals — which is release-gating, not freeze- or planning-gating.

---

*Produced by the Lead Architect under the G2 Approval Workflow, read against the frozen revisions and the merged audit/verification evidence.*
