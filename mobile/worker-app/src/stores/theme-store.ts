import { create } from 'zustand';

import { getItem, setItem } from '@/lib/persistent-storage';

/**
 * Light/dark mode preference.
 *
 * Until now the apps followed the OS scheme with no way to override it, while
 * the web app has always had a theme toggle — so a worker who keeps their phone
 * in dark mode could not read the app in light mode, or the reverse. This adds
 * the missing control.
 *
 * `system` is the default and stays the default: the OS preference is the right
 * answer for most people, and it is what every existing build already did, so
 * shipping this changes nobody's appearance until they choose otherwise.
 *
 * Persisted through persistent-storage (SecureStore on device, localStorage on
 * web) for the same reason locale-store uses it: this needs to survive a
 * restart, and that is the persistence these apps already have. A theme choice
 * is not secret, but adding AsyncStorage for one string is not worth it.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'fhm.themeMode';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * The scheme to actually render, given the user's choice and what the OS
 * reports. Pure and exported so it is testable without a renderer — this
 * project's jest config only collects `.test.ts`, so logic left inside a hook
 * or component is untested by construction.
 *
 * `system` follows the OS. React Native reports null (and, on some platforms,
 * 'unspecified') when it has no preference, which must fall back to light
 * rather than crashing a `Colors[scheme]` lookup with undefined.
 */
export function resolveScheme(mode: ThemeMode, systemScheme: string | null | undefined): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

interface ThemeState {
  mode: ThemeMode;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'system',
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await getItem(STORAGE_KEY);
      // An unrecognized stored value (older build, manual edit) falls back to
      // 'system' rather than rendering an undefined palette.
      set({ mode: isThemeMode(stored) ? stored : 'system', hydrated: true });
    } catch {
      // Storage failures must never block startup — the app just opens in the
      // OS scheme, which is the pre-existing behaviour.
      set({ hydrated: true });
    }
  },

  setMode: async (mode: ThemeMode) => {
    set({ mode });
    try {
      await setItem(STORAGE_KEY, mode);
    } catch {
      // The choice still applies for this session; only persistence failed.
    }
  },
}));
