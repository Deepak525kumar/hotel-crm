# mobile/manager-app

Expo app for `manager`, `regional_manager` and `admin` — one binary, gated by
role **and resolved scope**. The plan is
`docs/implementation/MANAGER_APP_PLAN.md`; screens land PR by PR against §7.

Most of this app's design system, API client and stores come from
`@hotel-crm/mobile-shared`. Read `mobile/CLAUDE.md` (rules shared by all four
packages, including the locale lockstep and the port trio) and
`mobile/shared/CLAUDE.md` too.

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
- **Dead links are not caught by typecheck.** `.expo/types` is gitignored, so
  expo-router's typed routes protect nothing in CI.
  `route-targets-exist.test.ts` is the gate; it has caught two —
  `/admin/archive` from the More menu, and `ONBOARDING_ROUTE`, which AuthGuard
  redirects a gated manager through.
- **Approving a Manager or RM is two calls.** `approve` then `assign`
  (`ADR-065`). Reporting success after the first leaves the record approved,
  unassigned, and the hotel with no manager — while every response said 200.
- **`PushRegistration` must stay inside `ConsentGate`.** Registering before
  the daily notice is accepted returns 403 `CONSENT_REQUIRED` and the token is
  then silently absent for the whole session.

## Not yet configured — owner actions, not PRs

- **EAS project — DONE (2026-09-23).** `eas init` was run by the owner;
  `app.json` now carries `extra.eas.projectId` and a matching `updates.url`
  on the `production` channel. The note that used to stand here said neither
  existed and was stale — verify `app.json` before believing any claim in
  this section.
- **Push credentials — iOS DONE (2026-09-23), Android client still open.**
  `APNS_BUNDLE_ID_MANAGER=com.fhmhotelservices.managerapp` is now set in the
  EC2 `backend/.env` and the Platform Worker has been restarted. Verified on
  the host, not inferred: the deployed bundle contains
  `apnsTopics[PushApp.MANAGER] = apnsBundleIdManager`, and dotenv reads the
  value back.

  **Do not trust the boot log to tell you this.** Until 2026-09-23 the
  `PUSH transport: APNs configured for {...}` line listed `worker` and
  `checker` only — it predated the MANAGER enum member and was never extended
  — so a correctly-configured manager topic logged exactly like an
  unconfigured one. That cost a live debugging session. The line is now
  derived from `Object.values(PushApp)`, but **a host running a build older
  than that fix will still print the two-app summary**, and its silence about
  manager means nothing either way.

  FCM is configured server-side (`FIREBASE_PROJECT_ID` and
  `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64` are both set in production), but
  `google-services.json` is still absent from this app, so it cannot mint an
  Android token to send to. That one is a client build artifact and a real
  secret: still an owner action.
