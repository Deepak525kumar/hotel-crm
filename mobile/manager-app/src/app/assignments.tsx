import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  BottomSheet,
  Button,
  DataRow,
  EmptyState,
  FilterBar,
  Input,
  MaxContentWidth,
  ScreenHeader,
  SelectSheet,
  SkeletonList,
  Spacing,
  ThemedView,
  api,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import {
  ASSIGNMENT_STATUSES,
  assignmentStatusLabel,
  assignmentTone,
} from '@/lib/assignment-format';
import { useDebounced } from '@/lib/use-debounced';


export default function Assignments() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Debounced so a search does not fire a request per keystroke. Every round
  // trip here is on a hotel's mobile data.
  const q = useDebounced(search, 350);

  const { data, error, isLoading, mutate } = useSWR(['assignments', status, q], () =>
    api.assignments.listFiltered({ status: status ?? undefined, q: q || undefined })
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  const rows = data ?? [];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <BackLink />
          <ScreenHeader title={t('nav.assignments')} />
          <FilterBar
            activeCount={(status ? 1 : 0) + (q ? 1 : 0)}
            onPress={() => setFiltersOpen(true)}
          />

          {isLoading ? (
            <SkeletonList rows={6} />
          ) : error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('assignments.noneFound')} />
          ) : (
            rows.map((row) => (
              <DataRow
                key={row.id}
                title={row.hotel?.name ?? row.work_request?.position ?? row.id}
                subtitle={row.day ?? undefined}
                meta={
                  row.shift_start_time
                    ? `${row.shift_start_time}–${row.shift_end_time ?? ''}`
                    : undefined
                }
                trailing={
                  <Badge
                    label={assignmentStatusLabel(row.status, t)}
                    tone={assignmentTone(row.status)}
                  />
                }
                onPress={() => router.push(`/assignment/${row.id}`)}
              />
            ))
          )}
        </ScrollView>

        <BottomSheet
          visible={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title={t('common.filter')}
          footer={
            /* A way BACK to "no filters" -- see requests.tsx's note. */
            <View style={styles.sheetActions}>
              <Button
                label={t('common.reset')}
                variant="ghost"
                disabled={status === null && search === ''}
                style={styles.sheetAction}
                onPress={() => {
                  setStatus(null);
                  setSearch('');
                }}
              />
              <Button
                label={t('common.done')}
                style={styles.sheetAction}
                onPress={() => setFiltersOpen(false)}
              />
            </View>
          }
        >
          <Input label={t('common.search')} value={search} onChangeText={setSearch} />
          <SelectSheet
            label={t('fields.status')}
            value={status}
            options={[
              { value: '__any__', label: t('common.all') },
              ...ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: assignmentStatusLabel(s, t) })),
            ]}
            onChange={(next) => setStatus(next === '__any__' ? null : next)}
          />
        </BottomSheet>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  sheetActions: { flexDirection: 'row', gap: Spacing.two },
  sheetAction: { flex: 1 },
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
