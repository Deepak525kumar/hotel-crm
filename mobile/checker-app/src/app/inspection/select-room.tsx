import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BackLink } from '@/components/BackLink';
import { Badge, Button, Card, EmptyState, ScreenHeader, SectionHeader } from '@/components/ui';
import { roomStateTone } from '@/lib/room-state-tone';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { RoomLog, RoomState } from '@/types/api';

/**
 * Step one of Start checking: pick the ROOM (owner-approved, 2026-09-01).
 *
 * This replaced a worker-first picker followed by a free-text room number. The
 * room number was typed from memory, tied to nothing, and never matched the
 * worker's own record of the shift -- so a typo produced an inspection of a
 * room nobody had cleaned, and the worker's log stayed unlinked forever. Here
 * the room is the choice and the worker comes with it, from the record the
 * worker created themselves.
 *
 * The list is whatever `GET /rooms/for-check` returns. Hotel scope is resolved
 * server-side from this checker's own roster (empty on a day off); the client
 * sends no hotel and filters nothing, because a client-side filter over a wider
 * list would be a disclosure rather than a gate.
 *
 * Empty groups are omitted rather than shown as bare headers: on a normal shift
 * two of the three are empty, and three labels over nothing reads as a broken
 * screen. The all-empty case gets its own message.
 */

type Translate = ReturnType<typeof useTranslation>['t'];

/** Literal `t()` calls, so `translation-keys-exist.test.ts` can see these keys. */
function stateLabel(state: RoomState, t: Translate): string {
  switch (state) {
    case 'AWAITING_CHECK':
      return t('rooms.state.awaitingCheck');
    case 'PASSED':
      return t('rooms.state.passed');
    case 'NEEDS_REWORK':
      return t('rooms.state.needsRework');
    case 'REWORK_SUBMITTED':
      return t('rooms.state.reworkSubmitted');
  }
}

export default function SelectRoomScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const { data, isLoading, isValidating, mutate, error } = useSWR('/rooms/for-check', () =>
    api.rooms.forCheck(),
  );

  const sections = [
    { key: 'awaiting', title: t('rooms.state.awaitingCheck'), data: data?.awaiting_check ?? [] },
    { key: 'reworked', title: t('rooms.check.reworkedTitle'), data: data?.reworked ?? [] },
    { key: 'checked', title: t('rooms.check.checkedTitle'), data: data?.already_checked ?? [] },
  ].filter((section) => section.data.length > 0);

  const openInspection = (room: RoomLog) => {
    // room_log_id is what the rating screen sends back to the server so the
    // inspection is linked to this record; without it the server has no way to
    // tell which logged room was inspected.
    router.push({
      pathname: '/rating/[id]',
      params: {
        id: room.assignment_id,
        worker_id: room.worker_id,
        room_log_id: room.id,
        room_number: room.room_number,
      },
    });
  };

  const renderItem = ({ item }: { item: RoomLog }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('quality.roomLabel')} ${item.room_number}. ${
        item.worker_name ?? t('quality.workerUnavailable')
      }`}
      onPress={() => openInspection(item)}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
            {`${t('quality.roomLabel')} ${item.room_number}`}
          </ThemedText>
          <Badge tone={roomStateTone(item.state)} label={stateLabel(item.state, t)} />
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {item.worker_name ?? t('quality.workerUnavailable')}
          {item.hotel_name ? ` · ${item.hotel_name}` : ''}
        </ThemedText>
        <View style={styles.row}>
          {item.score === null ? null : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
              {t('rooms.check.scoreShort', { score: item.score })}
            </ThemedText>
          )}
          {/* The reason the reworked group exists: the room auto-passed on the
              worker's word, and the checker still has to look at what they
              sent. The evidence screen is also where a room gets reopened. */}
          {item.verification_id ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/verification/${item.verification_id}`)}
            >
              <ThemedText type="small" themeColor="primary">
                {t('quality.evidence')}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <BackLink />
          <ScreenHeader title={t('rooms.check.title')} subtitle={t('rooms.check.subtitle')} />
        </View>
        {isLoading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled={false}
            refreshControl={
              <RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />
            }
            ListEmptyComponent={
              <EmptyState
                title={error ? t('common.loadFailed') : t('rooms.check.empty')}
                body={error ? undefined : t('rooms.check.emptyBody')}
              />
            }
            /* Kept reachable, not hidden: a worker can forget to log a room,
               and a skipped room must still be inspectable. That path types the
               room number and sends no room_log_id. */
            ListFooterComponent={
              <Button
                label={t('rooms.check.notListed')}
                variant="ghost"
                style={styles.fallback}
                onPress={() => router.push('/inspection/select-worker')}
              />
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  list: { padding: Spacing.four, gap: Spacing.two },
  card: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  grow: { flex: 1 },
  fallback: { marginTop: Spacing.four },
  loader: { marginTop: Spacing.six },
});
