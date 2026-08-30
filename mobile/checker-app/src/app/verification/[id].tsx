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
import { checklistItemLabelKey, INSPECTION_CHECKLIST_ITEMS } from '@/lib/inspection-checklist';
import type { QualityVerification, ReworkRoundPhotos } from '@/types/api';

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
/**
 * One evidence photo. Shared by the checker's own section and every rework
 * round, so a picture looks and behaves the same wherever it appears.
 *
 * Styles are passed in because this screen builds them from the theme inside
 * the component; the tile has no business rebuilding them.
 */
/**
 * What a rework round's state should say, in one place.
 *
 * Four states now, not two (2026-08-30). A round raised after the worker's
 * shift ended has no clock running -- saying "awaiting the worker" implies a
 * deadline that is not ticking, and saying nothing implies it was forgotten.
 * A round cancelled after three days is closed but explicitly NOT completed:
 * the room was never fixed, and the label has to keep saying so.
 */
function roundState(round: {
  completed_at: string | null;
  cancelled_at?: string | null;
  timer_started_at?: string | null;
}): { key: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  if (round.cancelled_at) return { key: 'quality.reworkCancelled', tone: 'danger' };
  if (round.completed_at) return { key: 'quality.reworkCompleted', tone: 'success' };
  if (!round.timer_started_at) return { key: 'quality.reworkWaitingOnSite', tone: 'muted' };
  return { key: 'quality.reworkAwaitingWorker', tone: 'warning' };
}

function PhotoTile({
  photo,
  styles,
  label,
}: {
  photo: { key: string; url: string | null };
  styles: { photo: object; missing: object; missingText: object };
  label: string;
}) {
  // Tap opens full size: a thumbnail is not enough to re-inspect a room, which
  // is the entire point of the evidence.
  if (photo.url) {
    return (
      <Pressable onPress={() => void Linking.openURL(photo.url as string)}>
        <Image source={{ uri: photo.url }} style={styles.photo} resizeMode="cover" />
      </Pressable>
    );
  }
  // url === null means storage is unconfigured. Shown rather than hidden, so a
  // broken bucket reads as a missing image and not as an inspection that never
  // had evidence.
  return (
    <View style={styles.missing}>
      <Text style={styles.missingText}>{label}</Text>
    </View>
  );
}

