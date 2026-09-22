import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
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
  api,
  scopeOf,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { ExportRow } from '@/components/ExportRow';

export default function Settings() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const scope = scopeOf(user);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('nav.settings')} />

          <Card>
            <ThemedText type="smallBold">
              {`${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || user?.email}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {user?.email}
            </ThemedText>
            {/* The resolved scope, said plainly. Three people see three
                different datasets on every screen in this app; without this
                the figures are ambiguous in a way that matters. */}
            <ThemedText type="small" themeColor="textSecondary">
              {user?.role} · {scope.kind}
            </ThemedText>
          </Card>

          <SectionHeader title={t('settings.appearance')} />
          <ThemePicker />

          <SectionHeader title={t('settings.language.title')} />
          <LanguagePicker />

          <SectionHeader title={t('settings.exportData')} />
          {/* Export only, no on-screen table (owner decision 2026-09-22): a
              phone is a poor place to read a report and a good place to send
              one. Both of these end at the share sheet. */}
          <ExportRow
            label={t('settings.exportDataAction')}
            run={() => api.reports.exportTeam({ dataset: 'attendance' })}
          />
          <ExportRow label={t('settings.exportDataShort')} run={() => api.reports.exportMine()} />

          <Button label={t('nav.logout')} variant="danger" onPress={() => void logout()} />
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
});
