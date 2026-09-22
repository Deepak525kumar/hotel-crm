import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet, Button, Input, Spacing, ThemedText } from '@hotel-crm/mobile-shared';

const FIELDS = [
  { key: 'total_rooms', label: 'calendar.dailySummary' },
  { key: 'stay_over_rooms', label: 'rooms.title' },
  { key: 'checkout_rooms', label: 'rooms.todayTitle' },
  { key: 'total_people_working', label: 'calendar.workersPlaced' },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

/**
 * The day's shift numbers for one hotel.
 *
 * The web lays these out as four number inputs side by side, which does not
 * fit 375pt — stacked here instead.
 *
 * Every field is a whole number and all four are required: the endpoint takes
 * four Ints, so a blank or decimal is a 422 the manager cannot interpret.
 * Validated before sending rather than after.
 */
export function ShiftSummarySheet({
  visible,
  day,
  initial,
  busy,
  onClose,
  onSave,
}: {
  visible: boolean;
  day: string;
  initial?: Partial<Record<FieldKey, number>> & { notes?: string | null };
  busy: boolean;
  onClose: () => void;
  onSave: (input: Record<FieldKey, number> & { notes?: string }) => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, initial?.[f.key]?.toString() ?? '']))
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const isWhole = (v: string) => /^\d+$/.test(v.trim());
  const ready = FIELDS.every((f) => isWhole(values[f.key] ?? ''));

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('calendar.editDailySummary')}
      footer={
        <View style={styles.actions}>
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} style={styles.action} />
          <Button
            label={t('common.save')}
            disabled={!ready}
            loading={busy}
            style={styles.action}
            onPress={() =>
              onSave({
                ...(Object.fromEntries(
                  FIELDS.map((f) => [f.key, Number(values[f.key].trim())])
                ) as Record<FieldKey, number>),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
              })
            }
          />
        </View>
      }
    >
      <ThemedText type="small" themeColor="textSecondary">
        {day}
      </ThemedText>

      {FIELDS.map((field) => (
        <Input
          key={field.key}
          label={t(field.label)}
          value={values[field.key] ?? ''}
          onChangeText={(next) => setValues((v) => ({ ...v, [field.key]: next }))}
          keyboardType="number-pad"
          error={
            (values[field.key] ?? '').trim() && !isWhole(values[field.key])
              ? t('calendar.roomsWholeNumber')
              : undefined
          }
        />
      ))}

      <Input
        label={t('fields.notes')}
        value={notes}
        onChangeText={setNotes}
        multiline
        autoCapitalize="sentences"
        autoCorrect
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