export default function VerificationEvidenceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [verification, setVerification] = useState<QualityVerification | null>(null);
  const [photos, setPhotos] = useState<{ key: string; url: string | null }[] | null>(null);
  const [rounds, setRounds] = useState<ReworkRoundPhotos[]>([]);
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
      // Rounds are optional on the wire so an older server (or a check with no
      // rework at all) simply renders no round sections rather than throwing.
      setRounds(p.rework_rounds ?? []);
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
  // The one remaining condition is that no round is currently OPEN (owner
  // decision, 2026-08-30: a room can be sent back again if the fix is not good
  // enough, with no accept step in between -- the checker either lets the
  // round stand or opens another).
  //
  // This used to be `rework_required !== true`, which hid the button forever
  // after the first time. What must not happen is a SECOND open round: that
  // would give the worker two shifts and two 20-minute clocks for one failure.
  // The server enforces exactly this with a compare-and-swap and answers 409;
  // the button follows the same rule so the checker is not offered an action
  // that is going to be refused.
  // Cancelled counts as closed. A round written off after three days has
  // completed_at NULL, so testing completion alone left it looking open
  // forever -- and the "assign rework again" button stayed hidden for good on
  // exactly the rooms that were never put right.
  const openRound = rounds.find((r) => r.completed_at === null && !r.cancelled_at) ?? null;
  const canAssignRework = verification !== null && openRound === null;

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
            {/* Which room. With many checks on one shift this is the only
                thing distinguishing two otherwise identical records, so it
                sits above the worker's name rather than buried in the meta. */}
            {verification.room_number ? (
              <Text style={styles.meta}>
                {t('quality.roomLabel')} {verification.room_number}
              </Text>
            ) : null}
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

        {/* The per-item checklist, which lived on the retired Rating model and
            had its own screen until the two merged (2026-08-29). Rendered here
            so the evidence screen shows the whole inspection rather than a
            score whose breakdown is somewhere else. */}
        {verification?.criteria_scores &&
        INSPECTION_CHECKLIST_ITEMS.some(
          (item) => typeof verification.criteria_scores?.[item] === 'number'
        ) ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.checklistTitle')}
            </ThemedText>
            {INSPECTION_CHECKLIST_ITEMS.filter(
              (item) => typeof verification.criteria_scores?.[item] === 'number'
            ).map((item) => (
              <View key={item} style={styles.row}>
                <ThemedText type="small">{t(checklistItemLabelKey(item))}</ThemedText>
                <ThemedText type="smallBold">{verification.criteria_scores![item]}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}

        {/* Evidence, grouped by who produced it (owner decision, 2026-08-30).
            This was one flat grid: the checker's own photographs and the
            worker's proof of the fix appended into the same array, in upload
            order, with nothing marking the boundary. The checker could not
            tell which pictures showed the room fixed -- which is the entire
            comparison they open this screen to make.

            The grid also sat OUTSIDE any card while every other block on this
            screen sat inside one, so it alone had no padding and no surface.
            Both sections use the same card as the rest of the screen. */}
        <View style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('quality.checkerEvidenceTitle')}
          </ThemedText>
          {photos && photos.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.photosHint', { max: 6 })}
            </ThemedText>
          ) : (
            <View style={styles.grid}>
              {(photos ?? []).map((photo) => (
                <PhotoTile
                  key={photo.key}
                  photo={photo}
                  styles={styles}
                  label={t('quality.photoUnavailable')}
                />
              ))}
            </View>
          )}
        </View>

        {/* One card per attempt, oldest first, each carrying its own note,
            state and pictures. A second round no longer overwrites the first:
            both stay on screen, so the checker can see what they asked for
            last time and whether it was actually done. */}
        {rounds.map((round) => (
          <View key={round.id} style={styles.card}>
            <View style={styles.row}>
              <ThemedText type="smallBold">
                {t('quality.reworkRoundTitle', { number: round.round_number })}
              </ThemedText>
              {(() => {
                const st = roundState(round);
                const tone =
                  st.tone === 'success'
                    ? theme.success
                    : st.tone === 'danger'
                      ? theme.danger
                      : st.tone === 'muted'
                        ? theme.textSecondary
                        : theme.warning;
                return (
                  <ThemedText type="small" style={{ color: tone }}>
                    {t(st.key)}
                  </ThemedText>
                );
              })()}
            </View>
            <Text style={styles.notes}>{round.notes}</Text>
            {round.photos.length > 0 ? (
              <View style={styles.grid}>
                {round.photos.map((photo) => (
                  <PhotoTile
                    key={photo.key}
                    photo={photo}
                    styles={styles}
                    label={t('quality.photoUnavailable')}
                  />
                ))}
              </View>
            ) : (
              // Two different silences: still being worked on, versus a round
              // finished before per-round evidence was recorded. Saying which
              // stops an empty section reading as lost evidence.
              <ThemedText type="small" themeColor="textSecondary">
                {round.cancelled_at
                  ? t('quality.reworkCancelledBody')
                  : round.completed_at
                    ? t('quality.reworkNoRoundPhotos')
                    : !round.timer_started_at
                      ? t('quality.reworkWaitingOnSiteBody')
                      : t('quality.reworkAwaitingPhotos')}
              </ThemedText>
            )}
          </View>
        ))}

        {canAssignRework ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {/* Named for what it does THIS time: after a completed round the
                  same control opens another one, and calling it "assign
                  rework" again would read as though the first never happened. */}
              {rounds.length > 0 ? t('quality.assignReworkAgain') : t('quality.assignRework')}
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
