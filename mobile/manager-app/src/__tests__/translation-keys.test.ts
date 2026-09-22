import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import en from '@hotel-crm/mobile-shared/src/lib/i18n/locales/en.json';

/**
 * Every `t('...')` key in this app exists in the catalogue.
 *
 * i18next renders a missing key as the key itself, so the failure ships as a
 * screen reading `attendance.noRecords` where a sentence should be. Nothing
 * else catches it: `tsc` sees a string, lint sees a string, and the locale
 * lockstep only proves the four catalogues MATCH each other -- four
 * catalogues can agree perfectly and still be missing the key a screen asks
 * for.
 *
 * This caught eight during the operations screens, including two where the
 * key existed under a different name (`attendance.noneFound`, not
 * `noRecords`) and one where the name I assumed belonged to a worker-facing
 * string with the wrong meaning.
 *
 * Statically analysable calls only -- `t(variable)` and template literals are
 * invisible here by construction. Those are covered by the dynamic-key
 * allowlist below.
 */
const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !full.includes('__tests__') ? [full] : [];
  });
}

function has(path: string): boolean {
  let cursor: unknown = en;
  for (const part of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || !(part in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === 'string';
}

describe('translation keys', () => {
  const files = sourceFiles(SRC);

  it('finds the app’s source files at all (guards the walker itself)', () => {
    // Without this, a broken path would make every assertion below vacuously
    // pass over an empty list -- a green test proving nothing, which is the
    // failure mode this repository has been bitten by before.
    expect(files.length).toBeGreaterThan(10);
  });

  it('every statically analysable t() key exists in the catalogue', () => {
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) {
        if (!has(match[1])) missing.push(`${match[1]} (${file.replace(SRC, '')})`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * Template-literal keys, which the regex above cannot see.
   *
   * The attendance screens build `attendance.status${row.status}` from the
   * status enum. Asserted explicitly rather than left uncovered: the enum and
   * the catalogue are two lists that must agree, and nothing else checks it.
   */
  it('every attendance status has a label', () => {
    for (const status of ['PRESENT', 'ABSENT', 'LATE', 'PARTIAL', 'EXCUSED', 'EXPECTED']) {
      expect(has(`attendance.status${status}`)).toBe(true);
    }
  });
});
