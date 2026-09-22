import { readFileSync } from 'fs';
import { join } from 'path';

const { applyMetroPort, METRO_PORT } = require('../../plugins/with-metro-port') as {
  applyMetroPort: (contents: string) => string;
  METRO_PORT: number;
};

const root = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

/**
 * The manager app's dev server is 8083. worker-app keeps Expo's default 8081
 * and checker-app took 8082.
 *
 * Three Expo projects in one repository, all defaulting to 8081, so a manager
 * build that resolves to 8081 attaches to worker-app's Metro and runs the
 * other app's JavaScript inside this app's shell. It has been reported twice
 * from real iOS builds of checker-app, which is why checker-app has this test
 * and why it was carried here rather than reinvented.
 *
 * The port has to be set in three places because there are three ways in:
 *   1. npm scripts (`--port`)      — `npm start`, `npm run ios`
 *   2. .env (`RCT_METRO_PORT`)     — `npx expo start|run:ios|prebuild` directly,
 *                                    which bypasses the scripts entirely
 *   3. ios/.xcode.env (the plugin) — pressing Run in Xcode, where no Expo CLI
 *                                    runs at all and the port is compiled into
 *                                    RCTBundleURLProvider.mm
 * Miss any one and the app silently falls back to worker-app's server.
 *
 * The .env assertion below earned its place on 2026-09-22: the file existed
 * locally and was never committed, because the REPOSITORY ROOT's .gitignore
 * lists `.env` and `git add mobile/manager-app` skipped it without a word.
 * Every local run passed. CI failed on a file that was simply not there.
 */
describe('dev server port', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it.each(['start', 'ios', 'android', 'web'])('pins the port in the `%s` script', (script) => {
    expect(pkg.scripts[script]).toContain(`--port ${METRO_PORT}`);
  });

  it('sets RCT_METRO_PORT in the committed .env, for direct CLI invocations', () => {
    expect(read('.env')).toMatch(new RegExp(`^RCT_METRO_PORT=${METRO_PORT}$`, 'm'));
  });

  it('registers the plugin that carries the port into Xcode builds', () => {
    const { expo } = JSON.parse(read('app.json')) as { expo: { plugins: unknown[] } };
    expect(expo.plugins).toContain('./plugins/with-metro-port');
  });

  it('adds the export to a freshly prebuilt .xcode.env', () => {
    expect(applyMetroPort('export NODE_BINARY=$(command -v node)\n')).toBe(
      `export NODE_BINARY=$(command -v node)\nexport RCT_METRO_PORT=${METRO_PORT}\n`,
    );
  });

  it('replaces an existing export rather than appending a conflicting one', () => {
    const out = applyMetroPort('export NODE_BINARY=node\nexport RCT_METRO_PORT=8081\n');
    expect(out).toBe(`export NODE_BINARY=node\nexport RCT_METRO_PORT=${METRO_PORT}\n`);
    expect(out).not.toContain('8081');
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = applyMetroPort('export NODE_BINARY=node\n');
    expect(applyMetroPort(once)).toBe(once);
  });

  it('never falls back to a port another app in this repo occupies', () => {
    // 8081 is worker-app's, 8082 is checker-app's. Colliding with either
    // produces the same silent wrong-JavaScript failure.
    expect(METRO_PORT).not.toBe(8081);
    expect(METRO_PORT).not.toBe(8082);
    for (const script of Object.values(pkg.scripts)) {
      expect(script).not.toContain('--port 8081');
      expect(script).not.toContain('--port 8082');
    }
  });
});
