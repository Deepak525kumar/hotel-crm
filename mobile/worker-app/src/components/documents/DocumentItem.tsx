import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatBytes, formatExpiry } from '@/lib/document-formatting';
import { openDocument } from './open-document';
import type { WorkerDocument, DocumentCategory } from '@/types/api';
import { useTranslation } from 'react-i18next';

// Translation KEYS, not display strings: this map is module-scope, where
// t() cannot be called. Each value is resolved at render time instead, so
// the label follows the active language rather than being frozen at import.
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

export function DocumentItem({ document, onDelete, isDeleting }: { document: WorkerDocument; onDelete?: (id: string) => void; isDeleting?: boolean }) {
  const { t } = useTranslation();
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.row} type="backgroundElement">
        <ThemedView style={styles.info} type="backgroundElement">
          <ThemedText type="smallBold" numberOfLines={1}>
            {document.original_filename}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatBytes(document.file_size_bytes)} · {t(CATEGORY_LABEL_KEY[document.category])}
            {document.expires_at && ` · Expires ${formatExpiry(document.expires_at)}`}
          </ThemedText>
        </ThemedView>
        <ThemedView style={styles.actions} type="backgroundElement">
          {document.presigned_url ? (
            <Pressable onPress={() => openDocument(document)}>
              <ThemedText type="linkPrimary">{t('documents.view')}</ThemedText>
            </Pressable>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
            {t('documents.previewUnavailable')}
          </ThemedText>
          )}
          {onDelete && (
            <Pressable onPress={() => onDelete(document.id)} disabled={isDeleting} style={styles.deleteButton}>
              <ThemedText type="small" style={{ color: isDeleting ? '#A0AEC0' : '#E53E3E' }}>{t("common.remove")}</ThemedText>
            </Pressable>
          )}
        </ThemedView>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  info: { flex: 1, gap: 2 },
  actions: { alignItems: 'flex-end', gap: Spacing.one },
  deleteButton: { marginTop: Spacing.one },
});
