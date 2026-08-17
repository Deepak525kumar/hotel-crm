import {
  UI_LOCALES,
  DEFAULT_UI_LOCALE,
  LOCALE_LABELS,
  isUiLocale,
  isRtlLocale,
  negotiateLocale,
} from '@/lib/locales';

// Frontend catalogues imported directly rather than read from disk: this
// package's tsconfig.test.json declares only `types: ["jest"]`, so node:fs /
// __dirname are not typed here and adding @types/node just for one test
// would be a heavier fix than the test needs. A relative import gives the
// same cross-package parity guarantee and is checked by the compiler.
import webDe from '../../../../frontend/lib/i18n/locales/de.json';
import webEn from '../../../../frontend/lib/i18n/locales/en.json';
import webUr from '../../../../frontend/lib/i18n/locales/ur.json';
import webAr from '../../../../frontend/lib/i18n/locales/ar.json';
import webFr from '../../../../frontend/lib/i18n/locales/fr.json';
import webUk from '../../../../frontend/lib/i18n/locales/uk.json';

import de from '@/lib/i18n/locales/de.json';
import en from '@/lib/i18n/locales/en.json';
import ur from '@/lib/i18n/locales/ur.json';
import ar from '@/lib/i18n/locales/ar.json';
import fr from '@/lib/i18n/locales/fr.json';
import uk from '@/lib/i18n/locales/uk.json';

type Catalogue = Record<string, unknown>;
const CATALOGUES: Record<string, Catalogue> = { de, en, ur, ar, fr, uk };
const WEB_CATALOGUES: Record<string, Catalogue> = {
  de: webDe, en: webEn, ur: webUr, ar: webAr, fr: webFr, uk: webUk,
};

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

  // The three copies of this contract (backend, frontend, mobile) share no
  // build, so drift needs an explicit guard: a locale added in one package
  // and not the others would show up as a picker option the backend rejects
  // with 422.
  //
  // Asserted through the frontend's shipped CATALOGUES rather than by
  // importing its locales.ts -- that module touches `navigator`, and this
  // package's tsconfig.test.json has no DOM lib. The catalogue set is the
  // same contract by a different route: one JSON file per supported locale.
  // The frontend's own __tests__/locales.test.ts pins its UI_LOCALES against
  // the backend, which closes the third edge of the triangle.
  it('matches the frontend locale set', () => {
    expect(Object.keys(WEB_CATALOGUES).sort()).toEqual([...UI_LOCALES].sort());
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
    expect(CATALOGUES[locale]).toEqual(WEB_CATALOGUES[locale]);
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
