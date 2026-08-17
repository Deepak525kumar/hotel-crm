// 2026-08-16: per-user UI language preference (PUT /auth/profile).
// Covers the locale contract and the null-vs-absent distinction that the
// whole feature rests on — see lib/locales.ts and auth/service.ts's
// updateProfile.
import {
  UI_LOCALES,
  DEFAULT_UI_LOCALE,
  isUiLocale,
  isRtlLocale,
  negotiateLocale,
} from '../lib/locales.js';
import { UpdateProfileSchema } from '../modules/auth/validation.js';
import { SUPPORTED_LANGUAGES } from '../modules/consent/types.js';

describe('UI locale contract', () => {
  it('ships the six owner-approved locales', () => {
    expect([...UI_LOCALES]).toEqual(['de', 'en', 'ur', 'ar', 'fr', 'uk']);
  });

  it('defaults to the platform primary-market language', () => {
    expect(DEFAULT_UI_LOCALE).toBe('de');
  });

  it('marks exactly Arabic and Urdu as RTL', () => {
    const rtl = UI_LOCALES.filter(isRtlLocale);
    expect(rtl).toEqual(['ur', 'ar']);
  });

  // ADR-068 closed the divergence this test previously guarded: `uk` was a UI
  // locale with no consent notice, so Ukrainian-speaking workers fell back to
  // German. It is now in both lists, and every UI locale must stay noticeable
  // — a worker receives the notice in the language they selected.
  it('every UI locale has a consent notice (ADR-068 / SIR-CONSENT-012)', () => {
    for (const locale of UI_LOCALES) {
      expect(SUPPORTED_LANGUAGES as readonly string[]).toContain(locale);
    }
  });

  it('rejects unsupported and malformed values', () => {
    expect(isUiLocale('de')).toBe(true);
    expect(isUiLocale('ru')).toBe(false); // consent-supported, not UI-translated
    expect(isUiLocale('')).toBe(false);
    expect(isUiLocale(null)).toBe(false);
    expect(isUiLocale(['de'])).toBe(false);
  });
});

describe('negotiateLocale', () => {
  it('drops region subtags and takes the first supported match', () => {
    expect(negotiateLocale(['de-AT', 'en-US'])).toBe('de');
    expect(negotiateLocale(['pt-BR', 'fr-CA'])).toBe('fr');
    expect(negotiateLocale(['EN'])).toBe('en');
  });

  // null, not DEFAULT_UI_LOCALE — callers must be able to tell "nothing
  // negotiable" from "negotiated German".
  it('returns null when nothing matches', () => {
    expect(negotiateLocale(['pt', 'zh'])).toBeNull();
    expect(negotiateLocale([])).toBeNull();
  });
});

describe('UpdateProfileSchema.preferred_language', () => {
  it('accepts every shipped locale', () => {
    for (const locale of UI_LOCALES) {
      expect(UpdateProfileSchema.safeParse({ preferred_language: locale }).success).toBe(true);
    }
  });

  it('rejects a locale the UI has no translations for', () => {
    expect(UpdateProfileSchema.safeParse({ preferred_language: 'ru' }).success).toBe(false);
  });

  // The three states the service's `'preferred_language' in data` check
  // distinguishes. Absent means "leave unchanged"; explicit null means
  // "clear it and go back to device-locale negotiation".
  it('distinguishes absent from explicit null', () => {
    const absent = UpdateProfileSchema.safeParse({ first_name: 'Ada' });
    expect(absent.success).toBe(true);
    expect('preferred_language' in absent.data!).toBe(false);

    const cleared = UpdateProfileSchema.safeParse({ preferred_language: null });
    expect(cleared.success).toBe(true);
    expect('preferred_language' in cleared.data!).toBe(true);
    expect(cleared.data!.preferred_language).toBeNull();
  });
});
