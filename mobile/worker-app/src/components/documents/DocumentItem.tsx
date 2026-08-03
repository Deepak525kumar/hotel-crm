import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatBytes } from '@/lib/format-bytes';
import { openDocument } from './open-document';
import type { WorkerDocument, DocumentCategory } from '@/types/api';

const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  GENERAL: 'General',
  WORK_PERMIT: 'Work permit',
};

// expires_at is YYYY-MM-DD (date-only); parsing/formatting as UTC avoids a
// local-timezone off-by-one when the device's own timezone differs (same
// reasoning as lib/calendar-dates.ts's formatDay).
function formatExpiry(expiresAt: string): string {
  return new Date(`${expiresAt}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

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
