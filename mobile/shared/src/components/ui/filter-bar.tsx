import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '../themed-text';
import { Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

/**
 * A single control that opens every filter for a list, and says how many are on.
 *
 * The web portal puts two or three `<select>` elements inline above each
 * table. Three selects side by side do not fit 375pt, and stacking them costs
 * the whole fold before a single row of data appears. One button plus a sheet
 * keeps the list visible, and the count means an empty list is never
 * mysterious -- "0 results" with "Filters (2)" explains itself.
 *
 * LOCALISED since 2026-09-23. The label, and the accessibility hint a screen
 * reader speaks, were hard-coded English in an app shipped in six languages --
 * two of them right-to-left. A control that every list screen wears at the top
 * is the last place to leave untranslated.
 */
export function FilterBar({
  activeCount,
  onPress,
  children,
}: {
  activeCount: number;
  onPress: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const label =
    activeCount > 0 ? t('common.filtersWithCount', { count: activeCount }) : t('common.filters');

  return (
    <View style={[styles.bar, { backgroundColor: theme.background }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t('common.filtersHint')}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: activeCount > 0 ? theme.primarySubtle : theme.backgroundElement,
            borderColor: activeCount > 0 ? theme.primary : theme.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <ThemedText type="smallBold">{label}</ThemedText>
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
  },
});
