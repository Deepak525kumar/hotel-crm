"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LOCALE_LABELS, UI_LOCALES, isUiLocale } from "@/lib/locales";
import { useLocaleStore } from "@/stores/locale";

/**
 * The bare select, for contexts that already supply their own label and
 * description (the Settings page's DataRow). Options are labelled with each
 * language's endonym -- its name in itself -- rather than translated names:
 * a user who only reads Arabic cannot find their language in a list that
 * says "Arabic".
 */
export function LanguageSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isUiLocale(next) || next === locale) return;
    setError(false);
    setBusy(true);
    try {
      await setLocale(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <select
        aria-label={t("settings.language.title")}
        value={locale}
        onChange={onChange}
        disabled={busy}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
      >
        {UI_LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {t("settings.language.changeFailed")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Standalone labelled picker, for screens with no surrounding label
 * (e.g. a future onboarding step or the mobile-parity settings screen).
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (!isUiLocale(next) || next === locale) return;

    setError(false);
    setBusy(true);
    try {
      await setLocale(next);
    } catch {
      // The store has already rolled the UI back to the previous locale, so
      // the select and the rendered language stay consistent with what was
      // actually saved. All that is left is telling the user.
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <label htmlFor="language-select" className="block text-sm font-medium">
        {t("settings.language.title")}
      </label>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.language.description")}</p>
      <select
        id="language-select"
        value={locale}
        onChange={onChange}
        disabled={busy}
        className="mt-2 w-full max-w-xs rounded-md border px-3 py-2 text-sm disabled:opacity-60"
      >
        {UI_LOCALES.map((code) => (
          // `lang` on each option so the browser picks the right font and a
          // screen reader switches voice per entry -- without it, Arabic and
          // Urdu names in an otherwise-German list are announced wrong.
          <option key={code} value={code} lang={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("settings.language.changeFailed")}
        </p>
      ) : null}
    </div>
  );
}
