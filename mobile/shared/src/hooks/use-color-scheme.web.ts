import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { resolveScheme, useThemeStore } from '../stores/theme-store';

/**
 * Web build of use-color-scheme. Expo resolves this file instead of the native
 * one on web, so it has to honour the user's theme setting too — otherwise the
 * settings screen would offer a Light/Dark choice that silently did nothing in
 * a browser.
 *
 * Keeps the static-rendering guard the original had: the server render has no
 * access to the OS preference, so the first paint is 'light' and the real value
 * is applied once hydrated. Without it the markup rendered on the server and
 * the markup rendered on the client disagree.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useRNColorScheme();

  if (hasHydrated) {
    return resolveScheme(mode, systemScheme);
  }

  return 'light';
}
