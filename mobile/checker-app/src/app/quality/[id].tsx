import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { api } from '@/lib/api';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';

type VerificationStatus = 'PASSED' | 'NEEDS_REWORK' | 'FAILED';

/**
 * Semantic tones, not raw hexes: the fills ignored the colour scheme, and
 * white-on-amber fails contrast in either. Same shape as the attendance and
 * assignment tone maps.
 */
const STATUS_TONE: Record<VerificationStatus, 'success' | 'warning' | 'danger'> = {
  PASSED: 'success',
  NEEDS_REWORK: 'warning',
  FAILED: 'danger',
};


// Keys rather than nouns, resolved at render. The uppercase presentation is
// part of each translation rather than a .toUpperCase() call: casing rules are
// not universal, and Arabic and Urdu have no case at all.
const STATUS_LABEL_KEY: Record<VerificationStatus, string> = {
  PASSED: 'quality.outcomePASSED',
  NEEDS_REWORK: 'quality.outcomeNEEDS_REWORK',
  FAILED: 'quality.outcomeFAILED',
};

function deriveStatus(score: number): VerificationStatus {
  if (score >= 70) return 'PASSED';
  if (score >= 40) return 'NEEDS_REWORK';
  return 'FAILED';
}

export default function QualityVerificationScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [score, setScore] = useState(80);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // CRR §15: the checker uploads a photo WITH the rating.
  const picker = usePhotoPicker();

  const derivedStatus = deriveStatus(score);

  const handleSubmit = async () => {
    // CRR §15: the photo accompanies the rating. Checked here so the checker
    // is told before a round-trip over hotel wifi; the server enforces it too
    // and stays authoritative.
    if (picker.photos.length === 0) {
      Alert.alert(t('errors.title'), t('quality.photoRequired'));
      return;
    }
    setSaving(true);
    try {
      const verification = await api.quality.createVerification(
        { assignment_id: id, score, notes: notes || undefined },
        picker.photos
      );
      // Route to the evidence screen rather than just dismissing. Two reasons:
      // it is the only in-app way to reach that screen (it was previously
      // reachable ONLY by tapping a push notification, so a missed push meant
      // the evidence could never be viewed), and for a failing score it is
      // where the checker assigns rework — CRR §14.
      Alert.alert(t('common.submitted'), t('quality.recorded'), [
        {
          text: t('common.ok'),
          onPress: () =>
            verification?.id
              ? router.replace(`/verification/${verification.id}`)
              : router.back(),
        },
      ]);
    } catch (e: any) {
      Alert.alert(t("errors.title"), e.message ?? t('quality.submitFailed'));
    } finally {
      setSaving(false);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, gap: 12 },
    card: { backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 16 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    scoreDisplay: { fontSize: 52, fontWeight: '800', color: theme.text, width: 80 },
    adjustCol: { flex: 1, gap: 8 },
    adjustRow: { flexDirection: 'row', gap: 8 },
    adjustBtn: {
      flex: 1,
      backgroundColor: theme.background,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
    },
    adjustBtnText: { fontSize: 16, fontWeight: '700', color: theme.text },
    outcomeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    outcomeBadge: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 2,
    },
    outcomeBadgeText: { fontSize: 13, fontWeight: '700' },
    outcomeHint: { fontSize: 12, color: theme.textSecondary, flex: 1 },
    photoActions: { flexDirection: 'row', gap: 8 },
    photoButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.textSecondary,
      alignItems: 'center',
    },
    photoButtonText: { color: theme.text, fontWeight: '600', fontSize: 13 },
    photoError: { color: theme.danger, fontSize: 12, marginTop: 8 },
    photoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 10,
    },
    photoName: { color: theme.textSecondary, fontSize: 12, flexShrink: 1 },
    photoRemove: { color: theme.danger, fontSize: 12, fontWeight: '600' },
    notesInput: {
      backgroundColor: theme.background,
      borderRadius: 10,
      padding: 12,
      color: theme.text,
      fontSize: 14,
      minHeight: 80,
      textAlignVertical: 'top',
    },
    button: {
      backgroundColor: theme.primary,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
    },
    buttonText: { color: theme.onPrimary, fontSize: 16, fontWeight: '700' },
  });

  const adj = (delta: number) => setScore((s) => Math.min(100, Math.max(0, s + delta)));

  return (
    <>
      <Stack.Screen options={{ title: t('nav.qualityCheck'), headerShown: true }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('fields.score0to100')}</Text>
          <View style={styles.scoreRow}>
            <Text style={styles.scoreDisplay}>{score}</Text>
            <View style={styles.adjustCol}>
              <View style={styles.adjustRow}>
                <TouchableOpacity style={styles.adjustBtn} onPress={() => adj(10)}>
                  <Text style={styles.adjustBtnText}>+10</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.adjustBtn} onPress={() => adj(-10)}>
                  <Text style={styles.adjustBtnText}>-10</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.adjustRow}>
                <TouchableOpacity style={styles.adjustBtn} onPress={() => adj(1)}>
                  <Text style={styles.adjustBtnText}>+1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.adjustBtn} onPress={() => adj(-1)}>
                  <Text style={styles.adjustBtnText}>-1</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("quality.outcome")}</Text>
          <View style={styles.outcomeRow}>
            {/* Paired solid/subtle tokens rather than a hex plus an alpha
                suffix: `${hex}22` produced a wash that only worked on a light
                ground, so in dark mode the badge sat invisibly on the card. */}
            <View
              style={[
                styles.outcomeBadge,
                {
                  borderColor: theme[STATUS_TONE[derivedStatus]],
                  backgroundColor: theme[`${STATUS_TONE[derivedStatus]}Subtle`],
                },
              ]}
            >
              <Text
                style={[styles.outcomeBadgeText, { color: theme[STATUS_TONE[derivedStatus]] }]}
              >
                {t(STATUS_LABEL_KEY[derivedStatus])}
              </Text>
            </View>
            <Text style={styles.outcomeHint}>{t("quality.determinedByScore")}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("fields.notes")}</Text>
          <TextInput
            style={styles.notesInput}
            placeholder={t("quality.describeFindingsPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>

        {/* CRR §15: photo evidence accompanies the rating. Camera first --
            the checker is standing in the room they are inspecting -- with
            the library as the fallback for an already-taken shot or a denied
            camera permission. */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('quality.photos')}</Text>
          <View style={styles.photoActions}>
            <TouchableOpacity style={styles.photoButton} onPress={picker.takePhoto}>
              <Text style={styles.photoButtonText}>{t('quality.takePhoto')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoButton} onPress={picker.pickFromLibrary}>
              <Text style={styles.photoButtonText}>{t('quality.chooseFromLibrary')}</Text>
            </TouchableOpacity>
          </View>
          {picker.error ? <Text style={styles.photoError}>{picker.error}</Text> : null}
          {picker.photos.map((photo, i) => (
            <View key={`${photo.uri}-${i}`} style={styles.photoRow}>
              <Text style={styles.photoName} numberOfLines={1}>
                {photo.name}
              </Text>
              <TouchableOpacity onPress={() => picker.removeAt(i)}>
                <Text style={styles.photoRemove}>{t('common.remove')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.button, saving && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{t("quality.submitVerification")}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}
