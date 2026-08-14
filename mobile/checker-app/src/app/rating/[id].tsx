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

const SCORE_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

export default function RatingScreen() {
  const { id, worker_id } = useLocalSearchParams<{ id: string; worker_id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [score, setScore] = useState(4);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!worker_id) {
      Alert.alert('Error', 'Worker ID missing from URL');
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
      Alert.alert('Submitted', 'Rating recorded.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to submit');
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
      <Stack.Screen options={{ title: 'Rate Worker', headerShown: true }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Rating (1–5 stars)</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <TouchableOpacity key={s} onPress={() => setScore(s)} activeOpacity={0.7}>
                <Text style={styles.star}>{s <= score ? '⭐' : '☆'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.scoreLabel}>{SCORE_LABELS[score]}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Comment</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Write your feedback..."
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
            <Text style={styles.buttonText}>Submit Rating</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}
