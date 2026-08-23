# Mobile Client Specification — `mobile-worker`, `mobile-checker`

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-MOBILE-001 / 0.1.0` |
| Status | `REVIEW` — **not frozen.** Authored after implementation. No G4 round, no G2 freeze. |
| Owner | `unassigned` (`SYNC-001`) |
| Repository revision | Reverse-specified at `8626256` (2026-08-23) |
| Supersedes | None. `MODULE_REGISTRY.yaml` recorded both apps as `specification: UNKNOWN` until this document. |
| Scope | Two Expo applications: `mobile/worker-app` (Worker) and `mobile/checker-app` (Quality Checker). One document because they share a stack, an auth model, and most infrastructure; their screen sets differ and are specified separately below. |

## 1. Stack

Expo SDK 57, React Native 0.86, `expo-router` 57, TypeScript. Both apps are built with EAS.
A single combined app (formerly at `mobile/hotel-crm-app`) was retired; the two-app split is the
current architecture. That path no longer exists and citations to it elsewhere are historical.

## 2. Authentication — and how it differs from web

**RULE-MOB-01. Mobile authenticates with `Authorization: Bearer`, not cookies.** The apps use bare
`fetch()` clients that ignore `Set-Cookie` outright and never send a cookie back. The backend serves
both transports unconditionally on every auth response, so no client-type negotiation happens
(`ADR-071`).

Tokens are persisted through `src/lib/persistent-storage.ts`, which uses `expo-secure-store`
(Keychain on iOS, EncryptedSharedPreferences on Android) on device and `localStorage` on web.

**This is a real asymmetry, not an oversight to fix casually.** The web client was moved off
`localStorage` precisely to close an XSS token-read path; mobile retains token storage because it
has no equivalent cookie mechanism. Whether mobile storage needs its own hardening is recorded as
open at `ADR-071` `OD-AUTH-T3` and is **not decided here**.

## 3. Screens

Both apps share: `(auth)/login`, `(app)/index`, `(app)/profile`, `(app)/notifications`,
`(app)/absences`, `consent`, `documents`, `hr`.

| Worker (`mobile/worker-app`) | Checker (`mobile/checker-app`) |
|---|---|
| `(app)/shifts`, `shift/[id]` — assigned shifts, check-in/out | `attendance/[id]` — attendance detail with embedded geo verification |
| `(app)/marketplace`, `offer/[id]`, `job/[id]` — broadcasts and acceptance | `quality/[id]`, `verification/[id]` — verification with photo capture |
| `ratings` — own ratings and stats | `rating/[id]` — rating a worker |
| `rework/[id]` — rework assignment with photo evidence (`ADR-069`) | `(app)/leaderboard` — quality leaderboard |

## 4. Cross-cutting behaviour

- **Consent gate.** Both apps enforce the daily GDPR access gate (`consent.tsx`), specified by
  `SPEC-CONSENT-001` and E2E scenario 11. It is a hard gate: unresolved consent blocks the app.
- **Localization.** Both carry their own copy of all six catalogues. See `SPEC-I18N-001`, including
  `OD-I18N-02` — catalogue *content* has no cross-client drift guard, only the locale list does.
- **Push.** `src/lib/push-notifications.ts` registers a device token via
  `IF-NOTIF-RegisterPushToken`. Delivery is the backend's transactional outbox (`ADR-029`).
- **Geo.** Check-in may carry a geo payload verified by `backend-geo`. `ADR-066`/`SPEC-GEO-001`
  govern; the client supplies coordinates and never decides whether a geofence passed.

**RULE-MOB-02. The client never adjudicates.** Geofence outcomes, eligibility, and lifecycle
transitions are all decided server-side. A mobile screen showing an action does not mean the caller
is authorized to perform it.

## 5. Build and release

EAS builds must point at the real production API — a misconfigured build produces an app that
launches, renders, and cannot connect, which has happened (PRs #488, #492). Verify the API base URL
in the EAS profile before every release build.

## 6. Open decisions

| ID | Item | Status |
|---|---|---|
| `OD-MOB-01` | Mobile token-storage hardening | **OPEN** — same item as `ADR-071` `OD-AUTH-T3` |
| `OD-MOB-02` | No automated mobile test suite; neither app has E2E coverage | **OPEN** |
| `OD-MOB-03` | Offline behaviour is unspecified — what a worker can do without connectivity | **OPEN** |
| `OD-MOB-04` | RTL rendering has not been verified on device for `ar`/`ur` | **OPEN** |
| `OD-MOB-05` | Both `README.md` files were unmodified Expo boilerplate ("Welcome to your Expo app") | **RESOLVED 2026-08-23** — replaced with per-app READMEs |
| `OD-MOB-06` | No documented minimum OS versions or device support matrix | **OPEN** |

## 7. Evidence

`mobile/*/package.json`, `mobile/*/src/app/` (screen inventory), `mobile/*/src/lib/persistent-storage.ts`,
`mobile/*/src/lib/push-notifications.ts`, `mobile/*/src/lib/i18n/locales/`,
`.claude/knowledge/MODULE_REGISTRY.yaml` (`mobile-worker`, `mobile-checker`).
