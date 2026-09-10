import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { POLL_INTERVAL_MS } from '@/constants/polling';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { isoDateInCalendarTimezone } from '@/lib/calendar-dates';
import { useAuthStore } from '@/stores/auth-store';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { RoomLog, RoomState, WorkerAssignment } from '@/types/api';

/**
 * The worker's room log (owner decision, 2026-09-01).
 *
 * The gap this closes: a worker had no way to record WHICH rooms they cleaned.
 * A manager typed a total afterwards, and the checker typed a room number from
 * memory during an inspection, so nothing connected the two. Now the worker
 * logs each room as they finish it, and the checker's room picker is built
 * from exactly these entries -- which is also what auto-fills the worker on an
 * inspection.
 *
 * Deliberately one screen, not a flow: the action is "I finished 412", done
 * dozens of times a shift, one-handed, often in a corridor.
 */

const STATE_TONE: Record<RoomState, 'success' | 'warning' | 'neutral' | 'primary'> = {
  AWAITING_CHECK: 'neutral',
  PASSED: 'success',
  NEEDS_REWORK: 'warning',
  REWORK_SUBMITTED: 'primary',
};

type Translate = ReturnType<typeof useTranslation>['t'];

function stateLabel(state: RoomState, t: Translate): string {
  switch (state) {
    case 'AWAITING_CHECK':
      return t('rooms.state.awaitingCheck', 'Awaiting check');
    case 'PASSED':
      return t('rooms.state.passed', 'Passed');
    case 'NEEDS_REWORK':
      return t('rooms.state.needsRework', 'Needs rework');
    case 'REWORK_SUBMITTED':
      return t('rooms.state.reworkSubmitted', 'Rework submitted');
  }
}

