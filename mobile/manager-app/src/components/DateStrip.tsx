import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Pressable } from 'react-native';

import { Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

export type DayCellLayout = { day: string; x: number; width: number };

/**
 * The row of days above the agenda, and the drop target for a drag.
 *
 * Reports each cell's measured x/width upward so the drag can resolve which
 * day a finger was released over. Measured rather than computed from an
 * assumed cell width: the strip scrolls, the locale changes the label
 * length, and a hardcoded width would drift silently and move shifts to the
 * wrong day.
 */
export function DateStrip({
  days,
  selected,
  onSelect,
  onCellLayout,
  highlight,
}: {
  days: readonly string[];
  selected: string;
  onSelect: (day: string) => void;
  onCellLayout?: (layout: DayCellLayout) => void;
  /** The day a drag is currently hovering, if any. */
  highlight?: string | null;
}) {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {days.map((day) => {
        const isSelected = day === selected;
        const isHovered = day === highlight;
        return (
          <Pressable
            key={day}
            onPress={() => onSelect(day)}
            onLayout={(e: LayoutChangeEvent) =>
              onCellLayout?.({
                day,
                x: e.nativeEvent.layout.x,
                width: e.nativeEvent.layout.width,
              })
            }
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={day}
            style={[
              styles.cell,
              {
                backgroundColor: isHovered
                  ? theme.primary
                  : isSelected
                    ? theme.primarySubtle
                    : theme.backgroundElement,
                borderColor: isSelected || isHovered ? theme.primary : theme.border,
              },
            ]}
          >
            <ThemedText
              type={isSelected ? 'smallBold' : 'small'}
              themeColor={isHovered ? 'onPrimary' : 'text'}
            >
              {day.slice(8)}
            </ThemedText>
            <ThemedText type="small" themeColor={isHovered ? 'onPrimary' : 'textSecondary'}>
              {day.slice(5, 7)}
            </ThemedText>
          </Pressable>
        );
      })}
      <View style={styles.tail} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: Spacing.two, paddingVertical: Spacing.two },
  cell: {
    minWidth: 48,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.two,
  },
  tail: { width: Spacing.three },
});
