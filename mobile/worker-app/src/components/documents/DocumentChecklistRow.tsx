import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import { openDocument } from './open-document';
import { shouldAutoUpload } from '@/lib/auto-upload-decision';
import type { ChecklistEntry } from '@/lib/onboarding-checklist';
import type { DocumentCategory, WorkerDocument } from '@/types/api';

/**
 * One requirement of the onboarding checklist.
 *
 * The category comes from the row, so there is no dropdown to get wrong — the
 * previous screen offered a single upload card whose default category silently
 * mis-filed anything uploaded without changing it.
 */
export function DocumentChecklistRow({
  entry,
  workerId,
  onUploaded,
}: {
  entry: ChecklistEntry;
  workerId: string;
  onUploaded: (doc: WorkerDocument) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>(entry.categories[0]!);
  const { uploading, error, pickFile, pickPhoto, pending, upload, clearPending } = useDocumentUpload(
    workerId,
    (doc) => {
      onUploaded(doc);
      setOpen(false);
    },
  );

  const done = entry.document !== null;

  // Upload as soon as something is picked: the row already knows the category,
  // so there is nothing left to ask.
  //
  // Attempted-once, tracked by ref, because a failed upload leaves `pending`
  // set and flips `uploading` back to false -- which is exactly the state this
  // effect fires on. Without the guard a rejected file (too large, wrong type,
  // offline) retries as fast as the network allows, forever, from every
  // affected device. Retrying is the explicit button below instead.
  const attemptedUri = useRef<string | null>(null);
  useEffect(() => {
    if (!pending) {
      attemptedUri.current = null;
      return;
    }
    if (!shouldAutoUpload({ pendingUri: pending.uri, uploading, attemptedUri: attemptedUri.current })) return;
    attemptedUri.current = pending.uri;
    void upload({ category });
  }, [pending, uploading, category, upload]);

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Pressable style={styles.head} onPress={() => setOpen((v) => !v)}>
        <View
          style={[
            styles.tick,
            { backgroundColor: done ? theme.success : 'transparent', borderColor: done ? theme.success : theme.border },
          ]}
        >
          {done ? <ThemedText style={{ color: theme.onPrimary }}>✓</ThemedText> : null}
        </View>

        <View style={styles.text}>
          <ThemedText type="smallBold">{t(entry.labelKey)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {entry.document?.original_filename ?? t('documents.required')}
          </ThemedText>
        </View>

        {uploading ? (
          <ActivityIndicator />
        ) : (
          <ThemedText type="linkPrimary">{done ? t('documents.replace') : t('common.add')}</ThemedText>
        )}
      </Pressable>

      {done && entry.document ? (
        <Pressable
          onPress={() => void openDocument(entry.document!)}
          disabled={!entry.document.presigned_url}
        >
          <ThemedText
            type="small"
            themeColor={entry.document.presigned_url ? undefined : 'textSecondary'}
            style={styles.view}
          >
            {/* A null presigned_url means storage could not produce a link.
                Previously this rendered nothing, so a storage outage looked
                like the app had simply lost the document. */}
            {entry.document.presigned_url ? t('documents.view') : t('documents.previewUnavailable')}
          </ThemedText>
        </Pressable>
      ) : null}

      {open ? (
        <View style={styles.actions}>
          {entry.categories.length > 1 ? (
            <View style={styles.choices}>
              {entry.categories.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[
                    styles.choice,
                    { borderColor: c === category ? theme.primary : theme.border },
                  ]}
                >
                  <ThemedText type="small">{t(`documents.category${c}`)}</ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.buttons}>
            <Pressable onPress={() => void pickPhoto('camera')} style={styles.action}>
              <ThemedText type="small">{t('documents.takePhoto')}</ThemedText>
            </Pressable>
            <Pressable onPress={() => void pickPhoto('library')} style={styles.action}>
              <ThemedText type="small">{t('documents.choosePhoto')}</ThemedText>
            </Pressable>
            <Pressable onPress={() => void pickFile()} style={styles.action}>
              <ThemedText type="small">{t('documents.chooseFile')}</ThemedText>
            </Pressable>
          </View>

          {error ? (
            <View style={styles.error}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
              <View style={styles.buttons}>
                {pending ? (
                  <Pressable onPress={() => void upload({ category })} style={styles.action}>
                    <ThemedText type="smallBold">{t('documents.retryUpload')}</ThemedText>
                  </Pressable>
                ) : null}
                <Pressable onPress={clearPending} style={styles.action}>
                  <ThemedText type="small" themeColor="textSecondary">{t('common.cancel')}</ThemedText>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  view: { marginLeft: 36, marginTop: Spacing.one },
  actions: { marginLeft: 36, marginTop: Spacing.two, gap: Spacing.two },
  choices: { flexDirection: 'row', gap: Spacing.one },
  choice: { borderWidth: 1, borderRadius: Spacing.two, paddingVertical: 6, paddingHorizontal: Spacing.two },
  buttons: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  action: { paddingVertical: 6 },
  error: { gap: Spacing.one },
});
