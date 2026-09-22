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

## The four rules that cut across every package

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

**4. Icons are generated, not hand-edited.** `mobile/scripts/generate-app-icons.mjs`
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
