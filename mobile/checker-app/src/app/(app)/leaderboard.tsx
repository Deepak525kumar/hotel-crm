import { RatingTierBadge } from '@/components/RatingTierBadge';
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { api } from '@/lib/api';
import type { LeaderboardEntry } from '@/types/api';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const data = await api.quality.leaderboard();
      setEntries(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message ?? t('common.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
    headerSub: { fontSize: 13, color: theme.textSecondary },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.backgroundElement,
      borderRadius: 12,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 8,
    },
    rank: { width: 40, fontSize: 22, textAlign: 'center' },
    info: { flex: 1, marginLeft: 8 },
    name: { fontSize: 15, fontWeight: '600', color: theme.text },
    sub: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    scoreCol: { alignItems: 'flex-end' },
    scoreNum: { fontSize: 20, fontWeight: '800', color: theme.text },
    stars: { fontSize: 11, color: '#f59e0b', marginTop: 2 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyText: { fontSize: 16, color: theme.textSecondary, textAlign: 'center' },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    error: { color: '#ef4444', textAlign: 'center', padding: 16 },
  });

  const renderItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const roundedScore = Math.round(item.average_score);
    return (
      <View style={styles.card}>
        <Text style={styles.rank}>{index < 3 ? MEDALS[index] : `${index + 1}`}</Text>
        <View style={styles.info}>
          <Text style={styles.name}>
            {item.worker.first_name} {item.worker.last_name}
          </Text>
          <Text style={styles.sub}>
            {item.total_ratings} ratings · {Math.round(item.completion_rate * 100)}% completion
            {item.worker_cancellations > 0
              ? ` · ${item.worker_cancellations} absence${item.worker_cancellations === 1 ? '' : 's'}`
              : ''}
          </Text>
        </View>
        <View style={styles.scoreCol}>
          <Text style={styles.scoreNum}>{item.average_score.toFixed(1)}</Text>
          <RatingTierBadge tier={item.rating_tier} />
          <Text style={styles.stars}>
            {'★'.repeat(roundedScore)}{'☆'.repeat(Math.max(0, 5 - roundedScore))}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loading]}>
        <ActivityIndicator size="large" color={theme.text} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerSub}>{t("leaderboard.topPerformers")}</Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={entries.length === 0 ? { flex: 1 } : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor={theme.text}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t("leaderboard.none")}</Text>
          </View>
        }
      />
    </View>
  );
}
