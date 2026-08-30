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
import type { ReworkRoundPhotos, QualityCheck } from '@/types/api';

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
/**
 * One evidence photo, shared by the checker's section and every rework round
 * so a picture looks and behaves the same wherever it appears.
 */
function EvidencePhoto({
  photo,
  styles,
  label,
}: {
  photo: { key: string; url: string | null };
  styles: { photo: object; missing: object; missingText: object };
  label: string;
}) {
  // Tap opens full size: a 150px thumbnail cannot settle what the checker was
  // looking at, which is the point of keeping it.
  if (photo.url) {
    return (
      <Pressable onPress={() => void Linking.openURL(photo.url as string)}>
        <Image source={{ uri: photo.url }} style={styles.photo} resizeMode="cover" />
      </Pressable>
    );
  }
  // url === null means storage is unconfigured. Shown rather than hidden, so a
  // broken bucket reads as a missing image and not as a check that never had
  // evidence.
  return (
    <View style={styles.missing}>
      <Text style={styles.missingText}>{label}</Text>
    </View>
  );
}

export default function CheckDetailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [check, setCheck] = useState<QualityCheck | null>(null);
  const [photos, setPhotos] = useState<{ key: string; url: string | null }[] | null>(null);
  const [rounds, setRounds] = useState<ReworkRoundPhotos[]>([]);
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
      // Optional on the wire: a check with no rework simply renders no round
      // sections rather than throwing.
      setRounds(p.rework_rounds ?? []);
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

        {/* Evidence grouped by who produced it, and the photo grid moved
            INSIDE a card (2026-08-30). It previously sat bare in the scroll
            view while every other block was carded, so it alone had no padding
            -- and the checker's photographs and the worker's own rework proof
            were mixed into one undifferentiated grid. */}
        <View style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('quality.checkerEvidenceTitle')}
          </ThemedText>
          {photos && photos.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.noPhotos')}
            </ThemedText>
          ) : (
            <View style={styles.grid}>
              {(photos ?? []).map((photo) => (
                <EvidencePhoto key={photo.key} photo={photo} styles={styles} label={t('quality.photoUnavailable')} />
              ))}
            </View>
          )}
        </View>

        {/* The worker's own attempts, one card each. Seeing what they already
            submitted for round 1 is what tells them what a second round is
            actually asking for. */}
        {rounds.map((round) => (
          <View key={round.id} style={styles.card}>
            <View style={styles.row}>
              <ThemedText type="smallBold">
                {t('quality.reworkRoundTitle', { number: round.round_number })}
              </ThemedText>
              <ThemedText
                type="small"
                style={{ color: round.completed_at ? theme.success : theme.warning }}
              >
                {round.completed_at ? t('quality.reworkCompleted') : t('quality.reworkAwaitingWorker')}
              </ThemedText>
            </View>
            <ThemedText type="small">{round.notes}</ThemedText>
            {round.photos.length > 0 ? (
              <View style={styles.grid}>
                {round.photos.map((photo) => (
                  <EvidencePhoto key={photo.key} photo={photo} styles={styles} label={t('quality.photoUnavailable')} />
                ))}
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {round.completed_at
                  ? t('quality.reworkNoRoundPhotos')
                  : t('quality.reworkAwaitingPhotos')}
              </ThemedText>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
