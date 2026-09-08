import { useState } from 'react';
import { ActivityIndicator, Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ListRow } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * "Export my data" — the GDPR Article 15/20 right of access and portability.
 *
 * OFFERED TO EVERY USER, with no role check anywhere in this component. This
 * is a legal right, not a management feature, and the backend token
 * (`reports:export-own`) is held by every role for exactly that reason.
 * Workers and checkers are also the people least likely to be handed their
 * own record any other way.
 *
 * HANDS THE URL TO THE OS rather than downloading bytes. The server builds
 * the workbook, stores it, and returns a short-lived presigned link;
 * `Linking.openURL` lets the platform's own download and share sheet handle
 * it. A phone should not hold a year of somebody's history in memory, and an
 * .xlsx is not something this app can usefully display anyway.
 *
 * A NULL URL IS A REAL STATE (storage unconfigured server-side) and is
 * reported as itself, never as a link that leads nowhere.
 */
export function ExportMyDataRow({ last }: { last?: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return; // a second tap would build and store a second workbook
    setBusy(true);
    try {
      const report = await api.reports.exportMine();

      if (!report.url) {
        Alert.alert(
          t('settings.exportData', 'Your data'),
          t(
            'settings.exportDataNoStorage',
            'Your file was prepared, but file storage is not set up on this server, so there is no download link. Please tell an administrator.'
          )
        );
        return;
      }

      const opened = await Linking.canOpenURL(report.url);
      if (!opened) {
        // Better to say the link cannot be opened than to call openURL and
        // have nothing visibly happen.
        Alert.alert(
          t('settings.exportData', 'Your data'),
          t('settings.exportDataCannotOpen', 'Your file is ready but this device could not open the link.')
        );
        return;
      }
      await Linking.openURL(report.url);
    } catch (error) {
      Alert.alert(
        t('settings.exportData', 'Your data'),
        error instanceof Error ? error.message : t('common.unknownError', 'Something went wrong.')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ListRow
      title={t('settings.exportDataAction', 'Export my data')}
      subtitle={t(
        'settings.exportDataShort',
        'Your shifts, attendance, absences and rooms, as a spreadsheet'
      )}
      onPress={run}
      last={last}
      right={
        busy ? (
          <ActivityIndicator size="small" />
        ) : (
          <ThemedText themeColor="textSecondary">›</ThemedText>
        )
      }
    />
  );
}
