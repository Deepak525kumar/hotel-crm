import { RatingTierBadge } from '@/components/RatingTierBadge';
import { StyleSheet, FlatList, ActivityIndicator, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { LeaderboardEntry } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function RatingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.quality.leaderboard()
      .then((res) => setEntries(Array.isArray(res) ? res : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />
        <ThemedText type="subtitle" style={styles.header}>{t('nav.leaderboard')}</ThemedText>
        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item, index }) => (
              <ThemedView type="backgroundElement" style={styles.card}>
                <View style={styles.rankContainer}>
                  <ThemedText type="smallBold" style={styles.rank}>
                    {index < 3 ? MEDAL[index] : `#${index + 1}`}
                  </ThemedText>
                  <RatingTierBadge tier={item.rating_tier} />
                </View>
                <View style={styles.info}>
                  <ThemedText type="smallBold">
                    {item.worker
                      ? `${item.worker.first_name} ${item.worker.last_name}`
                      : item.worker_id}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.average_score.toFixed(1)} ★ · {item.total_assignments} shifts
                    {item.worker.employment_record?.primary_hotel
                      ? ` · ${item.worker.employment_record.primary_hotel.name}`
                      : ''}
                  </ThemedText>
                </View>
              </ThemedView>
            )}
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="small" themeColor="textSecondary">{t('leaderboard.none')}</ThemedText>
              </ThemedView>
            }
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  back: { marginBottom: Spacing.three },
  header: { marginBottom: Spacing.three },
  loader: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  card: { borderRadius: Spacing.two, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rankContainer: { width: 36, alignItems: 'center' },
  rank: { fontSize: 18 },
  info: { flex: 1, gap: Spacing.one },
  empty: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center', marginTop: Spacing.four },
});
