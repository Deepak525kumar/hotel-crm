import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  BottomSheet,
  Button,
  Input,
  SelectSheet,
  Spacing,
  ThemedText,
  api,
  type CalendarAbsenceKind,
} from '@hotel-crm/mobile-shared';

/**
 * Mark a worker sick or on vacation for a day.
 *
 * A REASON IS MANDATORY FOR VACATION and optional for SICK. That is a zod
 * `.refine` on the backend, not a nicety: omitting it returns 422, and this
 * client already shipped that bug once — every vacation request failed
 * because the field was missing from the request shape entirely.
 *
 * Enforced here so the manager is told which field is wanted, rather than
 * discovering it as a generic failure after the round trip.
 */
export function MarkAbsenceSheet({
  visible,
  day,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  day: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { worker_id: string; day: string; kind: CalendarAbsenceKind; reason?: string }) => void;
}) {
  const { t } = useTranslation();
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [kind, setKind] = useState<CalendarAbsenceKind>('SICK');
  const [reason, setReason] = useState('');

  const workers = useSWR(visible ? ['users', 'worker'] : null, () =>
    api.users.list({ role: 'worker', limit: 100 })
  );

  const reasonRequired = kind === 'VACATION';
  const ready = workerId !== null && (!reasonRequired || reason.trim().length > 0);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('calendar.markAbsentTitle')}
      footer={
        <View style={styles.actions}>
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} style={styles.action} />
          <Button
            label={t('calendar.markAbsentAction')}
            disabled={!ready}
            loading={busy}
            style={styles.action}
            onPress={() =>
              workerId &&
              onSubmit({
                worker_id: workerId,
                day,
                kind,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              })
            }
          />
        </View>
      }
    >
      <ThemedText type="small" themeColor="textSecondary">
        {day}
      </ThemedText>

      <SelectSheet
        label={t('fields.worker')}
        value={workerId}
        options={(workers.data ?? []).map((w) => ({
          value: w.id,
          label: `${w.first_name} ${w.last_name}`.trim() || w.email,
        }))}
        onChange={setWorkerId}
      />

      <SelectSheet
        label={t('fields.type')}
        value={kind}
        options={[
          { value: 'SICK', label: t('calendar.sick') },
          { value: 'VACATION', label: t('calendar.onVacation') },
        ]}
        onChange={(next) => setKind(next as CalendarAbsenceKind)}
      />

      <Input
        label={t('fields.reason')}
        value={reason}
        onChangeText={setReason}
        multiline
        autoCapitalize="sentences"
        autoCorrect
        error={
          reasonRequired && reason.trim().length === 0
            ? t('calendar.reasonRequiredVacation')
            : undefined
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
