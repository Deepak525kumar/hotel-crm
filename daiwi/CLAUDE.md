# daiwi/

Internal app-distribution portal on :3002. **`README.md` is the runbook** —
setup, nginx, the install flow. This file holds only what is not written
there and has cost time.

## Adding an app takes no migration

`src/lib/apps.ts` is the whole registry. `Build.app`, `InstallEvent.app` and
`PromotionEvent.app` are **TEXT columns, not a Prisma enum**, so a new app is
one row in `APP_DEFINITIONS` and nothing else. The file's header comment
claimed a migration was required until 2026-09-22; it was wrong, and the
manager app was added without one.

Adding a row is not enough on its own: the bundle identifier must match what
the binary actually carries, because `appForBundleId()` resolves builds by
that and **refuses rather than guesses** when nothing matches. Guessing would
publish one app under another's name.

## Uploading is not publishing

Root `CLAUDE.md` says this and it is the single most important fact here: a
build must be dragged into the iOS or Android box to be promoted. An upload
alone changes nothing a user sees.

## It is deliberately isolated from the CRM

nginx strips CRM cookies from these paths (`map $http_cookie`, README §nginx),
so a CRM session never reaches :3002 and a portal session never reaches the
API. Do not "fix" that by sharing auth.

## Gates

```bash
npm run typecheck && npm test
```

`npm test` is `tsx --test test/unit.test.ts` — node's own runner, not jest.
There is no lint script.
