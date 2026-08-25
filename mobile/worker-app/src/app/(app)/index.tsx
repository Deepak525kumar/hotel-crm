import { StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import useSWR from 'swr';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';

function StatCard({ label, value, accent, index = 0 }: { label: string; value: string | number; accent?: string; index?: number }) {
  return (
    <Animated.View entering={FadeInUp.delay(index * 100)} style={[styles.statCard, { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }]}>
      <ThemedText type="title" style={accent ? { color: accent } : undefined}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Animated.View>
  );
}

export default function DashboardScreen() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const theme = useTheme();
  
  const [submitting, setSubmitting] = useState(false);

  // Using SWR for caching and automatic revalidation on focus/reconnect
  const { data: stats, isLoading: statsLoading, isValidating: statsValidating, mutate: mutateStats } = useSWR(
    user ? `/analytics/myStats/${user.id}` : null,
    () => api.analytics.myStats()
  );
  
  const { data: assignments, isLoading: assignmentsLoading, isValidating: assignmentsValidating, mutate: mutateAssignments } = useSWR(
    user ? `/assignments/list/${user.id}` : null,
    () => api.assignments.list({ limit: 5 })
  );

  const upcoming = Array.isArray(assignments) 
    ? assignments.filter((s) => ['CONFIRMED', 'IN_PROGRESS'].includes(s.status))
    : [];

  const loading = statsLoading || assignmentsLoading;
  const refreshing = statsValidating || assignmentsValidating;

  const onRefresh = async () => {
    await Promise.all([mutateStats(), mutateAssignments()]);
  };


  const handleSubmitForReview = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      // The lifecycle endpoints are keyed by the EmploymentRecord's
      // `employee_id` ("EMP-W-001"), not the user id, and /auth/me does not
      // return it — so it has to be resolved first. Passing user.id here (and
      // to an `/employee-management` path that is not mounted) meant every
      // submission 404'd and onboarding could not be completed from the app.
      const record = await api.employee.getByUserId(user.id);
      if (!record) {
        Alert.alert(
          t('errors.title'),
          t('onboarding.noEmploymentRecord', 'Your employment record is not ready yet. Please contact your manager.')
        );
        return;
      }
      await api.employee.submitForReview(record.employee_id);
      Alert.alert(t('common.success', 'Success'), t('onboarding.submittedForReview', 'Your application has been submitted for review.'));
      // A full app reload would be ideal here to update the user context, but for now we reload dashboard data
      await Promise.all([mutateStats(), mutateAssignments()]);
    } catch (e: any) {
      Alert.alert(t('errors.title'), translateApiError(e, t, 'errors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ThemedText type="subtitle" style={styles.greeting}>
            Hi, {user?.first_name} 👋
          </ThemedText>

          {user?.employment_status === 'PENDING' && (
            <ThemedView type="backgroundElement" style={[styles.shiftCard, { borderColor: '#D69E2E', borderWidth: 1, marginBottom: Spacing.four }]}>
              <ThemedText type="smallBold" style={{ color: '#D69E2E', marginBottom: Spacing.one }}>Onboarding Incomplete</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
                Please ensure all your documents are uploaded and your contract is signed. Once everything is ready, submit your profile for review.
              </ThemedText>
              <Pressable
                onPress={handleSubmitForReview}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.submitButton,
                  { backgroundColor: '#D69E2E', opacity: pressed || submitting ? 0.7 : 1 }
                ]}
              >
                {submitting ? <ActivityIndicator size="small" color="#fff" /> : <ThemedText type="smallBold" style={{ color: '#fff' }}>Submit for Review</ThemedText>}
              </Pressable>
            </ThemedView>
          )}

          {loading ? (
            <ActivityIndicator style={styles.loader} />
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>{t("profile.overview")}</ThemedText>
              <ThemedView style={styles.statsGrid}>
                <StatCard label={t('shifts.upcoming')} value={upcoming.length} accent={theme.text} />
                <StatCard label={t('status.completed')} value={stats?.completed_assignments ?? 0} />
                <StatCard label={t('shifts.roomsCompleted')} value={stats?.rooms_completed ?? 0} />
                <StatCard
                  label={t('fields.rating')}
                  value={stats?.average_rating ? stats.average_rating.toFixed(1) : '—'}
                />
              </ThemedView>

              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>{t("shifts.upcomingTitle")}</ThemedText>
              {upcoming.length === 0 ? (
                <ThemedView type="backgroundElement" style={styles.emptyCard}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>{t("shifts.noneUpcoming")}</ThemedText>
                </ThemedView>
              ) : (
                upcoming.map((shift, index) => (
                  <Animated.View entering={FadeInUp.delay((index + 4) * 100)} key={shift.id} style={[styles.shiftCard, { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }]}>
                    <ThemedText type="smallBold">
                      {shift.work_request?.position ?? t('common.shift')}
                    </ThemedText>
                    {/* From the assignment, not work_request: the latter is null
                        for calendar-placed shifts, which is all of them in
                        production, so this line used to render " – " with the
                        date missing entirely. */}
                    {shift.hotel?.name && (
                      <ThemedText type="small" themeColor="textSecondary">{shift.hotel.name}</ThemedText>
                    )}
                    <ThemedText type="small" themeColor="textSecondary">
                      {[
                        (shift.day ?? shift.work_request?.shift_date)
                          ? new Date((shift.day ?? shift.work_request!.shift_date) as string).toLocaleDateString()
                          : null,
                        shift.shift_start_time && shift.shift_end_time
                          ? `${shift.shift_start_time} – ${shift.shift_end_time}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join('  ')}
                    </ThemedText>
                    <ThemedView
                      style={[
                        styles.badge,
                        { backgroundColor: shift.status === 'IN_PROGRESS' ? '#38A169' : '#3182CE' },
                      ]}
                    >
                      <ThemedText type="small" style={styles.badgeText}>
                        {shift.status.replace('_', ' ')}
                      </ThemedText>
                    </ThemedView>
                  </Animated.View>
                ))
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  greeting: { marginBottom: Spacing.four },
  loader: { marginTop: Spacing.six },
  sectionLabel: { marginBottom: Spacing.two, marginTop: Spacing.three, textTransform: 'uppercase', letterSpacing: 0.8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  statCard: { flex: 1, minWidth: '45%', borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one },
  shiftCard: { borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.two, gap: Spacing.one },
  emptyCard: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center' },
  centerText: { textAlign: 'center' },
  badge: { alignSelf: 'flex-start', borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: 2, marginTop: Spacing.one },
  badgeText: { color: '#fff', fontSize: 11 },
  submitButton: { height: 40, borderRadius: Spacing.two, justifyContent: 'center', alignItems: 'center' },
});
