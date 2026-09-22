// UI locale contract — mobile mirror of backend/src/lib/locales.ts and
// frontend/lib/locales.ts. Kept as a duplicate because the three packages do
// not share a build; a test (__tests__/locales.test.ts) fails if they drift.
export const UI_LOCALES = ['de', 'en', 'ur', 'ar', 'fr', 'uk'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const RTL_UI_LOCALES: readonly UiLocale[] = ['ur', 'ar'];
export const DEFAULT_UI_LOCALE: UiLocale = 'de';

// Endonyms — each language named in itself. A worker who reads only Urdu
// cannot find their language in a list that calls it "Urdu".
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

export function negotiateLocale(tags: readonly string[]): UiLocale | null {
  for (const tag of tags) {
    const base = tag.split('-')[0]?.toLowerCase();
    if (base && isUiLocale(base)) return base;
  }
  return null;
}
