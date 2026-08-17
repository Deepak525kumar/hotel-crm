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

// 1-indexed to match the star value; index 0 is unused. Keys, not nouns.
const SCORE_LABEL_KEY = [
  '',
  'ratings.score1',
  'ratings.score2',
  'ratings.score3',
  'ratings.score4',
  'ratings.score5',
];

export default function RatingScreen() {
  const { t } = useTranslation();
  const { id, worker_id } = useLocalSearchParams<{ id: string; worker_id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [score, setScore] = useState(4);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!worker_id) {
      Alert.alert(t("errors.title"), t('ratings.workerIdMissing'));
      return;
    }
    setSaving(true);
    try {
      await api.quality.createRating({
        assignment_id: id,
        worker_id,
        score: score * 20, // scale 1-5 to 0-100
        comment: comment || undefined,
      });
      Alert.alert(t("common.submitted"), t('ratings.recorded'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert(t("errors.title"), e.message ?? t('ratings.submitFailed'));
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
    starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 8 },
    star: { fontSize: 44 },
    scoreLabel: {
      textAlign: 'center',
      fontSize: 16,
      fontWeight: '600',
      color: theme.text,
      marginTop: 8,
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
      backgroundColor: '#f59e0b',
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
    },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });

  return (
    <>
      <Stack.Screen options={{ title: t('nav.rateWorker'), headerShown: true }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('ratings.stars1to5')}</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <TouchableOpacity key={s} onPress={() => setScore(s)} activeOpacity={0.7}>
                <Text style={styles.star}>{s <= score ? '⭐' : '☆'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.scoreLabel}>{t(SCORE_LABEL_KEY[score])}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("ratings.comment")}</Text>
          <TextInput
            style={styles.notesInput}
            placeholder={t("ratings.feedbackPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            value={comment}
            onChangeText={setComment}
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
            <Text style={styles.buttonText}>{t("ratings.submit")}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}
