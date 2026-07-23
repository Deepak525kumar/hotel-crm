# Release Readiness Audit — hotel-crm

**Date:** 2026-07-23
**Baseline:** `origin/main` @ `2fd9437` (post PR #197 — frontend architecture bootstrap)
**Framework:** `.claude/` 1.5.0
**Producer:** Repository-wide Release Readiness Audit (read-mostly; verification against current code, not prior reports)
**Scope:** Backend, Frontend, Mobile (worker + checker), API, Database, Infrastructure, Security, Performance, Testing, Documentation.

> Every finding below was verified directly against the worktree at `2fd9437`. Where a finding
> restates an already-catalogued governance blocker it is cross-referenced to its `GD-*` /
> `SIR-*` canonical source rather than duplicated. Prior audit reports were **not** trusted; each
> claim was re-checked in code.

---

## 1. Release Readiness Report

### Health verification (objective gates, re-run this session)

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `npm run typecheck` (backend) | ✅ clean |
| Backend lint | `npm run lint` (backend) | ✅ clean |
| Frontend build | `npm run build --workspace frontend` | ✅ exit 0 |
| Repository integrity | `node .claude/tooling/repository-integrity-check.js` | ✅ 0 new blocking (4 baselined, 56 warnings) |
| Backend test surface | `src/__tests__/*.test.ts` | 39 test files (incl. authz + migration characterization suites) |

The three build/quality gates are **green**. The repository is internally consistent at the
tooling level: the deterministic integrity gate reports **zero new blocking findings**. This is a
disciplined, well-governed codebase — the modular-monolith boundaries, a single hotel-access
authorization seam (`resolveHotelAccess`), centralized error handling, feature-flag cutover seams,
and an exhaustive ADR / specification-issues governance corpus are all in place and coherent.

### What is production-ready today

The MVP transactional core is implemented, typechecks, lints, builds, and is test-covered:
`auth` (JWT access/refresh with dedicated refresh secret, hashed refresh tokens, password reset),
`users`, `crm` (hotels / hotel-groups), `work-requests`, `work-applications`, `assignments`,
`attendance`, `quality` (0–100 rating scale, ADR-026), `analytics`, and `notifications` (in-app
CRUD). Infrastructure is mature: least-privilege CI, a gated production deploy (manual environment
approval, non-cancelling concurrency, migration-drift validation before `migrate deploy`), Nginx
TLS termination with HSTS/CSP/rate-limiting, and reversible `down.sql` for every migration.

### What blocks a full production cutover

Delivery of notifications (email/push) is **stubbed** (`throw NotImplementedError`), two support
modules (`hr`, `calendar`) are mounted but **unimplemented** (`501`), and ~23 product/architecture
decisions (`GD-01..23`) remain reserved for the human product owner. None of these are silent —
they are catalogued in `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` and the
`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`. This audit **confirms** that inventory
against current code and adds independent cross-cutting observations (§Findings).

---

## 2. Repository Health Score

**Overall: 77 / 100 — "Release-ready core, decision-gated completion."**

The score reflects a clean, coherent, well-tested MVP core (build gates green, strong architecture
and governance) held back from a full-scope production release by a small number of **stubbed
delivery paths** and a **large but explicitly-tracked backlog of reserved product decisions**. The
debt is disclosed, not hidden — which is itself a mark of health.

---

## 3. Category Scores

| Category | Score | Basis (verified) |
|---|---:|---|
| **Architecture** | 84 | Clean modular monolith; per-module `controller/routes/service/types`; single `resolveHotelAccess` authz seam; `BaseService`; ADR corpus + dependency graph. Cross-module state-read boundary still un-ratified (GD-13). |
| **Documentation** | 85 | Exceptional governance/ADR/registers; deterministic integrity CI. −: 4 baselined broken README links (SIR-GLOB-020) + 56 orphan-doc warnings (knowledge-graph hygiene). |
| **Accessibility** | 82 | Dedicated a11y PRs shipped: drawer focus management, contrast/focus rings, table accessible names, `role="alert"` FormError, root spinner `status` role (N1–N5, commits `24db347`/`b24ba92`/`6a1df1b`). |
| **Frontend** | 80 | `next build` green; consolidated shared UI kit + hooks (`usePaginatedList`, `useAsyncAction`); responsive nav; SWR + Zustand. −: access/refresh tokens in `localStorage` (XSS-exposure, architectural). |
| **Infrastructure** | 80 | Comprehensive CI (integrity + context + backend + frontend + mobile matrix); gated deploy w/ approval, concurrency, migration validation; Nginx hardening. −: no Dockerfile (EC2 + pm2 path); no app-layer defense-in-depth. |
| **Backend** | 78 | Typecheck/lint clean; solid layering, error mapping, transactions via Prisma `$transaction`. −: `hr`/`calendar` are `501` stubs; notification delivery stubbed; quality dual-writer (§F-2). |
| **Performance** | 74 | Schema indexes present; reviewed list paths use `Promise.all` + pagination; roster fan-out is non-blocking. −: no SLO/workload baseline (GD-11); fan-out swallows per-recipient errors (§F-3). |
| **Mobile** | 72 | Two Expo apps; `SecureStore` token storage (secure); unit tests + CI matrix. −: expo scaffold residue (`explore.tsx`); worker dashboard calls an admin-only analytics route → always 403 (GD-06). |
| **Security** | 70 | Nginx supplies HSTS/CSP/X-Frame/rate-limiting; dedicated refresh secret; hashed refresh tokens; scoped authz. −: no app-layer `helmet`/rate-limit/CSRF (proxy-only); web `localStorage` tokens; no MFA (GD-08); dead `super_admin` branch. |
| **Testing** | 68 | 39 backend suites incl. authz + migration characterization; mobile unit tests. −: no e2e; no frontend unit tests; stub modules uncovered; no coverage gate in CI. |

---

## 4. Production Readiness %

**~72% for MVP scope.**

The transactional core is production-grade and green. The remaining 28% is dominated by three
gates, in priority order: **GD-01** (notification dispatch/delivery model — highest leverage,
unblocks the widest surface), **GD-02** (manager write-permission contradiction), and **GD-03**
(5-role / Regional-Manager model). Delivering GD-01 alone moves readiness materially because it
unblocks auth email flows, HR contract reminders, quality escalation, and mobile push.

---

## 5. Remaining Technical Debt (verified, not decision-blocked)

- **TD-1 — Orphaned documentation (knowledge-sync).** 56 `orphan-document` warnings: framework
  `agents/`, `checklists/`, `templates/` and several `docs/03-modules/*/MODULE_SPEC.md` have no
  inbound reference. Non-blocking; a knowledge-graph index pass would clear them. Evidence:
  integrity report, this session.
- **TD-2 — Stub modules advertised as available.** `GET /api/v1/status` lists `hr` and `calendar`
  in `modules[]`, but both throw `NotImplementedError` (`501`). Cosmetic/informational mismatch.
  Evidence: `src/routes/v1/index.ts:80`, `src/modules/{hr,calendar}/service.ts`.
- **TD-3 — Dead `super_admin` branch.** `requirePermission` special-cases `role === 'super_admin'`,
  a token that cannot exist (`UserRole` enum = `WORKER/CHECKER/MANAGER/ADMIN`). Harmless dead
  defensive code. Evidence: `src/middleware/permissions.ts:20`, `schema.prisma:22`.
- **TD-4 — Expo scaffold residue in mobile.** `explore.tsx` (`TabTwoScreen`) and root
  `src/app/index.tsx` are template leftovers. Evidence: `mobile/*/src/app/explore.tsx`.
- **TD-5 — No coverage gate.** `test:coverage` exists but CI runs `npm test` without a threshold;
  frontend has no unit tests; no e2e layer. Evidence: `.github/workflows/ci.yml`, `backend/package.json`.

*(These are engineering-hygiene items, not product decisions — but each still carries a non-zero
risk of touching an API-response shape (TD-2), authz code (TD-3), or navigation (TD-4), so they are
reported for prioritization rather than auto-applied — see §Phase 4.)*

## 6. Remaining Implementable Work (no reserved decision required)

1. Knowledge-graph index pass to clear the 56 orphan-doc warnings (TD-1).
2. Add a CI coverage threshold + a minimal frontend unit-test harness (TD-5).
3. Prune expo scaffold routes from both mobile apps after a device smoke test (TD-4).
4. Remove the dead `super_admin` branch under a focused authz review (TD-3).

These are safe in principle but each touches a live surface (docs graph, CI policy, mobile nav,
authz), so they are **recommended as small reviewed PRs**, not silent audit-time edits.

## 7. Remaining Governance-Blocked Work

The authoritative backlog is `docs/implementation/GOVERNANCE_DECISIONS_REQUIRED.md` (**GD-01..23**),
re-verified against code this session. Highest-leverage, in order:

| ID | Decision | Priority | Verified current state |
|---|---|---|---|
| GD-01 | Notification dispatch & delivery model | P0 | `sendEmail`/`sendPushNotification` throw `NotImplementedError`; 10 fire-and-forget `.catch(() => {})` swallow sites. |
| GD-02 | Manager write-permission authority | P0 | `POST/PATCH /crm/hotels` gate `requireRole(['admin','manager'])` **and** `requirePermission('hotels:write')`, but `MANAGER` lacks `hotels:write` → net Admin-only (`constants.ts` ROLE_PERMISSIONS, `crm/routes.ts:12,14`). |
| GD-03 | 5-role model & Regional-Manager authority | P0 | `UserRole` has 4 tokens; RM representable only as a `HotelGroup` FK (`schema.prisma:22,231`). |
| GD-04 | Quality rating derivation / dual-writer | P1 | DB trigger `Rating_refresh_overall_rating` **and** app `workerOverallRating.upsert` both write `average_score` (`quality/service.ts:196`, migration `...init/migration.sql:629`). |
| GD-06 | Worker analytics scope | P1 | `mobile-worker` calls `GET /analytics/stats` (admin/manager-only) → always 403 (`worker-app/src/app/(app)/index.tsx:36`). |
| GD-07/08 | Session revocation, auth rate-limit, MFA | P1/P2 | No app-layer rate-limit (Nginx-only); no MFA data model. |
| GD-05, GD-09..23 | Product/architecture scope decisions | P1–P3 | Per the backlog; none implementable without a reserved decision. |

## 8. Recommended Execution Order

1. **GD-01 (notifications outbox + scheduled worker)** — unblocks the widest surface (auth email,
   HR reminders, quality escalation, mobile push) and fixes the silent-failure swallow.
2. **GD-02 (manager write scope)** — small, removes a live authorization contradiction on CRM/Users.
3. **GD-03 (Regional-Manager role/token)** — unblocks org-chart, group-scoped scheduling & analytics.
4. **GD-04 (single-writer quality aggregate + delete-behavior)** — correctness before layering tiers.
5. Engineering-hygiene PRs (§6) in parallel — none block, none conflict.
6. **GD-07/08 (revocation, auth rate-limit, MFA)** before external exposure.
7. Remaining GD-05, GD-09..23 by product priority.

## 9. Next Highest-ROI Tasks

- **GD-01** — one decision unblocks ~4–6 PRs across backend/mobile and eliminates a whole class of
  silent notification failures. Highest ROI on the board.
- **GD-02** — ~2–3 PRs, resolves a concrete authz contradiction; very high ROI-per-effort.
- **Coverage gate + frontend test harness (TD-5)** — cheap, compounding regression protection.
- **Orphan-doc index pass (TD-1)** — cheap, restores the knowledge-graph invariant the tooling
  already checks for.

## 10. Final Conclusion

**The hotel-crm repository is internally consistent and its MVP core is release-ready; full
production readiness is decision-gated, not defect-gated.** All objective build gates are green,
the architecture is clean and well-bounded, and — unusually — the entire remaining-work surface is
already catalogued and traceable through the governance registers. No new blocking integrity
findings exist. The path to production runs through **product/architecture decisions**
(GD-01 → GD-02 → GD-03 → GD-04) rather than through hidden bugs or structural remediation.

**Audit stop condition reached:** the remaining work is either **governance-blocked**
(reserved product/architecture decisions, GD-01..23) or **decision-adjacent engineering hygiene**
(§6) that each touch a live surface (authz, CI policy, mobile navigation, docs graph) and are
therefore recommended as small reviewed PRs rather than applied as unreviewed audit-time edits.
Under the Phase-4 gate ("behavior-preserving **and** reversible **and** low-risk **and** no
contract/architecture/product decision"), **no finding qualified for automatic in-place code
change** — every candidate either restated a reserved decision or touched authorization / API
response shape / navigation. The audit therefore delivers this verified report as its artifact and
stops per Stop Condition #1/#3/#4.
