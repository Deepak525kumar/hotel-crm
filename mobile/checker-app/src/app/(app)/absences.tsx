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
import { isoDateInCalendarTimezone, formatDay } from '@/lib/calendar-dates';
import { resolveDaySelection, selectedDays as daysOf } from '@/lib/absence-selection';
import { Spacing } from '@/constants/theme';
import type { CalendarAbsence, CalendarAbsenceKind } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { translateApiError } from '../../lib/api-error-i18n';

// Keys, not nouns: the label is resolved with t() at the point of render so a
// language change repaints it. Both the badge and the confirm dialog read from
// here, which is why the dialog interpolates the resolved label rather than
// composing an English sentence out of fragments.
const KIND_LABEL_KEY: Record<CalendarAbsenceKind, string> = {
  SICK: 'absences.kindSICK',
  VACATION: 'absences.kindVACATION',
};

const KIND_COLOR: Record<CalendarAbsenceKind, string> = {
  SICK: '#E53E3E',
  VACATION: '#3182CE',
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
  const color = KIND_COLOR[item.kind];
  // The backend refuses to delete a past absence, so offering the action on
  // one would only ever produce an error. Same rule the web app applies.
  const isPast = item.day < isoDateInCalendarTimezone(0);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.cardRow} type="backgroundElement">
        <ThemedText type="smallBold">{formatDay(item.day)}</ThemedText>
        <ThemedView style={[styles.badge, { backgroundColor: color }]} type="backgroundElement">
          <ThemedText type="small" style={styles.badgeText}>
            {t(KIND_LABEL_KEY[item.kind])}
          </ThemedText>
        </ThemedView>
      </ThemedView>
      {!isPast && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('absences.withdrawA11y', {
            kind: t(KIND_LABEL_KEY[item.kind]).toLowerCase(),
            day: formatDay(item.day),
          })}
          onPress={() => onWithdraw(item)}
          disabled={withdrawing}
          style={({ pressed }) => [styles.withdrawButton, { opacity: pressed || withdrawing ? 0.6 : 1 }]}
        >
          {withdrawing ? (
            <ActivityIndicator size="small" />
          ) : (
            <ThemedText type="small" style={styles.withdrawText}>{t("consent.withdraw")}</ThemedText>
          )}
        </Pressable>
      )}
    </ThemedView>
  );
}

