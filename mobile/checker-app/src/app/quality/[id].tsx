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

// TREQ-005 / CRR §15's confirmed inspection checklist, in the order the
// requirement lists them. Kept as a local constant mirroring the backend's
// INSPECTION_CHECKLIST_ITEMS (quality/inspection-checklist.ts) — the app has
// no shared-constants package with the server, and the labels already exist
// under the `checklist.*` i18n namespace in all six locales.
const CHECKLIST_ITEMS = [
  'dust',
  'bathroom',
  'bed_linen',
  'mirror',
  'floor',
  'minibar_restocking',
  'fragrance_amenities',
  'other',
] as const;

type VerificationStatus = 'PASSED' | 'NEEDS_REWORK' | 'FAILED';

const STATUS_COLORS: Record<VerificationStatus, string> = {
  PASSED: '#22c55e',
  NEEDS_REWORK: '#f59e0b',
  FAILED: '#ef4444',
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
  // Per-item scores, kept as strings so a field can be genuinely empty
  // ("not assessed") rather than defaulting to 0, which would silently record
  // a failing mark for something the checker never looked at.
  const [criteria, setCriteria] = useState<Partial<Record<string, string>>>({});
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
    // Only include items the checker actually filled in, and validate them
    // here so a bad value is caught before the upload rather than after it.
    const criteriaScores: Record<string, number> = {};
    for (const item of CHECKLIST_ITEMS) {
      const raw = criteria[item];
      if (raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        Alert.alert(t('errors.title'), t('quality.checklistItemRange'));
        return;
      }
      criteriaScores[item] = value;
    }

    setSaving(true);
    try {
      const verification = await api.quality.createVerification(
        {
          assignment_id: id,
          score,
          notes: notes || undefined,
          criteria_scores: Object.keys(criteriaScores).length > 0 ? criteriaScores : undefined,
        },
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
    photoError: { color: '#E53E3E', fontSize: 12, marginTop: 8 },
    photoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 10,
    },
    photoName: { color: theme.textSecondary, fontSize: 12, flexShrink: 1 },
    photoRemove: { color: '#E53E3E', fontSize: 12, fontWeight: '600' },
    criteriaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 6,
    },
    criteriaLabel: { color: theme.text, fontSize: 14, flex: 1 },
    criteriaInput: {
      backgroundColor: theme.background,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: theme.text,
      fontSize: 14,
      width: 72,
      textAlign: 'center',
    },
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
      backgroundColor: '#7c3aed',
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
    },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
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
            <View
              style={[
                styles.outcomeBadge,
                {
                  borderColor: STATUS_COLORS[derivedStatus],
                  backgroundColor: `${STATUS_COLORS[derivedStatus]}22`,
                },
              ]}
            >
              <Text style={[styles.outcomeBadgeText, { color: STATUS_COLORS[derivedStatus] }]}>
                {t(STATUS_LABEL_KEY[derivedStatus])}
              </Text>
            </View>
            <Text style={styles.outcomeHint}>{t("quality.determinedByScore")}</Text>
          </View>
        </View>

        {/* TREQ-005 / CRR §15: the confirmed inspection checklist. Each item
            is optional and 0-100 — an empty field means "not assessed", which
            is different from scoring it zero. The headline score above stays
            the checker's own overall judgement; these do not compute it. */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('quality.checklist')}</Text>
          {CHECKLIST_ITEMS.map((item) => (
            <View key={item} style={styles.criteriaRow}>
              <Text style={styles.criteriaLabel}>{t(`checklist.${item}`)}</Text>
              <TextInput
                style={styles.criteriaInput}
                keyboardType="number-pad"
                placeholder="—"
                placeholderTextColor={theme.textSecondary}
                maxLength={3}
                value={criteria[item] ?? ''}
                onChangeText={(v) =>
                  setCriteria((prev) => ({ ...prev, [item]: v.replace(/[^0-9]/g, '') }))
                }
              />
            </View>
          ))}
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
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t("quality.submitVerification")}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}
