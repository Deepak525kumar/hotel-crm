"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_UI_LOCALE, UI_LOCALES, initialLocale, type UiLocale } from "@/lib/locales";

import de from "./locales/de.json";
import en from "./locales/en.json";
import ur from "./locales/ur.json";
import ar from "./locales/ar.json";
import fr from "./locales/fr.json";
import uk from "./locales/uk.json";

/**
 * Drop the `_meta` block before the catalogue reaches i18next.
 *
 * `_meta` is bookkeeping -- review status, RTL documentation, and the
 * "MACHINE-TRANSLATED, NOT REVIEWED BY A HUMAN SPEAKER" warning. i18next's
 * `ignoreJSONStructure` option does NOT hide it (verified: `t('_meta.note')`
 * still resolved), so a stray or mistyped key could render that warning
 * straight into the UI. Stripping it at load makes that impossible rather
 * than merely unlikely.
 */
function stripMeta<T extends Record<string, unknown>>(catalogue: T): Omit<T, "_meta"> {
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

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    // Every locale falls back to German, matching the backend's
    // DEFAULT_UI_LOCALE and DEFAULT_LANGUAGE. Four of the six catalogues are
    // machine-translated and unreviewed (see each file's `_meta.reviewed`);
    // when one is missing a key the user sees German rather than a raw key
    // like "nav.dashboard".
    fallbackLng: DEFAULT_UI_LOCALE,
    supportedLngs: [...UI_LOCALES],
    lng: initialLocale(),
    interpolation: {
      // React already escapes interpolated values; i18next escaping on top
      // double-escapes apostrophes in the French and Ukrainian strings.
      escapeValue: false,
    },
    returnNull: false,
  });
}

export default i18n;
