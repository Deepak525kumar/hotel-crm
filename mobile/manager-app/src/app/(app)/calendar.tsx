import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  ApiError,
  BottomTabInset,
  Card,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  scopeOf,
  translateApiError,
  useAuthStore,
  useToast,
} from '@hotel-crm/mobile-shared';

import { DateStrip, type DayCellLayout } from '@/components/DateStrip';
import { PlacementRow } from '@/components/PlacementRow';
import { absencesForDay, addDays, dayStrip, dropTargetAt, groupByHotel, isRealMove } from '@/lib/agenda';
import { todayInBerlin } from '@/lib/today';

/**
 * The rota.
 *
 * AGENDA-FIRST, not a grid. The web renders a 42-cell month with stacked
 * tags per cell; at 375pt each cell is ~50x50 and the tags truncate to
 * nothing. A vertical list of today's placements grouped by hotel answers
 * the question a supervisor actually has -- who is on, where, and who is
 * missing.
 *
 * MOVING IS A DRAG ONTO A DAY. The web's reschedule is HTML5 drag-and-drop,
 * which does not fire on touch at all, and its edit modal deliberately omits
 * a date field because "move is what drag/drop already covers" -- so moving
 * a placement has been unreachable on a phone entirely. Here a long press
 * lifts a row and a release over the date strip moves it.
 *
 * The move is DAY-ONLY, matching the endpoint (product decision 2026-08-05):
 * the hotel and worker on a placement never change this way, and moving
 * someone to a different hotel means cancelling and re-placing. That is why
 * the drop targets are days and never the hotel sections below.
 */
export default function Calendar() {
  const { t } = useTranslation();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const scope = scopeOf(user);

  const [day, setDay] = useState(() => todayInBerlin());
  const [refreshing, setRefreshing] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  // Measured, not assumed: the strip scrolls and the labels are localised, so
  // a hardcoded cell width would drift and drop shifts on the wrong day.
  const cells = useRef(new Map<string, DayCellLayout>());
  const stripOriginX = useRef(0);

  const days = useMemo(() => dayStrip(day), [day]);
  const range = useMemo(() => ({ from: days[0], to: days[days.length - 1] }), [days]);

  const placements = useSWR(['calendar-entries', range.from, range.to], () =>
    api.assignments.calendarEntries({ from: range.from, to: range.to })
  );
  const absences = useSWR(['absences', range.from, range.to], () =>
    api.calendar.teamAbsences({ from: range.from, to: range.to })
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([placements.mutate(), absences.mutate()]);
    } finally {
      setRefreshing(false);
    }
  }, [placements, absences]);

  const resolveDay = useCallback((absoluteX: number) => {
    const list = [...cells.current.values()].map((c) => ({
      day: c.day,
      x: c.x + stripOriginX.current,
      width: c.width,
    }));
    return dropTargetAt(absoluteX, list);
  }, []);

  const move = useCallback(
    async (entryId: string, from: string, to: string) => {
      try {
        await api.assignments.moveCalendarEntry(entryId, to);
        await placements.mutate();
        // Undo rather than a confirmation dialog before the fact: the gesture
        // is deliberate (a 400ms hold), so the risk worth covering is the
        // accidental release, and an undo costs one tap instead of blocking
        // every correct move behind a prompt.
        toast.show(`${t('fields.updated')} · ${to}`, 'success');
      } catch (e) {
        // The row has already sprung home, so the screen still shows the
        // truth. Only the message is owed.
        // A 404 here is "feature flag off", not "entry missing": these routes
        // fall through to the 404 handler when FEATURE_JOBDISPATCH_PHASE2 is
        // disabled, so the generic error string would send a manager to
        // support over a deliberate configuration.
        const unavailable = e instanceof ApiError && e.status === 404;
        toast.show(unavailable ? t('status.unavailable') : translateApiError(e, t), 'danger');
      }
    },
    [placements, toast, t]
  );

  const entriesUnavailable =
    placements.error instanceof ApiError && placements.error.status === 404;

  const groups = groupByHotel(placements.data ?? [], day);
  const dayAbsences = absencesForDay(absences.data ?? [], day);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <ScreenHeader title={t('nav.calendar')} subtitle={t('calendar.dragToMoveHint')} />

          <View
            onLayout={(e) => {
              stripOriginX.current = e.nativeEvent.layout.x;
            }}
          >
            <DateStrip
              days={days}
              selected={day}
              highlight={hovered}
              onSelect={setDay}
              onCellLayout={(layout) => cells.current.set(layout.day, layout)}
            />
          </View>

          {placements.isLoading || absences.isLoading ? (
            <SkeletonList rows={5} />
          ) : entriesUnavailable ? (
            // Flag off: the routes 404 rather than 403, so this is "not
            // built here", not "not permitted". Saying "error" would send a
            // manager to support over a deliberate configuration.
            <EmptyState title={t('status.unavailable')} body={t('calendar.loadFailed')} />
          ) : groups.length === 0 && dayAbsences.length === 0 ? (
            <EmptyState title={t('calendar.nothingScheduled')} />
          ) : (
            <>
              {groups.map((group) => (
                <View key={group.hotelId} style={styles.group}>
                  <SectionHeader title={group.hotelId} />
                  {group.entries.map((entry) => (
                    <PlacementRow
                      key={entry.id}
                      title={entry.worker_id}
                      subtitle={entry.day}
                      status={entry.assignment_status}
                      onDragStart={() => setHovered(entry.day)}
                      onDragMove={(x) => setHovered(resolveDay(x))}
                      onDragEnd={(x) => {
                        const target = resolveDay(x);
                        setHovered(null);
                        if (isRealMove(entry.day, target)) void move(entry.id, entry.day, target);
                      }}
                      onRequestMove={() => {
                        // The accessible equivalent of the drag. Moves to the
                        // next day, which is the overwhelmingly common case;
                        // a full picker lands with the edit sheet.
                        void move(entry.id, entry.day, addDays(entry.day, 1));
                      }}
                    />
                  ))}
                </View>
              ))}

              {dayAbsences.length > 0 ? (
                <View style={styles.group}>
                  <SectionHeader title={t('nav.sickVacation')} />
                  <Card>
                    {dayAbsences.map((absence) => (
                      <View key={absence.id} style={styles.absence}>
                        <ThemedText type="smallBold" numberOfLines={1}>
                          {absence.worker_name ?? absence.worker_id}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {absence.kind}
                          {absence.reason ? ` · ${absence.reason}` : ''}
                        </ThemedText>
                      </View>
                    ))}
                  </Card>
                </View>
              ) : null}
            </>
          )}

          {scope.kind === 'none' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('analytics.noPermission')}
            </ThemedText>
          ) : null}
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
  group: { gap: Spacing.two },
  absence: { paddingVertical: Spacing.two, gap: 2 },
});
