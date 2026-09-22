import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CalendarProvider, ExpandableCalendar } from 'react-native-calendars';

import useSWR from 'swr';

import {
  ApiError,
  Badge,
  BottomTabInset,
  Button,
  Card,
  EmptyState,
  MaxContentWidth,
  ProgressSheet,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  translateApiError,
  useTheme,
  useToast,
} from '@hotel-crm/mobile-shared';

import { AddPlacementSheet } from '@/components/AddPlacementSheet';
import { MarkAbsenceSheet } from '@/components/MarkAbsenceSheet';
import { NotificationBell } from '@/components/NotificationBell';
import { ShiftSheet } from '@/components/ShiftSheet';
import { ShiftSummarySheet } from '@/components/ShiftSummarySheet';
import { useDirectory } from '@/hooks/useDirectory';
import { absencesForDay, groupByHotel } from '@/lib/agenda';
import { calendarTheme } from '@/lib/calendar-theme';
import { monthGrid } from '@/lib/calendar-views';
import { isCompleteSuccess, weeklyOccurrences, type OccurrenceOutcome } from '@/lib/recurring';
import { todayInBerlin } from '@/lib/today';

/**
 * The rota, on `react-native-calendars`.
 *
 * REBUILT 2026-09-23 on the Wix kit, at the project owner's request, after
 * the hand-rolled version (a scrolling date strip, then a segmented
 * day/week/month switcher over my own grid) was judged poor UX twice.
 *
 * `ExpandableCalendar` is the reason the kit is worth adopting: a week strip
 * that pulls down into a month is one gesture instead of a three-way switch,
 * and it is the interaction people already know from every native calendar.
 * `CalendarProvider` keeps the selected day in sync between the calendar and
 * the list below it, which is precisely the state I was threading by hand.
 *
 * The kit ships a light-only palette of its own. `calendarTheme()` maps every
 * colour it exposes onto our tokens, so this does not become a second design
 * system inside the app and dark mode does not render black on white.
 *
 * `markedDates` carries the workload: a dot per day with placements, a second
 * in the warning colour when somebody is off. That is what makes a month view
 * worth opening — the shape of the fortnight, not thirty truncated names.
 */
