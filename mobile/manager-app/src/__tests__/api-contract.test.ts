import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AssignmentStatus } from '@hotel-crm/mobile-shared';
import { ASSIGNMENT_STATUSES } from '../lib/assignment-format';

/**
 * The backend's schemas are read as SOURCE, not imported.
 *
 * analytics-contract.test.ts imports backend *types* and gets tsc to check
 * them, which is strictly better -- but these are zod values, and importing a
 * backend runtime module here fails: the backend is ESM and writes `.js`
 * specifiers that this app's jest resolver cannot follow. Reading the
 * declaration is the honest fallback, and it still fails the moment the
 * server renames the parameter.
 */
const backendSource = (...parts: string[]): string =>
  readFileSync(join(REPO, 'backend', ...parts), 'utf8');

const REPO = join(__dirname, '..', '..', '..', '..');

/**
 * Pins three query/enum contracts that were each wrong in a way nothing could
 * catch, because the client and the server never compared notes.
 *
 * All three shipped. All three typechecked. All three produced a 400 or a
 * silently-ignored parameter in a manager's hand.
 */
describe('client/server request contracts', () => {
  /**
   * The filter chips used to start with 'ASSIGNED', which is not a member of
   * the AssignmentStatus enum (the stored default is CONFIRMED). Tapping the
   * FIRST chip 400'd the entire assignments list.
   */
  it('every assignment filter status is a real AssignmentStatus', () => {
    // The compile-time half: `readonly AssignmentStatus[]` on the const means
    // tsc rejects an invented member outright.
    const statuses: readonly AssignmentStatus[] = ASSIGNMENT_STATUSES;

    // The runtime half: pinned against the Prisma enum's own source, so a
    // member REMOVED from the schema fails here too -- tsc cannot see that,
    // since the mobile union is hand-written.
    const schema = readFileSync(join(REPO, 'backend', 'prisma', 'schema.prisma'), 'utf8');
    const block = schema.match(/enum AssignmentStatus \{([^}]*)\}/);
    expect(block).not.toBeNull();
    const declared = block![1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//'));

    expect([...statuses].sort()).toEqual([...declared].sort());
  });

  /**
   * /work-requests names its page size `per_page`. The mobile client sent
   * `limit`, which zod dropped without complaint, so every caller silently
   * got the default page size.
   */
  it('the work-requests page-size parameter is per_page, not limit', () => {
    const types = backendSource('src', 'modules', 'job-requests', 'types.ts');
    const schema = types.match(
      /export const ListWorkRequestsQuerySchema = z\.object\(\{([\s\S]*?)\n\}\)/
    );
    expect(schema).not.toBeNull();
    // Keys only -- `per_page` also appears inside this file's prose, and a
    // comment mentioning a parameter is not the same as declaring it.
    const keys = [...schema![1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    expect(keys).toContain('per_page');
    expect(keys).not.toContain('limit');

    const client = readFileSync(
      join(REPO, 'mobile', 'shared', 'src', 'lib', 'api.ts'),
      'utf8'
    );
    const list = client.match(/workRequests[\s\S]{0,400}?list: \(params\?: \{([^}]*)\}/);
    expect(list).not.toBeNull();
    expect(list![1]).toContain('per_page');
    expect(list![1]).not.toContain('limit');
  });

  /**
   * Every team export the app could make was rejected, and reported as a 500.
   *
   * `POST /reports/export` requires `dataset`, `format`, `from` AND `to`. The
   * client sent `{ dataset }` alone, so it could never succeed — and because
   * the route used a bare `.parse()`, a missing field surfaced as
   * `500 INTERNAL_ERROR` rather than a validation error, which reads as the
   * server being broken rather than the request being incomplete. Both halves
   * are fixed; this pins both.
   */
  it('the team export sends every field the endpoint requires', () => {
    const client = readFileSync(
      join(REPO, 'mobile', 'shared', 'src', 'lib', 'api.ts'),
      'utf8'
    );
    const sig = client.match(/exportTeam: \(input: \{([\s\S]*?)\}\) =>/);
    expect(sig).not.toBeNull();
    for (const field of ['dataset', 'format', 'from', 'to']) {
      expect(sig![1]).toContain(field);
    }
    // Required, not optional: an optional `format` is how this broke.
    expect(sig![1]).not.toMatch(/format\?:/);
    expect(sig![1]).not.toMatch(/from\?:/);
    expect(sig![1]).not.toMatch(/to\?:/);

    // And the server still demands them, so this test fails if the
    // requirement is ever relaxed and the strictness here becomes a lie.
    const routes = backendSource('src', 'modules', 'reports', 'routes.ts');
    expect(routes).toContain('parseExportBody');
    // A bare `.parse()` on the body is what turned a 422 into a 500.
    expect(routes).not.toMatch(/ReportFormatSchema\.exclude\(\['json'\]\)\.parse\(/);
  });

  /**
   * All four datasets are reachable. The app shipped with one hard-coded
   * `dataset: 'attendance'` row, so three of the four could not be exported
   * at all -- and this is the only surface that reaches them, since nothing
   * in the web portal spends `reports:export-team`.
   */
  it('the reports screen offers every dataset the server defines', () => {
    const screen = readFileSync(
      join(REPO, 'mobile', 'manager-app', 'src', 'app', 'reports.tsx'),
      'utf8'
    );
    const offered = screen.match(/const DATASETS = \[([^\]]*)\]/);
    expect(offered).not.toBeNull();
    const offeredNames = [...offered![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();

    const types = backendSource('src', 'modules', 'reports', 'types.ts');
    const declared = types.match(/ReportDatasetSchema = z\.enum\(\[([^\]]*)\]/);
    expect(declared).not.toBeNull();
    const declaredNames = [...declared![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();

    expect(offeredNames).toEqual(declaredNames);
  });

  /**
   * /users caps `limit` at 100, and validateQuery THROWS rather than clamping.
   * useDirectory asked for 200, so the whole directory 400'd -- and the rota
   * then rendered a raw cuid for every name, which looked like a missing-name
   * bug in the DTO rather than a request that never returned.
   */
  it('useDirectory asks for a page size the users endpoint accepts', () => {
    const hook = readFileSync(
      join(REPO, 'mobile', 'manager-app', 'src', 'hooks', 'useDirectory.ts'),
      'utf8'
    );
    const requested = hook.match(/api\.users\.list\(\{ limit: (\d+) \}\)/);
    expect(requested).not.toBeNull();

    const types = backendSource('src', 'modules', 'users', 'types.ts');
    const cap = types.match(/limit: z\.coerce\.number\(\)\.min\(\d+\)\.max\((\d+)\)/);
    expect(cap).not.toBeNull();
    expect(Number(requested![1])).toBeLessThanOrEqual(Number(cap![1]));
  });
});
