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
} from '@hotel-crm/mobile-shared';

/**
 * Bar an employee from a hotel.
 *
 * A REASON IS MANDATORY — `SetBlocklistSchema` requires min(1), and rightly:
 * this bars a named person from a named property, and the reason is the only
 * record of why. Enforced before the round trip so the manager is told which
 * field is wanted rather than reading a 422.
 *
 * The employee list comes from `/users`, scoped server-side, so a manager
 * cannot block someone outside their own scope even by id.
 */
export function BlocklistSheet({
  visible,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { employee_id: string; reason: string }) => void;
}) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const people = useSWR(visible ? ['users', 'blocklist'] : null, () =>
    api.users.list({ limit: 100 })
  );

  const ready = employeeId !== null && reason.trim().length > 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('employees.addToBlocklistTitle')}
      footer={
        <View style={styles.actions}>
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} style={styles.action} />
          <Button
            label={t('common.add')}
            variant="danger"
            disabled={!ready}
            loading={busy}
            style={styles.action}
            onPress={() => employeeId && onSubmit({ employee_id: employeeId, reason: reason.trim() })}
          />
        </View>
      }
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t('employees.noBlockedDescription')}
      </ThemedText>

      <SelectSheet
        label={t('fields.worker')}
        value={employeeId}
        options={(people.data ?? []).map((u) => ({
          value: u.id,
          label: `${u.first_name} ${u.last_name}`.trim() || u.email,
        }))}
        onChange={setEmployeeId}
      />

      <Input
        label={t('fields.reason')}
        value={reason}
        onChangeText={setReason}
        multiline
        autoCapitalize="sentences"
        autoCorrect
        error={reason.trim().length === 0 ? t('common.required') : undefined}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
