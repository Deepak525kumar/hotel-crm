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

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { api } from '@/lib/api';
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

  const { data, isLoading, mutate } = useSWR(user ? '/rooms/mine' : null, () => api.rooms.mine(), { refreshInterval: 5000 });

  // The shift to log against: today's, and only once the worker has checked in
  // (the server enforces the same rule -- this just avoids offering an input
  // that would be refused). A rework shift is excluded: rooms belong to the
  // original shift, and logging one here would put the same room in the
  // checker's picker twice.
  const { data: assignments } = useSWR(user ? '/assignments/for-rooms' : null, () =>
    api.assignments.list({ limit: 20 }),
    { refreshInterval: 5000 }
  );
  const todayShift = useMemo<WorkerAssignment | undefined>(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (assignments ?? []).find(
      (a: WorkerAssignment) =>
        a.day === today &&
        !a.rework_of_assignment_id &&
        (a.status === 'IN_PROGRESS' || a.status === 'COMPLETED')
    );
  }, [assignments]);

  const { data: suggestionData } = useSWR(
    todayShift?.hotel?.id ? `/rooms/suggestions/${todayShift.hotel.id}` : null,
    () => api.rooms.suggestions(todayShift!.hotel!.id)
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
            <ThemedText type="smallBold">{room.room_number}</ThemedText>
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
        <FlatList
          contentContainerStyle={styles.content}
          data={data?.rooms ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderRoom(item)}
          refreshing={isLoading}
          onRefresh={() => void mutate()}
          ListHeaderComponent={
            <>
              <View style={styles.headerRow}>
                <ThemedText type="title">{t('rooms.title', 'My rooms')}</ThemedText>
                <NotificationBell />
              </View>

              {/* Rooms sent back, from any day. Kept above today's list and
                  outside the day filter on purpose: a rework raised yesterday
                  is dated today by the server and has a 20-minute clock on
                  it, so it must never be a scroll away. */}
              {(data?.needs_rework ?? []).length > 0 ? (
                <>
                  <SectionHeader title={t('rooms.needsYourAttention', 'Needs your attention')} />
                  <Card style={styles.listCard}>
                    {(data?.needs_rework ?? []).map((room) => renderRoom(room, { showHotel: true }))}
                  </Card>
                </>
              ) : null}

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
                <Card>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t(
                      'rooms.checkInFirst',
                      'Check in to today’s shift to start logging the rooms you finish.'
                    )}
                  </ThemedText>
                </Card>
              )}

              <SectionHeader
                title={t('rooms.todayTitle', 'Logged today')}
                subtitle={String((data?.rooms ?? []).length)}
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
    paddingTop: Spacing.three,
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
