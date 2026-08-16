import { create } from "zustand";
import i18n from "@/lib/i18n";
import { DEFAULT_UI_LOCALE, initialLocale, isUiLocale, type UiLocale } from "@/lib/locales";
import { authApi } from "@/lib/api";

// Survives a reload before /auth/me resolves, and carries the choice of a
// user who is not signed in at all (the login and password-reset screens are
// public but still need to render in the user's language). The server copy
// on User.preferred_language remains authoritative for a signed-in user --
// this is a cache, not a second source of truth.
const STORAGE_KEY = "fhm.locale";

function readStored(): UiLocale | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isUiLocale(raw) ? raw : null;
  } catch {
    // Private-browsing modes and locked-down profiles can throw on access.
    // A language preference is never worth breaking the app over.
    return null;
  }
}

function writeStored(locale: UiLocale | null): void {
  if (typeof window === "undefined") return;
  try {
    if (locale) window.localStorage.setItem(STORAGE_KEY, locale);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see readStored */
  }
}

interface LocaleState {
  locale: UiLocale;
  /**
   * True once the signed-in user's stored preference has been applied (or
   * confirmed absent). Until then `locale` is a guess from the browser's
   * own languages, good enough to paint with but not yet authoritative.
   */
  reconciled: boolean;

  /** User-initiated change: updates the UI immediately, then persists. */
  setLocale: (locale: UiLocale) => Promise<void>;
  /** Apply the value returned by GET /auth/me at bootstrap. */
  reconcileFromServer: (preferred: string | null | undefined) => void;
}

function apply(locale: UiLocale): void {
  void i18n.changeLanguage(locale);
}

export const useLocaleStore = create<LocaleState>()((set, get) => ({
  // localStorage first (an explicit past choice), then the browser's
  // languages, then German.
  locale: readStored() ?? (typeof window === "undefined" ? DEFAULT_UI_LOCALE : initialLocale()),
  reconciled: false,

  setLocale: async (locale) => {
    const previous = get().locale;
    // Optimistic: a language switch must feel instant. The request below is
    // only about durability across devices.
    set({ locale });
    apply(locale);
    writeStored(locale);

    try {
      await authApi.updateProfile({ preferred_language: locale });
    } catch {
      // The local choice stands -- the user asked for it and localStorage
      // has it -- but surface nothing here: the caller (LanguageSwitcher)
      // owns the error message, and silently reverting the UI under
      // someone who just clicked would be worse than a preference that
      // fails to sync. Re-thrown so that caller can decide.
      set({ locale: previous });
      apply(previous);
      writeStored(previous);
      throw new Error("locale-persist-failed");
    }
  },

  reconcileFromServer: (preferred) => {
    if (isUiLocale(preferred)) {
      // A stored preference always wins over the device-locale guess.
      if (preferred !== get().locale) {
        set({ locale: preferred });
        apply(preferred);
      }
      writeStored(preferred);
    }
    // preferred == null means "never chosen": keep whatever we negotiated
    // from the browser and do NOT write it back to the server. Writing it
    // would convert an inferred guess into an explicit choice and pin the
    // user to this device's locale everywhere else.
    set({ reconciled: true });
  },
}));
