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
  DataRow,
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
import { ReassignSheet } from '@/components/ReassignSheet';
import {
  assignmentStatusLabel,
  assignmentTone,
  formatDateTime,
} from '@/lib/assignment-format';

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
  const [reassignOpen, setReassignOpen] = useState(false);
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
                  <Badge
                    label={assignmentStatusLabel(data.status, t)}
                    tone={assignmentTone(data.status)}
                  />
                  {data.rework_of_assignment_id ? (
                    <Badge label={t('quality.goToRework')} tone="warning" />
                  ) : null}
                </View>
              </Card>

              {/*
                The facts this screen used to leave out.

                It rendered hotel, day, status and a rooms input -- about four
                of the ~20 fields the DTO carries -- and the owner reported the
                assignment detail as "empty". Every row below is a field the
                API was already sending. Rows are omitted when the value is
                null rather than shown blank: "not recorded" and "empty" look
                identical, and only one of them is a bug worth chasing.
              */}
              <Card>
                <SectionHeader title={t('assignments.placementDetails')} />
                {data.worker_name ? (
                  <DataRow title={t('fields.worker')} meta={data.worker_name} />
                ) : null}
                {data.shift_start_time ? (
                  <DataRow
                    title={t('fields.time')}
                    meta={`${data.shift_start_time}${
                      data.shift_end_time ? `\u2013${data.shift_end_time}` : ''
                    }`}
                  />
                ) : null}
                {data.hotel?.address ? (
                  <DataRow
                    title={t('fields.hotel')}
                    meta={[data.hotel.address, data.hotel.city].filter(Boolean).join(', ')}
                  />
                ) : null}
                {data.assigned_by_name ? (
                  <DataRow title={t('assignments.assignedBy')} meta={data.assigned_by_name} />
                ) : null}
                {data.started_at ? (
                  <DataRow title={t('assignments.started')} meta={formatDateTime(data.started_at)} />
                ) : null}
                {data.completed_at ? (
                  <DataRow
                    title={t('status.completed')}
                    meta={formatDateTime(data.completed_at)}
                  />
                ) : null}
                {data.cancelled_at ? (
                  <DataRow
                    title={t('status.cancelled')}
                    meta={formatDateTime(data.cancelled_at)}
                  />
                ) : null}
                {/* The reason a manager typed. It was collected, made
                    mandatory, and then discarded before the request -- so it
                    could never appear here until now. */}
                {data.cancellation_reason ? (
                  <DataRow title={t('fields.reason')} meta={data.cancellation_reason} />
                ) : null}
                {data.rooms_completed ? (
                  <DataRow
                    title={t('assignments.roomsCompleted')}
                    meta={String(data.rooms_completed.rooms_completed)}
                    subtitle={
                      data.rooms_completed.entered_by_name
                        ? `${t('assignments.loggedBy')}: ${data.rooms_completed.entered_by_name}`
                        : undefined
                    }
                  />
                ) : null}
                {data.rooms_completed?.notes ? (
                  <DataRow title={t('fields.notes')} meta={data.rooms_completed.notes} />
                ) : null}
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
                label={t('assignments.reassignTitle')}
                variant="ghost"
                onPress={() => setReassignOpen(true)}
              />
              <Button
                label={t('assignments.cancelTitle')}
                variant="danger"
                onPress={() => setCancelOpen(true)}
              />
            </>
          )}
        </ScrollView>

        <ReassignSheet
          visible={reassignOpen}
          busy={busy}
          onClose={() => setReassignOpen(false)}
          onSubmit={(workerId) => {
            setReassignOpen(false);
            void run(
              () => api.assignments.reassign(String(id), workerId),
              'fields.updated'
            );
          }}
        />

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
            // The reason goes WITH the status change. `void reason` stood
            // here until 2026-09-23, so a mandatory field the manager filled
            // in never left the device, and UpdateAssignmentSchema had
            // accepted `cancellation_reason` the whole time.
            void run(
              () => api.assignments.updateStatus(String(id), 'CANCELLED', reason),
              'fields.updated'
            );
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
