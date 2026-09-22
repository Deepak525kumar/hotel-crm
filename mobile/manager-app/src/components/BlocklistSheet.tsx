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
  const [userId, setUserId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = useSWR(visible ? ['users', 'blocklist'] : null, () =>
    api.users.list({ limit: 100 })
  );

  const ready = userId !== null && reason.trim().length > 0;

  /**
   * The picker lists USERS; the blocklist route is keyed by the
   * employee-management-owned `employee_id` ("EMP-W-001"). Sending the user
   * cuid here 404'd on EVERY add (2026-09-23) -- `findRecordOrThrow` looks up
   * `employmentRecord.employee_id`, which a cuid never matches.
   *
   * Resolved through the real lookup rather than by widening the user DTO:
   * /employees/by-user is the same call the web client makes, and it returns
   * null (not 404) for someone never onboarded -- which is exactly the case
   * worth telling the manager about, since such a person has no employment
   * record to bar.
   */
  const submit = async () => {
    if (!userId) return;
    setResolving(true);
    setError(null);
    try {
      const record = await api.employee.getByUserId(userId);
      if (!record?.employee_id) {
        setError(t('employees.noRecordFound'));
        return;
      }
      onSubmit({ employee_id: record.employee_id, reason: reason.trim() });
    } catch {
      setError(t('errors.generic'));
    } finally {
      setResolving(false);
    }
  };

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
            loading={busy || resolving}
            style={styles.action}
            onPress={submit}
          />
        </View>
      }
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t('employees.noBlockedDescription')}
      </ThemedText>

      <SelectSheet
        label={t('fields.worker')}
        value={userId}
        options={(people.data ?? []).map((u) => ({
          value: u.id,
          label: `${u.first_name} ${u.last_name}`.trim() || u.email,
        }))}
        onChange={setUserId}
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

      {error ? (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
