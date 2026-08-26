import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Badge, Button, Card, EmptyState, ScreenHeader, SectionHeader, StatTile } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { greetingKeyForHour, workerDisplayName } from '@/lib/greeting';
import type { WorkerAssignment } from '@/types/api';

/**
 * Home.
 *
 * Rebuilt on the shared UI primitives (`components/ui`) rather than inline
 * styles. The previous version hardcoded `#FFFFFF` card backgrounds and
 * `#38A169`/`#3182CE` status pills, so in dark mode every card was a white
 * slab and the shift text on it was unreadable.
 *
 * Also absorbs the Jobs tab: with the tab bar down to three, open jobs are a
 * section here with a link to the full list.
 */

function statusTone(status: string) {
  if (status === 'IN_PROGRESS') return 'success' as const;
  if (status === 'CONFIRMED') return 'primary' as const;
  return 'neutral' as const;
}

function shiftWhen(shift: WorkerAssignment): string {
  // From the assignment, not work_request: the latter is null for
  // calendar-placed shifts, which is all of them in production, so this line
  // used to render " – " with the date missing entirely.
  const day = shift.day ?? shift.work_request?.shift_date;
  return [
    day ? new Date(day as string).toLocaleDateString() : null,
    shift.shift_start_time && shift.shift_end_time
      ? `${shift.shift_start_time} – ${shift.shift_end_time}`
      : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const router = useRouter();

  const { data: stats, isLoading: statsLoading, isValidating: statsValidating, mutate: mutateStats } =
    useSWR(user ? `/analytics/myStats/${user.id}` : null, () => api.analytics.myStats());

  const {
    data: assignments,
    isLoading: assignmentsLoading,
    isValidating: assignmentsValidating,
    mutate: mutateAssignments,
  } = useSWR(user ? `/assignments/list/${user.id}` : null, () => api.assignments.list({ limit: 5 }));

  const upcoming = Array.isArray(assignments)
    ? assignments.filter((s) => ['CONFIRMED', 'IN_PROGRESS'].includes(s.status))
    : [];

  const loading = statsLoading || assignmentsLoading;
  const refreshing = statsValidating || assignmentsValidating;

  const onRefresh = async () => {
    await Promise.all([mutateStats(), mutateAssignments()]);
  };

  const name = workerDisplayName(user?.first_name);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ScreenHeader
            subtitle={t(greetingKeyForHour(new Date().getHours()))}
            title={name ? name : t('home.greetingNoName')}
            action={<NotificationBell />}
          />

          {loading ? (
            <ActivityIndicator style={styles.loader} />
          ) : (
            <>
              <SectionHeader title={t('profile.overview')} />
              <View style={styles.statsGrid}>
                <StatTile label={t('shifts.upcoming')} value={upcoming.length} tone="primary" />
                <StatTile label={t('status.completed')} value={stats?.completed_assignments ?? 0} />
              </View>
              <View style={styles.statsGrid}>
                <StatTile label={t('shifts.roomsCompleted')} value={stats?.rooms_completed ?? 0} />
                <StatTile
                  label={t('fields.rating')}
                  value={stats?.average_rating ? stats.average_rating.toFixed(1) : '—'}
                  tone={stats?.average_rating ? 'success' : 'neutral'}
                />
              </View>

              <SectionHeader
                title={t('shifts.upcomingTitle')}
                action={
                  upcoming.length > 0 ? (
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      onPress={() => router.push('/(app)/shifts')}
                    >
                      {t('home.viewAll')}
                    </ThemedText>
                  ) : null
                }
              />

              {upcoming.length === 0 ? (
                <EmptyState
                  title={t('home.noUpcomingShifts')}
                  body={t('home.noUpcomingShiftsBody')}
                  action={
                    <Button
                      label={t('home.browseJobs')}
                      variant="ghost"
                      onPress={() => router.push('/(app)/marketplace')}
                    />
                  }
                />
              ) : (
                upcoming.map((shift, index) => (
                  <Animated.View entering={FadeInUp.delay(index * 80)} key={shift.id}>
                    <Card style={styles.shiftCard}>
                      <View style={styles.shiftTop}>
                        <ThemedText type="smallBold" style={styles.shiftTitle}>
                          {shift.work_request?.position ?? t('common.shift')}
                        </ThemedText>
                        <Badge
                          label={shift.status.replace('_', ' ')}
                          tone={statusTone(shift.status)}
                        />
                      </View>
                      {shift.hotel?.name ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {shift.hotel.name}
                        </ThemedText>
                      ) : null}
                      <ThemedText type="small" themeColor="textSecondary">
                        {shiftWhen(shift)}
                      </ThemedText>
                    </Card>
                  </Animated.View>
                ))
              )}

              <SectionHeader title={t('home.openJobs')} />
              <Card>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('marketplace.description', 'Shifts you can apply for.')}
                </ThemedText>
                <Button
                  label={t('home.browseJobs')}
                  variant="secondary"
                  onPress={() => router.push('/(app)/marketplace')}
                />
              </Card>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  header: { gap: Spacing.half, marginBottom: Spacing.two },
  loader: { marginTop: Spacing.five },
  statsGrid: { flexDirection: 'row', gap: Spacing.two },
  shiftCard: { marginBottom: Spacing.two },
  shiftTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  shiftTitle: { flex: 1 },
});
