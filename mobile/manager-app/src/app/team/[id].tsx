import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

/**
 * One team member.
 *
 * Read-first. The employment record is shown, and every lifecycle action on
 * it is a NAMED TRANSITION rather than a field edit -- ADR-030 D-4b is
 * explicit that manager authority here is expressed only as discrete
 * workflow actions, and that no manager-editable field set exists or may be
 * introduced by inference from `employees:write`.
 *
 * So there is deliberately no "edit employment record" form on this screen.
 * Profile fields (name, phone) are a different entity with a different
 * owner and are editable; identity, legal, payroll, tax and employment terms
 * are Admin-owned and are not.
 */
export default function TeamMember() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const user = useSWR(id ? ['user', id] : null, () => api.users.get(String(id)));
  const employment = useSWR(id ? ['employment', id] : null, () =>
    api.employee.getByUserId(String(id))
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('nav.users')} />

          {user.isLoading ? (
            <SkeletonList rows={4} />
          ) : user.error || !user.data ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : (
            <>
              <Card>
                <ThemedText type="h2">
                  {`${user.data.first_name} ${user.data.last_name}`.trim() || user.data.email}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {user.data.email}
                </ThemedText>
                <View style={styles.badges}>
                  <Badge label={user.data.role} tone="neutral" />
                  {user.data.employment_status ? (
                    <Badge label={user.data.employment_status} tone="primary" />
                  ) : null}
                </View>
              </Card>

              <SectionHeader title={t('hr.title')} />
              <Button
                label={t('hr.contract')}
                variant="ghost"
                onPress={() =>
                  router.push({
                    pathname: '/team/contract',
                    params: { workerId: String(id) },
                  })
                }
              />
              <Button
                label={t('nav.docs')}
                variant="ghost"
                onPress={() => router.push('/documents')}
              />

              <SectionHeader title={t('nav.onboarding')} />
              {employment.data ? (
                <Card>
                  <ThemedText type="small">{employment.data.job_title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {employment.data.status} · {employment.data.start_date}
                  </ThemedText>
                </Card>
              ) : (
                <EmptyState title={t('onboarding.noRecordFound')} />
              )}
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
