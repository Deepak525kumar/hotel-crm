import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * No screen may import an optional native module at the top level.
 *
 * A top-level `import ... from 'expo-<native>'` whose native half is absent
 * from the running binary throws `Cannot find native module '...'` during
 * MODULE EVALUATION. That takes down every importer, not just the feature —
 * and expo-router surfaces it as the thoroughly misleading
 * "Route is missing the required default export".
 *
 * This has now happened three times in this codebase:
 *   - `shift/[id].tsx` via `expo-location` (worker-app)
 *   - the contract download via `expo-file-system` / `expo-sharing`
 *   - `assistant.tsx` via `expo-speech-recognition` (2026-09-22) — reported
 *     as "I am not able to log into the app", because a route that cannot be
 *     evaluated breaks navigation, not just its own screen
 *
 * Typecheck cannot see it: the JS half is installed, so the import resolves
 * perfectly. Only a device with an older build fails, which is exactly the
 * case CI never runs. Hence a source-shape test.
 *
 * A module goes on this list when its native half can plausibly be missing
 * from a build someone is already running — i.e. it was added after some
 * build was cut. Modules present since the app's first build (expo-router,
 * expo-constants, and so on) are not the hazard.
 */
const LAZY_ONLY = [
  'expo-speech-recognition',
  'expo-file-system',
  'expo-sharing',
  'expo-location',
  'expo-haptics',
];

const SRC = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('optional native modules are required lazily', () => {
  const files = walk(SRC).filter((f) => !f.includes('__tests__'));

  it('found source files (guards the walker itself)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(LAZY_ONLY)('%s is never imported at the top level', (moduleName) => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      // A static `import ... from 'module'` — the form that is evaluated
      // eagerly. `require()` inside a function is the safe shape and is what
      // this test exists to require.
      const staticImport = new RegExp(
        `^\\s*import\\s[^;]*?from\\s+['"]${moduleName}['"]`,
        'm'
      );
      return staticImport.test(text);
    });

    expect(offenders.map((f) => f.slice(SRC.length))).toEqual([]);
  });
});
