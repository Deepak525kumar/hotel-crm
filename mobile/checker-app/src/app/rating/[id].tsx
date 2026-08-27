import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BackLink } from '@/components/BackLink';
import { Button, Card, ScreenHeader, SectionHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import {
  INSPECTION_CHECKLIST_ITEMS,
  checklistItemLabelKey,
  deriveOverallScore,
  invalidChecklistItems,
  type InspectionChecklistItem,
} from '@/lib/inspection-checklist';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * TREQ-005 inspection checklist and worker rating.
 *
 * This is the score that feeds WorkerOverallRating -- distinct from the
 * pass/fail QualityVerification on /quality/[id], and the web has had both as
 * separate actions since TREQ-005. The mobile app had only the verification,
 * so `criteria_scores` was reachable from the API client and from nowhere in
 * the UI: a checker could not produce the checklist-based score at all.
 *
 * The overall score is DERIVED from the items rather than typed separately.
 * The web asks for both and lets them disagree, which lets the headline number
 * and the evidence behind it tell different stories.
 */
export default function RatingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { id, worker_id: workerId } = useLocalSearchParams<{ id: string; worker_id?: string }>();

  const [scores, setScores] = useState<Partial<Record<InspectionChecklistItem, number>>>({});
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = usePhotoPicker();

  const overall = deriveOverallScore(scores);

  const setItem = (item: InspectionChecklistItem, raw: string) => {
    const trimmed = raw.trim();
    setScores((prev) => ({
      ...prev,
      [item]: trimmed === '' ? undefined : Number(trimmed),
    }));
  };

  const submit = async () => {
    setError(null);

    // Named here rather than left to the server, which 400s citing a field the
    // checker cannot see after the whole form is filled in.
    const invalid = invalidChecklistItems(scores);
    if (invalid.length > 0) {
      setError(t('quality.checklistItemRange'));
      return;
    }
    if (overall === null) {
      setError(t('quality.checklistEmpty'));
      return;
    }
    // CRR §15: the photo accompanies the rating. The server enforces it too
    // and stays authoritative; this just avoids a wasted round-trip.
    if (picker.photos.length === 0) {
      setError(t('quality.photoRequired'));
      return;
    }
    if (!workerId) {
      setError(t('quality.workerUnknown'));
      return;
    }

    setSubmitting(true);
    try {
      const criteria_scores = Object.fromEntries(
        Object.entries(scores).filter(([, v]) => typeof v === 'number'),
      ) as Record<string, number>;

      await api.quality.createRating(
        {
          assignment_id: id,
          worker_id: workerId,
          score: overall,
          comment: comment || undefined,
          criteria_scores,
        },
        picker.photos,
      );
      Alert.alert(t('common.submitted'), t('quality.ratingRecorded'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    } catch (e) {
      setError(translateApiError(e, t, 'quality.ratingFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader
            title={t('quality.rateWorker')}
            subtitle={
              overall === null
                ? t('quality.checklistEmpty')
                : t('quality.overallScore', { score: overall })
            }
          />

          <SectionHeader title={t('quality.checklistTitle')} />
          <Card style={styles.checklist}>
            {INSPECTION_CHECKLIST_ITEMS.map((item) => (
              <View key={item} style={[styles.itemRow, { borderBottomColor: theme.border }]}>
                <ThemedText type="small" style={styles.itemLabel}>
                  {t(checklistItemLabelKey(item))}
                </ThemedText>
                <TextInput
                  value={scores[item] === undefined ? '' : String(scores[item])}
                  onChangeText={(v) => setItem(item, v)}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="—"
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={t(checklistItemLabelKey(item))}
                  style={[styles.itemInput, { color: theme.text, borderColor: theme.border }]}
                />
              </View>
            ))}
          </Card>

          <SectionHeader title={t('quality.photoEvidence')} />
          <Card>
            <View style={styles.photoButtons}>
              <Pressable onPress={picker.takePhoto} style={styles.photoButton}>
                <ThemedText type="smallBold">{t('documents.takePhoto')}</ThemedText>
              </Pressable>
              <Pressable onPress={picker.pickFromLibrary} style={styles.photoButton}>
                <ThemedText type="smallBold">{t('documents.choosePhoto')}</ThemedText>
              </Pressable>
            </View>
            {picker.error ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {picker.error}
              </ThemedText>
            ) : null}
            {picker.photos.map((photo, i) => (
              <View key={`${photo.uri}-${i}`} style={styles.photoRow}>
                <ThemedText type="small" numberOfLines={1} style={styles.itemLabel}>
                  {photo.name}
                </ThemedText>
                <Pressable onPress={() => picker.removeAt(i)}>
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    {t('common.remove')}
                  </ThemedText>
                </Pressable>
              </View>
            ))}
          </Card>

          <SectionHeader title={t('quality.comment')} />
          <Card>
            <TextInput
              value={comment}
              onChangeText={setComment}
              multiline
              placeholder={t('quality.commentPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.comment, { color: theme.text, borderColor: theme.border }]}
            />
          </Card>

          {error ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          ) : null}

          <Button
            label={t('quality.submitRating')}
            onPress={() => void submit()}
            loading={submitting}
            style={styles.submit}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  checklist: { gap: 0, paddingVertical: 0 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemLabel: { flex: 1 },
  itemInput: {
    width: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.one,
    paddingVertical: Spacing.one,
    textAlign: 'center',
  },
  photoButtons: { flexDirection: 'row', gap: Spacing.two },
  photoButton: { paddingVertical: Spacing.one },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  comment: {
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.one,
    padding: Spacing.two,
    textAlignVertical: 'top',
  },
  submit: { marginTop: Spacing.two },
});
