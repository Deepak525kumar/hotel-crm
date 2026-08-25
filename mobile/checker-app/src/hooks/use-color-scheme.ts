import { useColorScheme as useSystemColorScheme } from 'react-native';

import { resolveScheme, useThemeStore } from '@/stores/theme-store';

/**
 * The scheme every themed component should read.
 *
 * Was a bare re-export of React Native's `useColorScheme`, i.e. OS-only with no
 * override. Routing it through the theme store means the whole app honours the
 * user's setting without any other file changing: `useTheme()` and every
 * `ThemedText`/`ThemedView` already consume this hook.
 */
export function useColorScheme(): 'light' | 'dark' {
  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useSystemColorScheme();
  return resolveScheme(mode, systemScheme);
}
