import { create } from 'zustand';
import { I18nManager } from 'react-native';
import { getItem, setItem } from '../lib/persistent-storage';
import i18n, { deviceLocale } from '../lib/i18n';
import { isRtlLocale, isUiLocale, type UiLocale } from '../lib/locales';
import { api } from '../lib/api';

// Cached so the app opens in the right language before /auth/me resolves,
// and so a signed-out worker still sees a translated login screen. The
// server copy (User.preferred_language) stays authoritative once known.
//
// Stored via expo-secure-store, which this app already depends on for
// tokens, rather than adding AsyncStorage for one non-secret string. A
// language choice needs no encryption, but it does need to survive a
// restart, and persistent-storage is the persistence this app already has
// (SecureStore on device, localStorage on web -- see that module).
const STORAGE_KEY = 'fhm.locale';

interface LocaleState {
  locale: UiLocale;
  reconciled: boolean;
  /**
   * True when the active locale's writing direction differs from the one the
   * native layout was laid out with. React Native applies RTL at the native
   * layout level, and `I18nManager.forceRTL` only takes effect on the next
   * app start -- so the UI can be translated into Arabic while still laid
   * out left-to-right. The settings screen shows a "restart to finish"
   * notice when this is true; it must never be silently ignored, because
   * the alternative is a half-mirrored screen the user cannot explain.
   */
  needsRestartForRtl: boolean;

  hydrate: () => Promise<void>;
  setLocale: (locale: UiLocale) => Promise<void>;
  reconcileFromServer: (preferred: string | null | undefined) => Promise<void>;
}

function directionMismatch(locale: UiLocale): boolean {
  return isRtlLocale(locale) !== I18nManager.isRTL;
}

async function applyLocale(locale: UiLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  // Ask the native layer to lay out the NEXT launch in the right direction.
  // Deliberately not calling any reload helper here: forcing a restart out
  // from under someone who just tapped a picker loses whatever they were
  // doing. We flag it and let them finish.
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(isRtlLocale(locale));
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: deviceLocale(),
  reconciled: false,
  needsRestartForRtl: false,

  hydrate: async () => {
    try {
      const stored = await getItem(STORAGE_KEY);
      if (isUiLocale(stored)) {
        await applyLocale(stored);
        set({ locale: stored, needsRestartForRtl: directionMismatch(stored) });
      }
    } catch {
      // A cached preference that cannot be read is not worth blocking boot.
    }
  },

  setLocale: async (locale) => {
    const previous = get().locale;
    // Optimistic — switching language must feel immediate.
    await applyLocale(locale);
    set({ locale, needsRestartForRtl: directionMismatch(locale) });
    try {
      await setItem(STORAGE_KEY, locale);
    } catch {
      /* non-fatal: the choice still applies to this session */
    }

    try {
      await api.auth.updateProfile({ preferred_language: locale });
    } catch (error) {
      // Roll the UI back so what is shown matches what was actually saved,
      // then let the caller surface the failure.
      await applyLocale(previous);
      set({ locale: previous, needsRestartForRtl: directionMismatch(previous) });
      try {
        await setItem(STORAGE_KEY, previous);
      } catch {
        /* non-fatal */
      }
      throw error;
    }
  },

  reconcileFromServer: async (preferred) => {
    if (isUiLocale(preferred) && preferred !== get().locale) {
      await applyLocale(preferred);
      set({ locale: preferred, needsRestartForRtl: directionMismatch(preferred) });
      try {
        await setItem(STORAGE_KEY, preferred);
      } catch {
        /* non-fatal */
      }
    }
    // A null preference means "never chosen": keep the device-negotiated
    // locale and do NOT write it back, which would turn a guess into an
    // explicit choice on every other device.
    set({ reconciled: true });
  },
}));
