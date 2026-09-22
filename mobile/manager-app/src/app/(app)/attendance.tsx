import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  BottomSheet,
  BottomTabInset,
  Button,
  DataRow,
  EmptyState,
  FilterBar,
  MaxContentWidth,
  ScreenHeader,
  SelectSheet,
  SkeletonList,
  Spacing,
  ThemedView,
  api,
} from '@hotel-crm/mobile-shared';

import { addDays } from '@/lib/agenda';
import { todayInBerlin } from '@/lib/today';
import { attendanceTone, personName } from '@/lib/attendance-format';

const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'PARTIAL', 'EXCUSED'] as const;

/**
 * The attendance queue.
 *
 * Defaults to a week ending today rather than "everything": the list is the
 * manager's verification work, and an unbounded list buries today's
 * unverified rows under months of settled ones.
 */
export default function AttendanceScreen() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);

  const range = useMemo(() => {
    const to = todayInBerlin();
    return { from: addDays(to, -7), to };
  }, []);

  const { data, error, isLoading, mutate } = useSWR(
    ['attendance', range.from, range.to, status],
    () => api.attendance.listTeam({ from: range.from, to: range.to, status: status ?? undefined })
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  // Client-side only, and only over rows the server already scoped: this is a
  // view convenience, never the gate.
  const rows = (data ?? []).filter((r) => (unverifiedOnly ? !r.is_verified : true));
  const activeFilters = (status ? 1 : 0) + (unverifiedOnly ? 1 : 0);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <ScreenHeader title={t('nav.attendance')} />
          <FilterBar activeCount={activeFilters} onPress={() => setFiltersOpen(true)} />

          {isLoading ? (
            <SkeletonList rows={6} />
          ) : error ? (
            <EmptyState title={t('attendance.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('attendance.noneFound')} />
          ) : (
            rows.map((row) => (
              <DataRow
                key={row.id}
                title={personName(row)}
                subtitle={row.hotel?.name ?? row.hotel_id ?? ''}
                meta={row.check_in_at ?? undefined}
                trailing={
                  <View style={styles.trailing}>
                    <Badge
                      label={t(`attendance.status${row.status}`)}
                      tone={attendanceTone(row.status)}
                    />
                    {row.is_verified ? (
                      <Badge label={t('status.verified')} tone="success" />
                    ) : (
                      <Badge label={t('status.unverified')} tone="warning" />
                    )}
                  </View>
                }
                onPress={() => router.push(`/attendance/${row.id}`)}
              />
            ))
          )}
        </ScrollView>

        <BottomSheet
          visible={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title={t('common.filter')}
          footer={<Button label={t('common.done')} onPress={() => setFiltersOpen(false)} />}
        >
          <SelectSheet
            label={t('fields.status')}
            value={status}
            options={[
              { value: '__any__', label: t('common.all') },
              // Localised labels: the catalogue already carries one per
              // status (attendance.statusPRESENT etc.), so the filter reads
              // in the manager's language instead of showing the enum.
              ...STATUSES.map((s) => ({ value: s, label: t(`attendance.status${s}`) })),
            ]}
            onChange={(next) => setStatus(next === '__any__' ? null : next)}
          />
          <Button
            label={unverifiedOnly ? t('status.unverified') : t('common.all')}
            variant={unverifiedOnly ? 'primary' : 'ghost'}
            onPress={() => setUnverifiedOnly((v) => !v)}
          />
        </BottomSheet>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: BottomTabInset,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  trailing: { gap: Spacing.one, alignItems: 'flex-end' },
});
