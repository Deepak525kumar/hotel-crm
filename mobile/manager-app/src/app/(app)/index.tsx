import { useCallback, useMemo, useState } from 'react';
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
  RatingTierBadge,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  scopeOf,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

import { ActionCard } from '@/components/ActionCard';
import { ChatLauncher } from '@/components/ChatLauncher';
import { DayShape } from '@/components/DayShape';
import { ScopeNote } from '@/components/ScopeNote';
import { TrendBar, TrendCard } from '@/components/TrendBar';
import { percent, score } from '@/lib/format-metrics';
import { todayInBerlin } from '@/lib/today';

/**
 * Home.
 *
 * Renamed from "Today" 2026-09-23 and restructured, because the first
 * version was a grid of KPI tiles — which answers "how are we doing" when the
 * question a supervisor opens the app with, mid-shift, is "what needs me".
 *
 * Three bands, in the order a shift is actually managed:
 *
 *   1. THE DAY'S SHAPE — is today covered, who is missing, what is unfilled.
 *   2. WHAT NEEDS ME  — only non-zero items, each a tap into the work.
 *   3. HOW WE ARE DOING — rates and the leaderboard, for when there is time.
 *
 * Band 2 renders nothing when nothing is waiting. A dashboard full of zeroes
 * teaches people to stop reading it.
 */
export default function Home() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const scope = scopeOf(user);
  const [refreshing, setRefreshing] = useState(false);
  const today = useMemo(() => todayInBerlin(), []);

  const stats = useSWR('analytics/stats', () => api.analytics.stats());
  const board = useSWR('analytics/leaderboard', () => api.analytics.leaderboard());
  const queue = useSWR('review-queue', () => api.employee.reviewQueue());
  const attendanceToday = useSWR(['attendance', today], () =>
    api.attendance.listTeam({ from: today, to: today })
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([stats.mutate(), board.mutate(), queue.mutate(), attendanceToday.mutate()]);
    } finally {
      setRefreshing(false);
    }
  }, [stats, board, queue, attendanceToday]);

  const d = stats.data;
  const rows = attendanceToday.data ?? [];
  const present = rows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const absent = rows.filter((r) => r.status === 'ABSENT').length;
  const unverified = rows.filter((r) => !r.is_verified).length;
  const pendingReviews = (queue.data ?? []).length;
  const topFive = (board.data ?? []).slice(0, 5);

  const loading = stats.isLoading || attendanceToday.isLoading;
  const nothingWaiting = unverified === 0 && pendingReviews === 0 && (d?.work_requests.open ?? 0) === 0;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <ScreenHeader title={t('nav.home')} />
          <ScopeNote scope={scope} />

          {loading ? (
            <SkeletonList rows={5} />
          ) : stats.error ? (
            <EmptyState title={t('analytics.loadFailed')} />
          ) : (
            <>
              {/* 1 — the day's shape */}
              <DayShape
                present={present}
                expected={rows.length}
                absent={absent}
                unfilled={d?.work_requests.open ?? 0}
              />

              {/* 2 — what needs me, non-zero only */}
              <SectionHeader title={t('common.actions')} />
              {nothingWaiting ? (
                <EmptyState title={t('notifications.allCaughtUp')} />
              ) : (
                <>
                  <ActionCard
                    label={t('attendance.statusPRESENT')}
                    count={unverified}
                    urgent
                    onPress={() => router.push('/(app)/attendance')}
                  />
                  <ActionCard
                    label={t('nav.reviewQueue')}
                    count={pendingReviews}
                    urgent
                    onPress={() => router.push('/review-queue')}
                  />
                  <ActionCard
                    label={t('analytics.openRequests')}
                    count={d?.work_requests.open ?? 0}
                    onPress={() => router.push('/requests')}
                  />
                  <ActionCard
                    label={t('analytics.noShows')}
                    count={d?.assignments.no_show ?? 0}
                    onPress={() => router.push('/(app)/attendance')}
                  />
                </>
              )}

              {/* 3 — how we are doing */}
              <SectionHeader
                title={t('nav.analytics')}
                action={
                  <Button
                    label={t('analytics.viewAnalytics')}
                    variant="ghost"
                    onPress={() => router.push('/analytics')}
                  />
                }
              />
              <TrendCard>
                <TrendBar
                  label={t('analytics.onTimeRate')}
                  value={rate(d?.attendance.on_time_rate)}
                  display={percent(d?.attendance.on_time_rate)}
                  tone="success"
                />
                <TrendBar
                  label={t('analytics.qualityPassRate')}
                  value={rate(d?.quality.pass_rate)}
                  display={percent(d?.quality.pass_rate)}
                />
                <TrendBar
                  label={t('analytics.averageRating')}
                  // Ratings are 0-100 on this platform (ADR-026), so the bar
                  // shares the same scale as the rates above.
                  value={rate(d?.ratings.average_score)}
                  display={score(d?.ratings.average_score)}
                  tone="warning"
                />
              </TrendCard>

              <SectionHeader
                title={t('nav.leaderboard')}
                action={
                  <Button
                    label={t('leaderboard.view')}
                    variant="ghost"
                    onPress={() => router.push('/leaderboard')}
                  />
                }
              />
              {topFive.length === 0 ? (
                <EmptyState title={t('analytics.noRankedWorkers')} />
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
                      {row.rating_tier ? <RatingTierBadge tier={row.rating_tier} /> : null}
                    </View>
                  ))}
                </Card>
              )}
            </>
          )}
        </ScrollView>
        <ChatLauncher />
      </SafeAreaView>
    </ThemedView>
  );
}

/**
 * A 0-100 API value as a 0..1 fraction, or null when never measured.
 *
 * Null stays null rather than becoming 0: an unmeasured rate and a rate of
 * zero look identical on a bar, and only one of them is bad news.
 */
function rate(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
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
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  position: { width: 24 },
  boardName: { flex: 1, flexShrink: 1, minWidth: 0 },
});
