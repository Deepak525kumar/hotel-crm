import { ActivityIndicator, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { DocumentItem } from './DocumentItem';
import type { WorkerDocument } from '@/types/api';
import { useTranslation } from 'react-i18next';

export function DocumentsList({
  documents,
  loading,
  refreshing,
  onRefresh,
  onDelete,
  deletingId,
}: {
  documents: WorkerDocument[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDelete?: (id: string) => void;
  deletingId?: string | null;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (loading) {
    return <ActivityIndicator style={styles.loader} color={theme.text} />;
  }

  return (
    <FlatList
      data={documents}
      keyExtractor={(d) => d.id}
      renderItem={({ item }) => <DocumentItem document={item} onDelete={onDelete} isDeleting={deletingId === item.id} />}
      ListEmptyComponent={
        <ThemedView type="backgroundElement" style={styles.empty}>
          <ThemedText type="smallBold" style={styles.emptyTitle}>{t("documents.none")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDescription}>{t("documents.uploadFirstHint")}</ThemedText>
        </ThemedView>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  empty: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center', gap: Spacing.one },
  emptyTitle: { textAlign: 'center' },
  emptyDescription: { textAlign: 'center' },
});
