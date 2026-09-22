import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

/**
 * The shape of today, in one glance.
 *
 * A supervisor opening the app mid-shift is asking one question — "is today
 * covered?" — and a grid of KPI tiles answers a different, slower one. So
 * this leads: how many are on, how many turned up, how many are missing, and
 * how much of the work is still unfilled.
 *
 * The bar is proportional coverage, not decoration: an eye reads a part-full
 * bar faster than it reads "14 / 18", and the numbers are still there for
 * anyone who wants them.
 */
export function DayShape({
  present,
  expected,
  absent,
  unfilled,
}: {
  present: number;
  expected: number;
  absent: number;
  unfilled: number;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  // Guarded: a day with nothing scheduled is a real state, and dividing by it
  // would render NaN% rather than an empty bar.
  const covered = expected > 0 ? Math.min(1, present / expected) : 0;
  const shortfall = Math.max(0, expected - present);

  return (
    <Card>
      <View style={styles.head}>
        <ThemedText type="h2">
          {present}/{expected}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('attendance.statusPRESENT')}
        </ThemedText>
      </View>

      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.fill,
            {
              // Green when fully covered, amber when not — the colour is the
              // answer, the number is the detail.
              backgroundColor: shortfall === 0 ? theme.success : theme.warning,
              width: `${Math.round(covered * 100)}%`,
            },
          ]}
        />
      </View>

      <View style={styles.legend}>
        <Legend tone={theme.danger} label={t('attendance.statusABSENT')} value={absent} />
        <Legend tone={theme.warning} label={t('analytics.openRequests')} value={unfilled} />
      </View>
    </Card>
  );
}

function Legend({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  track: { height: 8, borderRadius: Radius.full, overflow: 'hidden', marginVertical: Spacing.two },
  fill: { height: 8, borderRadius: Radius.full },
  legend: { flexDirection: 'row', gap: Spacing.four, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexShrink: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
