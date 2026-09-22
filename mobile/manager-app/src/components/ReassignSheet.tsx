import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  BottomSheet,
  Button,
  SelectSheet,
  Spacing,
  ThemedText,
  api,
} from '@hotel-crm/mobile-shared';

/**
 * Move an assignment to a different worker.
 *
 * Reassigning does not delete the old assignment — the backend chains them
 * via `previous_assignment_id`, so the original stays as history. A manager
 * looking for "what happened to Anna's shift" finds it, rather than finding
 * nothing.
 *
 * The worker list is `/users` scoped server-side, so this cannot offer
 * someone outside the manager's own scope.
 */
export function ReassignSheet({
  visible,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (workerId: string) => void;
}) {
  const { t } = useTranslation();
  const [workerId, setWorkerId] = useState<string | null>(null);

  const workers = useSWR(visible ? ['users', 'worker'] : null, () =>
    api.users.list({ role: 'worker', limit: 100 })
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('assignments.reassignTitle')}
      footer={
        <View style={styles.actions}>
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} style={styles.action} />
          <Button
            label={t('common.save')}
            disabled={workerId === null}
            loading={busy}
            style={styles.action}
            onPress={() => workerId && onSubmit(workerId)}
          />
        </View>
      }
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t('assignments.reassignTitle')}
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
