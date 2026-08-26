import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BackLink } from '@/components/BackLink';
import { Card, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import type { EmploymentRecordDto } from '@/types/api';

/**
 * The worker's own record, reached by tapping their name on the profile tab.
 *
 * Everything here already existed on /auth/me and /employees/by-user; the app
 * simply never showed it, so a worker could not check the employee ID or start
 * date they were being asked for.
 */
function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value || '—'}</ThemedText>
    </View>
  );
}

export default function ProfileDetailsScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [record, setRecord] = useState<EmploymentRecordDto | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setRecord(await api.employee.getByUserId(user.id));
    } catch {
      // The identity block below is useful on its own; an unavailable
      // employment record must not blank the whole screen.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="title">{t('profile.myDetails')}</ThemedText>

          <SectionHeader title={t('profile.identity')} />
          <Card>
            <Row label={t('profile.name')} value={[user?.first_name, user?.last_name].filter(Boolean).join(' ')} />
            <Row label={t('profile.email')} value={user?.email} />
            <Row label={t('profile.role')} value={user?.role ? t(`roles.${user.role}`, user.role) : null} />
          </Card>

          <SectionHeader title={t('profile.employment')} />
          {loading ? (
            <ActivityIndicator />
          ) : (
            <Card>
              <Row label={t('profile.employeeId')} value={record?.employee_id} />
              <Row label={t('profile.jobTitle')} value={record?.job_title} />
              <Row label={t('profile.startDate')} value={record?.start_date} />
              <Row
                label={t('profile.employmentStatus')}
                value={record?.status ? t(`onboarding.status${record.status}`, record.status) : null}
              />
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.one, gap: Spacing.two },
});
