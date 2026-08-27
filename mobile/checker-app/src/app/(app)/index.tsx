import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Badge, Button, Card, EmptyState, ScreenHeader, SectionHeader, StatTile } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { assignmentStatusTone } from '@/lib/assignment-status-tone';
import { greetingKeyForHour, workerDisplayName } from '@/lib/greeting';
import { resolveCheckingEligibility, type CheckingBlockReason } from '@/lib/checking-eligibility';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Today in the device's local timezone, as YYYY-MM-DD. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

const BLOCK_MESSAGE: Record<CheckingBlockReason, string> = {
  NO_SHIFT_TODAY: 'home.checkingBlockedNoShift',
  NOT_CHECKED_IN: 'home.checkingBlockedNotCheckedIn',
  CHECKED_OUT: 'home.checkingBlockedCheckedOut',
};

/**
 * Home — the checker's landing screen, and the only route to Start checking.
 *
 * It replaces the attendance queue that used to be the first tab. The queue
 * still exists (`/(app)/queue`); it is simply no longer what the app opens on,
 * because a list of unverified attendance rows is not where a checker's day
 * starts.
 *
 * Start checking is gated on being checked in (`resolveCheckingEligibility`,
 * which carries the rule and its tests). The gate is deliberately visible
 * rather than hidden: the button stays on screen and explains why it is
 * unavailable, because "check in first" is one tap away and a missing button
 * teaches nobody that.
 *
 * This is a client-side gate on a client-side affordance. It is not the
 * authorization for inspecting — that lives on the server with the quality
 * endpoints, exactly as ADR-072's own note about client gates requires.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
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

  const {
    data: attendance,
    isValidating: attendanceValidating,
    mutate: mutateAttendance,
  } = useSWR(user ? `/attendance/mine/${user.id}` : null, () =>
    api.attendance.listMine({ per_page: 20 })
  );

  const upcoming = Array.isArray(assignments)
    ? assignments.filter((s) => ['CONFIRMED', 'IN_PROGRESS'].includes(s.status))
    : [];

  // user!.id, not an unfiltered list: GET /attendance returns other workers'
  // rows to a checker (it backs the verification queue), so the gate must pick
  // out the checker's own — see checking-eligibility.ts.
  const eligibility = resolveCheckingEligibility(
    attendance?.data ?? [],
    localToday(),
    user?.id ?? ''
  );

  const loading = statsLoading || assignmentsLoading;
  const refreshing = statsValidating || assignmentsValidating || attendanceValidating;

  const onRefresh = async () => {
    await Promise.all([mutateStats(), mutateAssignments(), mutateAttendance()]);
  };

  const name = workerDisplayName(user?.first_name);

  const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    content: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
    loader: { marginTop: Spacing.six },
    tiles: { flexDirection: 'row', gap: Spacing.two },
    startCard: { gap: Spacing.three },
    blockedText: { color: theme.textSecondary },
    shiftRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.two,
    },
  });

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
              <Card style={styles.startCard}>
                <SectionHeader title={t('home.startCheckingTitle')} />
                {eligibility.allowed ? null : (
                  <ThemedText type="small" style={styles.blockedText}>
                    {t(BLOCK_MESSAGE[eligibility.reason ?? 'NO_SHIFT_TODAY'])}
                  </ThemedText>
                )}
                <Button
                  label={t('home.startChecking')}
                  disabled={!eligibility.allowed}
                  onPress={() => router.push('/inspection/select-worker')}
                />
                {eligibility.reason === 'NOT_CHECKED_IN' ? (
                  <Button
                    label={t('home.goToSchedule')}
                    variant="secondary"
                    onPress={() => router.push('/(app)/shifts')}
                  />
                ) : null}
              </Card>

              <SectionHeader title={t('profile.overview')} />
              <View style={styles.tiles}>
                <StatTile label={t('shifts.upcoming')} value={upcoming.length} tone="primary" />
                <StatTile
                  label={t('status.completed')}
                  value={stats?.completed_assignments ?? 0}
                />
              </View>

              <SectionHeader
                title={t('shifts.upcoming')}
                action={
                  <Button
                    label={t('home.viewAll')}
                    variant="ghost"
                    onPress={() => router.push('/(app)/shifts')}
                  />
                }
              />
              {upcoming.length === 0 ? (
                <EmptyState title={t('home.noUpcomingShifts')} />
              ) : (
                upcoming.slice(0, 3).map((shift) => (
                  <Pressable
                    key={shift.id}
                    accessibilityRole="button"
                    onPress={() => router.push(`/shift/${shift.id}`)}
                  >
                    <Card>
                      <View style={styles.shiftRow}>
                        <ThemedText type="smallBold">
                          {shift.hotel?.name ?? t('common.shift')}
                        </ThemedText>
                        <Badge
                          tone={assignmentStatusTone(shift.status)}
                          label={shift.status.replace('_', ' ')}
                        />
                      </View>
                      {shift.day ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {shift.day}
                          {shift.shift_start_time ? ` · ${shift.shift_start_time}` : ''}
                        </ThemedText>
                      ) : null}
                    </Card>
                  </Pressable>
                ))
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
