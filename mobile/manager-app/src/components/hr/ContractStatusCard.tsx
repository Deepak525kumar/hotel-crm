import { StyleSheet, ActivityIndicator, Pressable, Alert } from 'react-native';
import { ThemedText , ThemedView , useTheme , Spacing } from '@hotel-crm/mobile-shared';
import type { ContractDto } from '@hotel-crm/mobile-shared';
import { useTranslation } from 'react-i18next';
import { ContractDownloadError, downloadContract } from '@/lib/contract-download';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import { useState } from 'react';

export function ContractStatusCard({
  contract,
  loading,
  workerId,
  onUploadSuccess,
}: {
  contract: ContractDto | null;
  loading: boolean;
  workerId: string;
  onUploadSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { uri, outcome } = await downloadContract(workerId);
      if (outcome === 'saved') {
        // Sharing was unavailable, so the share sheet never opened. Say where
        // the file actually is rather than leaving the tap looking like a no-op.
        Alert.alert(t('common.done'), t('hr.contractSavedTo', { uri }));
      }
    } catch (e) {
      // Was `t('hr.dataLoadFailed')` for every failure, which is why this was
      // impossible to diagnose from the device: a missing native module, an
      // expired session and a server error all produced the same sentence.
      if (e instanceof ContractDownloadError && e.code === 'NATIVE_MODULE_MISSING') {
        Alert.alert(t('errors.title'), t('hr.contractModuleMissing', { module: e.detail ?? '' }));
      } else {
        const detail = e instanceof ContractDownloadError ? e.detail : undefined;
        Alert.alert(
          t('errors.title'),
          detail ? `${t('hr.contractDownloadFailed')}\n\n${detail}` : t('hr.contractDownloadFailed'),
        );
      }
    } finally {
      setDownloading(false);
    }
  };

  const { pending, uploading, pickFile, upload, error, clearPending } = useDocumentUpload(workerId, () => {
    Alert.alert(t('common.success'), t('documents.uploadSuccess', 'Contract uploaded successfully.'));
    onUploadSuccess?.();
  });

  if (loading) {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ActivityIndicator color={theme.text} style={styles.loader} />
      </ThemedView>
    );
  }

  if (!contract) {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold" style={styles.emptyTitle}>{t("hr.noActiveContract")}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDescription}>{t("hr.noContractYet")}</ThemedText>
      </ThemedView>
    );
  }

  const needsSignature = contract.status === 'PENDING';

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">{t('fields.status')}</ThemedText>
        <ThemedText type="smallBold" style={{ textTransform: 'capitalize' }}>
          {contract.status.toLowerCase()}
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.divider} type="backgroundSelected" />
      
      <ThemedView style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">{t('jobs.position')}</ThemedText>
        <ThemedText type="smallBold">{contract.position}</ThemedText>
      </ThemedView>
      <ThemedView style={styles.divider} type="backgroundSelected" />

      <ThemedView style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">{t('fields.startDate')}</ThemedText>
        <ThemedText type="small">{contract.start_date}</ThemedText>
      </ThemedView>
      
      {contract.end_date && (
        <>
          <ThemedView style={styles.divider} type="backgroundSelected" />
          <ThemedView style={styles.row}>
            <ThemedText type="small" themeColor="textSecondary">{t('fields.endDate')}</ThemedText>
            <ThemedText type="small">{contract.end_date}</ThemedText>
          </ThemedView>
        </>
      )}

      {needsSignature && (
        <ThemedView style={styles.actions}>
          <Pressable
            onPress={handleDownload}
            disabled={downloading || uploading}
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: theme.backgroundSelected, opacity: pressed || downloading ? 0.7 : 1 }
            ]}
          >
            {downloading ? <ActivityIndicator size="small" color={theme.text} /> : <ThemedText type="smallBold">Download PDF</ThemedText>}
          </Pressable>

          {!pending ? (
            <Pressable
              onPress={pickFile}
              disabled={downloading || uploading}
              style={({ pressed }) => [
                styles.actionButton,
                { backgroundColor: theme.primary, opacity: pressed ? 0.7 : 1 }
              ]}
            >
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{t('hr.uploadSignedScan')}</ThemedText>
            </Pressable>
          ) : (
            <ThemedView style={styles.uploadPendingRow}>
              <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>{pending.name}</ThemedText>
              <Pressable onPress={clearPending} disabled={uploading}>
                <ThemedText type="small" themeColor="textSecondary">{t('common.remove')}</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => upload({ category: 'CONTRACT_SCAN' })}
                disabled={uploading}
                style={[styles.confirmButton, { opacity: uploading ? 0.7 : 1 }]}
              >
                {uploading ? <ActivityIndicator size="small" color={theme.onPrimary} /> : <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{t('common.submit')}</ThemedText>}
              </Pressable>
            </ThemedView>
          )}

          {error && <ThemedText type="small" style={{ color: theme.danger, marginTop: Spacing.two }}>{error}</ThemedText>}
        </ThemedView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
    marginBottom: Spacing.four,
  },
  loader: {
    padding: Spacing.six,
  },
  emptyTitle: {
    textAlign: 'center',
    paddingTop: Spacing.four,
  },
  emptyDescription: {
    textAlign: 'center',
    paddingBottom: Spacing.four,
    paddingTop: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  divider: {
    height: 1,
    marginHorizontal: Spacing.three,
  },
  actions: {
    padding: Spacing.three,
    borderTopWidth: 1,
    borderColor: 'rgba(150, 150, 150, 0.2)',
    gap: Spacing.two,
  },
  actionButton: {
    height: 40,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadPendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  confirmButton: {

    paddingHorizontal: Spacing.three,
    height: 36,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
