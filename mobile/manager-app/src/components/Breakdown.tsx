import { StyleSheet, View } from 'react-native';

import { Card, Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

export type BreakdownRow = { key: string; label: string; value: number };

/**
 * A labelled bar per category, replacing the web's side-by-side breakdown grid.
 *
 * Bars rather than a donut or a stacked bar: the question a manager asks here
 * is "how many were absent", not "what proportion of the whole" -- and a
 * stacked segment three pixels wide at 375pt cannot be read or labelled at
 * all. Each row keeps its own count visible next to its name.
 *
 * A zero total renders every bar empty rather than dividing by it. That case
 * is real and common (a hotel with no requests yet), not defensive padding.
 */
export function Breakdown({ rows, total }: { rows: readonly BreakdownRow[]; total: number }) {
  const theme = useTheme();
  const safeTotal = total > 0 ? total : 0;

  return (
    <Card>
      {rows.map((row) => {
        const fraction = safeTotal === 0 ? 0 : row.value / safeTotal;
        return (
          <View key={row.key} style={styles.row}>
            <View style={styles.head}>
              <ThemedText type="small" style={styles.label} numberOfLines={1}>
                {row.label}
              </ThemedText>
              <ThemedText type="smallBold">{row.value}</ThemedText>
            </View>
            <View
              style={[styles.track, { backgroundColor: theme.backgroundSelected }]}
              // One announcement for the pair, so a screen reader says
              // "Absent, 3 of 20" instead of reading a decorative bar.
              accessibilityRole="progressbar"
              accessibilityLabel={`${row.label}, ${row.value} of ${safeTotal}`}
            >
              <View
                style={[
                  styles.fill,
                  { backgroundColor: theme.primary, width: `${Math.round(fraction * 100)}%` },
                ]}
              />
            </View>
          </View>
        );
      })}
      <ThemedText type="small" themeColor="textSecondary">
        {total}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.one, paddingVertical: Spacing.one },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { flex: 1, flexShrink: 1, minWidth: 0 },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.full },
});
