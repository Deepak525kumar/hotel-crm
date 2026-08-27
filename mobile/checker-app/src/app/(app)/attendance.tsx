import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Card, EmptyState, ScreenHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { calendarDateOf, calendarTimeOf, formatDay } from '@/lib/calendar-dates';
import { formatDuration, workedMinutes } from '@/lib/attendance-format';
import type { AttendanceRecord, AttendanceStatus } from '@/types/api';

// Mirrors the tone language used on the shifts list: present/excused read as
// settled, absent as a problem, late/partial as needing a look.
const STATUS_TONE: Record<AttendanceStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  PRESENT: 'success',
  EXCUSED: 'success',
  ABSENT: 'danger',
  LATE: 'warning',
  PARTIAL: 'warning',
  EXPECTED: 'neutral',
};

/**
 * The worker's own attendance history.
 *
 * The web app has had an attendance view since Epic 3; mobile had the check-in
 * action but no way to look back at what was recorded, so a worker disputing a
 * shift's hours had nothing to point at.
 */
function time(iso?: string | null): string {
  return iso ? calendarTimeOf(iso) : '—';
}

export default function AttendanceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const [items, setItems] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      // Own records only -- GET /attendance is cross-hotel for a checker by
      // design (it backs the verification queue elsewhere in the app), so
      // this screen must scope to self explicitly. See listMine's own note.
      const res = await api.attendance.listMine(user.id, { per_page: 50 });
      setItems(Array.isArray(res) ? res : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title={t('nav.attendance')} action={<NotificationBell />} />

        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void load();
                }}
              />
            }
            ListEmptyComponent={<EmptyState title={t('attendance.noneFound')} />}
            renderItem={({ item }) => {
              const minutes = workedMinutes(item);
              return (
                // The record alone does not say which shift it belongs to --
                // where, when, for which hotel. That detail already exists on
                // the shift screen, so the row links to it.
                <Pressable
                  onPress={() => router.push(`/shift/${item.assignment_id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={t('attendance.viewAssignment')}
                  style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                >
                <Card>
                  <View style={styles.row}>
                    <ThemedText type="smallBold">
                      {item.check_in_at ? formatDay(calendarDateOf(item.check_in_at)) : '—'}
                    </ThemedText>
                    <Badge
                      label={t(`attendance.status${item.status}`, item.status)}
                      tone={STATUS_TONE[item.status]}
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {time(item.check_in_at)} – {time(item.check_out_at)}
                    {minutes !== null ? ` · ${formatDuration(minutes)}` : ''}
                  </ThemedText>
                </Card>
                </Pressable>
              );
            }}
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
  list: { gap: Spacing.two, paddingBottom: Spacing.five },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
