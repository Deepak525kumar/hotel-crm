import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Card, EmptyState, ScreenHeader } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import { calendarDateOf } from '@/lib/calendar-dates';
import { useTheme } from '@/hooks/use-theme';

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

function CheckCard({ item }: { item: OwnInspection }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const workerName = item.worker
    ? `${item.worker.first_name} ${item.worker.last_name}`.trim()
    : t('quality.workerUnavailable');

  const styles = StyleSheet.create({
    card: { gap: Spacing.two },
    head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
    flex: { flex: 1 },
    room: {
      alignSelf: 'flex-start',
      borderRadius: Radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: theme.backgroundSelected,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.two,
      paddingTop: Spacing.two,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    rowText: { flex: 1, gap: 2 },
    pill: {
      alignSelf: 'flex-start',
      borderRadius: Radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: theme.warningSubtle,
    },
    pillText: { color: theme.warning, fontSize: 12, fontWeight: '600' },
  });

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/verification/${item.id}`)}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <View style={styles.flex}>
            {/* Room first: with many checks on one shift it is the only thing
                that tells two rows apart at a glance. */}
            <View style={styles.head}>
              <View style={styles.room}>
                <ThemedText type="smallBold">
                  {t('quality.roomLabel')} {item.room_number}
                </ThemedText>
              </View>
              <Badge
                label={t(STATUS_LABEL_KEY[item.status])}
                tone={STATUS_TONE[item.status]}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {workerName}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {[item.day ? calendarDateOf(item.day) : null, item.hotel?.name]
                .filter(Boolean)
                .join('  ·  ')}
            </ThemedText>
          </View>
          <ThemedText type="title">{item.score}</ThemedText>
        </View>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.photoCount', { count: item.photo_count })}
            </ThemedText>
            {item.rework_required ? (
              <View style={styles.pill}>
                <ThemedText type="small" style={styles.pillText}>
                  {item.rework_completed_at
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
        </View>
      </Card>
    </Pressable>
  );
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  // Debounced so a five-column LIKE does not run on every keystroke. 300ms is
  // the usual "finished a word" pause; shorter makes the list flicker while
  // typing a room number, longer feels unresponsive.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isLoading, isValidating, mutate, error } = useSWR(
    ['/quality/my-inspections', debounced],
    () => api.quality.myInspections(1, 20, debounced)
  );

  const items = data?.checks ?? [];

  const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
    loader: { marginTop: Spacing.five },
    list: { gap: Spacing.two, paddingBottom: Spacing.six },
    search: {
      backgroundColor: theme.backgroundElement,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      color: theme.text,
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.two,
      fontSize: 15,
      marginBottom: Spacing.two,
    },
  });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader
          title={t('nav.history')}
          subtitle={t('quality.historySubtitle')}
          action={<NotificationBell />}
        />

        {/* One box across room, notes, worker and hotel. Searching server-side
            rather than filtering the loaded page: the list is paginated, so a
            client-side filter would only ever search the twenty rows already
            on screen and quietly miss the rest. */}
        <TextInput
          style={styles.search}
          placeholder={t('quality.searchPlaceholder')}
          placeholderTextColor={theme.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel={t('quality.searchPlaceholder')}
        />

        {isLoading && !items.length ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <CheckCard item={item} />}
            ListEmptyComponent={
              error ? (
                <EmptyState
                  title={t('errors.title')}
                  body={translateApiError(error, t, 'errors.generic')}
                />
              ) : debounced ? (
                // A search that found nothing is NOT "you have no history" --
                // that reads as data loss to someone who knows they checked a
                // room this morning.
                <EmptyState
                  title={t('quality.searchNoResults')}
                  body={t('quality.searchNoResultsBody')}
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
