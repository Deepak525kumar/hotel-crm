# Web client — Hotel CRM

Next.js 16 (App Router) dashboard for FHM Hotelservice GmbH's workforce operations platform.
Manager, Regional Manager and Admin surfaces primarily; Worker and Checker self-service secondarily.

**Specification:** [`docs/08-frontend/FRONTEND_SPEC.md`](../docs/08-frontend/FRONTEND_SPEC.md)
· **Docs map:** [`docs/README.md`](../docs/README.md)

## Running it

```bash
npm install          # from the repository root — this is a workspace
npm run dev          # http://localhost:3000, proxies /api/* to the backend
```

The backend must be running (default `http://localhost:3001`). `next.config.ts` rewrites
`/api/:path*` to it — **that same-origin proxy is what makes the cookie auth model safe**, so don't
bypass it by pointing the client at the backend directly. See
[`ADR-071`](../docs/14-governance/architecture-decisions/ADR-071-dual-transport-authentication.md).

## Scripts

| Command | Does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev, production build, serve |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Jest unit tests |
| `npm run test:e2e` | Playwright browser tests (`e2e/`) |
| `npm run test:no-localstorage-tokens` | **Guard — see below** |

## Two things to know before you change anything

**1. Auth tokens never go in `localStorage`.** They live in httpOnly cookies the client cannot read.
`npm run test:no-localstorage-tokens` fails the build if that regresses, because a regression
silently reopens the XSS token-theft path the cookie migration existed to close. If that check
fails, do not work around it.

**2. Role gates must not be exact-match.** `regional_manager` is a distinct role from `manager` and
breaks silently against a gate that only tests for `manager` — the UI simply renders nothing, with
no error. Use the capability hooks (`useEmploymentPermissions()` and friends), not inline role
string comparisons.

## Layout

```
app/          routes; (protected)/ is the authenticated group
components/   shared and feature components
lib/          api.ts (client + refresh/revocation), locales.ts, i18n/, types
stores/       zustand: auth, locale
hooks/        capability seams, data hooks
e2e/          Playwright        __tests__/  Jest
```

Localization (six locales, two RTL) is specified in
[`SPEC-I18N-001`](../docs/02-architecture/system/INTERNATIONALIZATION.md). Deployed on Vercel,
separately from the backend.
