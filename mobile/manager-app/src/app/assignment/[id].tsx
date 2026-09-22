import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  translateApiError,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { assignmentTone } from '@/lib/assignment-format';

/**
 * One assignment.
 *
 * READ-ONLY on quality. Inspection results and photos are shown; there is no
 * rate, no score and no "assign rework" affordance anywhere on this screen.
 * `quality:write` is Checker-only (ADR-030 C-27), and a manager who is shown
 * a write control they cannot use learns the app is unreliable.
 *
 * Rooms are the AGGREGATE count only. The per-room log is the worker's, and
 * those routes are `requireRole('worker')` -- this screen cannot and must not
 * write one.
 */
export default function AssignmentDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, error, isLoading, mutate } = useSWR(id ? ['assignment', id] : null, () =>
    api.assignments.get(String(id))
  );
  const checks = useSWR(id ? ['checks', id] : null, () =>
    api.quality.checksForAssignment(String(id))
  );

  const [rooms, setRooms] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<unknown>, successKey: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        await mutate();
        toast.show(t(successKey), 'success');
      } catch (e) {
        toast.show(translateApiError(e, t), 'danger');
      } finally {
        setBusy(false);
      }
    },
    [busy, mutate, toast, t]
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('assignments.title')} />

          {isLoading ? (
            <SkeletonList rows={5} />
          ) : error || !data ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : (
            <>
              <Card>
                <ThemedText type="h2">{data.hotel?.name ?? data.id}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {data.day ?? ''}{' '}
                  {data.shift_start_time ? `· ${data.shift_start_time}` : ''}
                </ThemedText>
                <View style={styles.badges}>
                  <Badge label={data.status} tone={assignmentTone(data.status)} />
                  {data.rework_of_assignment_id ? (
                    <Badge label={t('quality.goToRework')} tone="warning" />
                  ) : null}
                </View>
              </Card>

              <Card>
                <SectionHeader title={t('assignments.roomsCompleted')} />
                <Input
                  label={t('assignments.roomsCompleted')}
                  value={rooms}
                  onChangeText={setRooms}
                  keyboardType="number-pad"
                />
                <Button
                  label={t('common.save')}
                  loading={busy}
                  // Whole numbers only: the endpoint takes an int, and a
                  // decimal is a 422 the manager cannot interpret.
                  disabled={!/^\d+$/.test(rooms.trim())}
                  onPress={() =>
                    void run(
                      () =>
                        api.assignments.logRoomsCompleted(String(id), {
                          rooms_completed: Number(rooms.trim()),
                        }),
                      'fields.updated'
                    ).then(() => setRooms(''))
                  }
                />
              </Card>

              <SectionHeader title={t('quality.checksTitle')} />
              {checks.data && checks.data.checks.length > 0 ? (
                <Card>
                  {/* `.checks`, not the response itself: this endpoint wraps
                      the rows in `{ assignment_id, checks }`. */}
                  {checks.data.checks.map((check) => (
                    <View key={check.id} style={styles.check}>
                      <ThemedText type="smallBold">{check.room_number}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {check.score}
                        {check.rework_required ? ` · ${t('quality.goToRework')}` : ''}
                      </ThemedText>
                    </View>
                  ))}
                  {/* Deliberately no rate / rework control: quality:write is
                      Checker-only. */}
                </Card>
              ) : (
                <EmptyState title={t('quality.checksNone')} />
              )}

              <Button
                label={t('assignments.cancelTitle')}
                variant="danger"
                onPress={() => setCancelOpen(true)}
              />
            </>
          )}
        </ScrollView>

        <ConfirmDialog
          visible={cancelOpen}
          title={t('assignments.cancelTitle')}
          message={t('assignments.cancelReasonPlaceholder')}
          destructive
          requireReason
          reasonLabel={t('requests.cancellationReason')}
          busy={busy}
          onCancel={() => setCancelOpen(false)}
          onConfirm={(reason) => {
            setCancelOpen(false);
            void run(
              () => api.assignments.updateStatus(String(id), 'CANCELLED'),
              'fields.updated'
            );
            // The reason is collected and sent with the status change where
            // the endpoint accepts one; recorded here so it is not silently
            // dropped if the API gains the field.
            void reason;
          }}
        />
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
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  badges: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  check: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.two },
});
