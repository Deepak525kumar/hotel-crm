import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import en from '@/lib/i18n/locales/en.json';

/**
 * Every static t('...') key used in the app must exist in the catalogue.
 *
 * i18next renders a missing key as the key itself, so a typo or a key that was
 * never added ships as literal text like "common.send" -- which reads as "this
 * string does not translate" and survives every other test in this suite. Two
 * such keys were found by hand while writing this file.
 *
 * Only statically-analysable calls are checked. Template literals
 * (t(`documents.category${c}`)) are skipped deliberately: resolving them needs
 * the runtime value, and guessing would produce false failures.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === '__mocks__' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function has(catalogue: unknown, key: string): boolean {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    catalogue,
  ) !== undefined;
}

describe('translation keys', () => {
  const SRC = join(__dirname, '..');
  // t('a.b'), t("a.b"), t('a.b', {...}), t('a.b', 'default')
  const CALL = /\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g;

  const used = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const [, key] of text.matchAll(CALL)) {
      if (!key.includes('.')) continue; // not a catalogue path
      used.set(key, [...(used.get(key) ?? []), file.replace(SRC, 'src')]);
    }
  }

  it('finds keys to check', () => {
    expect(used.size).toBeGreaterThan(50);
  });

  it('every static key exists in the English catalogue', () => {
    const missing = [...used.entries()]
      .filter(([key]) => !has(en, key))
      .map(([key, files]) => `${key} (${files[0]})`);
    expect(missing).toEqual([]);
  });
});
