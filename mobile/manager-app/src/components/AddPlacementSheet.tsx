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

import { MAX_OCCURRENCES } from '@/lib/recurring';

/**
 * Place a worker on a day, optionally repeating weekly.
 *
 * The worker list is `role=worker`, scoped server-side — a manager receives
 * their hotel's workers and nobody else's, so this cannot offer someone they
 * may not place.
 */
export function AddPlacementSheet({
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
  onSubmit: (input: { workerId: string; hotelId: string; weeks: number }) => void;
}) {
  const { t } = useTranslation();
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [weeks, setWeeks] = useState('1');

  const workers = useSWR(visible ? ['users', 'worker'] : null, () =>
    api.users.list({ role: 'worker', limit: 100 })
  );
  const hotels = useSWR(visible ? 'crm/hotels' : null, () => api.crm.hotels());

  const parsedWeeks = Number(weeks.trim());
  const weeksValid =
    /^\d+$/.test(weeks.trim()) && parsedWeeks >= 1 && parsedWeeks <= MAX_OCCURRENCES;
  const ready = workerId !== null && hotelId !== null && weeksValid;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('calendar.placements')}
      footer={
        <View style={styles.actions}>
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} style={styles.action} />
          <Button
            label={t('common.save')}
            disabled={!ready}
            loading={busy}
            style={styles.action}
            onPress={() =>
              workerId &&
              hotelId &&
              onSubmit({ workerId, hotelId, weeks: parsedWeeks })
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
        label={t('nav.hotels')}
        value={hotelId}
        options={(hotels.data ?? [])
          .filter((h) => h.is_active)
          .map((h) => ({ value: h.id, label: h.name, hint: h.city }))}
        onChange={setHotelId}
      />

      <Input
        label={t('calendar.numberOfWeeks')}
        value={weeks}
        onChangeText={setWeeks}
        keyboardType="number-pad"
        // The cap is the web's, matched deliberately: a different limit here
        // would make the same form produce different rotas depending on which
        // client the manager happened to open.
        error={weeks.trim() && !weeksValid ? `1–${MAX_OCCURRENCES}` : undefined}
        hint={t('calendar.repeatWeekly')}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
