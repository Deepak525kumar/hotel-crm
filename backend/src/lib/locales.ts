// UI locale contract — the set of languages the *client applications* can
// render themselves in, and the persisted per-user preference behind that
// choice.
//
// Deliberately NOT the same list as consent's SUPPORTED_LANGUAGES
// (modules/consent/types.ts). That constant is frozen spec (SPEC-CONSENT-001
// @0.2.0, CRR §32) describing the 12 languages *legal notice content* exists
// in; this one describes the languages the app's own chrome is translated
// into. The two lists answer different questions and are allowed to diverge:
// a language can be legally noticed but not yet UI-translated, and — as with
// Ukrainian below — vice versa.
//
// Owner decision (2026-08-16): ship UI translations for de, en, ur, ar, fr,
// uk. Note `uk` (Ukrainian) is NOT in CRR §32's list, which carries `ru` but
// no `uk`. Adding it to the consent contract would amend a frozen
// specification, which this change is not authorized to do — so a user whose
// UI language is `uk` still receives consent notices under
// DEFAULT_LANGUAGE ('de') via the existing fallback in
// ConsentService.getNoticeContent. That divergence is intentional and
// recorded here rather than silently papered over; lifting it requires a
// spec amendment to SPEC-CONSENT-001.
export const UI_LOCALES = ['de', 'en', 'ur', 'ar', 'fr', 'uk'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

// Locales written right-to-left. Consistent with consent's RTL_LANGUAGES for
// the two locales the lists share (ar, ur).
export const RTL_UI_LOCALES: readonly UiLocale[] = ['ar', 'ur'];

// Matches consent's DEFAULT_LANGUAGE for the same reason recorded there:
// German is the platform's primary-market language. Used when a user has
// expressed no preference AND no usable locale can be negotiated from the
// client.
export const DEFAULT_UI_LOCALE: UiLocale = 'de';

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value);
}

export function isRtlLocale(locale: UiLocale): boolean {
  return RTL_UI_LOCALES.includes(locale);
}

// Negotiate a supported locale from an Accept-Language-style list of tags,
// e.g. ['de-AT', 'en-US']. Region subtags are dropped ('de-AT' -> 'de') since
// the UI is translated per language, not per region. Returns null when
// nothing matches, so callers can distinguish "no preference expressible"
// from "explicitly chose the default".
export function negotiateLocale(tags: readonly string[]): UiLocale | null {
  for (const tag of tags) {
    const base = tag.split('-')[0]?.toLowerCase();
    if (base && isUiLocale(base)) return base;
  }
  return null;
}
