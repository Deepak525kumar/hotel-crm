import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
  const label = activeCount > 0 ? `Filters (${activeCount})` : 'Filters';

  return (
    <View style={[styles.bar, { backgroundColor: theme.background }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the filter options for this list"
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
