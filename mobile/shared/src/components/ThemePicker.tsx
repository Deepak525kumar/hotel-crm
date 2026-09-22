import { StyleSheet, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from './themed-text';
import { Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { useThemeStore, type ThemeMode } from '../stores/theme-store';

/**
 * Light/dark mode selector, matching the web app's theme toggle.
 *
 * Rows rather than a switch, because there are three states and not two:
 * "System" has to be reachable, and a two-position switch cannot express it.
 * Losing "System" would be a real regression — it is the default and what every
 * build did before this existed.
 *
 * No pending/error state, unlike LanguagePicker: the change applies from local
 * state immediately and never calls the server, so there is nothing to wait for
 * and nothing to fail. A storage write failure only costs persistence, which
 * the store swallows deliberately.
 */
const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

const LABEL_KEY: Record<ThemeMode, string> = {
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
};

const FALLBACK: Record<ThemeMode, string> = {
  system: 'Match device',
  light: 'Light',
  dark: 'Dark',
};

export function ThemePicker() {
  const { t } = useTranslation();
  const theme = useTheme();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <View>
      <ThemedText type="smallBold" style={styles.heading}>
        {t('settings.appearance', 'Appearance')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {t('settings.appearanceHint', 'Choose how the app looks. "Match device" follows your phone settings.')}
      </ThemedText>

      {MODES.map((option) => {
        const selected = option === mode;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => void setMode(option)}
            style={({ pressed }) => [
              styles.row,
              {
                // The palette has no dedicated border token, so an unselected
                // row uses the element background to stay visible in both
                // schemes rather than a hardcoded grey.
                backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <ThemedText type={selected ? 'smallBold' : 'default'}>
              {t(LABEL_KEY[option], FALLBACK[option])}
            </ThemedText>
            {selected && <ThemedText type="small">✓</ThemedText>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: Spacing.one },
  hint: { marginBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
    marginBottom: Spacing.one,
  },
});
