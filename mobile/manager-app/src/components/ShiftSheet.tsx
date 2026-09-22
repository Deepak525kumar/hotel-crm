import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  BottomSheet,
  Button,
  SectionHeader,
  Spacing,
  ThemedText,
  api,
} from '@hotel-crm/mobile-shared';

import { assignmentTone, formatDateTime } from '@/lib/assignment-format';
import { attendanceStatusLabel } from '@/lib/attendance-format';

/**
 * Everything about one placement, and what can be done to it.
 *
 * The rota previously rendered a worker id and nothing was tappable, so a
 * shift on the calendar was a dead end: you could see that somebody was on,
 * and learn nothing else without leaving for the assignments list and
 * searching. Reported by the project owner as "I am not able to click on that
 * shift. So how will I get information?".
 *
 * The placement itself is thin — ids, a day, a status. The DETAIL lives on
 * the assignment it created, so this fetches that and shows both: who and
 * where from the directory, times and status from the assignment, and the
 * actions that apply.
 *
 * Actions NAVIGATE rather than mutate in place. Reassigning and cancelling
 * both need their own confirmation and their own reason, and duplicating
 * those flows inside a sheet would mean two implementations of a destructive
 * write that must behave identically.
 */
export function ShiftSheet({
  visible,
  entry,
  workerName,
  hotelName,
  onClose,
  onMove,
}: {
  visible: boolean;
  entry: {
    id: string;
    assignment_id: string;
    worker_id: string;
    hotel_id: string;
    day: string;
    assignment_status?: string;
  } | null;
  workerName: (id: string) => string;
  hotelName: (id: string) => string;
  onClose: () => void;
  onMove: () => void;
}) {
  const { t } = useTranslation();

  // Only fetched while the sheet is open: the agenda can hold thirty of these
  // and pre-loading every assignment would be thirty round trips on a hotel's
  // connection for information nobody has asked to see.
  const assignment = useSWR(
    visible && entry ? ['assignment', entry.assignment_id] : null,
    () => api.assignments.get(String(entry?.assignment_id))
  );

  if (!entry) return null;
  const a = assignment.data;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={workerName(entry.worker_id)}
      footer={
        <View style={styles.actions}>
          <Button
            label={t('calendar.viewDay')}
            variant="ghost"
            style={styles.action}
            onPress={() => {
              onClose();
              router.push(`/assignment/${entry.assignment_id}`);
            }}
          />
          <Button
            label={t('assignments.reassignTitle')}
            style={styles.action}
            onPress={() => {
              onClose();
              router.push(`/assignment/${entry.assignment_id}`);
            }}
          />
        </View>
      }
    >
      <View style={styles.badges}>
        {entry.assignment_status ? (
          <Badge
            label={entry.assignment_status}
            tone={assignmentTone(entry.assignment_status)}
          />
        ) : null}
        {a?.rework_of_assignment_id ? (
          <Badge label={t('quality.goToRework')} tone="warning" />
        ) : null}
      </View>

      <Row label={t('nav.hotels')} value={a?.hotel?.name ?? hotelName(entry.hotel_id)} />
      <Row label={t('fields.date')} value={entry.day} />
      <Row
        label={t('fields.startTime')}
        value={
          a?.shift_start_time
            ? `${a.shift_start_time}${a.shift_end_time ? ` – ${a.shift_end_time}` : ''}`
            : '—'
        }
      />
      <Row label={t('jobs.position')} value={a?.work_request?.position ?? '—'} />
      <Row label={t('fields.role')} value={a?.work_request?.target_role ?? '—'} />
      {a?.assigned_by_name ? (
        <Row label={t('assignments.title')} value={a.assigned_by_name} />
      ) : null}

      {/* Attendance, when the shift has started. An em dash where there is no
          record yet, never "absent" — not checked in and did not turn up are
          different facts and only one is a problem. */}
      <SectionHeader title={t('nav.attendance')} />
      {/* `attendance.checkedInAt` is "Checked in: {{time}}" -- a sentence,
          not a label; as a label it printed the literal "{{time}}". */}
      <Row
        label={t('assignments.checkInLabel')}
        value={a?.attendance?.check_in_at ? formatDateTime(a.attendance.check_in_at) : '—'}
      />
      <Row
        label={t('fields.status')}
        value={
          a?.attendance?.status ? attendanceStatusLabel(a.attendance.status, t) : '—'
        }
      />

      {/* `calendar.dragToMoveHint` is a HINT ("drag a shift to move it"),
          which read as a button caption. The button moves the shift; say so. */}
      <Button label={t('common.reassign')} variant="ghost" onPress={onMove} />
    </BottomSheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.rowValue} numberOfLines={2}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  row: { flexDirection: 'row', gap: Spacing.three, paddingVertical: Spacing.one },
  rowLabel: { width: 110, flexShrink: 0 },
  rowValue: { flex: 1, flexShrink: 1, minWidth: 0 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
