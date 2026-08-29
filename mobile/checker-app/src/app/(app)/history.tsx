import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Card, EmptyState, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import { calendarDateOf } from '@/lib/calendar-dates';
import { inspectionHistoryRows } from '@/lib/inspection-history-rows';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import type { OwnInspection, VerificationStatus } from '@/types/api';

/**
 * History — the shifts this checker has scored.
 *
 * The app had no route back to a past inspection. Both evidence screens are
 * keyed by a record id, and nothing handed one out after the fact: the only
 * ways to reach `/verification/[id]` were the redirect fired immediately after
 * submitting a verification, and tapping a REWORK_COMPLETED push. So a checker
 * who dismissed the confirmation could not see their own scores or the photos
 * they had uploaded, and "Assign rework" — the one action CRR §14 names a
 * checker for — had no entry point at all once that moment passed.
 *
 * Rows are per SHIFT rather than per record, matching the endpoint: the
 * checklist rating and the pass/fail verification are two separate actions on
 * the same assignment, and a checker thinks of them as one visit to one room.
 *
 * Each record is its own tappable row rather than the whole card being one
 * target, because they lead to different places — and because the ABSENCE of
 * the verification row is itself the affordance that offers to record one.
 * That path is what makes rework reachable in practice: the checker's own
 * inspection flow (Home -> Start checking -> select worker) produces a Rating,
 * while rework can only be assigned against a QualityVerification. Without a
 * way to record the second one, rework stays unreachable no matter how many
 * inspections have been logged.
 */

const STATUS_TONE: Record<VerificationStatus, 'success' | 'warning' | 'danger'> = {
  PASSED: 'success',
  NEEDS_REWORK: 'warning',
  FAILED: 'danger',
};

// Keys rather than nouns, and the uppercase presentation lives in each
// translation rather than in a .toUpperCase() call here: casing rules are not
// universal, and Arabic and Urdu have no case at all. Same map as the quality
// and verification screens use.
const STATUS_LABEL_KEY: Record<VerificationStatus, string> = {
  PASSED: 'quality.outcomePASSED',
  NEEDS_REWORK: 'quality.outcomeNEEDS_REWORK',
  FAILED: 'quality.outcomeFAILED',
};

function InspectionCard({ item }: { item: OwnInspection }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const workerName = item.worker
    ? `${item.worker.first_name} ${item.worker.last_name}`.trim()
    : t('quality.workerUnavailable');

  // Which rows to draw is decided by a pure function so it is actually
  // tested -- see lib/inspection-history-rows.ts. This screen renders that
  // answer rather than re-deriving it from the same nullable fields, so the
  // test governs what ships instead of describing a parallel copy of it.
  const rows = inspectionHistoryRows(item);

  const styles = StyleSheet.create({
    card: { gap: Spacing.two },
    head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
    flex: { flex: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.two,
      paddingVertical: Spacing.two,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    rowText: { flex: 1, gap: 2 },
    pill: {
      alignSelf: 'flex-start',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: theme.warningSubtle,
    },
    pillText: { color: theme.warning, fontSize: 12, fontWeight: '600' },
  });

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {workerName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {[calendarDateOf(item.day), item.hotel?.name].filter(Boolean).join('  ·  ')}
          </ThemedText>
        </View>
      </View>

      {/* The check. One record per inspection since the Rating merge
          (2026-08-29), so this is the whole card -- and the road to the
          evidence screen, which is where rework is assigned. The old
          "record a pass/fail check" branch existed only for shifts that had a
          rating and no verification, which can no longer happen. */}
      {rows.includes('verification') && item.verification ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/verification/${item.verification!.id}`)}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={styles.rowText}>
            <View style={styles.head}>
              <ThemedText type="smallBold">
                {t('quality.verificationLabel')} · {item.verification.score}
              </ThemedText>
              <Badge
                label={t(STATUS_LABEL_KEY[item.verification.status])}
                tone={STATUS_TONE[item.verification.status]}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.photoCount', { count: item.verification.photo_count })}
            </ThemedText>
            {item.verification.rework_required ? (
              <View style={styles.pill}>
                <ThemedText type="small" style={styles.pillText}>
                  {item.verification.rework_completed_at
                    ? t('quality.reworkCompleted')
                    : t('quality.reworkPending')}
                </ThemedText>
              </View>
            ) : null}
          </View>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            tintColor={theme.textSecondary}
            size={18}
          />
        </Pressable>
      ) : null}
    </Card>
  );
}

export default function HistoryScreen() {
  const { t } = useTranslation();

  const { data, isLoading, isValidating, mutate, error } = useSWR('/quality/my-inspections', () =>
    api.quality.myInspections()
  );

  const items = data?.inspections ?? [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader
          title={t('nav.history')}
          subtitle={t('quality.historySubtitle')}
          action={<NotificationBell />}
        />

        {isLoading && !items.length ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.assignment_id}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews
            renderItem={({ item }) => <InspectionCard item={item} />}
            ListEmptyComponent={
              // A load failure is NOT reported as "no inspections yet": that
              // reads as data loss to someone who knows they scored a room
              // this morning, and sends them to record it again.
              error ? (
                <EmptyState
                  title={t('errors.title')}
                  body={translateApiError(error, t, 'errors.generic')}
                />
              ) : (
                <EmptyState
                  title={t('quality.historyEmpty')}
                  body={t('quality.historyEmptyBody')}
                />
              )
            }
            refreshControl={
              <RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />
            }
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
  safeArea: { flex: 1, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  loader: { marginTop: Spacing.five },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
});
