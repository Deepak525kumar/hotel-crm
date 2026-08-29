import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { BackLink } from '@/components/BackLink';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import { checklistItemLabelKey, INSPECTION_CHECKLIST_ITEMS } from '@/lib/inspection-checklist';
import type { QualityCheck } from '@/types/api';

/**
 * One check, from the worker's side.
 *
 * Owner decision, 2026-08-29: "he should see the details, I mean the same
 * screen the checker sees in his history tab ... with one addition. when the
 * check is marked rework there should be a button to go to rework."
 *
 * "The same screen" is meant literally at the data layer: this reads
 * `GET /quality/checks/:id`, the identical endpoint and DTO the checker's
 * evidence screen uses. Two screens rendering two shapes of the same
 * inspection is how a worker and a checker end up quoting different scores at
 * each other, and neither can prove the other wrong.
 *
 * The addition is the rework button, which the checker's copy has no use for.
 */
export default function CheckDetailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [check, setCheck] = useState<QualityCheck | null>(null);
  const [photos, setPhotos] = useState<{ key: string; url: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Both together: the record drives what the screen offers, the photos
      // are the evidence. A failure in either is surfaced -- a silently
      // photo-less check reads as one that never had any.
      const [c, p] = await Promise.all([
        api.quality.getCheck(id),
        api.quality.checkPhotos(id),
      ]);
      setCheck(c);
      setPhotos(p.photos);
    } catch (e) {
      setError(translateApiError(e, t, 'errors.generic'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusColor =
    check?.status === 'PASSED'
      ? theme.success
      : check?.status === 'NEEDS_REWORK'
        ? theme.warning
        : theme.danger;

  const scored = check?.criteria_scores
    ? INSPECTION_CHECKLIST_ITEMS.filter(
        (item) => typeof check.criteria_scores?.[item] === 'number'
      )
    : [];

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, gap: 16 },
    card: { backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 16, gap: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    score: { fontSize: 34, fontWeight: '800', color: theme.text },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    badgeText: { color: theme.onPrimary, fontWeight: '700', fontSize: 12 },
    meta: { color: theme.text, fontSize: 15, fontWeight: '600' },
    metaSecondary: { color: theme.textSecondary, fontSize: 13 },
    notes: { color: theme.text, fontSize: 14 },
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
    reworkBtn: {
      backgroundColor: theme.warning,
      borderRadius: 12,
      padding: 15,
      alignItems: 'center',
    },
    reworkBtnText: { color: theme.onPrimary, fontWeight: '700', fontSize: 15 },
    error: { color: theme.danger, fontSize: 13 },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackLink />
        <ThemedText type="subtitle">{t('quality.evidence')}</ThemedText>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!check && !error ? <ActivityIndicator color={theme.text} /> : null}

        {check ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.score}>{check.score}</Text>
              <View style={[styles.badge, { backgroundColor: statusColor }]}>
                <Text style={styles.badgeText}>{check.status.replace(/_/g, ' ')}</Text>
              </View>
            </View>
            <Text style={styles.meta}>
              {t('quality.roomLabel')} {check.room_number}
            </Text>
            {check.hotel?.name ? (
              <Text style={styles.metaSecondary}>{check.hotel.name}</Text>
            ) : null}
            {check.checked_by ? (
              <Text style={styles.metaSecondary}>
                {t('quality.checkedBy')}{' '}
                {`${check.checked_by.first_name} ${check.checked_by.last_name}`.trim()}
              </Text>
            ) : null}
            {check.notes ? <Text style={styles.notes}>{check.notes}</Text> : null}
          </View>
        ) : null}

        {/* THE addition over the checker's copy. Shown only while there is
            something to do: once the rework is completed the button would lead
            to a finished assignment, which reads as unfinished work. */}
        {check?.rework_required && check.rework_assignment && !check.rework_completed_at ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.reworkTitle')}
            </ThemedText>
            {check.rework_notes ? <Text style={styles.notes}>{check.rework_notes}</Text> : null}
            <Pressable
              accessibilityRole="button"
              style={styles.reworkBtn}
              onPress={() => router.push(`/rework/${check.rework_assignment!.id}`)}
            >
              <Text style={styles.reworkBtnText}>{t('quality.goToRework')}</Text>
            </Pressable>
          </View>
        ) : null}

        {check?.rework_completed_at ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.reworkCompleted')}
            </ThemedText>
          </View>
        ) : null}

        {scored.length > 0 ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.checklistTitle')}
            </ThemedText>
            {scored.map((item) => (
              <View key={item} style={styles.row}>
                <ThemedText type="small">{t(checklistItemLabelKey(item))}</ThemedText>
                <ThemedText type="smallBold">{check!.criteria_scores![item]}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}

        {photos && photos.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('quality.noPhotos')}
          </ThemedText>
        ) : null}

        <View style={styles.grid}>
          {(photos ?? []).map((photo) =>
            photo.url ? (
              // Tap opens full size: a 150px thumbnail cannot settle what the
              // checker was looking at, which is the point of keeping it.
              <Pressable key={photo.key} onPress={() => void Linking.openURL(photo.url as string)}>
                <Image source={{ uri: photo.url }} style={styles.photo} resizeMode="cover" />
              </Pressable>
            ) : (
              // url === null means storage is unconfigured. Shown rather than
              // hidden, so a broken bucket reads as a missing image and not as
              // a check that never had evidence.
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
