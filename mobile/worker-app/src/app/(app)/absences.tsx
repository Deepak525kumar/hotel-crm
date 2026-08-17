import { StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState, useCallback } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { isoDateInCalendarTimezone, formatDay } from '@/lib/calendar-dates';
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

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
  const handleMark = useCallback(
    async (daysFromToday: 0 | 1, kind: CalendarAbsenceKind) => {
      const day = isoDateInCalendarTimezone(daysFromToday);
      setErrorMessage(null);
      setMarking({ day, kind });
      try {
        await api.calendar.markAbsence({ day, kind });
        await load();
      } catch (error) {
        setErrorMessage(translateApiError(error, t, 'absences.markFailed'));
      } finally {
        setMarking(null);
      }
    },
    [load, t]
  );

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

  const isMarking = (daysFromToday: 0 | 1, kind: CalendarAbsenceKind) =>
    marking?.day === isoDateInCalendarTimezone(daysFromToday) && marking.kind === kind;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.header}>{t("calendar.sickOrVacation")}</ThemedText>

        <ThemedView type="backgroundElement" style={styles.actionsCard}>
          {([0, 1] as const).map((daysFromToday) => (
            <ThemedView key={daysFromToday} style={styles.actionRow} type="backgroundElement">
              <ThemedText type="small" style={styles.flex}>
                {daysFromToday === 0 ? t('common.today') : t('common.tomorrow')}
              </ThemedText>
              {(['SICK', 'VACATION'] as const).map((kind) => (
                <Pressable
                  key={kind}
                  onPress={() => handleMark(daysFromToday, kind)}
                  disabled={marking !== null}
                  style={({ pressed }) => [
                    styles.actionButton,
                    { backgroundColor: KIND_COLOR[kind], opacity: pressed || marking !== null ? 0.7 : 1 },
                  ]}
                >
                  {isMarking(daysFromToday, kind) ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <ThemedText type="small" style={styles.actionButtonText}>
                      {t(KIND_LABEL_KEY[kind])}
                    </ThemedText>
                  )}
                </Pressable>
              ))}
            </ThemedView>
          ))}
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
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
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
  withdrawText: {
    textDecorationLine: 'underline',
  },
  badgeText: { color: '#fff', fontSize: 11 },
  empty: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center' },
});
