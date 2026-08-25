import { StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { UploadDocumentCard } from '@/components/documents/UploadDocumentCard';
import { DocumentsList } from '@/components/documents/DocumentsList';
import type { WorkerDocument, DocumentCompleteness, DocumentCategory } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';
import { translateApiError } from '../lib/api-error-i18n';

// For the completeness banner translation
const CATEGORY_LABEL_KEY: Record<DocumentCategory, string> = {
  GENERAL: 'documents.categoryGENERAL',
  WORK_PERMIT: 'documents.categoryWORK_PERMIT',
  TAX_NUMBER: 'documents.categoryTAX_NUMBER',
  SOCIAL_SECURITY_NUMBER: 'documents.categorySOCIAL_SECURITY_NUMBER',
  HEALTH_INSURANCE: 'documents.categoryHEALTH_INSURANCE',
  ID_CARD: 'documents.categoryID_CARD',
  PASSPORT: 'documents.categoryPASSPORT',
  ADDRESS: 'documents.categoryADDRESS',
  CONTRACT_SCAN: 'documents.categoryCONTRACT_SCAN',
};

export default function DocumentsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const [documents, setDocuments] = useState<WorkerDocument[]>([]);
  const [completeness, setCompleteness] = useState<DocumentCompleteness | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadError(null);
    try {
      const [docsRes, compRes] = await Promise.all([
        api.documents.list(user.id),
        api.documents.getCompleteness(user.id).catch(() => null),
      ]);
      setDocuments(Array.isArray(docsRes) ? docsRes : []);
      setCompleteness(compRes);
    } catch (error) {
      setLoadError(translateApiError(error, t, 'documents.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, t]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const onUploaded = useCallback((doc: WorkerDocument) => {
    setDocuments((prev) => [doc, ...prev]);
    // Refresh to update the completeness state from backend
    load();
  }, [load]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert(
      t('common.confirm'),
      t('documents.deleteConfirm', 'Are you sure you want to remove this document?'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: async () => {
            setDeletingId(id);
            try {
              await api.documents.delete(id);
              setDocuments((prev) => prev.filter((d) => d.id !== id));
              load(); // refresh completeness
            } catch (err) {
              Alert.alert(t('errors.title'), translateApiError(err, t, 'errors.generic'));
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }, [load, t]);

  if (!user) return null;

  const showCompletenessBanner = completeness && !completeness.is_complete && completeness.missing_categories.length > 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />
        <ThemedText type="subtitle" style={styles.header}>{t("documents.title")}</ThemedText>

        {showCompletenessBanner && (
          <ThemedView style={styles.warningBanner} type="backgroundSelected">
            <ThemedText type="smallBold" style={styles.warningTitle}>
              {t('documents.missingRequired', 'Missing Required Documents')}
            </ThemedText>
            <ThemedText type="small" style={styles.warningText}>
              {t('documents.missingRequiredDesc', 'Please upload the following missing documents:')}
            </ThemedText>
            {completeness.missing_categories.map(cat => (
              <ThemedText key={cat} type="small" style={styles.missingCategoryItem}>
                • {t(CATEGORY_LABEL_KEY[cat] || cat)}
              </ThemedText>
            ))}
          </ThemedView>
        )}

        <UploadDocumentCard workerId={user.id} onUploaded={onUploaded} />

        {loadError && (
          <ThemedText type="small" style={styles.errorText}>
            {loadError}
          </ThemedText>
        )}

        <DocumentsList
          documents={documents}
          loading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onDelete={handleDelete}
          deletingId={deletingId}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  back: { marginBottom: Spacing.two },
  header: { marginBottom: Spacing.three },
  errorText: { color: '#E53E3E', marginBottom: Spacing.two },
  warningBanner: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    marginBottom: Spacing.three,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#F6E05E',
  },
  warningTitle: { color: '#B7791F', marginBottom: Spacing.one },
  warningText: { color: '#B7791F', marginBottom: Spacing.one },
  missingCategoryItem: { color: '#B7791F', marginLeft: Spacing.two },
});
