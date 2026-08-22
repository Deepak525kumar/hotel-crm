# Web Client Specification — `frontend-web`

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-FRONTEND-001 / 0.1.0` |
| Status | `REVIEW` — **not frozen.** Authored after implementation, describing as-built behaviour. No G4 round, no G2 freeze. |
| Owner | `unassigned` (`SYNC-001`) |
| Repository revision | Reverse-specified at `8626256` (2026-08-23) |
| Supersedes | None. `MODULE_REGISTRY.yaml` recorded `frontend-web` as `specification: UNKNOWN` until this document. |
| Scope | The Next.js dashboard at `frontend/`. Manager, Regional Manager and Admin surfaces primarily; Worker and Checker self-service surfaces secondarily. Backend behaviour is out of scope and referenced, never redefined. |

## 1. Stack

Next.js 16 (App Router) on React 19, TypeScript. Zustand for client state (two stores: `auth`,
`locale`), `next-themes` for dark mode, `i18next`/`react-i18next` for translation, Tailwind for
styling. Jest for unit tests, Playwright for browser tests (`frontend/e2e/`). Deployed on Vercel,
separately from the backend.

| Directory | Holds |
|---|---|
| `app/` | Routes. `(protected)/` is the authenticated group; `login`, `forgot-password`, `reset-password` sit outside it |
| `components/` | Shared and feature components |
| `lib/` | API client (`api.ts`), locale contract (`locales.ts`), i18n catalogues, shared types |
| `stores/` | `auth.ts`, `locale.ts` |
| `hooks/` | Including `useEmploymentPermissions()`, the role-gate seam for lifecycle actions |
| `e2e/`, `__tests__/` | Playwright and Jest |

## 2. Authentication — the invariant that has a CI guard

**RULE-FE-01. The web client never stores auth tokens in `localStorage`.** Tokens live in httpOnly
cookies set by the backend (`ADR-071`); the client cannot read them and does not try.

This is enforced mechanically, not by review: `npm run test:no-localstorage-tokens` runs
`frontend/scripts/check-no-localstorage-tokens.mjs`. **A regression here silently reopens the XSS
token-theft exposure the cookie migration existed to close**, which is why it is a build-time check
rather than a convention.

Session bootstrap is asynchronous: `SessionBootstrap` calls `GET /auth/me` after mount, so first
paint does not know who the user is. Anything depending on identity or stored preference must
tolerate that gap rather than assume it away.

`lib/api.ts` owns token-revocation handling and refresh-retry; those paths have dedicated tests
(`__tests__/`) because they are where a silent logout or an infinite retry loop would hide.

## 3. Routing and authorization

Routes under `app/(protected)/` require a session. **Server route grouping is not an authorization
boundary** — every meaningful check is enforced by the backend, and the client's role gating is a
usability affordance that hides actions the caller could not perform anyway.

**RULE-FE-02. Role gates must not be exact-match against a single role string.** `regional_manager`
is a distinct role from `manager` and breaks silently when a gate tests only for `manager`. Use the
capability seams (`useEmploymentPermissions()` and equivalents) rather than inline role comparisons.

Surfaces: dashboard, hotels and hotel groups (incl. org chart), users, employees and onboarding
review queue, calendar and assignments, requests and broadcasts, attendance, analytics,
leaderboard, payslips, notifications, profile, settings.

## 4. Theme and locale

Dark mode is a manual toggle defaulting to the OS preference, via `next-themes`. It sets a class
client-side after server render; `suppressHydrationWarning` on the single mutated element is
next-themes' documented pattern, not blanket hydration suppression.

Locale behaviour is specified in [`SPEC-I18N-001`](../02-architecture/system/INTERNATIONALIZATION.md)
and not restated here. The web-specific part: `app/layout.tsx` ships `lang="de" dir="ltr"` as a
pre-hydration placeholder and `LocaleProvider` rewrites both client-side once the stored preference
resolves.

## 5. Open decisions

| ID | Item | Status |
|---|---|---|
| `OD-FE-01` | No component-level design system or documented component contract | **OPEN** |
| `OD-FE-02` | Accessibility has never been audited; no WCAG target is set | **OPEN** |
| `OD-FE-03` | No performance budget (bundle size, LCP) | **OPEN** |
| `OD-FE-04` | Playwright coverage is narrow relative to the surface area | **OPEN** |
| `OD-FE-05` | `frontend/README.md` is still unmodified `create-next-app` boilerplate | **OPEN** |

## 6. Evidence

`frontend/package.json` (stack, scripts), `frontend/lib/api.ts`, `frontend/lib/locales.ts`,
`frontend/app/layout.tsx`, `frontend/stores/`, `frontend/scripts/check-no-localstorage-tokens.mjs`,
`.claude/knowledge/MODULE_REGISTRY.yaml` (`frontend-web`).
