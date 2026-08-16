import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UI_LOCALES,
  DEFAULT_UI_LOCALE,
  LOCALE_LABELS,
  isUiLocale,
  isRtlLocale,
  negotiateLocale,
} from '@/lib/locales';

import de from '@/lib/i18n/locales/de.json';
import en from '@/lib/i18n/locales/en.json';
import ur from '@/lib/i18n/locales/ur.json';
import ar from '@/lib/i18n/locales/ar.json';
import fr from '@/lib/i18n/locales/fr.json';
import uk from '@/lib/i18n/locales/uk.json';

type Catalogue = Record<string, unknown>;
const CATALOGUES: Record<string, Catalogue> = { de, en, ur, ar, fr, uk };

function keyPaths(obj: Catalogue, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    if (prefix === '' && key === '_meta') return [];
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object'
      ? keyPaths(value as Catalogue, path)
      : [path];
  });
}

describe('locale contract', () => {
  it('ships the six owner-approved locales', () => {
    expect([...UI_LOCALES]).toEqual(['de', 'en', 'ur', 'ar', 'fr', 'uk']);
    expect(DEFAULT_UI_LOCALE).toBe('de');
  });

  it('marks exactly Arabic and Urdu as RTL', () => {
    expect(UI_LOCALES.filter(isRtlLocale).sort()).toEqual(['ar', 'ur']);
  });

  it('rejects values outside the contract', () => {
    expect(isUiLocale('de')).toBe(true);
    // Consent-supported (CRR §32) but not UI-translated.
    expect(isUiLocale('ru')).toBe(false);
  });

  it('negotiates from device language tags, dropping region subtags', () => {
    expect(negotiateLocale(['de-AT', 'en-US'])).toBe('de');
    expect(negotiateLocale(['ar-EG'])).toBe('ar');
    // null rather than a default, so callers can tell the difference.
    expect(negotiateLocale(['zh-CN'])).toBeNull();
  });

  // The three copies of this contract (backend, frontend, mobile) have no
  // shared build. These assertions are what stop them drifting apart
  // silently -- a language added in one place and not the others would
  // otherwise show up as a picker option that the backend rejects with 422.
  it('matches the backend and frontend locale contracts', () => {
    const parse = (path: string) =>
      readFileSync(join(__dirname, path), 'utf8')
        .match(/UI_LOCALES = \[([^\]]+)\]/)?.[1]
        .match(/'([a-z-]+)'/g)
        ?.map((quoted) => quoted.replace(/'/g, ''));

    expect(parse('../../../../backend/src/lib/locales.ts')).toEqual([...UI_LOCALES]);
    expect(parse('../../../../frontend/lib/locales.ts')).toEqual([...UI_LOCALES]);
  });
});

describe('translation catalogues', () => {
  it('has a catalogue for every shipped locale', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual([...UI_LOCALES].sort());
  });

  // A missing key silently renders German at runtime (the i18next fallback).
  // This is what surfaces that in CI rather than in front of a worker.
  it.each(UI_LOCALES.filter((l) => l !== 'en'))(
    '%s has the same keys as the English source',
    (locale) => {
      const expected = keyPaths(en as Catalogue).sort();
      const actual = keyPaths(CATALOGUES[locale]).sort();
      expect({ locale, missing: expected.filter((k) => !actual.includes(k)) }).toEqual({
        locale,
        missing: [],
      });
    },
  );

  // The mobile catalogues are copies of the frontend's. Same reasoning as
  // the contract-drift test above: no shared build, so parity needs a guard.
  it.each([...UI_LOCALES])('%s matches the frontend catalogue exactly', (locale) => {
    const web = JSON.parse(
      readFileSync(join(__dirname, `../../../../frontend/lib/i18n/locales/${locale}.json`), 'utf8'),
    );
    expect(CATALOGUES[locale]).toEqual(web);
  });

  it('names every language by its own endonym', () => {
    expect(LOCALE_LABELS.de).toBe('Deutsch');
    expect(LOCALE_LABELS.ar).not.toMatch(/arabic/i);
  });

  // Honest flags, not aspirational ones: de/en were authored, the rest were
  // machine-translated and are awaiting a human speaker's review.
  it('marks the machine-translated catalogues as unreviewed', () => {
    const reviewed = (c: Catalogue) => (c._meta as { reviewed?: boolean })?.reviewed;
    expect(reviewed(de)).toBe(true);
    expect(reviewed(en)).toBe(true);
    for (const locale of ['ur', 'ar', 'fr', 'uk'] as const) {
      expect({ locale, reviewed: reviewed(CATALOGUES[locale]) }).toEqual({
        locale,
        reviewed: false,
      });
    }
  });
});
