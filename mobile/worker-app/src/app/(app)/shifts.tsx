import { StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { WorkerAssignment, AssignmentStatus } from '@/types/api';
import { useTranslation } from 'react-i18next';

const STATUS_COLOR: Record<AssignmentStatus, string> = {
  CONFIRMED: '#3182CE',
  IN_PROGRESS: '#38A169',
  COMPLETED: '#718096',
  NO_SHOW: '#E53E3E',
  CANCELLED: '#A0AEC0',
  REASSIGNED: '#DD6B20',
};

function ShiftCard({ item, onPress }: { item: WorkerAssignment; onPress: () => void }) {
  const { t } = useTranslation();
  const color = STATUS_COLOR[item.status] ?? '#718096';
  const isRework = Boolean(item.rework_of_assignment_id);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedView style={styles.cardRow} type="backgroundElement">
          <ThemedText type="smallBold" style={styles.flex}>
            {isRework
              ? t('quality.reworkTitle')
              : (item.work_request?.position ?? t('common.shift'))}
          </ThemedText>
          <View style={[styles.badge, { backgroundColor: color }]}>
            <ThemedText type="small" style={styles.badgeText}>
              {item.status.replace(/_/g, ' ')}
            </ThemedText>
          </View>
        </ThemedView>
        {item.work_request && (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(item.work_request.shift_date).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
              })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.work_request.shift_start_time} – {item.work_request.shift_end_time}
            </ThemedText>
          </>
        )}
        {item.attendance?.check_in_at && (
          <ThemedText type="small" themeColor="textSecondary">
            Checked in: {new Date(item.attendance.check_in_at).toLocaleTimeString()}
          </ThemedText>
        )}
      </ThemedView>
    </Pressable>
  );
}

export default function ShiftsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  
  const { data: assignments, isLoading: loading, isValidating: refreshing, mutate } = useSWR(
    user ? `/assignments/list_all/${user.id}` : null,
    () => api.assignments.list({ limit: 50 })
  );
  
  const items = Array.isArray(assignments) ? assignments : [];

  const onRefresh = async () => {
    await mutate();
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.header}>{t('nav.myShifts')}</ThemedText>
        {loading && !items.length ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
            renderItem={({ item }) => (
              <ShiftCard
                item={item}
                onPress={() => {
                  if (item.rework_of_assignment_id) {
                    router.push(`/rework/${item.id}`);
                    return;
                  }
                  router.push(`/shift/${item.id}`);
                }}
              />
            )}
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="small" themeColor="textSecondary">{t('shifts.none')}</ThemedText>
              </ThemedView>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  header: { marginBottom: Spacing.three },
  loader: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  badge: { borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11 },
  empty: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center', marginTop: Spacing.four },
});
