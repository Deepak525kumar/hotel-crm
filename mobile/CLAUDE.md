# mobile/

Four packages: three Expo apps (`worker-app`, `checker-app`, `manager-app`) and
`shared/`, which only the manager app consumes.

Each has its own `CLAUDE.md` with what has cost time *there*. This file holds
only what is true across all four — do not restate it in a child.

## Who each app is for

| App | Users | Port |
|---|---|---|
| `worker-app` | housekeepers | 8081 (Expo default) |
| `checker-app` | quality checkers | 8082 |
| `manager-app` | manager, regional manager, admin | 8083 |

The web portal (`frontend/`) serves the same three roles as `manager-app`; it is
not being retired. Both exist.

## The six rules that cut across every package

**1. Locale catalogues are all-or-nothing, across four packages.**
`frontend`, `worker-app`, `checker-app` and `shared` each deep-equal their
catalogue against the frontend's. A key added to one fails CI in packages your
branch never opened. Add a string to every catalogue or to none — and never add
a dead key to three of them just to go green.

**2. The dev-server port must agree in three places per app**: `--port` in
`package.json`'s scripts, `RCT_METRO_PORT` in a committed `.env`, and the
`with-metro-port` config plugin that writes `ios/.xcode.env` on prebuild. Miss
one and an Xcode build serves another app's JavaScript inside this app's shell.
`dev-server-port.test.ts` asserts all three.

**3. Generated files exist locally and never in CI.** `expo-env.d.ts` and
`.expo/types/router.d.ts` are both gitignored and both are produced by the Expo
tooling. Anything that leans on them typechecks on every developer's machine and
on no runner. Two real consequences:
- a stylesheet or asset import needs a committed ambient declaration, not
  `expo-env.d.ts` (see `shared/src/types/css.d.ts`);
- **expo-router's typed routes protect nothing in CI.** A `router.push` to a
  route that does not exist compiles fine there. `route-targets-exist.test.ts`
  is the actual gate, and it has caught two dead links.

**4. Never import an optional native module at the top level.**
A static `import ... from 'expo-<native>'` whose native half is absent from
the running binary throws during MODULE EVALUATION, taking down every
importer — and expo-router reports it as *"Route is missing the required
default export"*, which sends you looking in entirely the wrong place. It has
happened three times: `expo-location` in worker-app's `shift/[id].tsx`,
`expo-file-system`/`expo-sharing` in the contract download, and
`expo-speech-recognition` in manager-app's `assistant.tsx` — the last
reported as *"I am not able to log into the app"*, because a route that
cannot be evaluated breaks navigation, not just its own screen.

Typecheck cannot see it: the JS half is installed, so the import resolves.
Only a device running a build cut before the dependency was added fails.
`require()` it inside the function that uses it and degrade gracefully;
manager-app's `native-module-imports.test.ts` enforces this.

**5. `google-services.json` is generated, not hand-edited.** All three apps
ship the SAME project-level file, listing every client; each build picks the
one whose `package_name` matches its `applicationId`.

On 2026-09-23 the Firebase project was found holding worker and checker under
`com.hotelcrm.*` while their committed configs claimed `com.fhmhotelservices.*`
— commit `3e425c0e` had edited the package names in the JSON rather than
re-registering the apps. The file was self-consistent, so every existing
assertion passed, and **not one Android device had ever registered a push
token for any app**. Nothing surfaced it: a device that cannot register simply
has no token, the backend then finds no devices, and the outbox event is still
marked `DELIVERED`.

A Firebase app's package name cannot be changed after creation, so the fix was
to register the real packages afresh and regenerate the config. Regenerate it;
never correct it by hand. Each app's `android-fcm-config.test.ts` now also
asserts that no two clients share an app id (the fingerprint of such an edit)
and that all three files are byte-identical.

**6. Icons are generated, not hand-edited.** `mobile/scripts/generate-app-icons.mjs`
renders every size for all three apps from one vector source each. Re-run it
after touching `GLYPHS` or `BRANDS`; it is reproducible, so a clean `git status`
afterwards is the check that nothing drifted.

## Gates, per package

```bash
npm run typecheck && npx expo lint && npx jest --forceExit
```

Lint is the one that gets skipped and the one that fails CI.

`shared/` has no jest project — its behaviour is covered by `manager-app`'s
suite, which imports it directly.

## CI

`worker-app` and `checker-app` run as a matrix that installs each app
standalone from its own lockfile. `manager-app` cannot join it: it depends on
`@hotel-crm/mobile-shared`, a workspace package that exists only in this
repository, so it has its own job that installs from the repo root.
