import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every router.push() target must resolve to a real route file.
 *
 * Three dead links shipped in one change: Home, Schedule and Attendance were
 * ported from worker-app and kept pushing to `/shift/[id]` and `/rework/[id]`,
 * neither of which existed here. Nothing caught it — expo-router resolves
 * paths as strings at runtime, so typecheck is blind to it and no test
 * rendered a tap. The `/shift/[id]` case was the worst: the Start-checking
 * gate told a checker to check in, and the only route to check in went
 * nowhere.
 */
const APP = join(__dirname, '..', 'app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(APP);

/** Route paths expo-router exposes, normalised: groups dropped, params as :p. */
const routes = new Set(
  files
    .filter((f) => f.endsWith('.tsx'))
    .map((f) =>
      f
        .slice(APP.length)
        .replace(/\.tsx$/, '')
        .replace(/\/\([^)]+\)/g, '')
        .replace(/\/index$/, '')
        .replace(/\[[^\]]+\]/g, ':param')
    )
    .map((r) => (r === '' ? '/' : r))
);

/** Literal and template targets: /a/b, `/a/${x}`. */
function targetsIn(source: string): string[] {
  const out: string[] = [];
  const re = /router\.push\(\s*[`'"]([^`'"]+)[`'"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  const tpl = /router\.push\(\s*`([^`]*)`/g;
  while ((m = tpl.exec(source))) out.push(m[1]);
  return out;
}

function normalise(target: string): string {
  return target
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, ':param')
    .replace(/\/\([^)]+\)/g, '')
    .replace(/\/$/, '')
    .replace(/\/index$/, '') || '/';
}

describe('every router.push target resolves to a route', () => {
  const found = files
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => targetsIn(readFileSync(f, 'utf8')).map((t) => ({ file: f.slice(APP.length), t })));

  it('finds targets to check at all (guards the regex itself)', () => {
    expect(found.length).toBeGreaterThan(5);
  });

  it.each(found.map(({ file, t }) => [t, file]))('%s (pushed from %s)', (target) => {
    // Dynamic targets built entirely from a variable cannot be checked.
    if (target.startsWith(':param')) return;
    expect(routes).toContain(normalise(target));
  });
});
