import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { BackLink } from '@/components/BackLink';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import type { QualityVerification } from '@/types/api';

/**
 * The inspection record and its evidence.
 *
 * CRR §14: "Checker is notified with the photo + details" — this is where that
 * photo is actually seen. The keys stored on the verification are useless to a
 * client on their own (the bucket is private), so the evidence was write-only
 * until this screen existed. URLs are minted per request and expire in 15
 * minutes, so they are fetched here rather than carried in the push payload,
 * which could sit unread in a tray for hours.
 *
 * CRR §14 also: "Checker assigns rework to a specific worker." That action
 * lives here (added 2026-08-24) because this is the only screen that shows a
 * checker what they are deciding about — the score, the outcome, and the
 * photos. Previously the checker app had no rework capability at all: no API
 * method, no UI, so the one role the requirement names could not do it.
 */
export default function VerificationEvidenceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [verification, setVerification] = useState<QualityVerification | null>(null);
  const [photos, setPhotos] = useState<{ key: string; url: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reworkNotes, setReworkNotes] = useState('');
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Both in parallel: the record drives what actions are offered, the
      // photos are the evidence itself. A failure in either is surfaced —
      // a silently photo-less inspection reads as one that never had any.
      const [v, p] = await Promise.all([
        api.quality.getVerification(id),
        api.quality.verificationPhotos(id),
      ]);
      setVerification(v);
      setPhotos(p.photos);
    } catch (e) {
      setError(translateApiError(e, t, 'errors.generic'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAssignRework = () => {
    if (!reworkNotes.trim()) {
      Alert.alert(t('errors.title'), t('quality.reworkNotesRequired'));
      return;
    }
    setAssigning(true);
    void api.quality
      .assignRework(id, reworkNotes.trim())
      .then(() => {
        setReworkNotes('');
        // Re-read rather than patching local state: the server decides whether
        // rework is now assigned, and a 409 from a concurrent assignment must
        // not leave this screen showing a success it did not get.
        return load();
      })
      .then(() => Alert.alert(t('common.submitted'), t('quality.reworkAssigned')))
      .catch((e) => Alert.alert(t('errors.title'), translateApiError(e, t, 'errors.generic')))
      .finally(() => setAssigning(false));
  };

  // Offered at any status. Rework is the checker's decision, not an inference
  // from the score (owner decision, 2026-08-29) -- this used to exclude PASSED,
  // which meant a checker who scored a room 75 and then found something that
  // had to be redone had no way to say so from the evidence screen either.
  //
  // The one remaining condition is that rework has not already been assigned:
  // the server enforces that with a compare-and-swap and answers 409, and a
  // second rework row would start a second 20-minute escalation timer for one
  // failure.
  const canAssignRework = verification !== null && verification.rework_required !== true;

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, gap: 16 },
    card: { backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 16, gap: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    label: { color: theme.textSecondary, fontSize: 13 },
    score: { fontSize: 34, fontWeight: '800', color: theme.text },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    badgeText: { color: theme.onPrimary, fontWeight: '700', fontSize: 12 },
    meta: { color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 8 },
    metaSecondary: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
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
    input: {
      backgroundColor: theme.background,
      borderRadius: 10,
      padding: 12,
      color: theme.text,
      fontSize: 14,
      minHeight: 70,
      textAlignVertical: 'top',
    },
    button: { backgroundColor: theme.warning, borderRadius: 12, padding: 15, alignItems: 'center' },
    buttonText: { color: theme.onPrimary, fontWeight: '700', fontSize: 15 },
    error: { color: theme.danger, fontSize: 13 },
    pill: {
      alignSelf: 'flex-start',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: theme.warningSubtle,
    },
    pillText: { color: theme.warning, fontSize: 12, fontWeight: '600' },
  });

  // Tokens, not hexes: the previous trio ignored the colour scheme entirely
  // and matched neither the queue's badges nor the quality screen's outcome.
  const statusColor =
    verification?.status === 'PASSED'
      ? theme.success
      : verification?.status === 'NEEDS_REWORK'
        ? theme.warning
        : theme.danger;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackLink />
        <ThemedText type="subtitle">{t('quality.evidence')}</ThemedText>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!verification && !error ? <ActivityIndicator color={theme.text} /> : null}

        {verification ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.score}>{verification.score}</Text>
              <View style={[styles.badge, { backgroundColor: statusColor }]}>
                <Text style={styles.badgeText}>{verification.status}</Text>
              </View>
            </View>
            {/* Whose work, where and when. The screen used to show a score and
                photos with no way to tell which shift was inspected. */}
            {verification.assignment?.worker && (
              <Text style={styles.meta}>
                {`${verification.assignment.worker.first_name} ${verification.assignment.worker.last_name}`.trim()}
              </Text>
            )}
            {(verification.hotel || verification.assignment?.day) && (
              <Text style={styles.metaSecondary}>
                {[
                  verification.hotel
                    ? [verification.hotel.name, verification.hotel.city].filter(Boolean).join(' · ')
                    : null,
                  verification.assignment?.day
                    ? new Date(verification.assignment.day).toLocaleDateString()
                    : null,
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
            )}
            {verification.verified_by && (
              <Text style={styles.metaSecondary}>
                {t('quality.inspectedBy', 'Inspected by')}{' '}
                {`${verification.verified_by.first_name} ${verification.verified_by.last_name}`.trim()}
              </Text>
            )}
            {verification.notes ? <Text style={styles.notes}>{verification.notes}</Text> : null}
            {verification.rework_required ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>
                  {verification.rework_completed_at
                    ? t('quality.reworkCompleted')
                    : t('quality.reworkPending')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {photos && photos.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('quality.photosHint', { max: 6 })}
          </ThemedText>
        ) : null}

        <View style={styles.grid}>
          {(photos ?? []).map((photo) =>
            photo.url ? (
              // Tap opens full size: a thumbnail is not enough to re-inspect a
              // room, which is the entire point of the evidence.
              <Pressable key={photo.key} onPress={() => void Linking.openURL(photo.url as string)}>
                <Image source={{ uri: photo.url }} style={styles.photo} resizeMode="cover" />
              </Pressable>
            ) : (
              // url === null means storage is unconfigured. Shown rather than
              // hidden, so a broken bucket reads as a missing image and not as
              // an inspection that never had evidence.
              <View key={photo.key} style={styles.missing}>
                <Text style={styles.missingText}>{t('quality.photoUnavailable')}</Text>
              </View>
            ),
          )}
        </View>

        {canAssignRework ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.assignRework')}
            </ThemedText>
            <TextInput
              style={styles.input}
              placeholder={t('quality.reworkNotesPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              value={reworkNotes}
              onChangeText={setReworkNotes}
              multiline
            />
            <Pressable
              style={[styles.button, assigning && { opacity: 0.6 }]}
              onPress={handleAssignRework}
              disabled={assigning}
            >
              {assigning ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>{t('quality.assignRework')}</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
