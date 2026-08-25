/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  // use-color-scheme now resolves the user's setting (theme-store) against the
  // OS scheme and always returns 'light' | 'dark', so the 'unspecified'
  // normalization that used to live here moved into resolveScheme().
  return Colors[useColorScheme()];
}
