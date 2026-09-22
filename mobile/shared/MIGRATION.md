# What in here has a twin, and where

`mobile/shared` is consumed by `mobile/manager-app` only. `worker-app` and
`checker-app` still carry their own copies of most of these files
(`MANAGER_APP_PLAN.md` D-2: no migration risk to two production apps while a
third is being built).

That is three copies of the design system, and it is a real cost, not a
footnote. This file exists so the eventual migration is a checklist rather
than an archaeology exercise — and so that anyone fixing a bug in one copy
can find the other two in one place.

## Copied verbatim from `worker-app` at 2026-09-22

Fix a bug in any of these and the same bug exists in **both** other apps:

| This package | Twin in `worker-app` | Twin in `checker-app` |
|---|---|---|
| `src/constants/theme.ts` | `src/constants/theme.ts` | same |
| `src/constants/polling.ts` | `src/constants/polling.ts` | same |
| `src/components/themed-text.tsx` | `src/components/themed-text.tsx` | same |
| `src/components/themed-view.tsx` | `src/components/themed-view.tsx` | same |
| `src/components/ui/index.tsx` | `src/components/ui/index.tsx` | same |
| `src/hooks/use-theme.ts` | `src/hooks/use-theme.ts` | same |
| `src/hooks/use-color-scheme.ts(.web.ts)` | same | same |
| `src/lib/persistent-storage.ts` | `src/lib/persistent-storage.ts` | same |
| `src/lib/api.ts` | `src/lib/api.ts` | near-identical |
| `src/lib/api-error-i18n.ts` | `src/lib/api-error-i18n.ts` | same |
| `src/lib/locales.ts` | `src/lib/locales.ts` | same |
| `src/lib/i18n/**` | `src/lib/i18n/**` | same |
| `src/stores/*.ts` | `src/stores/*.ts` | near-identical |
| `src/types/api.ts` | `src/types/api.ts` | near-identical |

## Deliberate divergences from the copies

These are **not** drift. Each is a decision recorded here so a future
migration does not "fix" it back:

1. **`api.ts` takes worker-app's version, not checker-app's.** checker-app
   hardcodes `'Content-Type': 'application/json'` on every request;
   worker-app duck-types FormData and omits the header so the runtime can set
   its own multipart boundary. Every document, photo and signed-contract
   upload in the manager app depends on the latter. checker-app's copy is the
   one that is wrong, and fixing it is its own change.

2. **`ScreenHeader` renders title-then-subtitle.** The two apps disagree
   (worker renders subtitle first, checker title first) and a single shared
   copy can only have one. Title first, because the subtitle is context for
   the title rather than the other way round.

3. **`themed-text` adds `h1` (28/34/700) and `h2` (20/26/600).** An addition,
   never a change to `title`/`subtitle` — those still render at 48pt and 32pt
   exactly as the shipped apps expect. See the comment in the file for why a
   manager screen needs a smaller heading than a worker's home screen.

4. **`PushApp` includes `MANAGER`.** Matches the backend enum as of the
   migration in `backend/prisma/migrations/20260922090000_push_app_manager`.

5. **`DashboardStats` describes the response the endpoint actually returns.**
   The copies in both shipped apps declare
   `{ total_shifts, completed_shifts, upcoming_shifts, average_rating }` and
   **not one of those four fields exists**. `GET /analytics/stats` returns a
   nested `work_requests`/`assignments`/`attendance`/`quality`/`ratings`/
   `rooms_completed` shape and always has. The old type was hand-written to
   describe a response nobody had read back, so `tsc` checked against a
   fiction and every stat card rendered `undefined`.

   Corrected here and pinned by `manager-app`'s `analytics-contract.test.ts`,
   which type-checks against the backend's own declaration in both directions.
   The shipped apps are deliberately left alone: a worker's call to that route
   403s before the shape ever matters (`SIR-ANLY-002`), so this is latent
   there, and reaching into a production app to fix a latent bug is its own
   change with its own gates. Tracked as `SIR-ANLY-016`.

6. **`User` carries `scope_hotel_id` / `scope_hotel_group_id`.** Present in the
   login response all along; simply absent from the copied type because the
   worker app had no use for them. Every manager surface branches on these,
   never on `role` — an admin and a regional manager both have a null
   `scope_hotel_id`, so `role === 'admin'` silently shows an RM the whole
   platform.

7. **`AnalyticsLeaderboardEntry` is a second, distinct leaderboard row.**
   `/quality/leaderboard` (`quality:read`) and `/analytics/leaderboard`
   (`analytics:read`) return different shapes sharing only `worker_id` and
   `rating_tier`. Managers hold `analytics:read` and never `quality:write`, so
   reading one with the other's type yields undefined in every column that
   matters.

## Not copied, and why

- **`constants/app-config.ts`** is per-app by design: `PUSH_APP` and
  `ALLOWED_ROLES` differ, and `PUSH_APP` is the *only* per-app difference in
  the whole push-registration path. Sharing it would defeat that.
- **Screens (`src/app/**`)** are app-specific.
- **`lib/push-notifications.ts`** currently reads `app-config`; it is a
  migration candidate once the config is injected rather than imported.

## The locale catalogues are the one part that cannot drift silently

`locales.test.ts` in `worker-app` and `checker-app` deep-equals each app's
catalogue against `frontend/lib/i18n/locales/*`. This package's catalogues are
covered the same way by `manager-app`'s suite, which imports them from here.

So all four sources are pinned to the frontend's. **A string added to one
catalogue alone fails CI in packages the branch never touched.** Add a key to
every catalogue or to none — never a dead key to satisfy the test.
