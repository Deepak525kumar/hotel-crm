import { StyleSheet, View } from 'react-native';

import { Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

export type Slice = { key: string; label: string; value: number; tone: string };

/**
 * A proportional bar chart, stacked.
 *
 * NOT a donut, despite the name this file started with, and not a pie: these
 * apps ship no SVG or charting dependency, and adding one for three
 * breakdowns would be a native module, a build, and a licence to audit.
 * A stacked bar renders in plain views, reads correctly at 375pt, and shows
 * the same thing a pie would — how the whole divides.
 *
 * Segments below ~4% are still drawn at 4% so they remain visible and
 * tappable-looking; the legend carries the true number, so nothing is
 * misreported, only made findable.
 */
export function StackedStat({ slices, total }: { slices: readonly Slice[]; total: number }) {
  const theme = useTheme();
  const safeTotal = total > 0 ? total : 0;

  return (
    <View style={styles.wrap}>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        {safeTotal === 0
          ? null
          : slices
              .filter((s) => s.value > 0)
              .map((slice) => (
                <View
                  key={slice.key}
                  style={{
                    backgroundColor: slice.tone,
                    width: `${Math.max(4, (slice.value / safeTotal) * 100)}%`,
                  }}
                />
              ))}
      </View>

      <View style={styles.legend}>
        {slices.map((slice) => (
          <View key={slice.key} style={styles.item}>
            <View style={[styles.dot, { backgroundColor: slice.tone }]} />
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.label}>
              {slice.label}
            </ThemedText>
            <ThemedText type="smallBold">{slice.value}</ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  track: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  legend: { gap: Spacing.one },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  label: { flex: 1, flexShrink: 1, minWidth: 0 },
});
