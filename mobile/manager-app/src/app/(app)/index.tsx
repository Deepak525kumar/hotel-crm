import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import useSWR from 'swr';

import {
  BottomTabInset,
  Card,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SkeletonList,
  Spacing,
  StatTile,
  ThemedText,
  ThemedView,
  api,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

/**
 * Today.
 *
 * The scope pickers this screen will grow are driven by the user's resolved
 * scope claims, never by their role: `scope_hotel_id` is set only for a hotel
 * manager, while an admin and a regional manager both have it null and must
 * choose. Reading `role === 'admin'` instead is the mistake the web app
 * documents (frontend/CLAUDE.md) -- it puts an RM and an admin in the same
 * branch when their scope is not the same shape at all.
 *
 * Pull-to-refresh is deliberately decoupled from SWR's `isValidating`: tying
 * the spinner to revalidation leaves it turning on every focus and poll, so
 * it stops meaning "your pull is being handled".
 */
export default function Today() {
  const user = useAuthStore((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);

  const { data, error, isLoading, mutate } = useSWR('analytics/stats', () => api.analytics.stats());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        >
          <ScreenHeader
            title="Today"
            subtitle={user ? `Signed in as ${user.first_name ?? user.email}` : undefined}
          />

          {isLoading ? (
            <SkeletonList rows={4} />
          ) : error ? (
            // A readable failure, never a blank screen or a spinner that never
            // ends: hotel wifi drops constantly and "nothing rendered" is
            // indistinguishable from "there is nothing to show".
            <EmptyState
              title="Couldn’t load today"
              body="Check your connection and pull down to try again."
            />
          ) : (
            <Card>
              <View style={styles.tiles}>
                {/* The fields DashboardStats actually declares. Inventing
                    richer ones here would typecheck against nothing and
                    render blank against the real response. */}
                <StatTile label="Upcoming" value={String(data?.upcoming_shifts ?? 0)} />
                <StatTile label="Completed" value={String(data?.completed_shifts ?? 0)} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                More of the dashboard lands with PR-3.
              </ThemedText>
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
    paddingBottom: BottomTabInset,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  tiles: { flexDirection: 'row', gap: Spacing.three },
});
