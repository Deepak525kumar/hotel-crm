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
 * There used to be an attendance-verification queue as the first tab.
 * Checkers do not verify attendance, so that screen was dropped entirely
 * (see `(app)/_layout.tsx`'s header comment).
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
    api.attendance.listMine(user!.id, { per_page: 20 })
  );

  // Open jobs, CHECKER-targeted only (enforced server-side, see jobs.tsx's
  // own note) -- mirrors worker-app's Home section, kept to 3 rows here with
  // "Browse jobs" the way through to the full list.
  const {
    data: openJobs,
    isValidating: jobsValidating,
    mutate: mutateJobs,
  } = useSWR(user ? `/work-requests/open/${user.id}` : null, () =>
    api.workRequests.list({ status: 'OPEN', limit: 3 })
  );

  const upcoming = Array.isArray(assignments)
    ? assignments.filter((s) => ['CONFIRMED', 'IN_PROGRESS'].includes(s.status))
    : [];

  // user!.id, not an unfiltered list: GET /attendance returns other workers'
  // rows to a checker (it backs the verification queue), so the gate must pick
  // out the checker's own — see checking-eligibility.ts.
  const eligibility = resolveCheckingEligibility(
    attendance ?? [],
    localToday(),
    user?.id ?? ''
  );

  const loading = statsLoading || assignmentsLoading;
  const refreshing = statsValidating || assignmentsValidating || attendanceValidating || jobsValidating;

  const onRefresh = async () => {
    await Promise.all([mutateStats(), mutateAssignments(), mutateAttendance(), mutateJobs()]);
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

              <SectionHeader title={t('home.openJobs')} />
              {Array.isArray(openJobs) && openJobs.length > 0 ? (
                openJobs.map((job) => (
                  <Pressable
                    key={job.id}
                    accessibilityRole="button"
                    onPress={() => router.push(`/job/${job.id}`)}
                  >
                    <Card>
                      <ThemedText type="smallBold">{job.position ?? t('common.shift')}</ThemedText>
                      {job.hotel?.name ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {job.hotel.name}
                        </ThemedText>
                      ) : null}
                      <ThemedText type="small" themeColor="textSecondary">
                        {job.shift_date ? new Date(job.shift_date).toLocaleDateString() : ''}
                      </ThemedText>
                    </Card>
                  </Pressable>
                ))
              ) : (
                <Card>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('marketplace.noneOpen')}
                  </ThemedText>
                </Card>
              )}
              <Button
                label={t('home.browseJobs')}
                variant="secondary"
                onPress={() => router.push('/(app)/jobs')}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
