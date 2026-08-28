import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { BackLink } from '@/components/BackLink';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import { checklistItemLabelKey, INSPECTION_CHECKLIST_ITEMS } from '@/lib/inspection-checklist';

/**
 * The photos and checklist behind one RATING.
 *
 * CRR §15 gave Rating a photo column and the backend has served
 * `GET /quality/ratings/:id/photos` ever since — but nothing in this app ever
 * called it. Every photo a checker attached to a checklist score was
 * write-only: uploaded, stored, and then unreachable from any screen.
 *
 * Deliberately separate from `/verification/[id]` rather than folded into it.
 * That screen is keyed by a QualityVerification id and carries the rework
 * action, which does not apply here: rework is assigned against a
 * verification, never against a rating. Merging the two would mean a screen
 * whose primary action is absent half the time, addressed by two different
 * id spaces.
 *
 * The rating record itself is not re-fetched — there is no
 * `GET /quality/ratings/:id`, and adding one to render a score this screen was
 * reached from would be a round trip for data the caller already had. Score
 * and comment therefore arrive as params; the photos, whose presigned URLs
 * expire in 15 minutes, are fetched here.
 */
export default function RatingEvidenceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { id, score, comment, criteria } = useLocalSearchParams<{
    id: string;
    score?: string;
    comment?: string;
    criteria?: string;
  }>();

  const [photos, setPhotos] = useState<{ key: string; url: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Params arrive as strings. A malformed `criteria` must not take the screen
  // down with it — the photos are the point, and the checklist is context.
  let criteriaScores: Record<string, number> = {};
  try {
    criteriaScores = criteria ? JSON.parse(criteria) : {};
  } catch {
    criteriaScores = {};
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.quality.ratingPhotos(id);
      setPhotos(result.photos);
    } catch (e) {
      setError(translateApiError(e, t, 'errors.generic'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const scored = INSPECTION_CHECKLIST_ITEMS.filter(
    (item) => typeof criteriaScores[item] === 'number'
  );

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, gap: 16 },
    card: { backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 16, gap: 8 },
    score: { fontSize: 34, fontWeight: '800', color: theme.text },
    comment: { color: theme.text, fontSize: 14 },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    photo: { width: 150, height: 150, borderRadius: 10, backgroundColor: theme.backgroundElement },
    missing: {
      width: 150,
      height: 150,
      borderRadius: 10,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: theme.textSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
    },
    missingText: { color: theme.textSecondary, fontSize: 11, textAlign: 'center' },
    error: { color: theme.danger, fontSize: 13 },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackLink />
        <ThemedText type="subtitle">{t('quality.ratingEvidence')}</ThemedText>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {score ? (
          <View style={styles.card}>
            <Text style={styles.score}>{score}</Text>
            {comment ? <Text style={styles.comment}>{comment}</Text> : null}
          </View>
        ) : null}

        {scored.length > 0 ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.checklistTitle')}
            </ThemedText>
            {scored.map((item) => (
              <View key={item} style={styles.itemRow}>
                <ThemedText type="small">{t(checklistItemLabelKey(item))}</ThemedText>
                <ThemedText type="smallBold">{criteriaScores[item]}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}

        {!photos && !error ? <ActivityIndicator color={theme.text} /> : null}

        {photos && photos.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('quality.noPhotos')}
          </ThemedText>
        ) : null}

        <View style={styles.grid}>
          {(photos ?? []).map((photo) =>
            photo.url ? (
              // Tap opens full size: a 150px thumbnail cannot settle whether a
              // mirror was actually streaked, which is the point of keeping
              // the evidence at all. Same behaviour as the verification
              // evidence screen.
              <Pressable key={photo.key} onPress={() => void Linking.openURL(photo.url as string)}>
                <Image source={{ uri: photo.url }} style={styles.photo} resizeMode="cover" />
              </Pressable>
            ) : (
              // url === null means storage is unconfigured. Shown rather than
              // hidden, so a broken bucket reads as a missing image and not as
              // a rating that never had evidence.
              <View key={photo.key} style={styles.missing}>
                <Text style={styles.missingText}>{t('quality.photoUnavailable')}</Text>
              </View>
            )
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
