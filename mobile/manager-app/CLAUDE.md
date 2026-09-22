# mobile/manager-app

Expo app for `manager`, `regional_manager` and `admin` — one binary, gated by
role **and resolved scope**. The plan is
`docs/implementation/MANAGER_APP_PLAN.md`; screens land PR by PR against §7.

Most of this app's design system, API client and stores come from
`@hotel-crm/mobile-shared`. Read `mobile/shared/CLAUDE.md` too.

## Gates

```bash
npm run typecheck && npx expo lint && npx jest --forceExit
```

Touching `mobile/shared` means running **worker-app and checker-app's** gates
as well — they do not consume the package, but they share the locale
catalogues it is pinned against.

## The things that will cost you time

- **`regional_manager` breaks silently.** Role gates are exact-match strings.
  `['manager', 'admin']` excludes RM at every site, with no error anywhere —
  the RM just finds the door locked. RM holds manager's entire capability set
  at group scope plus `org_chart:read` (ADR-030 D-5). Both strings, always.
  `capability-map.test.ts` pins this against the backend's real matrix.
- **Gate on scope, not role.** `scope_hotel_id` is set only for a hotel
  manager; an admin and an RM both have it null and must pick. Branching on
  `role === 'admin'` puts an RM in the wrong branch.
- **Never fabricate a permission in a test.** `capability-map.test.ts`
  imports `ROLE_PERMISSIONS` from `backend/src/config/constants.ts`. A tool
  once required a token WORKER does not hold and would have denied every
  worker in production while 100+ tests passed, because they invented it.
- **This app reads quality; it never writes it.** `quality:write` is
  Checker-only. No rating or rework affordance belongs here.
- **This app does not log rooms.** Those routes are `requireRole('worker')`.
  A manager enters only the aggregate count.
- **Port 8083**, in three places: `package.json`'s `--port` flags, `.env`'s
  `RCT_METRO_PORT`, and `plugins/with-metro-port.js`. `dev-server-port.test.ts`
  asserts all three agree. Get it wrong and an Xcode build serves
  worker-app's JavaScript inside this app's shell.
- **Locale keys are all-or-nothing** across four catalogues (frontend,
  worker, checker, shared). Adding one key to one package fails CI in
  packages your branch never opened.
- **`PushRegistration` must stay inside `ConsentGate`.** Registering before
  the daily notice is accepted returns 403 `CONSENT_REQUIRED` and the token is
  then silently absent for the whole session.

## Not yet configured — owner actions, not PRs

- **EAS project.** `app.json` has no `extra.eas.projectId` and no `updates`
  block, so `eas build` and OTA updates will not work until someone runs
  `eas init` in this directory. Deliberately left empty rather than filled
  with a plausible-looking placeholder: a wrong project id fails at build
  time with a confusing error, and a wrong *update url* would point this app
  at another app's OTA channel.
- **Push credentials.** `APNS_BUNDLE_ID_MANAGER` is wired end to end and
  `com.fhmhotelservices.managerapp` is pinned against this `app.json`, but
  the APNs key and `google-services.json` are real secrets that belong in
  environment config. Until they exist, push in this app is untestable — and
  per the E2E suite's own rule, that is a recorded gap, never a pass.
