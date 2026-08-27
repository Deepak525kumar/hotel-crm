/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Every colour the app is allowed to use, in both schemes.
 *
 * The rule this exists to enforce: **no screen may hardcode a colour.** Five
 * screens used to paint cards `#FFFFFF` inline, which looked fine in light mode
 * and rendered white-on-white text in dark mode -- invisible, and invisible to
 * typecheck and to every test. If a colour you need is missing, add a token
 * here (in BOTH schemes) rather than reaching for a hex literal in a screen.
 *
 * `text` / `background` / `backgroundElement` / `backgroundSelected` /
 * `textSecondary` / `primary` predate this and are kept under their original
 * names so existing screens keep working; the rest are additive.
 */
export const Colors = {
  light: {
    text: '#09090B',
    background: '#F8FAFC', // Slate 50
    backgroundElement: '#FFFFFF', // Pure white cards
    backgroundSelected: '#E2E8F0', // Slate 200
    textSecondary: '#64748B', // Slate 500
    // Teal rather than WhatsApp's own green: the palette already spends
    // green on `success` (a completed shift), and an accent in the same
    // hue would undo the distinction between "finished" and "this is a
    // button". Teal keeps the messaging-app feel without the collision.
    primary: '#0F766E', // Teal 700 — 4.8:1 on white, so onPrimary text passes AA

    // --- additive semantic tokens ---
    /** Hairline dividers and card outlines. */
    border: '#E2E8F0', // Slate 200
    /** A card raised above `backgroundElement`, e.g. a sheet over a card. */
    surfaceRaised: '#FFFFFF',
    /** Text/icons drawn ON a `primary` fill. */
    onPrimary: '#FFFFFF',
    /** Tinted `primary` wash for selected rows and subtle callouts. */
    primarySubtle: '#CCFBF1', // Teal 100
    success: '#15803D', // Green 700
    successSubtle: '#DCFCE7', // Green 100
    warning: '#B45309', // Amber 700
    warningSubtle: '#FEF3C7', // Amber 100
    danger: '#B91C1C', // Red 700
    dangerSubtle: '#FEE2E2', // Red 100
    /** Skeleton/placeholder blocks while content loads. */
    skeleton: '#E2E8F0',
  },
  dark: {
    text: '#FAFAFA',
    background: '#09090B', // Zinc 950 (True OLED-like)
    backgroundElement: '#18181B', // Zinc 900
    backgroundSelected: '#27272A', // Zinc 800
    textSecondary: '#A1A1AA', // Zinc 400
    primary: '#0D9488', // Teal 600 — lifted for the dark ground

    // --- additive semantic tokens ---
    border: '#27272A', // Zinc 800
    surfaceRaised: '#27272A', // Zinc 800
    onPrimary: '#FFFFFF',
    primarySubtle: '#042F2E', // Teal 950
    // Lightened against the dark ground: the light-mode 700s fail contrast here.
    success: '#4ADE80', // Green 400
    successSubtle: '#14532D', // Green 900
    warning: '#FBBF24', // Amber 400
    warningSubtle: '#451A03', // Amber 950
    danger: '#F87171', // Red 400
    dangerSubtle: '#450A0A', // Red 950
    skeleton: '#27272A',
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

/**
 * Corner radii. Cards and sheets share `lg`; pills use `full`.
 */
export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/**
 * Cross-platform elevation. Spread onto a View's style.
 *
 * iOS shadows need four properties that must agree; Android needs `elevation`.
 * Screens previously inlined partial, inconsistent versions of this, so cards
 * on the same screen sat at visibly different heights.
 */
export const Elevation = {
  none: {},
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
