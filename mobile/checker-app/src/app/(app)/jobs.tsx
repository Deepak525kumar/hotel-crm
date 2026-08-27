import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Card, EmptyState, ScreenHeader, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import type { Broadcast, WorkRequest } from '@/types/api';

/**
 * Jobs — open shifts a checker can browse and accept.
 *
 * Mirrors worker-app's marketplace screen, with one difference that is the
 * whole point of it: every row here is CHECKER-targeted. That is enforced
 * server-side, not here — `GET /work-requests` narrows a self-scoped caller
 * to their own `target_role` and ignores any the client sends
 * (job-requests/service.ts list()), and `acceptBroadcast()` refuses a
 * request targeted at the other role outright. This screen adds no filter of
 * its own precisely so there is one place that decides, not two that can
 * disagree.
 *
 * No skill picker anywhere in this flow: the four SkillTag values are
 * worker-domain, so a checker-targeted broadcast always carries the single
 * `skill: null` ("no specific skill required") slot the web form now
 * produces for CHECKER.
 */
function JobCard({ item, onPress }: { item: WorkRequest; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
      <Card>
        <View style={styles.row}>
          <ThemedText type="smallBold" style={styles.flex} numberOfLines={1}>
            {item.position}
          </ThemedText>
          <Badge label={`${item.workers_confirmed}/${item.workers_needed}`} tone="neutral" />
        </View>
        {item.hotel?.name ? (
          <ThemedText type="small" themeColor="textSecondary">
            {item.hotel.name}
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          {new Date(item.shift_date).toLocaleDateString()} · {item.shift_start_time} – {item.shift_end_time}
        </ThemedText>
        {item.hourly_rate ? <ThemedText type="small">{item.hourly_rate}/hr</ThemedText> : null}
      </Card>
    </Pressable>
  );
}

function OfferCard({ item, onPress }: { item: Broadcast; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
      <Card>
        <View style={styles.row}>
          <ThemedText type="smallBold" style={styles.flex} numberOfLines={1}>
            {item.hotel?.name ?? t('common.shift')}
          </ThemedText>
          <Badge label={t('jobs.offerBadge')} tone="primary" />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {new Date(item.shift_date).toLocaleDateString()} · {item.shift_start_time} – {item.shift_end_time}
        </ThemedText>
        {item.hourly_rate ? <ThemedText type="small">{item.hourly_rate}/hr</ThemedText> : null}
        {(item.skill_slots ?? []).map((slot) => (
          <ThemedText key={slot.id} type="small" themeColor="textSecondary">
            {t('jobs.slotsFilled', {
              confirmed: slot.confirmed_count,
              headcount: slot.headcount,
              defaultValue: `${slot.confirmed_count}/${slot.headcount} filled`,
            })}
          </ThemedText>
        ))}
      </Card>
    </Pressable>
  );
}

export default function JobsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<WorkRequest[]>([]);
  const [offers, setOffers] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [jobsRes, offersRes] = await Promise.all([
        api.workRequests.list({ status: 'OPEN', limit: 50 }),
        // Broadcasts are gated by FEATURE_JOBDISPATCH_PHASE2 server-side
        // (404 while disabled) — treated as "no offers", the same
        // graceful degradation worker-app's marketplace uses.
        api.workRequests.list({ status: 'OPEN', is_broadcast: true, limit: 50 }).catch(() => []),
      ]);
      setItems(Array.isArray(jobsRes) ? jobsRes : []);
      setOffers(Array.isArray(offersRes) ? (offersRes as Broadcast[]) : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openOffers = offers.filter((o) => o.status === 'OPEN');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title={t('nav.jobs')} action={<NotificationBell />} />

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
            ListHeaderComponent={
              openOffers.length > 0 ? (
                <>
                  <SectionHeader title={t('jobs.offersForYou')} />
                  {openOffers.map((offer) => (
                    <OfferCard key={offer.id} item={offer} onPress={() => router.push(`/offer/${offer.id}`)} />
                  ))}
                  <SectionHeader title={t('jobs.open')} />
                </>
              ) : null
            }
            ListEmptyComponent={
              openOffers.length === 0 ? <EmptyState title={t('jobs.none')} /> : null
            }
            renderItem={({ item }) => (
              <JobCard item={item} onPress={() => router.push(`/job/${item.id}`)} />
            )}
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  flex: { flex: 1 },
});
