import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { api } from '@/lib/api';
import type { AttendanceRecord } from '@/types/api';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth-store';

function statusColor(status: string): string {
  switch (status) {
    case 'PRESENT': return '#22c55e';
    case 'LATE': return '#f59e0b';
    case 'ABSENT': return '#ef4444';
    default: return '#94a3b8';
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function QueueScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();

  const { data: recordsData, error: recordsError, isLoading: recordsLoading, isValidating: recordsValidating, mutate: mutateRecords } = useSWR(
    user ? `/attendance/list/${user.id}` : null,
    () => api.attendance.list({ is_verified: false, per_page: 50 })
  );
  
  const rawRecords = recordsData?.data ?? [];
  const records = rawRecords.filter((r) => r.status !== 'EXPECTED');
  const loading = recordsLoading;
  const refreshing = recordsValidating;
  const error = recordsError ? t('common.loadFailed') : null;

  const onRefresh = async () => {
    await mutateRecords();
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    headerTitle: { fontSize: 24, fontWeight: '700', color: theme.text },
    headerSubtitle: { fontSize: 14, color: theme.textSecondary, marginTop: 4 },
    statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
    statCard: {
      flex: 1,
      backgroundColor: theme.backgroundElement,
      borderRadius: 16,
      padding: 12,
      alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    statNum: { fontSize: 22, fontWeight: '700', color: theme.text },
    statLabel: { fontSize: 11, color: theme.textSecondary, marginTop: 2 },
    card: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 16,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    workerLabel: { fontSize: 15, fontWeight: '600', color: theme.text },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    badgeText: { fontSize: 12, fontWeight: '600', color: '#fff' },
    cardSub: { fontSize: 13, color: theme.textSecondary, marginTop: 4 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyText: { fontSize: 16, color: theme.textSecondary, textAlign: 'center' },
    errorText: { color: '#ef4444', textAlign: 'center', padding: 16, fontSize: 14 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });

  const renderItem = ({ item, index }: { item: AttendanceRecord; index: number }) => (
    <Animated.View entering={FadeInUp.delay((index + 2) * 100)}>
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/attendance/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.cardRow}>
          {/* The API now nests the worker, so this shows a name. It used to
              render `Worker ···{worker_id.slice(-6)}` -- the tail of a cuid --
              because the DTO carried only ids, and a checker could not tell
              whose attendance they were about to verify. */}
          <Text style={styles.workerLabel}>
            {item.worker
              ? `${item.worker.first_name} ${item.worker.last_name}`.trim()
              : t('attendance.unknownWorker', 'Unknown worker')}
          </Text>
          <View style={[styles.badge, { backgroundColor: statusColor(item.status) }]}>
            <Text style={styles.badgeText}>{item.status}</Text>
          </View>
        </View>
        {item.hotel && (
          <Text style={styles.cardSub}>
            {[item.hotel.name, item.hotel.city].filter(Boolean).join(' · ')}
          </Text>
        )}
        <Text style={styles.cardSub}>
          In: {formatTime(item.check_in_at)} · Out: {formatTime(item.check_out_at)}
          {item.minutes_late ? ` · ${item.minutes_late}m late` : ''}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.loading]}>
        <ActivityIndicator size="large" color={theme.text} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("attendance.queueTitle")}</Text>
        <Text style={styles.headerSubtitle}>{records.length} pending verification</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{records.filter((r) => r.status === 'PRESENT').length}</Text>
          <Text style={styles.statLabel}>{t("status.present")}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{records.filter((r) => r.status === 'LATE').length}</Text>
          <Text style={styles.statLabel}>{t("status.late")}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{records.filter((r) => r.status === 'ABSENT').length}</Text>
          <Text style={styles.statLabel}>{t("status.absent")}</Text>
        </View>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={records.length === 0 ? { flex: 1 } : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.text}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              All caught up!{'\n'}No attendance records pending verification.
            </Text>
          </View>
        }
      />
    </View>
  );
}
