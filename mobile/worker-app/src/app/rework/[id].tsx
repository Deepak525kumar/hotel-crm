import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { BackLink } from '@/components/BackLink';
import { useTheme } from '@/hooks/use-theme';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';

/**
 * CRR §14: "Worker uploads a photo and clicks work done."
 *
 * Reached from the rework notification, which carries the rework assignment
 * id. The photo is mandatory rather than encouraged: it is what the checker
 * is notified WITH, so a completion without one gives them nothing to
 * re-inspect while still stopping the 20-minute escalation.
 */
export default function ReworkScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { id, notes } = useLocalSearchParams<{ id: string; notes?: string }>();
  const picker = usePhotoPicker();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (picker.photos.length === 0) {
      setError(t('quality.reworkPhotoRequired'));
      return;
    }
    setSaving(true);
    try {
      await api.quality.completeRework(id, picker.photos);
      Alert.alert(t('common.submitted'), t('quality.reworkDone', { when: '' }), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    } catch (e) {
      setError(translateApiError(e, t, 'errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, gap: 16 },
    card: { backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 16, gap: 12 },
    actions: { flexDirection: 'row', gap: 8 },
    action: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.textSecondary,
      alignItems: 'center',
    },
    actionText: { color: theme.text, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    name: { color: theme.textSecondary, fontSize: 12, flexShrink: 1 },
    remove: { color: '#E53E3E', fontSize: 12, fontWeight: '600' },
    error: { color: '#E53E3E', fontSize: 13 },
    submit: { backgroundColor: '#208AEF', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    submitText: { color: '#fff', fontWeight: '700' },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackLink />
        <ThemedText type="subtitle">{t('quality.reworkTitle')}</ThemedText>

        {/* The checker's note is the whole instruction -- it is mandatory when
            they assign rework, so it is always present and worth showing
            prominently rather than tucked into a subtitle. */}
        {notes ? (
          <View style={styles.card}>
            <ThemedText type="small">{notes}</ThemedText>
          </View>
        ) : null}

        <View style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('quality.photosHint', { max: 6 })}
          </ThemedText>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.action} onPress={picker.takePhoto}>
              <Text style={styles.actionText}>{t('quality.takePhoto')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.action} onPress={picker.pickFromLibrary}>
              <Text style={styles.actionText}>{t('quality.chooseFromLibrary')}</Text>
            </TouchableOpacity>
          </View>

          {picker.error ? <Text style={styles.error}>{picker.error}</Text> : null}

          {picker.photos.map((photo, i) => (
            <View key={`${photo.uri}-${i}`} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {photo.name}
              </Text>
              <TouchableOpacity onPress={() => picker.removeAt(i)}>
                <Text style={styles.remove}>{t('common.remove')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.submit, saving && { opacity: 0.6 }]}
          onPress={submit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>{t('quality.markDone')}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
