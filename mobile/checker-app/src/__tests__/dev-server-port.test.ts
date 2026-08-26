import { readFileSync } from 'fs';
import { join } from 'path';

const { applyMetroPort, METRO_PORT } = require('../../plugins/with-metro-port') as {
  applyMetroPort: (contents: string) => string;
  METRO_PORT: number;
};

const root = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

/**
 * The checker app's dev server is 8082; worker-app keeps Expo's default 8081.
 *
 * Both apps are Expo projects in one repo and both default to 8081, so a
 * checker build that resolves to 8081 attaches to worker-app's Metro and runs
 * the other app's JavaScript. It has been reported twice from real iOS builds.
 *
 * The port has to be set in three places because there are three ways in:
 *   1. npm scripts (`--port`)      — `npm start`, `npm run ios`
 *   2. .env (`RCT_METRO_PORT`)     — `npx expo start|run:ios|prebuild` directly,
 *                                    which bypasses the scripts entirely
 *   3. ios/.xcode.env (the plugin) — pressing Run in Xcode, where no Expo CLI
 *                                    runs at all and the port is compiled into
 *                                    RCTBundleURLProvider.mm
 * Miss any one and the app silently falls back to worker-app's server.
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

  it('never falls back to the port worker-app occupies', () => {
    expect(METRO_PORT).not.toBe(8081);
    for (const script of Object.values(pkg.scripts)) {
      expect(script).not.toContain('--port 8081');
    }
  });
});
