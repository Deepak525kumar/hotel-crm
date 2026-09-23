import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  Card,
  DataRow,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { useDirectory } from '@/hooks/useDirectory';
import { formatDateTime } from '@/lib/assignment-format';

/**
 * Hotel groups, as their own screen.
 *
 * SEPARATE FROM HOTELS since 2026-09-23. Both menu rows pointed at `/hotels`
 * before that, so "Hotel groups" and "Org chart" opened the hotels list — and
 * React warned about two children with the same key, because the duplicated
 * route was the key.
 *
 * Read-only for everyone. Creating, renaming, re-parenting and deleting a
 * group are MASTER DATA and Admin-only (`ADR-030` D-2, C-06/C-07), and an RM
 * explicitly may not modify the group they run (CRR §11:180). So this shows
 * what a group IS and who runs it, and offers no controls that would be
 * refused.
 */
export default function HotelGroups() {
  const { t } = useTranslation();
  const { workerName } = useDirectory();
  const [refreshing, setRefreshing] = useState(false);

  const groups = useSWR('crm/hotel-groups', () => api.crm.hotelGroups());
  const hotels = useSWR('crm/hotels', () => api.crm.hotels());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([groups.mutate(), hotels.mutate()]);
    } finally {
      setRefreshing(false);
    }
  }, [groups, hotels]);

  const rows = groups.data ?? [];

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
          <ScreenHeader title={t('nav.hotelGroups')} />

          {groups.isLoading ? (
            <SkeletonList rows={4} />
          ) : groups.error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('hotelGroups.noneYet')} body={t('hotelGroups.noneYetDescription')} />
          ) : (
            rows.map((group) => {
              const members = (hotels.data ?? []).filter((h) => h.hotel_group_id === group.id);
              return (
                <Card key={group.id}>
                  <View style={styles.head}>
                    <ThemedText type="h2" numberOfLines={1} style={styles.name}>
                      {group.name}
                    </ThemedText>
                    <Badge
                      label={group.is_active ? t('status.active') : t('status.inactive')}
                      tone={group.is_active ? 'success' : 'neutral'}
                    />
                  </View>

                  {/* A vacancy is not a missing group: regional_manager_user_id
                      is nullable by design (2026-08-06 vacancy model), so an
                      empty value reads as "no RM assigned", never as broken
                      data. */}
                  <ThemedText type="small" themeColor="textSecondary">
                    {group.regional_manager_user_id
                      ? workerName(group.regional_manager_user_id)
                      : t('status.unassigned')}
                  </ThemedText>

                  {/* WHY it is vacant, when the server knows. "Unassigned"
                      alone conflates a group that never had an RM with one
                      whose RM left last week -- and only the second is
                      something a regional manager needs to act on. */}
                  {!group.regional_manager_user_id && group.regional_manager_vacancy_reason ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {group.regional_manager_vacancy_reason}
                      {group.regional_manager_vacated_at
                        ? ` · ${formatDateTime(group.regional_manager_vacated_at)}`
                        : ''}
                    </ThemedText>
                  ) : null}

                  {members.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('hotelGroups.noHotelsAssigned')}
                    </ThemedText>
                  ) : (
                    members.map((hotel) => (
                      <DataRow
                        key={hotel.id}
                        title={hotel.name}
                        subtitle={hotel.city}
                        onPress={() => router.push(`/hotel/${hotel.id}`)}
                      />
                    ))
                  )}
                </Card>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { flex: 1, flexShrink: 1, minWidth: 0 },
});
