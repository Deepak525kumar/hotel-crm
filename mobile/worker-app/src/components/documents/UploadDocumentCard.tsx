import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import type { DocumentCategory, WorkerDocument } from '@/types/api';
import { useTranslation } from 'react-i18next';

// Translation KEYS, not display strings: this map is module-scope, where
// t() cannot be called. Each value is resolved at render time instead, so
// the label follows the active language rather than being frozen at import.
/**
 * What the dropdown starts on. Must be a category the SERVER accepts — the
 * previous default was a client-only `GENERAL`, which 422'd every upload made
 * without changing the dropdown.
 */
const DEFAULT_CATEGORY: DocumentCategory = 'ID_CARD';

const CATEGORY_LABEL_KEY: Record<DocumentCategory, string> = {
  WORK_PERMIT: 'documents.categoryWORK_PERMIT',
  TAX_NUMBER: 'documents.categoryTAX_NUMBER',
  SOCIAL_SECURITY_NUMBER: 'documents.categorySOCIAL_SECURITY_NUMBER',
  HEALTH_INSURANCE: 'documents.categoryHEALTH_INSURANCE',
  ID_CARD: 'documents.categoryID_CARD',
  PASSPORT: 'documents.categoryPASSPORT',
  ADDRESS: 'documents.categoryADDRESS',
  CONTRACT_SCAN: 'documents.categoryCONTRACT_SCAN',
};

export function UploadDocumentCard({
  workerId,
  onUploaded,
}: {
  workerId: string;
  onUploaded: (doc: WorkerDocument) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [category, setCategory] = useState<DocumentCategory>(DEFAULT_CATEGORY);
  const [isWorkPermit, setIsWorkPermit] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const { pending, uploading, error, pickFile, pickPhoto, clearPending, upload } = useDocumentUpload(
    workerId,
    (doc) => {
      onUploaded(doc);
      setCategory(DEFAULT_CATEGORY);
      setIsWorkPermit(false);
      setExpiresAt('');
    }
  );

  // Category always has a valid default; the one field that can be malformed
  // is the free-text expiry date. Disabling on a clearly-invalid value here
  // is a UX nicety, not a security boundary — the backend's own regex
  // (documents/validation.ts) remains the authoritative check.
  const expiresAtIsValid = !expiresAt || /^\d{4}-\d{2}-\d{2}$/.test(expiresAt);
  const canSubmit = !uploading && expiresAtIsValid;

  const onSubmit = () =>
    upload({
      category,
      is_work_permit: category === 'WORK_PERMIT' ? isWorkPermit : undefined,
      expires_at: expiresAt || undefined,
    });

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold" style={styles.header}>{t("documents.uploadTitle")}</ThemedText>

      {!pending ? (
        /* Photo first: identity documents are photographed far more often than
           they are scanned, and an iPhone's HEIC cannot go through the file
           picker at all (the frozen upload policy has no image/heic). */
        <ThemedView style={styles.pickRow} type="backgroundElement">
          <Pressable onPress={() => void pickPhoto('camera')} style={({ pressed }) => [styles.pickButton, styles.flex, { opacity: pressed ? 0.7 : 1 }]}>
            <ThemedText type="small" style={styles.pickButtonText}>{t('documents.takePhoto')}</ThemedText>
          </Pressable>
          <Pressable onPress={() => void pickPhoto('library')} style={({ pressed }) => [styles.pickButton, styles.flex, { opacity: pressed ? 0.7 : 1 }]}>
            <ThemedText type="small" style={styles.pickButtonText}>{t('documents.choosePhoto')}</ThemedText>
          </Pressable>
          <Pressable onPress={pickFile} style={({ pressed }) => [styles.pickButton, styles.flex, { opacity: pressed ? 0.7 : 1 }]}>
            <ThemedText type="small" style={styles.pickButtonText}>{t('documents.chooseFile')}</ThemedText>
          </Pressable>
        </ThemedView>
      ) : (
        <>
          <ThemedView style={styles.row} type="backgroundElement">
            <ThemedText type="small" numberOfLines={1} style={styles.flex}>
              {pending.name}
            </ThemedText>
            <Pressable onPress={clearPending} disabled={uploading}>
              <ThemedText type="small" themeColor="textSecondary">{t("common.remove")}</ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={styles.row} type="backgroundElement">
            {(['WORK_PERMIT', 'TAX_NUMBER', 'SOCIAL_SECURITY_NUMBER', 'HEALTH_INSURANCE', 'ID_CARD', 'PASSPORT', 'ADDRESS', 'CONTRACT_SCAN'] as const).map((c) => (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                disabled={uploading}
                style={({ pressed }) => [
                  styles.categoryButton,
                  {
                    backgroundColor: category === c ? theme.text : theme.backgroundSelected,
                    opacity: pressed || uploading ? 0.7 : 1,
                  },
                ]}
              >
                <ThemedText
                  type="small"
                  style={category === c ? { color: theme.background } : undefined}
                >
                  {t(CATEGORY_LABEL_KEY[c])}
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>

          {category === 'WORK_PERMIT' && (
            <Pressable
              onPress={() => setIsWorkPermit((v) => !v)}
              disabled={uploading}
              style={styles.row}
            >
              <ThemedText type="small">{t("documents.nonEuWorkPermit")}</ThemedText>
              <ThemedText type="small" themeColor={isWorkPermit ? 'text' : 'textSecondary'}>
                {isWorkPermit ? '✓' : ''}
              </ThemedText>
            </Pressable>
          )}

          <TextInput
            value={expiresAt}
            onChangeText={setExpiresAt}
            placeholder="Expiry date (optional, YYYY-MM-DD)"
            placeholderTextColor={theme.textSecondary}
            editable={!uploading}
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
          {!expiresAtIsValid && (
            <ThemedText type="small" style={styles.errorText}>
              Expiry date must use YYYY-MM-DD.
            </ThemedText>
          )}

          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.uploadButton,
              { backgroundColor: theme.text, opacity: pressed || !canSubmit ? 0.7 : 1 },
            ]}
          >
            {uploading ? (
              <ActivityIndicator color={theme.background} size="small" />
            ) : (
              <ThemedText type="small" style={{ color: theme.background }}>
                {error ? t('documents.retryUpload') : t('documents.upload')}
              </ThemedText>
            )}
          </Pressable>
        </>
      )}

      {error && (
        <ThemedText type="small" style={styles.errorText}>
          {error}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.three },
  header: { marginBottom: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, flexWrap: 'wrap' },
  flex: { flex: 1 },
  pickRow: { flexDirection: 'row', gap: 8 },
  pickButton: {
    height: 44,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3182CE',
  },
  pickButtonText: { color: '#fff' },
  categoryButton: {
    width: '48%',
    height: 36,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    height: 40,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    fontSize: 14,
  },
  uploadButton: {
    height: 44,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: { color: '#E53E3E' },
});
