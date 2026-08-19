import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { BackLink } from '@/components/BackLink';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';

/**
 * CRR §14: "Checker is notified with the photo + details."
 *
 * This is where that photo is actually seen. The keys stored on the
 * verification are useless to a client on their own -- the bucket is private
 * -- so the evidence was write-only until this screen existed: uploaded,
 * recorded, and impossible to look at.
 *
 * URLs are minted per request and expire in 15 minutes, so they are fetched
 * here rather than carried in the push payload, which could sit unread in a
 * tray for hours.
 */
export default function VerificationEvidenceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [photos, setPhotos] = useState<{ key: string; url: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.quality
      .verificationPhotos(id)
      .then((r) => {
        if (!cancelled) setPhotos(r.photos);
      })
      .catch((e) => {
        if (!cancelled) setError(translateApiError(e, t, 'errors.generic'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, gap: 16 },
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
    error: { color: '#E53E3E', fontSize: 13 },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackLink />
        <ThemedText type="subtitle">{t('quality.evidence')}</ThemedText>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!photos && !error ? <ActivityIndicator color={theme.text} /> : null}

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
      </ScrollView>
    </SafeAreaView>
  );
}
