import { StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { UploadDocumentCard } from '@/components/documents/UploadDocumentCard';
import { DocumentsList } from '@/components/documents/DocumentsList';
import type { WorkerDocument } from '@/types/api';

export default function DocumentsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [documents, setDocuments] = useState<WorkerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadError(null);
    try {
      const res = await api.documents.list(user.id);
      setDocuments(Array.isArray(res) ? res : []);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Could not load documents.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const onUploaded = useCallback((doc: WorkerDocument) => {
    setDocuments((prev) => [doc, ...prev]);
  }, []);

  if (!user) return null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <ThemedText type="small" themeColor="textSecondary">
            ← Back
          </ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={styles.header}>
          Documents
        </ThemedText>

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
});
