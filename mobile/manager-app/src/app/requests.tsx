import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  ApiError,
  Badge,
  BottomSheet,
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

import { BackLink } from '@/components/BackLink';

const STATUSES = ['DRAFT', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'] as const;

/**
 * Work requests, including broadcasts.
 *
 * ONE list, not two. A broadcast is not a separate entity -- it is a work
 * request that has skill slots, and the backend discriminates with
 * `is_broadcast` on this same endpoint. There is no GET
 * /work-requests/broadcasts to call, so a second screen would have been a
 * second view of the same rows.
 *
 * The web has no navigation entry for this screen at all; it is reachable
 * only by typing the URL. The app gives it one.
 */
export default function Requests() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | 'broadcast' | 'standard'>('all');

  const { data, error, isLoading, mutate } = useSWR(['work-requests', status, kind], () =>
    api.workRequests.list({
      status: status ?? undefined,
      is_broadcast: kind === 'all' ? undefined : kind === 'broadcast',
    })
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  // Broadcast routes are FEATURE_JOBDISPATCH_PHASE2-gated and 404 when off.
  const unavailable = error instanceof ApiError && error.status === 404;
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
          <ScreenHeader title={t('nav.requests')} subtitle={t('requests.pageDescription')} />
          <View style={styles.bar}>
            <FilterBar
              activeCount={(status ? 1 : 0) + (kind === 'all' ? 0 : 1)}
              onPress={() => setFiltersOpen(true)}
            />
            <Button
              label={t('requests.new')}
              variant="ghost"
              onPress={() => router.push('/requests/new')}
            />
            <Button
              label={t('requests.newBroadcast')}
              variant="ghost"
              onPress={() => router.push('/requests/new-broadcast')}
            />
          </View>

          {isLoading ? (
            <SkeletonList rows={6} />
          ) : unavailable ? (
            <EmptyState title={t('status.unavailable')} />
          ) : error ? (
            <EmptyState title={t('requests.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('requests.noneFound')} />
          ) : (
            rows.map((row) => (
              <DataRow
                key={row.id}
                title={row.position}
                subtitle={row.hotel?.name ?? row.hotel_id}
                meta={`${row.workers_confirmed}/${row.workers_needed}`}
                trailing={<Badge label={row.status} tone={row.status === 'OPEN' ? 'primary' : 'neutral'} />}
                onPress={() => router.push(`/request/${row.id}`)}
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
              ...STATUSES.map((s) => ({ value: s, label: s })),
            ]}
            onChange={(next) => setStatus(next === '__any__' ? null : next)}
          />
          <SelectSheet
            label={t('fields.type')}
            value={kind}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'broadcast', label: t('nav.broadcasts') },
              { value: 'standard', label: t('nav.requests') },
            ]}
            onChange={(next) => setKind(next as 'all' | 'broadcast' | 'standard')}
          />
        </BottomSheet>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