export default function Calendar() {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const { workerName, hotelName } = useDirectory();

  const today = useMemo(() => todayInBerlin(), []);
  const [day, setDay] = useState(today);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [markingAbsence, setMarkingAbsence] = useState(false);
  const [summaryFor, setSummaryFor] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<OccurrenceOutcome[] | null>(null);

  // A month of data behind the calendar, so expanding to month view does not
  // render empty cells that look like quiet days rather than unloaded ones.
  const range = useMemo(() => {
    const grid = monthGrid(day);
    return { from: grid[0], to: grid[grid.length - 1] };
  }, [day]);

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

  /** Dots under each day: how much is on, and whether anyone is off. */
  const markedDates = useMemo(() => {
    const marks: Record<string, { dots: { key: string; color: string }[]; selected?: boolean }> = {};
    for (const entry of placements.data ?? []) {
      marks[entry.day] ??= { dots: [] };
      // One dot per day, not per placement: twelve dots under a date is
      // noise, and the count belongs in the list.
      if (!marks[entry.day].dots.some((d) => d.key === 'shift')) {
        marks[entry.day].dots.push({ key: 'shift', color: theme.primary });
      }
    }
    for (const off of absences.data ?? []) {
      marks[off.day] ??= { dots: [] };
      if (!marks[off.day].dots.some((d) => d.key === 'off')) {
        marks[off.day].dots.push({ key: 'off', color: theme.warning });
      }
    }
    return marks;
  }, [placements.data, absences.data, theme]);

  const createPlacements = useCallback(
    async (input: { workerId: string; hotelId: string; weeks: number }) => {
      const days = weeklyOccurrences(day, input.weeks);
      setAdding(false);
      setBusy(true);
      const outcomes: OccurrenceOutcome[] = days.map((d) => ({ day: d, state: 'pending' }));
      setRun([...outcomes]);

      for (let i = 0; i < days.length; i += 1) {
        outcomes[i] = { day: days[i], state: 'running' };
        setRun([...outcomes]);
        try {
          await api.assignments.createCalendarEntry({
            worker_id: input.workerId,
            hotel_id: input.hotelId,
            day: days[i],
          });
          outcomes[i] = { day: days[i], state: 'done' };
        } catch (e) {
          outcomes[i] = { day: days[i], state: 'failed', detail: translateApiError(e, t) };
        }
        setRun([...outcomes]);
      }

      setBusy(false);
      await placements.mutate();
      if (isCompleteSuccess(outcomes)) {
        setRun(null);
        toast.show(t('fields.updated'), 'success');
      }
    },
    [day, placements, toast, t]
  );

  const entriesUnavailable =
    placements.error instanceof ApiError && placements.error.status === 404;

  const groups = groupByHotel(placements.data ?? [], day);
  const dayAbsences = absencesForDay(absences.data ?? [], day);
  const shift = (placements.data ?? []).find((e) => e.id === openShift) ?? null;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <CalendarProvider
          date={day}
          onDateChanged={setDay}
          showTodayButton
          theme={{ todayButtonTextColor: theme.primary }}
        >
          <View style={styles.header}>
            <ScreenHeader title={t('nav.calendar')} action={<NotificationBell />} />
          </View>

          <ExpandableCalendar
            firstDay={1}
            markedDates={markedDates}
            markingType="multi-dot"
            theme={calendarTheme(theme)}
            allowShadow={false}
            // Closed by default: the week strip plus the day's list is what a
            // supervisor needs, and a month open on arrival pushes the actual
            // work below the fold.
            initialPosition={ExpandableCalendar.positions.CLOSED}
          />

          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
            }
          >
            <View style={styles.actions}>
              <Button
                label={t('calendar.placements')}
                variant="ghost"
                onPress={() => setAdding(true)}
              />
              <Button
                label={t('calendar.markAbsence')}
                variant="ghost"
                onPress={() => setMarkingAbsence(true)}
              />
            </View>

            {placements.isLoading || absences.isLoading ? (
              <SkeletonList rows={4} />
            ) : entriesUnavailable ? (
              <EmptyState title={t('status.unavailable')} body={t('calendar.loadFailed')} />
            ) : groups.length === 0 && dayAbsences.length === 0 ? (
              <EmptyState title={t('calendar.nothingScheduled')} />
            ) : (
              <>
                {groups.map((group) => (
                  <View key={group.hotelId} style={styles.group}>
                    <SectionHeader
                      title={hotelName(group.hotelId)}
                      action={
                        <Button
                          label={t('calendar.dailySummary')}
                          variant="ghost"
                          onPress={() => setSummaryFor(group.hotelId)}
                        />
                      }
                    />
                    <Card>
                      {group.entries.map((entry) => (
                        <View key={entry.id} style={styles.shiftRow}>
                          <View style={styles.shiftText}>
                            <ThemedText type="smallBold" numberOfLines={1}>
                              {workerName(entry.worker_id)}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                              {hotelName(entry.hotel_id)}
                            </ThemedText>
                          </View>
                          {entry.assignment_status ? (
                            <Badge
                              label={entry.assignment_status}
                              tone={entry.assignment_status === 'CANCELLED' ? 'danger' : 'neutral'}
                            />
                          ) : null}
                          <Button
                            label={t('calendar.viewDay')}
                            variant="ghost"
                            onPress={() => setOpenShift(entry.id)}
                          />
                        </View>
                      ))}
                    </Card>
                  </View>
                ))}

                {dayAbsences.length > 0 ? (
                  <View style={styles.group}>
                    <SectionHeader title={t('nav.sickVacation')} />
                    <Card>
                      {dayAbsences.map((absence) => (
                        <View key={absence.id} style={styles.shiftRow}>
                          <View style={styles.shiftText}>
                            <ThemedText type="smallBold" numberOfLines={1}>
                              {absence.worker_name ?? workerName(absence.worker_id)}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                              {absence.kind}
                              {absence.reason ? ` · ${absence.reason}` : ''}
                            </ThemedText>
                          </View>
                        </View>
                      ))}
                    </Card>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </CalendarProvider>

        <ShiftSheet
          visible={shift !== null}
          entry={shift}
          workerName={workerName}
          hotelName={hotelName}
          onClose={() => setOpenShift(null)}
          onMove={() => setOpenShift(null)}
        />

        <AddPlacementSheet
          visible={adding}
          day={day}
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={(input) => void createPlacements(input)}
        />

        <MarkAbsenceSheet
          visible={markingAbsence}
          day={day}
          busy={busy}
          onClose={() => setMarkingAbsence(false)}
          onSubmit={(input) => {
            setBusy(true);
            void api.calendar
              .markAbsenceForWorker(input)
              .then(() => absences.mutate())
              .then(() => {
                setMarkingAbsence(false);
                toast.show(t('fields.updated'), 'success');
              })
              .catch((e) => toast.show(translateApiError(e, t), 'danger'))
              .finally(() => setBusy(false));
          }}
        />

        {summaryFor ? (
          <ShiftSummarySheet
            visible
            day={day}
            busy={busy}
            onClose={() => setSummaryFor(null)}
            onSave={(input) => {
              setBusy(true);
              void api.calendar
                .saveShiftSummary(summaryFor, day, input)
                .then(() => {
                  setSummaryFor(null);
                  toast.show(t('fields.updated'), 'success');
                })
                .catch((e) => toast.show(translateApiError(e, t), 'danger'))
                .finally(() => setBusy(false));
            }}
          />
        ) : null}

        <ProgressSheet
          visible={run !== null}
          title={t('calendar.placements')}
          items={(run ?? []).map((o) => ({
            key: o.day,
            label: o.day,
            state: o.state,
            detail: o.detail,
          }))}
          onClose={() => setRun(null)}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: { paddingHorizontal: Spacing.three },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: BottomTabInset,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  actions: { flexDirection: 'row', gap: Spacing.two },
  group: { gap: Spacing.two },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  shiftText: { flex: 1, flexShrink: 1, minWidth: 0, gap: 1 },
});
