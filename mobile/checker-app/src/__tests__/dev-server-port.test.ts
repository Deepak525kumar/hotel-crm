import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The checker app's dev server is pinned to 8082; worker-app keeps Expo's
 * default 8081.
 *
 * Both apps are Expo projects in one repo and both default to 8081. With
 * worker-app's server already on 8081, `expo run:ios` offers "Use port 8082
 * instead?" — and on the decline branch (or non-interactively, where the CLI
 * warns and takes the same path) it skips starting a dev server and falls back
 * to `options.port ?? 8081` (@expo/cli, src/run/resolveBundlerProps.ts). The
 * checker build is then pointed at worker-app's Metro and serves the other
 * app's bundle. It has already been reported once from a real iOS build.
 *
 * Passing the port explicitly also fixes that fallback (`options.port` is 8082,
 * not 8081), so this asserts on the scripts rather than on a comment.
 */
describe('dev server port', () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  it.each(['start', 'ios', 'android', 'web'])(
    'pins the port in the `%s` script',
    (script) => {
      expect(pkg.scripts[script]).toContain('--port 8082');
    },
  );

  it('does not use the default port worker-app occupies', () => {
    for (const script of Object.values(pkg.scripts)) {
      expect(script).not.toContain('--port 8081');
    }
  });
});
