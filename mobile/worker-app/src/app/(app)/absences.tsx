import { StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState, useCallback } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { isoDateInCalendarTimezone, formatDay } from '@/lib/calendar-dates';
import { Spacing } from '@/constants/theme';
import type { CalendarAbsence, CalendarAbsenceKind } from '@/types/api';

const KIND_LABEL: Record<CalendarAbsenceKind, string> = {
  SICK: 'Sick',
  VACATION: 'Vacation',
};

const KIND_COLOR: Record<CalendarAbsenceKind, string> = {
  SICK: '#E53E3E',
  VACATION: '#3182CE',
};

function AbsenceCard({ item }: { item: CalendarAbsence }) {
  const color = KIND_COLOR[item.kind];
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.cardRow} type="backgroundElement">
        <ThemedText type="smallBold">{formatDay(item.day)}</ThemedText>
        <ThemedView style={[styles.badge, { backgroundColor: color }]} type="backgroundElement">
          <ThemedText type="small" style={styles.badgeText}>
            {KIND_LABEL[item.kind]}
          </ThemedText>
        </ThemedView>
      </ThemedView>
    </ThemedView>
  );
}

export default function AbsencesScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<CalendarAbsence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [marking, setMarking] = useState<{ day: string; kind: CalendarAbsenceKind } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        setErrorMessage(error instanceof ApiError ? error.message : 'Could not mark absence.');
      } finally {
        setMarking(null);
      }
    },
    [load]
  );

  const isMarking = (daysFromToday: 0 | 1, kind: CalendarAbsenceKind) =>
    marking?.day === isoDateInCalendarTimezone(daysFromToday) && marking.kind === kind;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.header}>
          Sick / Vacation
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.actionsCard}>
          {([0, 1] as const).map((daysFromToday) => (
            <ThemedView key={daysFromToday} style={styles.actionRow} type="backgroundElement">
              <ThemedText type="small" style={styles.flex}>
                {daysFromToday === 0 ? 'Today' : 'Tomorrow'}
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
                      {KIND_LABEL[kind]}
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

        <ThemedText type="small" themeColor="textSecondary" style={styles.listHeader}>
          Your marked days
        </ThemedText>

        {loading ? (
          <ActivityIndicator style={styles.loader} color={theme.text} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => <AbsenceCard item={item} />}
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="small" themeColor="textSecondary">
                  No sick or vacation days marked.
                </ThemedText>
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
  badgeText: { color: '#fff', fontSize: 11 },
  empty: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center' },
});
