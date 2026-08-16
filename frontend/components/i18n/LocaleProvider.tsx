"use client";

import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { dirFor } from "@/lib/locales";
import { useLocaleStore } from "@/stores/locale";
import { useAuthStore } from "@/stores/auth";

/**
 * Keeps the document's `lang` and `dir` in step with the active locale, and
 * applies the signed-in user's stored preference once it arrives.
 *
 * Why `<html lang>` is written here rather than in the server-rendered root
 * layout: the language a user should see depends on their account, which is
 * only known after `SessionBootstrap` resolves `GET /auth/me` client-side.
 * The layout therefore ships a static `lang="de"` (the platform default) and
 * this effect corrects it. `dir` matters more than `lang` visually -- it is
 * what flips the entire layout for Arabic and Urdu -- but `lang` is what
 * screen readers and hyphenation use, so both are set together.
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  const reconcileFromServer = useLocaleStore((s) => s.reconcileFromServer);
  const reconciled = useLocaleStore((s) => s.reconciled);
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = dirFor(locale);
  }, [locale]);

  useEffect(() => {
    // Reconcile once auth settles, whichever way it settles. An
    // unauthenticated visitor still gets a locale -- theirs comes from
    // localStorage or the browser -- so the login screen is translated too.
    if (reconciled || status === "loading") return;
    reconcileFromServer(status === "authenticated" ? user?.preferred_language : null);
  }, [reconciled, status, user?.preferred_language, reconcileFromServer]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
