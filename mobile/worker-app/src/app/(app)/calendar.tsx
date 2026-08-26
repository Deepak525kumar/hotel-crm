import { Modal, TextInput, StyleSheet, FlatList, Pressable, View, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import {
  ABSENCE_REASON_MAX_LENGTH,
  normalizeAbsenceReason,
  validateAbsenceReason,
} from '@/lib/absence-reason';
import { isoDateInCalendarTimezone, formatDay, weekOf } from '@/lib/calendar-dates';
import { resolveDaySelection, selectedDays as daysOf } from '@/lib/absence-selection';
import { Radius, Spacing } from '@/constants/theme';
import { Badge, BadgeTone, Button, Card, EmptyState, ScreenHeader, SectionHeader } from '@/components/ui';
import type { CalendarAbsence, CalendarAbsenceKind } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { NotificationBell } from '@/components/NotificationBell';
import { translateApiError } from '../../lib/api-error-i18n';

// Keys, not nouns: the label is resolved with t() at the point of render so a
// language change repaints it. Both the badge and the confirm dialog read from
// here, which is why the dialog interpolates the resolved label rather than
// composing an English sentence out of fragments.
const KIND_LABEL_KEY: Record<CalendarAbsenceKind, string> = {
  SICK: 'absences.kindSICK',
  VACATION: 'absences.kindVACATION',
};

/**
 * Semantic tones, not raw hexes. These were `#E53E3E` / `#3182CE` painted as
 * badge fills with white text, which ignored the colour scheme: the same two
 * colours in dark mode against a near-black ground, and white-on-light in the
 * modal error line.
 */
const KIND_TONE: Record<CalendarAbsenceKind, BadgeTone> = {
  SICK: 'danger',
  VACATION: 'primary',
};

function AbsenceCard({
  item,
  onWithdraw,
  withdrawing,
}: {
  item: CalendarAbsence;
  onWithdraw: (item: CalendarAbsence) => void;
  withdrawing: boolean;
}) {
  const { t } = useTranslation();
  // The backend refuses to delete a past absence, so offering the action on
  // one would only ever produce an error. Same rule the web app applies.
  const isPast = item.day < isoDateInCalendarTimezone(0);

  return (
    <Card>
      <ThemedView style={styles.cardRow} type="backgroundElement">
        <ThemedText type="smallBold">{formatDay(item.day)}</ThemedText>
        <Badge label={t(KIND_LABEL_KEY[item.kind])} tone={KIND_TONE[item.kind]} />
      </ThemedView>
      {!isPast && (
        <Button
          label={t('consent.withdraw')}
          variant="ghost"
          onPress={() => onWithdraw(item)}
          loading={withdrawing}
          accessibilityHint={t('absences.withdrawA11y', {
            kind: t(KIND_LABEL_KEY[item.kind]).toLowerCase(),
            day: formatDay(item.day),
          })}
          style={styles.withdrawButton}
        />
      )}
    </Card>
  );
}

export default function CalendarScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [items, setItems] = useState<CalendarAbsence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [marking, setMarking] = useState<{ day: string; kind: CalendarAbsenceKind } | null>(null);
  // VACATION requires a reason, so the tap opens this prompt rather than
  // submitting straight away.
  const [reasonPrompt, setReasonPrompt] = useState<
    { days: string[]; kind: CalendarAbsenceKind } | null
  >(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [selected, setSelected] = useState(() => isoDateInCalendarTimezone(0));
  // A second tap on a later day turns the selection into a range, so marking a
  // week off is two taps rather than seven separate visits to this screen.
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

  // Rules (past days, range extension, length cap) live in absence-selection
  // so they are testable; this only applies the result. A tap that resolves to
  // an unchanged selection was rejected -- a past day -- and must not move
  // `selected` either, or the header would name a day that cannot be marked.
  const onDayPress = useCallback(
    (day: string) => {
      const next = resolveDaySelection({
        current: { start: rangeStart, end: rangeEnd },
        tapped: day,
        today: isoDateInCalendarTimezone(0),
      });
      if (next.start === rangeStart && next.end === rangeEnd) return;
      setRangeStart(next.start);
      setRangeEnd(next.end);
      setSelected(next.start ?? day);
    },
    [rangeStart, rangeEnd],
  );

  const selectedDays = useMemo(
    () => daysOf({ start: rangeStart, end: rangeEnd }, selected),
    [rangeStart, rangeEnd, selected],
  );

  const byDay = new Map(items.map((a) => [a.day, a]));

  const markedDates = useMemo(() => {
    const marks: Record<string, Record<string, unknown>> = {};
    for (const a of items) {
      marks[a.day] = { marked: true, dotColor: a.kind === 'SICK' ? theme.danger : theme.primary };
    }
    for (const day of selectedDays) {
      marks[day] = {
        ...marks[day],
        selected: true,
        color: theme.primary,
        textColor: theme.onPrimary,
        startingDay: day === selectedDays[0],
        endingDay: day === selectedDays[selectedDays.length - 1],
      };
    }
    return marks;
  }, [items, selectedDays, theme]);

  const calendarTheme = useMemo(
    () => ({
      calendarBackground: theme.background,
      dayTextColor: theme.text,
      monthTextColor: theme.text,
      textSectionTitleColor: theme.textSecondary,
      todayTextColor: theme.primary,
      arrowColor: theme.primary,
      selectedDayBackgroundColor: theme.primary,
      selectedDayTextColor: theme.onPrimary,
    }),
    [theme],
  );

  const load = useCallback(async () => {
    try {
      const res = await api.calendar.myAbsences();
      setItems(Array.isArray(res) ? res : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  // REQ-CAL-T03: no cap, no approval, no advance notice -- a worker may freely
  // mark (or re-mark, RULE-CAL-03a last-write-wins) any current or future day.
  // The screen previously offered only today and tomorrow as fixed buttons,
  // which the backend never required; a week off had to be marked one day at a
  // time, and only once those two days came around.
  //
  // Sequential, not Promise.all: the backend applies last-write-wins per day
  // and a partial failure must leave the days it did accept marked, with the
  // error naming where it stopped.
  const submitMark = useCallback(
    async (days: string[], kind: CalendarAbsenceKind, reason?: string) => {
      setErrorMessage(null);
      try {
        for (const day of days) {
          setMarking({ day, kind });
          await api.calendar.markAbsence({ day, kind, reason: normalizeAbsenceReason(reason) });
        }
        await load();
      } catch (error) {
        setErrorMessage(translateApiError(error, t, 'absences.markFailed'));
        await load();
      } finally {
        setMarking(null);
      }
    },
    [load, t]
  );

  // VACATION needs a reason (backend MarkAbsenceSchema), so it opens a prompt
  // instead of firing immediately. SICK stays one tap on purpose: the backend
  // does not require a reason for it, and asking would both slow down someone
  // marking themselves sick and invite health details this system
  // deliberately does not collect.
  const handleMark = useCallback(
    (days: string[], kind: CalendarAbsenceKind) => {
      if (days.length === 0) return;
      if (kind === 'VACATION') {
        setReasonPrompt({ days, kind });
        setReasonText('');
        setReasonError(null);
        return;
      }
      void submitMark(days, kind);
    },
    [submitMark]
  );

  const confirmReason = useCallback(async () => {
    if (!reasonPrompt) return;
    const problem = validateAbsenceReason(reasonPrompt.kind, reasonText);
    if (problem) {
      setReasonError(
        problem === 'required'
          ? t('absences.reasonRequired', 'A reason is required for vacation.')
          : t('absences.reasonTooLong', 'Please keep the reason under 500 characters.')
      );
      return;
    }
    const { days, kind } = reasonPrompt;
    setReasonPrompt(null);
    await submitMark(days, kind, reasonText);
  }, [reasonPrompt, reasonText, submitMark, t]);

  // Confirmed before firing: withdrawing does NOT restore a shift that was
  // auto-cancelled when the absence was marked (the slot may already have been
  // backfilled), so this is not a plain undo and should not feel like one.
  const handleWithdraw = useCallback(
    (item: CalendarAbsence) => {
      Alert.alert(
        t('absences.withdrawTitle', { kind: t(KIND_LABEL_KEY[item.kind]).toLowerCase() }),
        t('absences.withdrawBody', {
          day: formatDay(item.day),
          kind: t(KIND_LABEL_KEY[item.kind]).toLowerCase(),
        }),
        [
          { text: t('common.keep'), style: 'cancel' },
          {
            text: t('consent.withdraw'),
            style: 'destructive',
            onPress: async () => {
              setErrorMessage(null);
              setWithdrawingId(item.id);
              try {
                await api.calendar.deleteAbsence(item.id);
                await load();
              } catch (error) {
                setErrorMessage(
                  translateApiError(error, t, 'absences.withdrawFailed')
                );
              } finally {
                setWithdrawingId(null);
              }
            },
          },
        ]
      );
    },
    [load, t]
  );

  const isMarking = (kind: CalendarAbsenceKind) => marking?.kind === kind;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* One scroll container for the whole screen. The calendar and the
            actions used to sit above a separately-scrolling FlatList, so the
            marked-days list could only be scrolled inside whatever narrow strip
            was left below the calendar. */}
        <FlatList
          data={loading ? [] : items}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <AbsenceCard
              item={item}
              onWithdraw={handleWithdraw}
              withdrawing={withdrawingId === item.id}
            />
          )}
          ListHeaderComponent={
            <>
          <ScreenHeader title={t('calendar.sickOrVacation')} action={<NotificationBell />} />

          <View style={styles.viewSwitch}>
            {(['month', 'week', 'day'] as const).map((v) => (
              <Pressable
                key={v}
                onPress={() => setView(v)}
                style={[
                  styles.viewTab,
                  { borderColor: v === view ? theme.primary : 'transparent' },
                ]}
              >
                <ThemedText type={v === view ? 'smallBold' : 'small'}>{t(`calendar.view${v}`)}</ThemedText>
              </Pressable>
            ))}
          </View>

          {view === 'month' ? (
            <Calendar
              current={selected}
              onDayPress={(d: { dateString: string }) => onDayPress(d.dateString)}
              markedDates={markedDates}
              // Affordance to match the rule: a past day cannot be marked, so it
              // should not look tappable either.
              minDate={isoDateInCalendarTimezone(0)}
              markingType="period"
              firstDay={1}
              theme={calendarTheme}
            />
          ) : view === 'week' ? (
            <View style={styles.weekStrip}>
              {weekOf(selected).map((day) => {
                const isSelected = day === selected;
                // Past days cannot be marked, so they must not look tappable.
                const isPast = day < isoDateInCalendarTimezone(0);
                return (
                  <Pressable
                    key={day}
                    onPress={() => onDayPress(day)}
                    disabled={isPast}
                    style={[
                      styles.weekCell,
                      { backgroundColor: isSelected ? theme.primary : 'transparent', opacity: isPast ? 0.35 : 1 },
                    ]}
                  >
                    <ThemedText type="small" style={isSelected ? { color: theme.onPrimary } : undefined}>
                      {day.slice(8)}
                    </ThemedText>
                    {byDay.get(day) ? (
                      <View style={[styles.dot, { backgroundColor: isSelected ? theme.onPrimary : theme.danger }]} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Card>
            <ThemedText type="smallBold">
              {rangeEnd ? `${formatDay(rangeStart!)} – ${formatDay(rangeEnd)}` : formatDay(selected)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {selectedDays.length > 1
                ? t('absences.daysSelected', { count: selectedDays.length })
                : t('absences.tapAgainForRange')}
            </ThemedText>

            <View style={styles.actionRow}>
              {(['SICK', 'VACATION'] as const).map((kind) => (
                <Button
                  key={kind}
                  label={t(KIND_LABEL_KEY[kind])}
                  variant={kind === 'SICK' ? 'danger' : 'primary'}
                  onPress={() => handleMark(selectedDays, kind)}
                  disabled={marking !== null}
                  loading={isMarking(kind)}
                  style={styles.actionButton}
                />
              ))}
            </View>
          </Card>

          {errorMessage && (
            <ThemedText type="small" style={[styles.errorText, { color: theme.danger }]}>
              {errorMessage}
            </ThemedText>
          )}

              <SectionHeader title={t('calendar.yourMarkedDays')} />
              {loading ? <ActivityIndicator style={styles.loader} color={theme.text} /> : null}
            </>
          }
          ListEmptyComponent={loading ? null : <EmptyState title={t('profile.noAbsences')} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />

        {/* Reason prompt for VACATION. A modal rather than Alert.prompt, which
            is iOS-only — on Android that would have silently done nothing. */}
        <Modal
          visible={reasonPrompt !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setReasonPrompt(null)}
        >
          <ThemedView style={styles.modalBackdrop} type="background">
            <ThemedView style={styles.modalCard} type="backgroundElement">
              <ThemedText type="smallBold">
                {t('absences.reasonTitle', 'Reason for vacation')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.modalHint}>
                {t('absences.reasonHint', 'Required for vacation. Do not enter medical details.')}
              </ThemedText>
              <TextInput
                value={reasonText}
                onChangeText={(next) => {
                  setReasonText(next);
                  setReasonError(null);
                }}
                placeholder={t('absences.reasonPlaceholder', 'e.g. family trip, personal days')}
                placeholderTextColor={theme.textSecondary}
                maxLength={ABSENCE_REASON_MAX_LENGTH}
                multiline
                autoFocus
                style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background }]}
              />
              {reasonError && (
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {reasonError}
                </ThemedText>
              )}
              <ThemedView style={styles.modalActions} type="backgroundElement">
                <Button
                  label={t('common.cancel')}
                  variant="ghost"
                  onPress={() => setReasonPrompt(null)}
                  style={styles.modalButton}
                />
                <Button
                  label={t('common.confirm')}
                  onPress={() => void confirmReason()}
                  style={styles.modalButton}
                />
              </ThemedView>
            </ThemedView>
          </ThemedView>
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalCard: {
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  modalHint: { marginBottom: Spacing.two },
  modalInput: {
    minHeight: 72,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    textAlignVertical: 'top',
  },
  modalError: {},
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  modalButton: { flex: 1 },
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  header: { marginBottom: Spacing.three },
  viewSwitch: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  viewTab: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderBottomWidth: 2 },
  weekStrip: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.two },
  weekCell: { flex: 1, alignItems: 'center', paddingVertical: Spacing.one, borderRadius: Radius.sm, gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  actionButton: { minWidth: 96, flexShrink: 1 },
  errorText: { marginBottom: Spacing.two },
  loader: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  card: { borderRadius: Spacing.two, padding: Spacing.three },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // `Spacing.xs` / `Spacing.sm` do not exist on this app's scale (it is
  // half/one/two/three/...), so these three values were `undefined` and the
  // button rendered with no spacing at all. The syntax error above masked the
  // type errors that would have caught it -- tsc stopped at the parse failure
  // and never checked the rest of the file. Mapped to the nearest real steps.
  withdrawButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
});
