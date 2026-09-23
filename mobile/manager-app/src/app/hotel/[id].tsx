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
  DataRow,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  StatTile,
  ThemedText,
  ThemedView,
  api,
  translateApiError,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { BlocklistSheet } from '@/components/BlocklistSheet';
import { percent, score } from '@/lib/format-metrics';

/**
 * One hotel: today's numbers, and who is barred from it.
 *
 * READ-ONLY on the hotel record. Create, edit, archive and restore are master
 * data and Admin-only (ADR-030 D-2/D-3), so none of those controls exist here
 * for anyone — an admin uses the Archive screen, which is a different job.
 *
 * The blocklist IS a manager capability (C-22, `employees:write`), and it is
 * the one destructive thing on this screen: it bars a named person from a
 * named property.
 */
export default function HotelDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);

  const hotel = useSWR(id ? ['hotel', id] : null, () => api.crm.hotel(String(id)));
  const summary = useSWR(id ? ['hotel-summary', id] : null, () =>
    api.analytics.hotelSummary(String(id))
  );
  const blocklist = useSWR(id ? ['blocklist', id] : null, () =>
    api.employee.blocklist(String(id))
  );

  const block = useCallback(
    async (input: { employee_id: string; reason: string }) => {
      if (!id || busy) return;
      setBusy(true);
      try {
        await api.employee.addToBlocklist(String(id), input);
        await blocklist.mutate();
        setBlocking(false);
        toast.show(t('fields.updated'), 'success');
      } catch (e) {
        toast.show(translateApiError(e, t), 'danger');
      } finally {
        setBusy(false);
      }
    },
    [id, busy, blocklist, toast, t]
  );

  const s = summary.data;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={hotel.data?.name ?? t('nav.hotels')} subtitle={hotel.data?.city} />

          {hotel.isLoading ? (
            <SkeletonList rows={4} />
          ) : hotel.error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : (
            <>
              <Card>
                <View style={styles.badges}>
                  <Badge
                    label={hotel.data?.is_active ? t('status.active') : t('status.inactive')}
                    tone={hotel.data?.is_active ? 'success' : 'neutral'}
                  />
                  {/* A live hotel can still be closed to new work -- two
                      different facts, and a manager placing staff needs the
                      second one. */}
                  {hotel.data?.is_active && hotel.data.accepting_jobs === false ? (
                    <Badge label={t('requests.notAcceptingNew')} tone="warning" />
                  ) : null}
                </View>

                {/*
                  The property itself (2026-09-23).

                  This screen showed a name, a city and a badge. The server has
                  always sent the whole row -- address, country, timezone,
                  contacts -- but the client's `Hotel` type declared five
                  fields, so a manager sending someone to a hotel could not see
                  where it was or who to call. Rows omitted when null rather
                  than rendered blank.
                */}
                {hotel.data?.address ? (
                  <DataRow
                    title={t('fields.address')}
                    meta={[hotel.data.address, hotel.data.city, hotel.data.country]
                      .filter(Boolean)
                      .join(', ')}
                  />
                ) : null}
                {hotel.data?.hotel_group?.name ? (
                  <DataRow title={t('fields.hotelGroup')} meta={hotel.data.hotel_group.name} />
                ) : null}
                {hotel.data?.contact_phone ? (
                  <DataRow title={t('fields.phone')} meta={hotel.data.contact_phone} />
                ) : null}
                {hotel.data?.contact_email ? (
                  <DataRow title={t('fields.email')} meta={hotel.data.contact_email} />
                ) : null}
                {hotel.data?.timezone ? (
                  <DataRow title={t('fields.timezone')} meta={hotel.data.timezone} />
                ) : null}
                <View style={styles.tiles}>
                  <StatTile
                    label={t('analytics.openRequests')}
                    value={String(s?.open_requests.count ?? 0)}
                  />
                  <StatTile
                    label={t('nav.assignments')}
                    value={String(s?.active_assignments ?? 0)}
                  />
                </View>
                <View style={styles.tiles}>
                  <StatTile
                    label={t('status.present')}
                    value={String(s?.today_attendance.present ?? 0)}
                  />
                  <StatTile
                    label={t('status.absent')}
                    value={String(s?.today_attendance.absent ?? 0)}
                  />
                </View>
                <View style={styles.tiles}>
                  {/* score(), not percent(): a null average means nothing has
                      been inspected, which is not a score of zero. */}
                  <StatTile
                    label={t('analytics.averageRating')}
                    value={score(s?.quality.average_score)}
                  />
                  <StatTile
                    label={t('analytics.qualityPassRate')}
                    value={percent(s?.quality.recent_pass_rate)}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('assignments.roomsCompleted')}: {s?.rooms_completed.total ?? 0}
                </ThemedText>
              </Card>

              <SectionHeader
                title={t('employees.addToBlocklistTitle')}
                action={
                  <Button
                    label={t('common.add')}
                    variant="ghost"
                    onPress={() => setBlocking(true)}
                  />
                }
              />
              {(blocklist.data ?? []).length === 0 ? (
                <EmptyState title={t('employees.noBlocked')} />
              ) : (
                (blocklist.data ?? []).map((entry) => (
                  <DataRow
                    key={entry.id}
                    title={entry.worker_name ?? entry.employee_id ?? entry.employment_record_id}
                    subtitle={entry.reason ?? undefined}
                  />
                ))
              )}
            </>
          )}
        </ScrollView>

        <BlocklistSheet
          visible={blocking}
          busy={busy}
          onClose={() => setBlocking(false)}
          onSubmit={(input) => void block(input)}
        />
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
  badges: { flexDirection: 'row', gap: Spacing.two },
  tiles: { flexDirection: 'row', gap: Spacing.three },
});
