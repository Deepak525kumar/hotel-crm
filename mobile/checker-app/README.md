# Quality Checker app — Hotel CRM

Expo / React Native application for FHM Hotelservice GmbH's workforce operations platform.
Role: **Quality Checker**.

**Specification:** [`docs/09-mobile/MOBILE_SPEC.md`](../../docs/09-mobile/MOBILE_SPEC.md)
· **Docs map:** [`docs/README.md`](../../docs/README.md)

## Running it

```bash
npm install        # from the repository root — this is a workspace
npx expo start
```

Point it at a running backend. **Check the API base URL before every EAS build** — a misconfigured
build produces an app that launches, renders correctly, and cannot connect to anything. That has
shipped before (PRs #488, #492).

## Screens

Shared with the sibling app: login, home, profile, notifications, absences, consent, documents, HR.
Specific to this one: attendance detail with geo verification, quality verification and rating with photo capture, leaderboard.

## Two things to know before you change anything

**1. Auth is bearer tokens, not cookies.** The web client uses httpOnly cookies; this app cannot —
bare `fetch()` ignores `Set-Cookie` and has no cookie jar. Tokens are persisted via
`src/lib/persistent-storage.ts` (`expo-secure-store`: Keychain on iOS, EncryptedSharedPreferences
on Android). The backend serves both transports unconditionally, so no negotiation happens. See
[`ADR-071`](../../docs/14-governance/architecture-decisions/ADR-071-dual-transport-authentication.md).

**2. The client never adjudicates.** Geofence outcomes, eligibility and lifecycle transitions are
all decided server-side. A visible button does not mean the user is authorized — render optimistically
if you like, but never treat a client-side check as the decision.

## Localization

Six locales, two right-to-left (`ar`, `ur`), each app carrying its own catalogue copy. Specified in
[`SPEC-I18N-001`](../../docs/02-architecture/system/INTERNATIONALIZATION.md). **On-device RTL has
never been verified** (`OD-MOB-04`) — if you have a device, check it and record the result.

## Known gaps

No automated test suite (`OD-MOB-02`). Offline behaviour is unspecified (`OD-MOB-03`). No
documented minimum OS versions (`OD-MOB-06`).
