import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  BottomTabInset,
  Button,
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

import { ScopeNote } from '@/components/ScopeNote';
import { percent } from '@/lib/format-metrics';

/**
 * Today.
 *
 * Four numbers, chosen because they are the ones a supervisor acts on before
 * lunch: work waiting to be filled, whether people arrived on time, whether
 * the rooms passed, and who did not turn up. Everything else is a tap away on
 * Analytics rather than competing for the fold.
 *
 * Pull-to-refresh is deliberately decoupled from SWR's `isValidating`: tying
 * the spinner to revalidation leaves it turning on every focus and poll, so
 * it stops meaning "your pull is being handled".
 */
export default function Today() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const scope = scopeOf(user);
  const [refreshing, setRefreshing] = useState(false);

  const stats = useSWR('analytics/stats', () => api.analytics.stats());
  const board = useSWR('analytics/leaderboard', () => api.analytics.leaderboard());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([stats.mutate(), board.mutate()]);
    } finally {
      setRefreshing(false);
    }
  }, [stats, board]);

  const d = stats.data;
  const topFive = (board.data ?? []).slice(0, 5);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <ScreenHeader title={t('common.today')} subtitle={t('analytics.description')} />
          <ScopeNote scope={scope} />

          {stats.isLoading ? (
            <SkeletonList rows={3} />
          ) : stats.error ? (
            // A readable failure, never a blank screen or a spinner that never
            // ends: hotel connectivity drops constantly, and "nothing
            // rendered" is indistinguishable from "there is nothing to show".
            <EmptyState title={t('analytics.loadFailed')} />
          ) : (
            <Card>
              <View style={styles.tiles}>
                <StatTile
                  label={t('analytics.openRequests')}
                  value={String(d?.work_requests.open ?? 0)}
                />
                <StatTile
                  label={t('analytics.onTimeRate')}
                  value={percent(d?.attendance.on_time_rate)}
                />
              </View>
              <View style={styles.tiles}>
                <StatTile
                  label={t('analytics.qualityPassRate')}
                  value={percent(d?.quality.pass_rate)}
                />
                <StatTile
                  label={t('analytics.noShows')}
                  value={String(d?.assignments.no_show ?? 0)}
                />
              </View>
              <Button
                label={t('analytics.viewAnalytics')}
                variant="ghost"
                onPress={() => router.push('/analytics')}
              />
              <Button
                label={t('nav.assignments')}
                variant="ghost"
                onPress={() => router.push('/assignments')}
              />
              <Button
                label={t('nav.requests')}
                variant="ghost"
                onPress={() => router.push('/requests')}
              />
            </Card>
          )}

          <SectionHeader title={t('nav.leaderboard')} />
          {board.isLoading ? (
            <SkeletonList rows={3} />
          ) : board.error ? (
            <EmptyState title={t('analytics.leaderboardLoadFailed')} />
          ) : topFive.length === 0 ? (
            <EmptyState
              title={t('analytics.noRankedWorkers')}
              body={t('analytics.noRankedWorkersDescription')}
            />
          ) : (
            <Card>
              {topFive.map((row) => (
                <View key={row.worker_id} style={styles.boardRow}>
                  <ThemedText type="smallBold" style={styles.position}>
                    {row.position}
                  </ThemedText>
                  <ThemedText style={styles.boardName} numberOfLines={1}>
                    {row.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {row.completed_tasks}/{row.total_tasks}
                  </ThemedText>
                </View>
              ))}
              <Button
                label={t('leaderboard.view')}
                variant="ghost"
                onPress={() => router.push('/leaderboard')}
              />
            </Card>
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
    paddingBottom: BottomTabInset,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  tiles: { flexDirection: 'row', gap: Spacing.three },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  position: { width: 24 },
  // flexShrink + min-width 0, or a long name widens the row past the viewport
  // instead of ellipsising (the lesson frontend/CLAUDE.md records for the web).
  boardName: { flex: 1, flexShrink: 1, minWidth: 0 },
});
