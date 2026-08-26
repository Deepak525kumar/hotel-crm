/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#09090B',
    background: '#F8FAFC', // Slate 50
    backgroundElement: '#FFFFFF', // Pure white cards
    backgroundSelected: '#E2E8F0', // Slate 200
    textSecondary: '#64748B', // Slate 500
    // Matches the worker app: teal rather than a green, so the accent never
    // competes with the meaning green carries for completed work.
    primary: '#0F766E', // Teal 700 — 4.8:1 on white
  },
  dark: {
    text: '#FAFAFA',
    background: '#09090B', // Zinc 950 (True OLED-like)
    backgroundElement: '#18181B', // Zinc 900
    backgroundSelected: '#27272A', // Zinc 800
    textSecondary: '#A1A1AA', // Zinc 400
    primary: '#0D9488', // Teal 600 — lifted for the dark ground
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
