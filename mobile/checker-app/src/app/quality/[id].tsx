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
  const [saving, setSaving] = useState(false);

  const derivedStatus = deriveStatus(score);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.quality.createVerification({
        assignment_id: id,
        score,
        notes: notes || undefined,
      });
      Alert.alert(t("common.submitted"), t('quality.recorded'), [
        { text: t('common.ok'), onPress: () => router.back() },
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
