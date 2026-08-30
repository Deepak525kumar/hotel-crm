import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { BackLink } from '@/components/BackLink';
import { useTheme } from '@/hooks/use-theme';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import type { QualityCheck } from '@/types/api';

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
  // What the checker actually found. The push payload carries only the
  // one-line note; a worker standing in the room with "redo the bathroom" and
  // no picture of what was wrong cannot reliably fix it (owner decision,
  // 2026-08-30). Loaded separately so a failure here still leaves the upload
  // form usable -- the instruction in `notes` is enough to proceed on.
  const [check, setCheck] = useState<(QualityCheck & { current_round_number: number }) | null>(null);
  const [evidence, setEvidence] = useState<{ key: string; url: string | null }[]>([]);
  // What the worker has ALREADY sent for this round. Without it they submit
  // into silence: the screen looked identical before and after uploading, so
  // the only way to confirm anything arrived was to ask the checker.
  const [mine, setMine] = useState<{ key: string; url: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await api.quality.checkForRework(id);
        if (cancelled) return;
        setCheck(c);
        // The checker's own photographs only. Round evidence is what the
        // worker is about to produce, so showing it back to them here would
        // just be their own previous attempt.
        const p = await api.quality.checkPhotos(c.id);
        if (cancelled) return;
        setEvidence(p.photos ?? []);
        // This round's own evidence, matched by round number rather than by
        // position: rounds are ordered but a screen should not depend on that.
        const thisRound = (p.rework_rounds ?? []).find(
          (r) => r.round_number === c.current_round_number
        );
        setMine(thisRound?.photos ?? []);
      } catch {
        // Deliberately silent: this is context, not the task. The upload form
        // below still works, and surfacing an error banner for missing context
        // would read as though the rework itself could not be loaded.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const submit = async () => {
    setError(null);
    if (picker.photos.length === 0) {
      setError(t('quality.reworkPhotoRequired'));
      return;
    }
    setSaving(true);
    try {
      await api.quality.completeRework(id, picker.photos);
      // Re-read so the section below shows what was just sent. The worker can
      // submit again -- to add a shot they missed, or replace a bad one -- and
      // seeing the result is what tells them whether they need to.
      void reload();
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
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photo: { width: 96, height: 96, borderRadius: 10, backgroundColor: theme.background },
    missing: {
      width: 96,
      height: 96,
      borderRadius: 10,
      backgroundColor: theme.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 6,
    },
    missingText: { color: theme.textSecondary, fontSize: 10, textAlign: 'center' },
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
        {/* What the checker found: the room, their score, their note, and the
            photographs they took. This screen used to show only `notes` from
            the push payload. */}
        {check ? (
          <View style={styles.card}>
            <View style={styles.headRow}>
              <ThemedText type="smallBold">
                {t('quality.roomLabel')} {check.room_number}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('quality.reworkRoundTitle', { number: check.current_round_number })}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.originalCheckTitle')}
              {check.checked_by ? ` · ${check.checked_by.first_name}` : ''}
            </ThemedText>
            {check.notes ? <ThemedText type="small">{check.notes}</ThemedText> : null}
            {evidence.length > 0 ? (
              <View style={styles.grid}>
                {evidence.map((photo) =>
                  photo.url ? (
                    <Pressable key={photo.key} onPress={() => void Linking.openURL(photo.url as string)}>
                      <Image source={{ uri: photo.url }} style={styles.photo} resizeMode="cover" />
                    </Pressable>
                  ) : (
                    // Storage unconfigured. Shown, not hidden: a broken bucket
                    // must read as a missing image, not as an inspection with
                    // no evidence behind it.
                    <View key={photo.key} style={styles.missing}>
                      <Text style={styles.missingText}>{t('quality.photoUnavailable')}</Text>
                    </View>
                  )
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* The instruction for THIS round. Mandatory when a checker assigns
            rework, so it is always present and worth showing prominently.
            Prefers the freshly loaded round's note over the one the push
            carried, which is stale once a second round opens. */}
        {check?.rework_notes ?? notes ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.checkerNotesTitle')}
            </ThemedText>
            <ThemedText type="small">{check?.rework_notes ?? notes}</ThemedText>
          </View>
        ) : null}

        {/* What the worker has already sent for this round. Placed above the
            upload controls so it answers "did that go through?" before they
            reach for the camera again. */}
        {mine.length > 0 ? (
          <View style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.yourEvidenceTitle', { count: mine.length })}
            </ThemedText>
            <View style={styles.grid}>
              {mine.map((photo) =>
                photo.url ? (
                  <Pressable key={photo.key} onPress={() => void Linking.openURL(photo.url as string)}>
                    <Image source={{ uri: photo.url }} style={styles.photo} resizeMode="cover" />
                  </Pressable>
                ) : (
                  <View key={photo.key} style={styles.missing}>
                    <Text style={styles.missingText}>{t('quality.photoUnavailable')}</Text>
                  </View>
                )
              )}
            </View>
            {/* Says plainly that sending more is allowed. The server used to
                refuse a second submission outright, so a worker who noticed a
                bad photo had no way to correct it. */}
            <ThemedText type="small" themeColor="textSecondary">
              {t('quality.canAddMoreEvidence')}
            </ThemedText>
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
