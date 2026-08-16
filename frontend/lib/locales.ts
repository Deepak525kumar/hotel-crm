// UI locale contract — client mirror of backend/src/lib/locales.ts.
//
// Kept as a small hand-maintained duplicate rather than imported: the
// frontend has no build-time dependency on the backend package, and the two
// lists changing together is enforced by a test
// (__tests__/locales.test.ts) that fails loudly if they drift.
export const UI_LOCALES = ['de', 'en', 'ur', 'ar', 'fr', 'uk'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const RTL_UI_LOCALES: readonly UiLocale[] = ['ur', 'ar'];
export const DEFAULT_UI_LOCALE: UiLocale = 'de';

// Endonyms — each language named in itself, which is what a language picker
// must show: someone who only reads Arabic cannot find their language in a
// list that calls it "Arabic". Never translate these.
export const LOCALE_LABELS: Record<UiLocale, string> = {
  de: 'Deutsch',
  en: 'English',
  ur: 'اردو',
  ar: 'العربية',
  fr: 'Français',
  uk: 'Українська',
};

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value);
}

export function isRtlLocale(locale: UiLocale): boolean {
  return RTL_UI_LOCALES.includes(locale);
}

export function dirFor(locale: UiLocale): 'rtl' | 'ltr' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}

// Negotiate from Accept-Language-style tags (e.g. navigator.languages).
// Region subtags are dropped: the UI is translated per language, not per
// region. Returns null when nothing matches so callers can distinguish
// "nothing negotiable" from "negotiated German".
export function negotiateLocale(tags: readonly string[]): UiLocale | null {
  for (const tag of tags) {
    const base = tag.split('-')[0]?.toLowerCase();
    if (base && isUiLocale(base)) return base;
  }
  return null;
}

// The locale to render before the user's stored preference is known.
//
// Auth resolves asynchronously (SessionBootstrap calls GET /auth/me after
// mount), so first paint cannot know the stored preference. Reading the
// browser's own languages is the best available guess and avoids flashing
// German at a French user for the duration of a network round-trip; the
// stored preference then reconciles on top of it when it arrives.
export function initialLocale(): UiLocale {
  if (typeof navigator === 'undefined') return DEFAULT_UI_LOCALE;
  return negotiateLocale(navigator.languages ?? [navigator.language]) ?? DEFAULT_UI_LOCALE;
}
