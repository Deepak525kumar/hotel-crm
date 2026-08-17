import { StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState, useCallback } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { WorkerStats, WorkerAssignment } from '@/types/api';
import { useTranslation } from 'react-i18next';

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.statCard}>
      <ThemedText type="title" style={accent ? { color: accent } : undefined}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  );
}

export default function DashboardScreen() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const theme = useTheme();
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [upcoming, setUpcoming] = useState<WorkerAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [statsRes, shiftsRes] = await Promise.allSettled([
        api.analytics.myStats(),
        api.assignments.list({ limit: 5 }),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      if (shiftsRes.status === 'fulfilled') {
        const all = Array.isArray(shiftsRes.value) ? shiftsRes.value : [];
        setUpcoming(all.filter((s) => ['CONFIRMED', 'IN_PROGRESS'].includes(s.status)));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

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
                upcoming.map((shift) => (
                  <ThemedView key={shift.id} type="backgroundElement" style={styles.shiftCard}>
                    <ThemedText type="smallBold">
                      {shift.work_request?.position ?? t('common.shift')}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {shift.work_request?.shift_date
                        ? new Date(shift.work_request.shift_date).toLocaleDateString()
                        : ''}{' '}
                      {shift.work_request?.shift_start_time} – {shift.work_request?.shift_end_time}
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
                  </ThemedView>
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
});
