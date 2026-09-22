import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  Card,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  StatTile,
  ThemedText,
  ThemedView,
  api,
  scopeOf,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { Breakdown } from '@/components/Breakdown';
import { ScopeNote } from '@/components/ScopeNote';
import { percent, score } from '@/lib/format-metrics';

/**
 * The full operational picture, at whatever scope the caller holds.
 *
 * Three breakdowns rather than one long table, because the web's version is a
 * grid of columns that does not reflow to 375pt. Each card answers one
 * question: is work getting filled, are people turning up, are the rooms
 * passing.
 */
export default function Analytics() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const scope = scopeOf(user);
  const [refreshing, setRefreshing] = useState(false);

  const { data, error, isLoading, mutate } = useSWR('analytics/stats', () =>
    api.analytics.stats()
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <BackLink />
          <ScreenHeader title={t('nav.analytics')} subtitle={t('analytics.description')} />
          <ScopeNote scope={scope} />

          {isLoading ? (
            <SkeletonList rows={6} />
          ) : error ? (
            <EmptyState title={t('analytics.loadFailed')} />
          ) : !data ? (
            <EmptyState title={t('analytics.loadFailed')} />
          ) : (
            <>
              <Card>
                <View style={styles.tiles}>
                  <StatTile
                    label={t('analytics.openRequests')}
                    value={String(data.work_requests.open)}
                  />
                  <StatTile
                    label={t('analytics.totalShifts')}
                    value={String(data.assignments.total)}
                  />
                </View>
                <View style={styles.tiles}>
                  <StatTile
                    label={t('analytics.completedShifts')}
                    value={String(data.assignments.completed)}
                  />
                  <StatTile
                    label={t('analytics.noShows')}
                    value={String(data.assignments.no_show)}
                  />
                </View>
                <View style={styles.tiles}>
                  <StatTile
                    label={t('analytics.onTimeRate')}
                    value={percent(data.attendance.on_time_rate)}
                  />
                  <StatTile
                    label={t('analytics.qualityPassRate')}
                    value={percent(data.quality.pass_rate)}
                  />
                </View>
                <View style={styles.tiles}>
                  {/* score(), not percent(): a null average means nothing has
                      been inspected, which is not the same as a zero score. */}
                  <StatTile
                    label={t('analytics.averageRating')}
                    value={score(data.ratings.average_score)}
                  />
                  <StatTile
                    // 'Rooms completed', not nav.rooms ('My rooms') -- this is
                    // the hotel's aggregate, not the caller's own log.
                    label={t('assignments.roomsCompleted')}
                    value={String(data.rooms_completed.total)}
                  />
                </View>
              </Card>

              <SectionHeader title={t('nav.requests')} />
              <Breakdown
                rows={[
                  {
                    key: 'open',
                    label: t('analytics.openRequests'),
                    value: data.work_requests.open,
                  },
                  { key: 'filled', label: t('jobs.filled'), value: data.work_requests.filled },
                  {
                    key: 'cancelled',
                    label: t('status.cancelled'),
                    value: data.work_requests.cancelled,
                  },
                  { key: 'expired', label: t('status.expired'), value: data.work_requests.expired },
                ]}
                total={data.work_requests.total}
              />

              <SectionHeader title={t('nav.attendance')} />
              <Breakdown
                rows={[
                  { key: 'present', label: t('status.present'), value: data.attendance.present },
                  { key: 'late', label: t('status.late'), value: data.attendance.late },
                  { key: 'absent', label: t('status.absent'), value: data.attendance.absent },
                ]}
                total={data.attendance.total}
              />

              <SectionHeader title={t('nav.assignments')} />
              <Breakdown
                rows={[
                  {
                    key: 'completed',
                    label: t('status.completed'),
                    value: data.assignments.completed,
                  },
                  {
                    key: 'in_progress',
                    label: t('status.inProgress'),
                    value: data.assignments.in_progress,
                  },
                  { key: 'no_show', label: t('analytics.noShows'), value: data.assignments.no_show },
                  {
                    key: 'cancelled',
                    label: t('status.cancelled'),
                    value: data.assignments.cancelled,
                  },
                ]}
                total={data.assignments.total}
              />

              <ThemedText type="small" themeColor="textSecondary">
                {t('analytics.qualityPassRate')}: {percent(data.quality.pass_rate)} ·{' '}
                {data.quality.total_verifications}
              </ThemedText>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  tiles: { flexDirection: 'row', gap: Spacing.three },
});
