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

  const [overallRaw, setOverallRaw] = useState('');
  const overall = overallRaw.trim() === '' ? null : Number(overallRaw);

  const submit = async () => {
    setError(null);

    const scoredItems = INSPECTION_CHECKLIST_ITEMS.filter((item) => typeof scores[item] === 'number');
    if (scoredItems.length === 0) {
      setError(t('quality.checklistEmpty', 'Score at least one item.'));
      return;
    }
    const invalid = invalidChecklistItems(scores);
    if (invalid.length > 0) {
      setError(t('quality.checklistItemRange'));
      return;
    }
    if (overall === null || !Number.isInteger(overall) || overall < 0 || overall > 100) {
      setError(t('quality.scoreWholeNumber', 'Score must be a whole number from 0 to 100.'));
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
                ? t('quality.checklistEmpty', 'Fill in the checklist and rating')
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
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={() => setScores((prev) => ({ ...prev, [item]: 100 }))}
                    style={[
                      styles.toggleButton,
                      scores[item] === 100 ? { backgroundColor: theme.primary, borderColor: theme.primary } : { borderColor: theme.border }
                    ]}
                  >
                    <ThemedText type="smallBold" style={{ color: scores[item] === 100 ? theme.background : theme.text }}>
                      {t('common.pass', 'Pass')}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setScores((prev) => ({ ...prev, [item]: 0 }))}
                    style={[
                      styles.toggleButton,
                      scores[item] === 0 ? { backgroundColor: theme.danger, borderColor: theme.danger } : { borderColor: theme.border }
                    ]}
                  >
                    <ThemedText type="smallBold" style={{ color: scores[item] === 0 ? '#fff' : theme.text }}>
                      {t('common.fail', 'Fail')}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </Card>

          <SectionHeader title={t('quality.overallScoreTitle', 'Overall Score (0-100)')} />
          <Card>
            <TextInput
              value={overallRaw}
              onChangeText={setOverallRaw}
              keyboardType="number-pad"
              maxLength={3}
              placeholder="e.g. 85"
              placeholderTextColor={theme.textSecondary}
              style={[styles.scoreInput, { color: theme.text, borderColor: theme.border }]}
            />
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

          <SectionHeader title={t('quality.commentOptional', 'Comment (optional)')} />
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
  toggleButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.one,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  scoreInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.one,
    padding: Spacing.two,
    fontSize: 16,
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