export default function RoomsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [roomNumber, setRoomNumber] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, isLoading, mutate } = useSWR(user ? '/rooms/mine' : null, () => api.rooms.mine(), { refreshInterval: POLL_INTERVAL_MS });

  // The shift to log against: today's, and only once the worker has checked in
  // (the server enforces the same rule -- this just avoids offering an input
  // that would be refused). A rework shift is excluded: rooms belong to the
  // original shift, and logging one here would put the same room in the
  // checker's picker twice.
  const { data: assignments } = useSWR(user ? '/assignments/for-rooms' : null, () =>
    api.assignments.list({ limit: 20 }),
    { refreshInterval: POLL_INTERVAL_MS }
  );
  const todayShift = useMemo<WorkerAssignment | undefined>(() => {
    const loggable = (assignments ?? []).filter(
      (a: WorkerAssignment) => !a.rework_of_assignment_id
    );
    // A shift that is IN_PROGRESS is the one being worked right now, whatever
    // any date arithmetic says -- so it wins outright, and is matched before
    // the day is considered at all.
    //
    // Reported live as "shift ended more than two hours ago" while standing
    // in an in-progress shift. `today` was read as new Date().toISOString(),
    // which is the UTC date, while the server dates shifts in Europe/Berlin
    // (rooms/service.ts toDayDate). From 22:00 UTC onwards the two disagree,
    // so the app skipped the in-progress shift dated tomorrow-in-Berlin and
    // picked YESTERDAY's completed one instead -- which the server then
    // refused, correctly, for being long over.
    const inProgress = loggable.find((a: WorkerAssignment) => a.status === 'IN_PROGRESS');
    if (inProgress) return inProgress;

    // Otherwise the day's finished shift, still inside its post-shift grace.
    const today = isoDateInCalendarTimezone(0);
    return loggable.find(
      (a: WorkerAssignment) => a.day === today && a.status === 'COMPLETED'
    );
  }, [assignments]);

  // The shift that WOULD unlock logging if the worker checked in: today's,
  // not yet started. Deliberately separate from todayShift (which requires
  // IN_PROGRESS/COMPLETED, matching what the server will accept) so the
  // empty state can point at something concrete instead of only explaining.
  const pendingShift = useMemo<WorkerAssignment | undefined>(() => {
    // Europe/Berlin, matching the server -- see todayShift's note.
    const today = isoDateInCalendarTimezone(0);
    return (assignments ?? []).find(
      (a: WorkerAssignment) =>
        a.day === today && !a.rework_of_assignment_id && a.status === 'CONFIRMED'
    );
  }, [assignments]);

  // Read once, here, rather than asserted non-null inside the fetcher. The
  // fetcher used `todayShift!.hotel!.id`, and `hotel` is genuinely nullable
  // on the DTO: this screen polls every 5s, so a revalidation could run the
  // fetcher from a render where todayShift had a hotel against a todayShift
  // that no longer does, and `hotel!.id` is then a hard
  // "Cannot read property 'id' of null" rather than a skipped fetch.
  const suggestionHotelId = todayShift?.hotel?.id ?? null;
  const { data: suggestionData } = useSWR(
    suggestionHotelId ? `/rooms/suggestions/${suggestionHotelId}` : null,
    () => api.rooms.suggestions(suggestionHotelId as string)
  );

  // Only suggestions that match what has been typed and are not already logged
  // today -- offering a room the worker cannot claim is a dead end.
  const suggestions = useMemo(() => {
    const typed = roomNumber.trim().toUpperCase();
    if (!typed) return [];
    const alreadyLogged = new Set((data?.rooms ?? []).map((r) => r.room_number.toUpperCase()));
    return (suggestionData?.rooms ?? [])
      .filter((r) => r.toUpperCase().startsWith(typed) && !alreadyLogged.has(r.toUpperCase()))
      .slice(0, 6);
  }, [roomNumber, suggestionData, data]);

  const submit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !todayShift) return;
    setSaving(true);
    try {
      await api.rooms.log(todayShift.id, trimmed);
      setRoomNumber('');
      await mutate();
    } catch (error) {
      // The conflict case names who already logged the room, which is the
      // whole point of surfacing the server's message rather than a generic
      // failure: the usual cause is two people cleaning one corridor.
      Alert.alert(
        t('rooms.couldNotLog', 'Could not log this room'),
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = (room: RoomLog) => {
    Alert.alert(
      t('rooms.removeTitle', 'Remove room?'),
      t('rooms.removeBody', { defaultValue: 'Remove {{room}} from your log?', room: room.room_number }),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('rooms.remove', 'Remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.rooms.remove(room.id);
              await mutate();
            } catch (error) {
              Alert.alert(
                t('rooms.couldNotRemove', 'Could not remove this room'),
                error instanceof Error ? error.message : String(error)
              );
            }
          },
        },
      ]
    );
  };

  const renderRoom = (room: RoomLog, { showHotel = false } = {}) => {
    const needsRework = room.state === 'NEEDS_REWORK' && room.rework_assignment_id;
    return (
      <Pressable
        key={room.id}
        // Tapping a room that needs rework takes the worker straight to the
        // rework shift, where they upload the fix (owner request). Any other
        // room has nothing behind it, so it is not made to look tappable.
        onPress={
          needsRework
            ? () => router.push(`/rework/${room.rework_assignment_id}` as never)
            : undefined
        }
        style={({ pressed }) => [{ opacity: needsRework && pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.roomRow, { borderBottomColor: theme.border }]}>
          <View style={styles.roomMain}>
            {/* The room number is what the worker scans this list for, so it
                carries the row rather than sitting at the same weight as the
                hotel line beside it. */}
            <ThemedText type="subtitle">{room.room_number}</ThemedText>
            {showHotel && room.hotel_name ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {room.hotel_name} · {room.day}
              </ThemedText>
            ) : null}
          </View>
          <View style={styles.roomRight}>
            <Badge label={stateLabel(room.state, t)} tone={STATE_TONE[room.state]} />
            {needsRework ? (
              <ThemedText type="small" style={{ color: theme.primary }}>
                {t('rooms.goToRework', 'Go to rework')} ›
              </ThemedText>
            ) : room.editable ? (
              <Pressable onPress={() => confirmRemove(room)} hitSlop={10}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('rooms.remove', 'Remove')}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* PINNED. The tab exists to log rooms one after another, and the
            input used to live inside ListHeaderComponent -- so it scrolled
            away behind the day's own list exactly as that list got long
            enough to matter, and the worker had to scroll back up for every
            room. Header and input sit outside the FlatList now; only the
            record below them scrolls. */}
        <View style={styles.pinned}>
          <View style={styles.headerRow}>
            <ThemedText type="title">{t('rooms.title', 'My rooms')}</ThemedText>
            <NotificationBell />
          </View>

          {todayShift ? (
                <>
                  <SectionHeader
                    title={t('rooms.addTitle', 'Log a finished room')}
                    subtitle={todayShift.hotel?.name ?? undefined}
                  />
                  <Card>
                    <View style={styles.inputRow}>
                      <TextInput
                        value={roomNumber}
                        onChangeText={setRoomNumber}
                        placeholder={t('rooms.placeholder', 'Room number')}
                        placeholderTextColor={theme.textSecondary}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={() => void submit(roomNumber)}
                        editable={!saving}
                        style={[
                          styles.input,
                          { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
                        ]}
                      />
                      <Button
                        label={t('rooms.add', 'Add')}
                        onPress={() => void submit(roomNumber)}
                        loading={saving}
                        disabled={saving || roomNumber.trim().length === 0}
                      />
                    </View>
                    {/* Typeahead over rooms already used at this hotel. This is
                        what keeps room matching conservative server-side
                        without workers inventing three spellings of one room. */}
                    {suggestions.length > 0 ? (
                      <View style={styles.suggestionsContainer}>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.suggestionsTitle}>
                          {t('rooms.suggestions', 'Suggestions:')}
                        </ThemedText>
                        <View style={styles.suggestionsGrid}>
                          {suggestions.map((s) => (
                            <Pressable
                              key={s}
                              onPress={() => void submit(s)}
                              style={({ pressed }) => [
                                styles.chip,
                                {
                                  borderColor: theme.border,
                                  backgroundColor: pressed ? theme.primarySubtle : theme.background,
                                },
                              ]}
                            >
                              <ThemedText type="smallBold">{s}</ThemedText>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </Card>
                </>
              ) : (
                // Reported as "no option to log a room". There IS a rule
                // behind it -- the server refuses a log against a shift that
                // is not IN_PROGRESS/COMPLETED (rooms/service.ts), so the
                // input is withheld rather than offered and then rejected --
                // but a bare sentence reads as the screen being broken. It
                // now says which shift is waiting and takes the worker
                // straight to the check-in that unlocks logging.
                <Card style={styles.checkInCard}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t(
                      'rooms.checkInFirst',
                      'Check in to today’s shift to start logging the rooms you finish.'
                    )}
                  </ThemedText>
                  {pendingShift ? (
                    <Button
                      label={t('rooms.goToCheckIn', 'Go to check-in')}
                      onPress={() => router.push(`/shift/${pendingShift.id}` as never)}
                    />
                  ) : null}
                </Card>
              )}
        </View>

        <FlatList
          contentContainerStyle={styles.content}
          data={data?.rooms ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderRoom(item)}
          refreshing={isLoading}
          onRefresh={() => void mutate()}
          ListHeaderComponent={
            <>
              {/* Rooms sent back, from any day, and outside the day filter on
                  purpose: a rework raised yesterday is dated today by the
                  server and carries a 20-minute clock. It leads the scrolling
                  section so it is the first thing under the input, with a
                  warning edge so it does not read as a third neutral list. */}
              {(data?.needs_rework ?? []).length > 0 ? (
                <>
                  <SectionHeader title={t('rooms.needsYourAttention', 'Needs your attention')} />
                  <Card
                    style={{
                      ...styles.listCard,
                      ...styles.attentionCard,
                      borderLeftColor: theme.warning,
                    }}
                  >
                    {(data?.needs_rework ?? []).map((room) => renderRoom(room, { showHotel: true }))}
                  </Card>
                </>
              ) : null}

              {/* Was the bare count ("3") as a subtitle, which read as an
                  unlabelled number next to the heading. */}
              <SectionHeader
                title={t('rooms.todayTitle', 'Logged today')}
                // `n`, not i18next's reserved `count`: passing `count` selects
                // a plural form, and Arabic and Ukrainian need more forms than
                // English does -- so a single string would silently fall back
                // for them. This is one string with one placeholder in every
                // locale instead.
                subtitle={t('rooms.loggedCount', {
                  n: (data?.rooms ?? []).length,
                  defaultValue: '{{n}} rooms',
                })}
              />
            </>
          }
          ListEmptyComponent={
            isLoading ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <Card>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('rooms.emptyToday', 'No rooms logged yet today.')}
                </ThemedText>
              </Card>
            )
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    // No top padding: the pinned block above already ends with its own
    // bottom padding, and keeping both put a visible gap between the input
    // and the first thing it produces.
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  listCard: { gap: 0, paddingVertical: 0 },
  checkInCard: { gap: Spacing.three, alignItems: 'flex-start' },
  attentionCard: { borderLeftWidth: 3 },
  // Matches `content`'s horizontal padding so the pinned block and the list
  // below it share one left edge.
  pinned: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    flex: 1,
    borderWidth: 2,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 20,
    fontWeight: '600',
  },
  suggestionsContainer: { marginTop: Spacing.three },
  suggestionsTitle: { marginBottom: Spacing.one },
  suggestionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 1, // subtle shadow on android
    shadowColor: '#000', // subtle shadow on ios
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  roomMain: { flex: 1, gap: Spacing.half },
  roomRight: { alignItems: 'flex-end', gap: Spacing.half },
});