export default function AbsencesScreen() {
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
  // A second tap on a later day turns the selection into a range, so a week off
  // is two taps rather than seven visits to this screen. The screen previously
  // offered only today and tomorrow as fixed buttons, which the backend never
  // required.
  const fallbackDay = isoDateInCalendarTimezone(0);
  const [rangeStart, setRangeStart] = useState<string | null>(fallbackDay);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

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

  // REQ-CAL-T03: no cap, no approval, no advance-notice -- a worker may
  // freely mark (or re-mark, RULE-CAL-03a last-write-wins) today or tomorrow
  // as sick or vacation. Only these two days are offered here (not an
  // arbitrary date picker) to keep this slice's UI surface minimal; the
  // backend itself accepts any current/future day.
  const submitMark = useCallback(
    async (days: string[], kind: CalendarAbsenceKind, reason?: string) => {
      setErrorMessage(null);
      try {
        // Sequential, not Promise.all: the backend applies last-write-wins per
        // day and a partial failure must leave the days it did accept marked.
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

  const selected = useMemo(
    () => daysOf({ start: rangeStart, end: rangeEnd }, fallbackDay),
    [rangeStart, rangeEnd, fallbackDay],
  );

  const markedDates = useMemo(() => {
    const marks: Record<string, Record<string, unknown>> = {};
    for (const a of items) {
      marks[a.day] = { marked: true, dotColor: a.kind === 'SICK' ? '#E53E3E' : theme.primary };
    }
    for (const day of selected) {
      marks[day] = {
        ...marks[day],
        selected: true,
        color: theme.primary,
        textColor: theme.background,
        startingDay: day === selected[0],
        endingDay: day === selected[selected.length - 1],
      };
    }
    return marks;
  }, [items, selected, theme]);

  // Rules (past days, range extension, 62-day cap) live in absence-selection so
  // they are testable; this only applies the result.
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
    },
    [rangeStart, rangeEnd],
  );

  const isMarking = (kind: CalendarAbsenceKind) => marking?.kind === kind;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.header}>{t("calendar.sickOrVacation")}</ThemedText>

        <Calendar
          current={selected[0]}
          onDayPress={(d: { dateString: string }) => onDayPress(d.dateString)}
          markedDates={markedDates}
          markingType="period"
          firstDay={1}
          minDate={fallbackDay}
          theme={{
            calendarBackground: theme.background,
            dayTextColor: theme.text,
            monthTextColor: theme.text,
            textSectionTitleColor: theme.textSecondary,
            todayTextColor: theme.primary,
            arrowColor: theme.primary,
            selectedDayBackgroundColor: theme.primary,
            selectedDayTextColor: theme.background,
          }}
        />

        <ThemedView type="backgroundElement" style={styles.actionsCard}>
          <ThemedText type="smallBold">
            {rangeEnd ? `${formatDay(rangeStart!)} – ${formatDay(rangeEnd)}` : formatDay(selected[0]!)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {selected.length > 1
              ? t('absences.daysSelected', { count: selected.length })
              : t('absences.tapAgainForRange')}
          </ThemedText>
          <View style={styles.actionRow}>
            {(['SICK', 'VACATION'] as const).map((kind) => (
              <Pressable
                key={kind}
                onPress={() => handleMark(selected, kind)}
                disabled={marking !== null}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: kind === 'SICK' ? '#E53E3E' : theme.primary,
                    opacity: pressed || marking !== null ? 0.6 : 1,
                  },
                ]}
              >
                {isMarking(kind) ? (
                  <ActivityIndicator color={theme.background} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    {t(KIND_LABEL_KEY[kind])}
                  </ThemedText>
                )}
              </Pressable>
            ))}
          </View>
        </ThemedView>

        {errorMessage && (
          <ThemedText type="small" style={styles.errorText}>
            {errorMessage}
          </ThemedText>
        )}

        <ThemedText type="small" themeColor="textSecondary" style={styles.listHeader}>{t("calendar.yourMarkedDays")}</ThemedText>

        {loading ? (
          <ActivityIndicator style={styles.loader} color={theme.text} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <AbsenceCard
                item={item}
                onWithdraw={handleWithdraw}
                withdrawing={withdrawingId === item.id}
              />
            )}
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="small" themeColor="textSecondary">{t("profile.noAbsences")}</ThemedText>
              </ThemedView>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        )}

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
                <ThemedText type="small" style={styles.modalError}>
                  {reasonError}
                </ThemedText>
              )}
              <ThemedView style={styles.modalActions} type="backgroundElement">
                <Pressable
                  onPress={() => setReasonPrompt(null)}
                  style={({ pressed }) => [styles.modalButton, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <ThemedText type="small">{t('common.cancel', 'Cancel')}</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => void confirmReason()}
                  style={({ pressed }) => [
                    styles.modalButton,
                    { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <ThemedText type="smallBold">{t('common.confirm', 'Confirm')}</ThemedText>
                </Pressable>
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
    borderRadius: Spacing.three,
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
  modalError: { color: '#E53E3E' },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  modalButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  header: { marginBottom: Spacing.three },
  actionsCard: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.three },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  actionButton: {
    minWidth: 84,
    height: 36,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
  },
  actionButtonText: { color: '#fff' },
  errorText: { color: '#E53E3E', marginBottom: Spacing.two },
  listHeader: { marginBottom: Spacing.two },
  loader: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  card: { borderRadius: Spacing.two, padding: Spacing.three },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  withdrawButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.half,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.one,
  },
  withdrawText: {
    textDecorationLine: 'underline',
  },
  badgeText: { color: '#fff', fontSize: 11 },
  empty: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center' },
});
