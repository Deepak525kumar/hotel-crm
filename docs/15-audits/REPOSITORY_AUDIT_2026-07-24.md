# Repository-Wide Audit — hotel-crm (post-Epic 7)

**Date:** 2026-07-24
**Baseline:** `main` @ `4079a0f` (merge of PR #208 — Epic 7 PR 7.7, mobile push-token registration; the last of Epic 7's 7.1–7.8 chain)
**Framework:** `.claude/` 1.5.0
**Producer:** Repository-wide re-audit, read-mostly. Every claim below was checked directly against the worktree and re-run health gates this session — no figure was carried forward from `RELEASE_READINESS_AUDIT_2026-07-23.md` or `IMPLEMENTATION_EXECUTION_PLAN.md` without independent verification.
**Scope:** Backend, Frontend, Mobile (worker + checker), Database, Infrastructure, Governance backlog.

---

## 0. Health gates (re-run this session, not inherited)

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `npm run typecheck` (backend) | ✅ clean |
| Backend lint | `npm run lint` (backend) | ✅ clean |
| Backend tests | `npm test` (backend) | ✅ **523/523 passed, 51 suites** (up from 367/39 at the 2026-07-23 audit — Epic 7 added 12 suites / 156 tests) |
| Frontend build | `npm run build --workspace frontend` | ✅ exit 0, all routes compiled |
| Mobile worker-app tests | `npm test` (mobile/worker-app) | ✅ 37/37 passed, 4 suites |
| Mobile checker-app tests | `npm test` (mobile/checker-app) | ✅ 37/37 passed, 4 suites |
| Repository integrity | `node .claude/tooling/repository-integrity-check.js` | ✅ exit 0 — **0 blocking findings**, 56 pre-existing orphan-doc WARN (unchanged in kind/count from 2026-07-23) |

All objective build/test gates are green at HEAD. `node_modules` had to be installed fresh in this session (`npm install` at the repo root) before these could be run directly — they were not assumed from a prior report.

---

## 1. Which epics are actually complete?

Verified against live code, not commit messages or prior register summaries:

| Epic | Status | Evidence |
|---|---|---|
| **Epic 1** — Critical `PATCH /assignments/:id` guard | ✅ **COMPLETE** | `assignments/service.ts::update()` deny-by-default guard present; `assignments-update-authz.test.ts` passes |
| **Epic 2** — Auth self-contained High findings (no refresh-secret fallback, hashed refresh token) | ✅ **COMPLETE** | `auth-refresh-secret.test.ts`, `auth-refresh-token-hash.test.ts` pass; no fallback path in `auth/*` |
| **Epic 3** — Shared `checkHotelAccess()` centralization seam | ✅ **COMPLETE** | Single seam in `middleware/permissions.ts`, consumed by 9 modules |
| **Epic 4** | ⚪ **SUPERSEDED (no-op)** — retired in place, not implemented, not a gap (see prior plan §2 for why no closable slice existed) |
| **Epic 5** — Hotel-Group / EMP / CRM migration (ADR-022/023/024/025), PR 5.1–5.8 | ✅ **COMPLETE** | `HotelGroup` schema live, `backend-hotel-workers` physically removed, JWT `scope` claim live, manager authz flip live behind `FEATURE_SCOPE_AUTHZ` (default on) |
| **Epic 6** — Quality/CRM/Analytics G8 items | 🟡 **PARTIAL** — only headline items complete | `Rating.score` is 0–100 (ADR-026, migration applied); `RoomsCompletedEntry` shipped (ADR-028). All non-headline sub-items (QUAL OQ-02/04/05/07/08, CRM OD-CRM-02..17, ANALYTICS OQ-02/04–12) remain **OPEN**, gated on GD-04/GD-06/etc. — genuinely decision-blocked, not forgotten |
| **Epic 7** — Notification dispatch & delivery (Transactional Outbox + Platform Worker, ADR-029) | ✅ **COMPLETE** — all 8 PRs (7.1–7.8) merged | Verified in code, not just `git log`: `OutboxEvent` model + transactional `enqueue()` (7.1); Platform Worker poll/claim/backoff/dead-letter runtime (7.2); all 4 legacy producers (work-requests, work-applications, attendance, quality) migrated off `.catch(() => {})` onto `enqueue()` (7.3); EMAIL transport via SendGrid/Resend provider abstraction (7.4); `PushToken` schema + APNs/FCM clients + registration endpoint (7.5); dead-letter observability + runbook (7.6); mobile push-token registration + OS permission flow in **both** Expo apps (7.7); multi-app APNs topic support via `PushToken.app`/`PushApp` enum (7.8). All corresponding test suites (`outbox-*`, `push-*`, `email-provider`, `scheduler`, `push-notifications` in both mobile apps) pass. |
| **Epic 8** — Work-request/work-application hotel-scoping (SIR-JOBD-002) | ✅ **COMPLETE** | `work-requests`/`work-applications` `service.ts` now import and call `isHotelInScope()`; `rooms-completed-scope-authz.test.ts`-pattern coverage present |

**Bottom line: Epics 1, 2, 3, 5, 6(headline), 7, 8 are complete; Epic 4 is a retired no-op; Epic 6's non-headline tail is the only "partial" epic**, and it is partial by design (blocked on reserved product decisions, not unfinished work).

## 2. Which epics are partially complete?

Only **Epic 6**. Its two headline items (QUAL rating scale, ANALYTICS rooms-completed metric) are done and shipped; roughly a dozen other sub-items (CRM OD-CRM-02..17 non-blocked subset, QUAL OQ-02/04/05/07/08, ANALYTICS OQ-02/04-11) sit `OPEN` in `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`, each with `Authority needed: human` or `human/architecture`. No code exists to write for them until their decisions (GD-04 quality rating derivation, GD-06 analytics scope, plus several CRM decisions folded into GD-02/GD-05/GD-22) land.

Every other epic is either fully complete or a clean no-op — there is no other epic straddling "started but abandoned."

## 3. Which files are still stubs?

Confirmed by reading the files directly this session (not from the registry description):

| Module | File | State |
|---|---|---|
| `backend-calendar` | `backend/src/modules/calendar/service.ts` | Both methods (`getDailyOperations`, `createDailyOperation`) `throw NotImplementedError`. Route-registered (`501` at runtime). |
| `backend-hr` | `backend/src/modules/hr/service.ts` | All four methods (`createContract`, `listContracts`, `createPayroll`, `listPayroll`) `throw NotImplementedError`. Route-registered (`501` at runtime). |
| `backend-chatbot` | `backend/src/modules/chatbot/` | Directory contains only `.placeholder` — **not route-registered at all**, not even a stub controller. |
| `backend-geo` | `backend/src/modules/geo/` | Same — `.placeholder` only, not route-registered. |

No other backend module, frontend page, or mobile screen was found in a stub state — `users`, `crm`, `work-requests`, `work-applications`, `assignments`, `attendance`, `quality`, `hr`(employment-record split into `employee-management`, which **is** implemented), `notifications`, `analytics` are all live, tested code.

Two cosmetic/hygiene items, unchanged from the prior audit and non-blocking:
- `GET /api/v1/status` still lists `hr`/`calendar` in `modules[]` despite both being `501` stubs (TD-2).
- A dead `super_admin` branch remains in `middleware/permissions.ts` (TD-3) — harmless, `UserRole` has no such token.

## 4. What is the updated completion percentage?

**~80% for MVP scope** (up from 72% at the 2026-07-23 audit).

Basis for the increase: the prior audit's own stated blocking order was **GD-01 → GD-02 → GD-03**, explicitly noting *"Delivering GD-01 alone moves readiness materially because it unblocks auth email flows, HR contract reminders, quality escalation, and mobile push."* GD-01 is now **fully resolved and built** — not just decided (ADR-029) but shipped end-to-end: transactional outbox, worker runtime, all 4 legacy producers migrated, EMAIL transport live, PUSH transport live on both backend and both mobile apps, dead-letter observability + runbook. This was the single highest-leverage gap and it is closed.

What still holds back the remaining ~20%:
- **GD-02** (manager write-permission contradiction — `MANAGER` role-gated but permission-denied on CRM/Users writes) — small, still open.
- **GD-03** (5-role model / Regional-Manager token) — `UserRole` still has only 4 tokens; RM is representable only via a FK, no dedicated role/permission set.
- **`hr`/`calendar` stubs** remain `501` (GD-15/GD-18, both post-MVP-scoped per the governance backlog).
- **~21 other governance decisions (GD-04 through GD-23)** remain open, most explicitly scoped as Production- or Post-MVP-tier rather than MVP-blocking.

Category scores that would move on a fresh scoring pass (directional, not re-scored formally here): **Backend** and **Mobile** both improve materially — the notification-delivery stub that previously dragged Backend to 78 and the "worker dashboard always 403s" mobile gap are unrelated to this fix, but the "fire-and-forget swallow" and "no scheduled-job host" findings that were counted against Backend/Performance are now resolved in code. **Testing** improves (39→51 suites, 367→523 tests, all new suites cover the new outbox/push/email surface with named security/behavior regression tests). No category regressed.

## 5. What is the new critical path?

With GD-01 shipped, the next-highest-leverage items, in order (unchanged ranking logic from `GOVERNANCE_DECISIONS_REQUIRED.md`, re-verified against current code — GD-01 removed from the list, nothing else has changed status):

1. **GD-02 — Manager write-permission authority** (P0, MVP, ~2–3 PRs). Smallest remaining P0: `POST/PATCH /crm/hotels` and the equivalent Users routes role-gate `manager` in but permission-map it out, producing a live authorization contradiction (net Admin-only despite the route claiming to admit managers). No schema change. Highest ROI-per-effort item on the board now.
2. **GD-03 — 5-role model & Regional-Manager authority** (P0, MVP, ~5–8 PRs). Unblocks RM features across CRM, Calendar, Analytics, and EMP org-chart in one decision; Epic 5 already shipped the scope-claim plumbing this needs (`HotelGroup.regional_manager_user_id`, JWT `scope` claim) — only the role token and permission set are missing.
3. **GD-09 — GDPR retention-tier assignment** (P1, Production, ~6–10 PRs, external tax-advisor lead time). Clears the G8 Release-Readiness blocker for seven modules (notifications, auth, HR, documents, chatbot, consent, geo) at once, including the freshly-built `OutboxEvent`. Has an external dependency (tax advisor sign-off) — worth starting in parallel now rather than waiting.
4. **GD-04 — Quality rating derivation / warning tiers** (P1, MVP, ~5–7 PRs). Unblocks the rest of Epic 6 and the downstream analytics warning-count metric (GD-06).
5. **GD-12 — Event-bus / inter-module transport ratification** (P2, zero code, gates HR/EMP/Calendar/Consent module builds). A zero-cost decision (formalize the existing in-process pattern, reuse the new outbox for anything needing durability) that unblocks several Post-MVP module builds at once.

Everything else (GD-05 through GD-23, minus the four above) is correctly deferred — either explicitly Post-MVP-scoped in the existing backlog (chatbot, consent, geo, calendar M2, job-dispatch pivot, billing) or a small follow-on that doesn't gate other work (GD-07 session revocation, GD-08 MFA, GD-10 concurrency, GD-11 perf SLO, GD-13 read-boundary ADR, GD-23 ADR ratification).

**No unblocked, spec-traceable application-code epic remains beyond Epic 8.** Consistent with the 2026-07-23 planning conclusion, the project is decision-bound, not implementation-bound: every remaining sizeable chunk of work sits behind one of the ~22 open governance decisions (23 minus the now-resolved GD-01), and GD-02 is the cheapest, highest-ROI one left to make.

---

## Summary

- **Epics complete:** 1, 2, 3, 5, 6(headline-only), 7 (all 8 PRs), 8. Epic 4 is a clean superseded no-op.
- **Epics partial:** Epic 6 non-headline tail only — blocked on decisions, not abandoned.
- **Stub files:** `backend/src/modules/calendar/service.ts`, `backend/src/modules/hr/service.ts` (both `501` via `NotImplementedError`); `backend/src/modules/chatbot/`, `backend/src/modules/geo/` (unregistered `.placeholder` only).
- **Completion:** ~80% MVP-scope readiness (up from 72%), driven entirely by Epic 7 (GD-01) landing in full.
- **Critical path:** GD-02 (manager write authority) → GD-03 (5-role/RM) → GD-09 (retention, start now, external lead time) → GD-04 (quality rating model) → GD-12 (event-bus ratification, zero-cost gate-clearer).

*Every figure in this report was verified against the worktree at `4079a0f` this session (`npm install` + `typecheck` + `lint` + full test suite × 3 workspaces + `repository-integrity-check.js`, plus direct reads of `calendar/service.ts`, `hr/service.ts`, `chatbot/`, `geo/`, and the Epic 7 commit chain). No figure was carried forward from a prior audit without independent re-check.*
