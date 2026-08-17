import { StyleSheet, ScrollView, Pressable, ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { WorkRequest } from '@/types/api';
import { useTranslation } from 'react-i18next';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={styles.infoRow} type="backgroundElement">
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

export default function JobDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<WorkRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.workRequests.get(id).then(setJob).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!job) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="small" themeColor="textSecondary">{t('jobs.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <ThemedText type="small" themeColor="textSecondary">← Back</ThemedText>
        </Pressable>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle" style={styles.title}>{job.position}</ThemedText>
          {job.hotel && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.hotelName}>
              {job.hotel.name}
            </ThemedText>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <InfoRow
              label={t('fields.date')}
              value={new Date(job.shift_date).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              })}
            />
            <View style={styles.divider} />
            <InfoRow label={t('fields.time')} value={`${job.shift_start_time} – ${job.shift_end_time}`} />
            <View style={styles.divider} />
            <InfoRow label={t('fields.pay')} value={job.hourly_rate ? `$${job.hourly_rate}/hr` : 'TBD'} />
            <View style={styles.divider} />
            <InfoRow label={t('jobs.spots')} value={`${job.workers_confirmed}/${job.workers_needed} filled`} />
            <View style={styles.divider} />
            <InfoRow label={t('fields.status')} value={job.status.replace(/_/g, ' ')} />
          </ThemedView>

          {job.description ? (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>{t("fields.description")}</ThemedText>
              <ThemedView type="backgroundElement" style={styles.descCard}>
                <ThemedText type="small">{job.description}</ThemedText>
              </ThemedView>
            </>
          ) : null}

          {job.status !== 'OPEN' && job.status !== 'PARTIALLY_FILLED' && (
            <ThemedView type="backgroundElement" style={styles.closedBanner}>
              <ThemedText type="small" themeColor="textSecondary">{t("jobs.noLongerOpen")}</ThemedText>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  back: { marginBottom: Spacing.three },
  scroll: { paddingBottom: Spacing.six },
  title: { marginBottom: Spacing.one },
  hotelName: { marginBottom: Spacing.three },
  section: { borderRadius: Spacing.two, overflow: 'hidden', marginBottom: Spacing.three },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  divider: { height: 1, backgroundColor: '#E0E1E6', marginHorizontal: Spacing.three },
  sectionLabel: { marginBottom: Spacing.two, textTransform: 'uppercase', letterSpacing: 0.8 },
  descCard: { borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.three },
  closedBanner: { borderRadius: Spacing.two, padding: Spacing.three, alignItems: 'center' },
});
