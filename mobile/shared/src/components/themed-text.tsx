import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'h1'
    | 'h2'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'h1' && styles.h1,
        type === 'h2' && styles.h2,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        // linkPrimary is the accent, so it must follow the theme rather than a
        // fixed blue that stopped matching the accent entirely.
        type === 'linkPrimary' && { color: theme.primary },
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  // h1/h2 added 2026-09-22 for the manager app, and deliberately ADDED rather
  // than changing `title`/`subtitle`: worker-app and checker-app render
  // `title` at 48pt on a home screen that shows one greeting, and shrinking it
  // would restyle two shipped apps to suit a third. A manager screen is dense
  // and data-led -- a 48pt heading above a twelve-row list wastes the fold on
  // a 375pt phone. Reserve `title`/`subtitle` for a hero; use h1 for a screen
  // heading and h2 for a section.
  h1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 700,
  },
  h2: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    // linkPrimary takes its colour from the theme at render time
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
