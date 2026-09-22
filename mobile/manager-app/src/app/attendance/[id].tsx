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
  EmptyState,
  Input,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SelectSheet,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  translateApiError,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { attendanceTone, personName } from '@/lib/attendance-format';

const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'PARTIAL', 'EXCUSED'] as const;

/**
 * Verify or correct one attendance record.
 *
 * `PATCH /attendance/:id` has NO route-level role gate -- the service is the
 * entire authorization boundary. This screen is therefore a new caller of a
 * route whose only guard is downstream, which is exactly the shape worth
 * stating: the client gate here mirrors what the web sends, and a manager of
 * another hotel is refused by the service, not by this file.
 *
 * `verified_by` is never sent. The server derives the actor from the token;
 * a client that supplied it would be asserting its own identity.
 */
export default function AttendanceDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, error, isLoading, mutate } = useSWR(id ? ['attendance', id] : null, () =>
    api.attendance.get(String(id))
  );

  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const save = useCallback(
    async (markVerified: boolean) => {
      if (!id || busy) return;
      setBusy(true);
      try {
        await api.attendance.updateRecord(String(id), {
          ...(status ? { status: status as (typeof STATUSES)[number] } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(markVerified ? { is_verified: true } : {}),
        });
        await mutate();
        setNotes('');
        toast.show(t('attendance.verifiedMark'), 'success');
      } catch (e) {
        toast.show(translateApiError(e, t), 'danger');
      } finally {
        setBusy(false);
      }
    },
    [id, busy, status, notes, mutate, toast, t]
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('attendance.reviewTitle')} />

          {isLoading ? (
            <SkeletonList rows={4} />
          ) : error || !data ? (
            <EmptyState title={t('attendance.loadFailed')} />
          ) : (
            <>
              <Card>
                <ThemedText type="h2">{personName(data)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {data.hotel?.name ?? data.hotel_id ?? ''}
                </ThemedText>
                <View style={styles.badges}>
                  <Badge
                    label={t(`attendance.status${data.status}`)}
                    tone={attendanceTone(data.status)}
                  />
                  <Badge
                    label={data.is_verified ? t('status.verified') : t('status.unverified')}
                    tone={data.is_verified ? 'success' : 'warning'}
                  />
                </View>
              </Card>

              <Card>
                <SectionHeader title={t('attendance.checkedInAt')} />
                <ThemedText type="small">{data.check_in_at ?? '—'}</ThemedText>
                <SectionHeader title={t('attendance.expectedStart')} />
                <ThemedText type="small">{data.expected_start ?? '—'}</ThemedText>
                <SectionHeader title={t('attendance.minutesLate')} />
                {/* An em dash for null, never 0: "not recorded" and "on time"
                    are different facts, and 0 asserts the second. */}
                <ThemedText type="small">{data.minutes_late ?? '—'}</ThemedText>
                {data.verified_by_name ? (
                  <>
                    <SectionHeader title={t('attendance.verifiedBy')} />
                    <ThemedText type="small">{data.verified_by_name}</ThemedText>
                  </>
                ) : null}
              </Card>

              <Card>
                <SelectSheet
                  label={t('fields.status')}
                  value={status ?? data.status}
                  options={STATUSES.map((s) => ({
                    value: s,
                    label: t(`attendance.status${s}`),
                  }))}
                  onChange={setStatus}
                />
                <Input
                  label={t('fields.notes')}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={t('attendance.verificationNotesPlaceholder')}
                  multiline
                  autoCapitalize="sentences"
                  autoCorrect
                />
                <Button
                  label={t('attendance.saveReview')}
                  variant="ghost"
                  loading={busy}
                  onPress={() => void save(false)}
                />
                <Button
                  label={t('attendance.markVerified')}
                  loading={busy}
                  onPress={() => void save(true)}
                />
              </Card>
            </>
          )}
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
  badges: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
});
