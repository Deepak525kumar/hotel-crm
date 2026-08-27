import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Card, EmptyState, ScreenHeader, SectionHeader, StatTile } from '@/components/ui';
import { api } from '@/lib/api';
import { attendanceStatusTone } from '@/lib/attendance-status-tone';
import { calendarTimeOf } from '@/lib/calendar-dates';
import { Spacing } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';
import type { AttendanceRecord } from '@/types/api';

/**
 * The verification queue.
 *
 * Rebuilt on the shared UI primitives, mirroring worker-app's dashboard
 * position for position: header with the notification bell, an overview strip
 * of StatTiles, then the list. The previous version built its own cards,
 * badges and shadows out of raw View/Text with hex literals, and recreated
 * every StyleSheet on each render.
 */
function QueueCard({ item, onPress }: { item: AttendanceRecord; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
      <Card>
        <View style={styles.cardRow}>
          {/* The API nests the worker, so this shows a name. It used to render
              the tail of a cuid, so a checker could not tell whose attendance
              they were about to verify. */}
          <ThemedText type="smallBold" style={styles.flex} numberOfLines={1}>
            {item.worker
              ? `${item.worker.first_name} ${item.worker.last_name}`.trim()
              : t('attendance.unknownWorker')}
          </ThemedText>
          <Badge
            label={t(`attendance.status${item.status}`, item.status)}
            tone={attendanceStatusTone(item.status)}
          />
        </View>

        {item.hotel ? (
          <ThemedText type="small" themeColor="textSecondary">
            {[item.hotel.name, item.hotel.city].filter(Boolean).join(' · ')}
          </ThemedText>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary">
          {t('attendance.inOutTimes', {
            in: item.check_in_at ? calendarTimeOf(item.check_in_at) : '—',
            out: item.check_out_at ? calendarTimeOf(item.check_out_at) : '—',
          })}
          {item.minutes_late ? ` · ${t('attendance.minutesLate', { count: item.minutes_late })}` : ''}
        </ThemedText>
      </Card>
    </Pressable>
  );
}

export default function QueueScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    user ? `/attendance/list/${user.id}` : null,
    () => api.attendance.list({ is_verified: false, per_page: 50 })
  );

  // EXPECTED means nobody has checked in yet -- there is nothing to verify, so
  // it does not belong in a verification queue.
  const records = (data?.data ?? []).filter((r) => r.status !== 'EXPECTED');
  const countOf = (status: string) => records.filter((r) => r.status === status).length;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader
          title={t('attendance.queueTitle')}
          subtitle={t('attendance.pendingCount', { count: records.length })}
          action={<NotificationBell />}
        />

        {isLoading && !isValidating ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={records}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />
            }
            ListHeaderComponent={
              <>
                <SectionHeader title={t('profile.overview')} />
                <View style={styles.statsGrid}>
                  <StatTile label={t('status.present')} value={countOf('PRESENT')} tone="success" />
                  <StatTile label={t('status.late')} value={countOf('LATE')} tone="warning" />
                  <StatTile label={t('status.absent')} value={countOf('ABSENT')} tone="danger" />
                </View>

                {error ? (
                  <Card>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('common.loadFailed')}
                    </ThemedText>
                  </Card>
                ) : null}

                <SectionHeader title={t('attendance.queueTitle')} />
              </>
            }
            renderItem={({ item, index }) => (
              <Animated.View entering={FadeInUp.delay(Math.min(index, 6) * 60)}>
                <QueueCard item={item} onPress={() => router.push(`/attendance/${item.id}`)} />
              </Animated.View>
            )}
            ListEmptyComponent={
              <EmptyState title={t('attendance.allCaughtUp')} body={t('attendance.noneFound')} />
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  loader: { marginTop: Spacing.five },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  statsGrid: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  flex: { flex: 1 },
});
