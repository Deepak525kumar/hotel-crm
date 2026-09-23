import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  BottomTabInset,
  Button,
  Card,
  LanguagePicker,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  Spacing,
  ThemePicker,
  ThemedText,
  ThemedView,
  UserAvatar,
  api,
  scopeOf,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

import { ExportRow } from '@/components/ExportRow';
import { roleLabelKey } from '@/lib/creatable-roles';

/**
 * The manager's own account.
 *
 * Added 2026-09-23 as the fifth tab. The worker and checker apps put profile
 * and its actions on one screen; here the actions live in More, so this page
 * spends its whole height on the account itself — who you are, what you can
 * see, and the settings that were previously buried behind a menu row.
 *
 * SETTINGS LIVE HERE AND NOWHERE ELSE. Theme, language and the data exports
 * were a separate `/settings` route reachable from More, which meant two
 * places to look for one thing.
 *
 * The resolved SCOPE is stated plainly, because it is the single fact that
 * explains why two managers looking at the same screen see different numbers,
 * and nothing else in the app says it out loud.
 */
export default function Profile() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const scope = scopeOf(user);

  // The manager's own employment record, when they have one. Absent for an
  // admin who was never onboarded, which is normal rather than an error.
  const employment = useSWR(user ? ['employment', user.id] : null, () =>
    api.employee.getByUserId(String(user?.id))
  );

  const name = `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || user?.email || '';

  const scopeLabel =
    scope.kind === 'global'
      ? t('analytics.platformOverview')
      : scope.kind === 'group'
        ? t('nav.hotelGroups')
        : scope.kind === 'hotel'
          ? t('nav.hotels')
          : t('status.unassigned');

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={t('nav.profile')} />

          <Card>
            <View style={styles.identity}>
              <UserAvatar
                userId={user?.id ?? ''}
                name={name}
                hasPhoto={user?.has_profile_photo}
                size={64}
              />
              <View style={styles.identityText}>
                <ThemedText type="h2" numberOfLines={1}>
                  {name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {user?.email}
                </ThemedText>
                <View style={styles.badges}>
                  {user?.role ? <Badge label={t(roleLabelKey(user.role))} tone="primary" /> : null}
                  <Badge label={scopeLabel} tone="neutral" />
                </View>
              </View>
            </View>
          </Card>

          {employment.data ? (
            <Card>
              <SectionHeader title={t('nav.onboarding')} />
              <Detail label={t('fields.jobTitle')} value={employment.data.job_title} />
              <Detail label={t('fields.status')} value={employment.data.status} />
              <Detail label={t('fields.date')} value={employment.data.start_date} />
            </Card>
          ) : null}

          <SectionHeader title={t('settings.appearance')} />
          <ThemePicker />

          <SectionHeader title={t('settings.language.title')} />
          <LanguagePicker />

          <SectionHeader title={t('settings.exportData')} />
          {/*
            The TEAM export moved to /reports (2026-09-23).

            It stood here as a single row that sent `{ dataset: 'attendance' }`
            and nothing else — no `format`, no date range, all three of which
            the endpoint requires. It could therefore never succeed, and
            because the route used a bare `.parse()` it failed as a 500, so it
            read as the server being broken rather than the request being
            incomplete. The reports screen sends a complete body and reaches
            all four datasets; only the personal export belongs on this tab.
          */}
          <Button
            label={t('nav.reports')}
            variant="ghost"
            onPress={() => router.push('/reports')}
          />
          <ExportRow label={t('settings.exportDataShort')} run={() => api.reports.exportMine()} />

          <Button
            label={t('nav.notifications')}
            variant="ghost"
            onPress={() => router.push('/notifications')}
          />
          <Button label={t('nav.logout')} variant="danger" onPress={() => void logout()} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.detailValue} numberOfLines={2}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: BottomTabInset,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  identity: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  identityText: { flex: 1, flexShrink: 1, minWidth: 0, gap: 2 },
  badges: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', marginTop: Spacing.one },
  detail: { flexDirection: 'row', gap: Spacing.three, paddingVertical: Spacing.one },
  detailLabel: { width: 110, flexShrink: 0 },
  detailValue: { flex: 1, flexShrink: 1, minWidth: 0 },
});
