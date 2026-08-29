import { useState } from 'react';
import { matchesShift, SEARCH_THRESHOLD } from '@/lib/check-search';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { NotificationBell } from '@/components/NotificationBell';
import { assignmentStatusTone } from '@/lib/assignment-status-tone';
import { useTheme } from '@/hooks/use-theme';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Badge, Card, EmptyState, ScreenHeader, SectionHeader } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { WorkerAssignment } from '@/types/api';

/**
 * Schedule — the merge of the old "My Shifts" and "Calendar" tabs.
 *
 * Those were two tabs, side by side, behind near-identical calendar icons,
 * showing the same assignments in two shapes. This is the list; the month grid
 * is one tap away at the top rather than a second tab competing for the same
 * space.
 *
 * Status colour now comes from theme tokens. It used to be a module-scope map
 * of six raw hexes (`#3182CE`, `#38A169`, ...) applied as badge fills with
 * white text, which ignored the colour scheme entirely.
 */

function ShiftCard({ item, onPress }: { item: WorkerAssignment; onPress: () => void }) {
  const { t } = useTranslation();
  const isRework = Boolean(item.rework_of_assignment_id);
  // Reads the assignment's own fields. Gating this on work_request meant every
  // calendar-placed shift (i.e. all of them in production) showed no date at
  // all — just a title and a status badge.
  const day = item.day ?? item.work_request?.shift_date;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
    >
      <Card>
        <View style={styles.cardRow}>
          <ThemedText type="smallBold" style={styles.flex} numberOfLines={1}>
            {isRework ? t('quality.reworkTitle') : (item.work_request?.position ?? t('common.shift'))}
          </ThemedText>
          <Badge
            label={item.status.replace(/_/g, ' ')}
            tone={assignmentStatusTone(item.status) ?? 'neutral'}
          />
        </View>

        {item.hotel?.name ? (
          <ThemedText type="small" themeColor="textSecondary">
            {item.hotel.name}
          </ThemedText>
        ) : null}

        {day ? (
          <ThemedText type="small" themeColor="textSecondary">
            {new Date(day as string).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
            {item.shift_start_time && item.shift_end_time
              ? `  ·  ${item.shift_start_time} – ${item.shift_end_time}`
              : ''}
          </ThemedText>
        ) : null}

        {item.attendance?.check_in_at ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('attendance.checkedInAt', {
              time: new Date(item.attendance.check_in_at).toLocaleTimeString(),
              defaultValue: `Checked in: ${new Date(item.attendance.check_in_at).toLocaleTimeString()}`,
            })}
          </ThemedText>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function ScheduleScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();

  const [query, setQuery] = useState('');

  const {
    data: assignments,
    isLoading: loading,
    isValidating: refreshing,
    mutate,
  } = useSWR(user ? `/assignments/list_all/${user.id}` : null, () =>
    api.assignments.list({ limit: 50 }),
  );

  const items = Array.isArray(assignments) ? assignments : [];

  // Owner decision (2026-08-30): search wherever there are multiple entries.
  // Filtered on the device -- this is one already-loaded page, so a server
  // round-trip per keystroke would only add latency.
  // The label passed in is exactly what the card renders -- `status` with
  // underscores as spaces -- so typing what is on screen finds it. There is no
  // shifts.status* translation key; the badge is not translated either, and
  // inventing a key here would have searched a string no user ever sees.
  const visible = items.filter((i) => matchesShift(i, query, i.status.replace(/_/g, ' ')));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ScreenHeader
            title={t('nav.schedule')}
            action={
              <View style={styles.headerActions}>
                {/* Was a "Calendar ›" text link buried in a section header. */}
                <Pressable
                  onPress={() => router.push('/(app)/calendar')}
                  accessibilityRole="button"
                  accessibilityLabel={t('nav.calendar')}
                  hitSlop={8}
                >
                  <SymbolView
                    name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
                    tintColor={theme.text}
                    size={24}
                  />
                </Pressable>
                <NotificationBell />
              </View>
            }
          />
        </View>

        <SectionHeader
          title={t('shifts.upcomingTitle')}
        />

        {/* Shown only once the list is long enough to be worth filtering. */}
        {items.length > SEARCH_THRESHOLD ? (
          <TextInput
            style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            placeholder={t('shifts.searchPlaceholder')}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        ) : null}

        {loading && !items.length ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(i) => i.id}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews
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
              /* "No matches" and "no shifts" are different facts: one means
                 the search is too narrow, the other that there is nothing to
                 find. Showing "you have no shifts" to someone mid-search
                 reads as though their schedule was cleared. */
              query.trim() !== '' ? (
                <EmptyState title={t('shifts.searchNoMatch')} body={t('shifts.searchNoMatchBody')} />
              ) : (
                <EmptyState title={t('shifts.none')} body={t('home.noUpcomingShiftsBody')} />
              )
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void mutate()} />
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
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  header: { marginBottom: Spacing.three },
  loader: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
});
