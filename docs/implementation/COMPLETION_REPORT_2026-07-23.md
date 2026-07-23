# Hotel-CRM Completion Report — Post-Epic-8 Baseline

**Date:** 2026-07-23 **HEAD:** `9ca0eed` (merge of PR #194, Epic 8) **Framework:** `.claude/` 1.5.0
**Author:** Repository synchronization + implementation-planning pass (`SYNC-053`)
**Method:** Estimates are derived by reading `backend/src/`, `frontend/`, and `mobile/` code at HEAD
(not commit history or spec prose), cross-checked against `.claude/knowledge/MODULE_REGISTRY.yaml` and
`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`. Percentages are a **structural proxy** (module /
surface coverage weighted by depth), not a burn-down against a single formal scope baseline — no such
single-number authority exists in the repository, so treat every figure as an informed estimate with the
stated methodology, ±10%.

---

## Headline completion estimates

| Surface | Completion | Basis |
|---|---:|---|
| **Backend** | **~80%** | Core transactional domain (staffing → attendance → quality → analytics) is code-complete and tested; remainder is governance-gated secondary modules. |
| **Frontend (web)** | **~57%** | Core worker/manager loop is wired to the real API; several admin/reporting surfaces have no page yet. |
| **Mobile (worker + checker apps)** | **~65%** | Both apps cover their primary role flows against the live API; depth-features tied to blocked backend surfaces are absent. |
| **Overall project** | **~70%** | Weighted backend 45% / frontend 30% / mobile 25%: `0.45·80 + 0.30·57 + 0.25·65 ≈ 70%`. |

**Confidence:** Backend high (verified in code + 367/367 tests). Frontend/mobile medium (structural read;
no end-to-end run performed this pass). Overall medium.

---

## Backend — ~80%

15 module directories; **`chatbot` and `geo` are empty REVIEW-status stubs, explicitly out of MVP scope.**
Of the 13 in-scope modules:

**Complete & route-registered (10):** `auth`, `users`, `crm`, `work-requests`, `work-applications`,
`assignments`, `attendance`, `quality`, `analytics`, `employee-management`.
Verified this pass: assignments deny-by-default guard; auth refresh-secret fail-closed +
SHA-256 `Session.refresh_token`; `resolveHotelAccess()` scope seam + `FEATURE_SCOPE_AUTHZ`;
`HotelGroup` / `Hotel.hotel_group_id` / `manager_user_id` / JWT `scope`; `Rating.score` 0–100;
`RoomsCompletedEntry`; `NotificationChannel.WEBHOOK`; `isHotelInScope()` on work-requests/applications.

**Partial (1):** `notifications` — in-app CRUD (list/read/mark) implemented; `sendEmail()` and
`sendPush()` throw `NotImplementedError`. Dispatch/transport design is **governance-blocked**
(`OQ-NOTIF-01` push design, `TREQ-002`/`TREQ-012` — not settled by ADR-027, which only fixed the enum shape).

**Stubs (2):** `hr` (contracts / payroll / document-upload all `NotImplementedError`) and `calendar`
(daily-ops `NotImplementedError`). Both are route-registered placeholders; their specs are REVIEW /
their builds gated on human/architecture decisions (`SIR-EMP-014` perf budget; HR contract ownership).

**Health at HEAD:** `tsc --noEmit` clean · **367/367 backend tests** (39 suites) green ·
`repository-integrity-check.js` exit 0 · `context-loader.js --validate` Errors:0.

## Frontend (web) — ~57%

Real Next.js app, SWR + typed API client (`frontend/lib/api.ts`) against the live backend. **Covered:**
login/auth, dashboard, work-requests (list/detail/new), applications (list/detail), assignments
(list/detail), attendance (list/detail), notifications (list/detail). **Not yet built:** CRM / hotel-group
admin, quality-review UI, analytics/leaderboard UI, HR / employee-management UI, calendar. Most of the
missing surfaces map onto backend modules that are themselves stubbed or governance-blocked.

## Mobile — ~65%

Two Expo/React-Native apps, both wired to the live API. **worker-app:** shifts, marketplace/job browsing,
shift detail, ratings, notifications, profile. **checker-app:** attendance verification, quality, rating,
leaderboard, notifications, profile. Primary role flows are present; deeper features (e.g. push
notifications, HR/contract surfaces) await the blocked backend work.

---

## Remaining epics (all governance-gated)

No unblocked, spec-traceable **application-code** epic remains after Epic 8. The remaining surface:

| Epic / area | What's left | Gate |
|---|---|---|
| Epic 6 — Quality / CRM / Analytics G8 mediums-lows | `QUAL OQ-02/04/05/07/08`; `CRM OD-CRM-02..17`; `ANALYTICS OQ-02/04..12` | `human` / `human/product` / `human/architecture` Decision Records |
| Epic 7 — Notifications dispatch | push/channel dispatch design (`TREQ-002`/`TREQ-012`); `OQ-NOTIF-02..09` | `human` design decision |
| HR module build | contracts / payroll / documents | `SIR-EMP-014` (`architecture/human` perf budget) + REVIEW spec |
| Calendar module build | daily-ops | REVIEW spec + human decision |
| Chatbot / Geo | greenfield | REVIEW-stub specs, out of MVP scope |
| Platform-wide | `SYNC-001` owner assignment; cross-module read-access ADR (`SIR-GLOB-010`); MFA (`SIR-GLOB-004` tail) | reserved `human` authority |
| Doc/knowledge (not app code) | `SIR-HR-018`, `SIR-HR-019` (spec renumbering), `SIR-USERS-017` (`ROLE_PERMISSIONS` graph node) | locked under Implementation Mode |

**Register tally:** 210 open/blocked rows — 209 need `human*` authority, 1 needs `architecture/human`.

## Estimated remaining PRs

Rough order-of-magnitude, **contingent on the gating decisions being made first** (the decisions
themselves are not PRs):

- Epic 6 remainder: ~6–10 PRs (one per resolved OQ/OD cluster).
- Epic 7 dispatch: ~3–5 PRs (design + email transport + push transport + tests).
- HR build: ~4–6 PRs (contracts, payroll, documents, migrations, tests).
- Calendar build: ~2–3 PRs.
- Frontend/mobile catch-up for the above: ~8–12 PRs.
- Chatbot/Geo (post-MVP): unscoped.

**≈ 25–35 PRs to a feature-complete v1**, essentially none of them startable today without human input.

## Critical path to MVP

The core staffing MVP loop (auth → work-request → application → assignment → attendance → quality →
analytics) is **backend-complete and tested**, web-wired for the worker/manager path, and mobile-wired for
worker + checker. The MVP-blocking gaps are:

1. **Notifications dispatch decision** (`OQ-NOTIF-01` / `TREQ-002`/`012`) → then email + optionally push
   transport. *This is the single highest-value human decision for MVP.*
2. **Frontend admin/reporting surfaces** for CRM/hotel-group and analytics/leaderboard (backend ready;
   pure client work, not gated).
3. **Ownership assignment** (`SYNC-001`) — required for release accountability, reserved human authority.

Critical path: **human notification-dispatch decision → dispatch PRs → web reporting UIs → release-gate
sign-off.** HR, calendar, chatbot, geo are **not** on the MVP path.

## Critical path to production

On top of MVP:

1. **Owner/CODEOWNERS assignment** (`SIR-GLOB-001`/`SYNC-001`) — blocks release accountability.
2. **Security tail:** MFA (`SIR-GLOB-004`), cross-module read-access ADR (`SIR-GLOB-010`), and confirming
   the repository publication boundary (register access note).
3. **HR/payroll + calendar** if in the production scope (each needs its Decision Record first —
   `SIR-EMP-014` perf budget, HR spec freeze).
4. **Ratify** the still-`Proposed` platform ADRs per Constitution §20 (ADR-019/020 and the 1.2.0 additions).
5. Standard release-workflow gates (G8/G9), migration/rollback rehearsal, observability.

Production is **decision-bound, not implementation-bound**: the remaining engineering is small and
well-scoped, but almost every item waits on a Constitution-reserved human/architecture/product decision.

---

*This report is an estimate produced by code inspection at `9ca0eed`; it does not itself freeze scope or
make any governance decision. See `IMPLEMENTATION_EXECUTION_PLAN.md` for sequencing and
`SPECIFICATION_ISSUES_REGISTER.md` for the authoritative open-issue list.*
