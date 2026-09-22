import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  Card,
  EmptyState,
  MaxContentWidth,
  RatingTierBadge,
  ScreenHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  scopeOf,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { HotelPicker } from '@/components/HotelPicker';
import { hotelFilterFor } from '@/lib/hotel-filter';
import { ScopeNote } from '@/components/ScopeNote';
import { score } from '@/lib/format-metrics';

/**
 * The full ranking, scoped server-side.
 *
 * `/analytics/leaderboard`, behind `analytics:read` -- NOT `/quality/
 * leaderboard`, which is a different response shape behind a different token.
 * A manager holds analytics:read and never quality:write.
 *
 * No hotel filter yet: narrowing to one hotel inside a group needs a hotels
 * list this client does not have. The server already scopes the unfiltered
 * call to the caller's own hotel or group, so the ranking is correct for
 * everyone -- just not narrowable by an RM or admin until the hotels screens
 * land.
 */
export default function Leaderboard() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const scope = scopeOf(user);
  const [refreshing, setRefreshing] = useState(false);
  const [hotelId, setHotelId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR(['analytics/leaderboard', hotelId], () =>
    api.analytics.leaderboard(hotelFilterFor(hotelId))
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
          <ScreenHeader
            title={t('nav.leaderboard')}
            subtitle={t('leaderboard.topPerformers')}
          />
          <ScopeNote scope={scope} />
          <HotelPicker scope={scope} value={hotelId} onChange={setHotelId} />

          {isLoading ? (
            <SkeletonList rows={8} />
          ) : error ? (
            <EmptyState title={t('analytics.leaderboardLoadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={t('analytics.noRankedWorkers')}
              body={t('analytics.noRankedWorkersDescription')}
            />
          ) : (
            <Card>
              {rows.map((row) => (
                <View key={row.worker_id} style={styles.row}>
                  <ThemedText type="smallBold" style={styles.position}>
                    {row.position}
                  </ThemedText>
                  <View style={styles.body}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {row.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {t('analytics.completedShifts')}: {row.completed_tasks}/{row.total_tasks} ·{' '}
                      {t('analytics.avgRating')}: {score(row.average_rating)}
                    </ThemedText>
                  </View>
                  {/* Shared with the other two apps so a tier never renders a
                      different colour here than it does to the worker. */}
                  {row.rating_tier ? <RatingTierBadge tier={row.rating_tier} /> : null}
                </View>
              ))}
            </Card>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  position: { width: 24 },
  body: { flex: 1, flexShrink: 1, minWidth: 0, gap: 2 },
});
