import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  Button,
  Card,
  Input,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SelectSheet,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  translateApiError,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import {
  SKILL_TAGS,
  isTimeOfDay,
  skillLinesValid,
  totalHeadcount,
  type SkillLine,
} from '@/lib/shift-form';
import { todayInBerlin } from '@/lib/today';

const NO_SKILL = '__none__';

/**
 * Raise a broadcast: one shift, several skill x headcount lines.
 *
 * The web lays the builder out as a grid of columns. At 375pt each line
 * becomes its own stacked row with a remove control, and the running total
 * sits in the footer where it is visible while typing — a manager asking for
 * 12 people across four skills should not have to add them up.
 *
 * `skill: null` is the "no specific skill required" slot, not a missing
 * value: the schema makes it nullable deliberately, so sending nothing is a
 * different and invalid request from sending null.
 */
export default function NewBroadcast() {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [hotelId, setHotelId] = useState<string | null>(null);
  const [date, setDate] = useState(todayInBerlin());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rate, setRate] = useState('');
  const [lines, setLines] = useState<SkillLine[]>([
    { id: '1', skill: 'CLEANER', headcount: '1' },
  ]);

  const hotels = useSWR('crm/hotels', () => api.crm.hotels());

  const timesValid = isTimeOfDay(start) && isTimeOfDay(end);
  const linesValid = skillLinesValid(lines);
  const ready = hotelId !== null && timesValid && linesValid;

  const submit = async () => {
    if (!ready || !hotelId || busy) return;
    setBusy(true);
    try {
      const created = await api.workRequests.createBroadcast({
        hotel_id: hotelId,
        target_role: 'WORKER',
        shift_date: date,
        shift_start_time: start.trim(),
        shift_end_time: end.trim(),
        ...(rate.trim() && Number(rate) > 0 ? { hourly_rate: Number(rate) } : {}),
        skills: lines.map((l) => ({ skill: l.skill, headcount: Number(l.headcount.trim()) })),
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
          <ScreenHeader
            title={t('requests.newBroadcast')}
            subtitle={t('requests.broadcastDescription')}
          />

          <Card>
            <SelectSheet
              label={t('nav.hotels')}
              value={hotelId}
              options={(hotels.data ?? [])
                .filter((h) => h.is_active)
                .map((h) => ({ value: h.id, label: h.name, hint: h.city }))}
              onChange={setHotelId}
            />
            <Input label={t('fields.date')} value={date} onChangeText={setDate} />
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
          </Card>

          <SectionHeader title={t('fields.skills')} />
          {lines.map((line, index) => (
            <Card key={line.id}>
              <SelectSheet
                label={t('fields.skills')}
                value={line.skill ?? NO_SKILL}
                options={[
                  { value: NO_SKILL, label: t('common.none') },
                  ...SKILL_TAGS.map((s) => ({ value: s, label: s })),
                ]}
                onChange={(next) =>
                  setLines((ls) =>
                    ls.map((l, i) =>
                      i === index
                        ? { ...l, skill: next === NO_SKILL ? null : (next as SkillLine['skill']) }
                        : l
                    )
                  )
                }
              />
              <Input
                label={t('fields.workersNeeded')}
                value={line.headcount}
                onChangeText={(next) =>
                  setLines((ls) => ls.map((l, i) => (i === index ? { ...l, headcount: next } : l)))
                }
                keyboardType="number-pad"
              />
              {lines.length > 1 ? (
                <Button
                  label={t('common.remove')}
                  variant="ghost"
                  onPress={() => setLines((ls) => ls.filter((_, i) => i !== index))}
                />
              ) : null}
            </Card>
          ))}

          <Button
            label={t('common.add')}
            variant="ghost"
            onPress={() =>
              setLines((ls) => [
                ...ls,
                { id: String(Date.now()), skill: null, headcount: '1' },
              ])
            }
          />

          {/* Two different reasons the lines can be unusable, and they need
              different fixes: a duplicate skill is not a richer request, it
              is two answers to the same question, and the schema does not
              forbid it. */}
          {!linesValid && lines.length > 0 ? (
            <ThemedText type="small" themeColor="danger">
              {t('common.required')}
            </ThemedText>
          ) : null}

          <View style={styles.footer}>
            <Badge label={String(totalHeadcount(lines))} tone="primary" />
            <Button
              label={t('common.save')}
              disabled={!ready}
              loading={busy}
              style={styles.action}
              onPress={() => void submit()}
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
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  action: { flex: 1 },
});
