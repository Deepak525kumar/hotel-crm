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

/**
 * Literal and template targets: /a/b, `/a/${x}`, plus the object form
 * router.push({ pathname: '/a/[id]', params }).
 *
 * The object form was invisible to this guard until now, which was a real
 * hole rather than a theoretical one: expo-router's typedRoutes cannot type a
 * pathname with an appended query string, so every link that needs to carry
 * params is written that way -- including the one that starts an inspection
 * (select-worker -> /rating/[id]). Those were exactly the links this file
 * exists to check, and none of them were being checked.
 */
function targetsIn(source: string): string[] {
  const out: string[] = [];
  const re = /router\.push\(\s*[`'"]([^`'"]+)[`'"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  const tpl = /router\.push\(\s*`([^`]*)`/g;
  while ((m = tpl.exec(source))) out.push(m[1]);
  // pathname: '/a/[id]' anywhere inside a push's object argument. Matched on
  // the property rather than on the whole call so it survives the multi-line
  // formatting prettier gives these.
  const obj = /router\.push\(\s*\{[\s\S]*?pathname:\s*[`'"]([^`'"]+)[`'"]/g;
  while ((m = obj.exec(source))) out.push(m[1]);
  return out;
}

function normalise(target: string): string {
  return target
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, ':param')
    // The object form names the segment literally ('/rating/[id]'), where a
    // template literal interpolates it; both must land on the same route key.
    .replace(/\[[^\]]+\]/g, ':param')
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
