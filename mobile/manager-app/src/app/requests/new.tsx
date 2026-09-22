import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Button,
  Card,
  Input,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SelectSheet,
  Spacing,
  ThemedView,
  api,
  translateApiError,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { isPositiveInt, isTimeOfDay } from '@/lib/shift-form';
import { todayInBerlin } from '@/lib/today';

/**
 * Raise a work request.
 *
 * SAVE DRAFT AND PUBLISH ARE BOTH OFFERED, because `status` defaults to DRAFT
 * server-side — publishing is the explicit act, not the default. Collapsing
 * them into one button would publish every request the moment it was typed,
 * which is the opposite of what the API assumes.
 */
export default function NewRequest() {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [hotelId, setHotelId] = useState<string | null>(null);
  const [targetRole, setTargetRole] = useState<'WORKER' | 'CHECKER'>('WORKER');
  const [position, setPosition] = useState('');
  const [needed, setNeeded] = useState('1');
  const [date, setDate] = useState(todayInBerlin());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rate, setRate] = useState('');
  const [description, setDescription] = useState('');

  const hotels = useSWR('crm/hotels', () => api.crm.hotels());

  const timesValid = isTimeOfDay(start) && isTimeOfDay(end);
  const ready = hotelId !== null && position.trim().length > 0 && isPositiveInt(needed) && timesValid;

  const submit = async (status: 'DRAFT' | 'OPEN') => {
    if (!ready || !hotelId || busy) return;
    setBusy(true);
    try {
      const created = await api.workRequests.create({
        hotel_id: hotelId,
        target_role: targetRole,
        position: position.trim(),
        workers_needed: Number(needed.trim()),
        shift_date: date,
        shift_start_time: start.trim(),
        shift_end_time: end.trim(),
        // Omitted entirely rather than sent as 0 or '': the schema marks both
        // optional, and a 0 rate is a different claim from "unspecified".
        ...(rate.trim() && Number(rate) > 0 ? { hourly_rate: Number(rate) } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        status,
      });
      toast.show(t('fields.updated'), 'success');
      router.replace(`/request/${created.id}`);
    } catch (e) {
      toast.show(translateApiError(e, t), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BackLink />
          <ScreenHeader title={t('requests.newTitle')} subtitle={t('requests.newDescription')} />

          <Card>
            <SelectSheet
              label={t('nav.hotels')}
              value={hotelId}
              options={(hotels.data ?? [])
                .filter((h) => h.is_active)
                .map((h) => ({ value: h.id, label: h.name, hint: h.city }))}
              onChange={setHotelId}
            />
            <SelectSheet
              label={t('fields.role')}
              value={targetRole}
              options={[
                { value: 'WORKER', label: t('roles.worker') },
                { value: 'CHECKER', label: t('roles.checker') },
              ]}
              onChange={(next) => setTargetRole(next as 'WORKER' | 'CHECKER')}
            />
            <Input
              label={t('jobs.position')}
              value={position}
              onChangeText={setPosition}
              autoCapitalize="sentences"
            />
            <Input
              label={t('fields.workersNeeded')}
              value={needed}
              onChangeText={setNeeded}
              keyboardType="number-pad"
              error={needed.trim() && !isPositiveInt(needed) ? t('common.required') : undefined}
            />
          </Card>

          <SectionHeader title={t('fields.date')} />
          <Card>
            <Input label={t('fields.date')} value={date} onChangeText={setDate} />
            {/* HH:MM, 24-hour. '9:00' and '24:00' both look right and are
                rejected by the backend's regex, so the hint is the format
                rather than a vague "invalid". */}
            <Input
              label={t('fields.startTime')}
              value={start}
              onChangeText={setStart}
              placeholder="08:00"
              error={start.trim() && !isTimeOfDay(start) ? 'HH:MM' : undefined}
            />
            <Input
              label={t('fields.endTime')}
              value={end}
              onChangeText={setEnd}
              placeholder="16:00"
              error={end.trim() && !isTimeOfDay(end) ? 'HH:MM' : undefined}
            />
            <Input
              label={t('fields.hourlyRate')}
              value={rate}
              onChangeText={setRate}
              keyboardType="decimal-pad"
            />
            <Input
              label={t('fields.description')}
              value={description}
              onChangeText={setDescription}
              multiline
              autoCapitalize="sentences"
              autoCorrect
            />
          </Card>

          <View style={styles.actions}>
            <Button
              label={t('requests.saveDraft')}
              variant="ghost"
              disabled={!ready}
              loading={busy}
              style={styles.action}
              onPress={() => void submit('DRAFT')}
            />
            <Button
              label={t('requests.published')}
              disabled={!ready}
              loading={busy}
              style={styles.action}
              onPress={() => void submit('OPEN')}
            />
          </View>
        </ScrollView>
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
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
