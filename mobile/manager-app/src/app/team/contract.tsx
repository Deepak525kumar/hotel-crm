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
  ConfirmDialog,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  translateApiError,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';

/**
 * One worker's contract.
 *
 * THE PHONE IS THE SCANNER. The web's flow assumes a printer and a flatbed:
 * download the PDF, print it, have it signed, scan it back. On a phone the
 * signed page is photographed where it was signed, which is the one part of
 * this flow that is genuinely better here than on a laptop.
 *
 * Confirm is separate from upload and deliberately so: uploading a scan is
 * evidence, confirming is an assertion that the contract is validly signed.
 * The backend keeps them as two routes; collapsing them in the UI would make
 * a blurry photo into a confirmed contract.
 */
export default function Contract() {
  const { t } = useTranslation();
  const toast = useToast();
  const { workerId } = useLocalSearchParams<{ workerId: string }>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // takePhoto / pickFromLibrary, not a single `pick`: the camera is the
  // point of this screen (the signed page is on paper, in the room), but a
  // scan that already exists in the library must not require re-photographing
  // it. `photos` accumulates, so the newest is the one to send.
  const { photos, error: pickError, takePhoto, pickFromLibrary, reset } = usePhotoPicker();

  const status = useSWR(workerId ? ['contract', workerId] : null, () =>
    api.hr.getContractStatus(String(workerId))
  );

  const upload = useCallback(async () => {
    const photo = photos[photos.length - 1];
    if (!workerId || busy || !photo) return;
    setBusy(true);
    try {
      await api.hr.uploadContractScan(String(workerId), photo);
      await status.mutate();
      // Cleared only on success: a failed upload must leave the photo in hand
      // so the manager can retry without walking back to the signed page.
      reset();
      toast.show(t('fields.updated'), 'success');
    } catch (e) {
      toast.show(translateApiError(e, t), 'danger');
    } finally {
      setBusy(false);
    }
  }, [workerId, busy, photos, status, reset, toast, t]);

  const contract = status.data;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('hr.contract')} />

          {status.isLoading ? (
            <SkeletonList rows={3} />
          ) : status.error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : !contract ? (
            <EmptyState title={t('hr.noContract')} />
          ) : (
            <>
              <Card>
                <ThemedText type="h2">{contract.position}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {contract.start_date}
                  {contract.end_date ? ` – ${contract.end_date}` : ''}
                </ThemedText>
                <View style={styles.badges}>
                  <Badge
                    label={contract.status}
                    tone={contract.status === 'ACTIVE' ? 'success' : 'warning'}
                  />
                  {contract.scanned_document_id ? (
                    <Badge label={t('status.uploaded')} tone="neutral" />
                  ) : null}
                </View>
              </Card>

              <SectionHeader title={t('common.actions')} />
              <Button
                label={t('hr.downloadContractPdf')}
                variant="ghost"
                onPress={() => void api.hr.getContractDownloadUrl(String(workerId))}
              />
              <Button
                label={t('documents.takePhoto')}
                variant="ghost"
                onPress={() => void takePhoto()}
              />
              <Button
                label={t('documents.choosePhoto')}
                variant="ghost"
                onPress={() => void pickFromLibrary()}
              />
              {pickError ? (
                <ThemedText type="small" themeColor="danger">
                  {pickError}
                </ThemedText>
              ) : null}
              {photos.length > 0 ? (
                <Button
                  label={t('hr.uploadSignedContract')}
                  loading={busy}
                  onPress={() => void upload()}
                />
              ) : null}
              {/* Confirm stays separate from upload: a scan is evidence, a
                  confirmation is an assertion that the contract is validly
                  signed. */}
              <Button
                label={t('hr.confirmSignature')}
                disabled={!contract.scanned_document_id}
                onPress={() => setConfirming(true)}
              />
            </>
          )}
        </ScrollView>

        <ConfirmDialog
          visible={confirming}
          title={t('hr.confirmSignature')}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            setBusy(true);
            void api.hr
              .confirmContract(String(workerId))
              .then(() => status.mutate())
              .then(() => toast.show(t('fields.updated'), 'success'))
              .catch((e) => toast.show(translateApiError(e, t), 'danger'))
              .finally(() => setBusy(false));
          }}
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
  badges: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
});
