import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import {
  DEFAULT_UI_LOCALE,
  UI_LOCALES,
  negotiateLocale,
  type UiLocale,
} from '../locales';

import de from './locales/de.json';
import en from './locales/en.json';
import ur from './locales/ur.json';
import ar from './locales/ar.json';
import fr from './locales/fr.json';
import uk from './locales/uk.json';

/**
 * Drop the `_meta` block before the catalogue reaches i18next.
 *
 * `_meta` is bookkeeping -- review status and the "MACHINE-TRANSLATED, NOT
 * REVIEWED BY A HUMAN SPEAKER" warning. i18next's `ignoreJSONStructure`
 * option does NOT hide it (verified: `t('_meta.note')` still resolved), so a
 * stray or mistyped key could render that warning straight into the UI.
 * Stripping it at load makes that impossible rather than merely unlikely.
 */
function stripMeta<T extends Record<string, unknown>>(catalogue: T): Omit<T, '_meta'> {
  const { _meta: _ignored, ...rest } = catalogue;
  return rest;
}

const resources = {
  de: { translation: stripMeta(de) },
  en: { translation: stripMeta(en) },
  ur: { translation: stripMeta(ur) },
  ar: { translation: stripMeta(ar) },
  fr: { translation: stripMeta(fr) },
  uk: { translation: stripMeta(uk) },
} satisfies Record<UiLocale, { translation: unknown }>;

/**
 * The locale to use before the signed-in worker's stored preference is known
 * (auth resolves asynchronously at boot). Falls back through the device's
 * own configured languages, then German.
 */
export function deviceLocale(): UiLocale {
  const tags = getLocales().map((l) => l.languageTag);
  return negotiateLocale(tags) ?? DEFAULT_UI_LOCALE;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    // Every locale falls back to German, matching the backend. Four of the
    // six catalogues are machine-translated and unreviewed (see each file's
    // `_meta.reviewed`); a missing key shows German, never a raw key path.
    fallbackLng: DEFAULT_UI_LOCALE,
    supportedLngs: [...UI_LOCALES],
    lng: deviceLocale(),
    interpolation: { escapeValue: false },
    returnNull: false,
    // React Native has no Intl.PluralRules on older JSC builds; i18next's
    // own compatibility layer is not needed for the current key set (no
    // plurals yet), but keep this explicit so adding one is a conscious act.
    compatibilityJSON: 'v4',
  });
}

export default i18n;
