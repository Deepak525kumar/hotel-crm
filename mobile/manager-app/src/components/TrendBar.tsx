import { StyleSheet, View } from 'react-native';

import { Card, Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

/**
 * A labelled proportion, for the "how are we doing" half of Home.
 *
 * Deliberately a bar and not a line chart: these are single current values
 * (on-time rate, pass rate), not series — this product stores no history the
 * client can plot, so a line chart would be drawing a trend that does not
 * exist. Claiming a trajectory from one data point is worse than showing the
 * number honestly.
 */
export function TrendBar({
  label,
  value,
  display,
  tone = 'primary',
}: {
  label: string;
  /** 0..1, or null when never measured. */
  value: number | null;
  display: string;
  tone?: 'primary' | 'success' | 'warning';
}) {
  const theme = useTheme();
  const colour = tone === 'success' ? theme.success : tone === 'warning' ? theme.warning : theme.primary;

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <ThemedText type="small" style={styles.label} numberOfLines={1}>
          {label}
        </ThemedText>
        <ThemedText type="smallBold">{display}</ThemedText>
      </View>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        {/* Null renders an empty track, never a zero-width bar presented as a
            measurement: "not measured" and "zero" are different facts. */}
        {value === null ? null : (
          <View
            style={[styles.fill, { backgroundColor: colour, width: `${Math.round(value * 100)}%` }]}
          />
        )}
      </View>
    </View>
  );
}

export function TrendCard({ children }: { children: React.ReactNode }) {
  return <Card>{children}</Card>;
}

const styles = StyleSheet.create({
  row: { gap: Spacing.one, paddingVertical: Spacing.one },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { flex: 1, flexShrink: 1, minWidth: 0 },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.full },
});
