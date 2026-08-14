import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatBytes, formatExpiry } from '@/lib/document-formatting';
import { openDocument } from './open-document';
import type { WorkerDocument, DocumentCategory } from '@/types/api';

const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  GENERAL: 'General',
  WORK_PERMIT: 'Work permit',
};

export function DocumentItem({ document }: { document: WorkerDocument }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.row} type="backgroundElement">
        <ThemedView style={styles.info} type="backgroundElement">
          <ThemedText type="smallBold" numberOfLines={1}>
            {document.original_filename}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatBytes(document.file_size_bytes)} · {CATEGORY_LABEL[document.category]}
            {document.expires_at && ` · Expires ${formatExpiry(document.expires_at)}`}
          </ThemedText>
        </ThemedView>
        {document.presigned_url ? (
          <Pressable onPress={() => openDocument(document)}>
            <ThemedText type="linkPrimary">View</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Unavailable
          </ThemedText>
        )}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  info: { flex: 1, gap: 2 },
});
