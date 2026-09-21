import { starString } from '@/lib/stars';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';

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
    // Same values as every sibling screen's `safeArea` (jobs.tsx, history.tsx).
    safeArea: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: 12 },
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
    stars: { fontSize: 11, color: theme.warning, marginTop: 2 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyText: { fontSize: 16, color: theme.textSecondary, textAlign: 'center' },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    error: { color: theme.danger, textAlign: 'center', padding: 16 },
  });

  const renderItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
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
          {/* An unrated worker has average_score 0 and total_ratings 0, and
              printing "0.0" next to real scores reads as the worst performer
              on the board rather than as "nobody has checked them yet". The
              web leaderboard has always shown "—" here; this did not, so the
              same worker looked bottom-ranked on mobile and unrated on the
              web. RatingTierBadge already handles the null tier the server
              sends for them, and starString would draw zero stars, so both
              are suppressed too rather than left to render an empty verdict. */}
          {item.total_ratings > 0 ? (
            <>
              <Text style={styles.scoreNum}>{item.average_score.toFixed(1)}</Text>
              <RatingTierBadge tier={item.rating_tier} />
              <Text style={styles.stars}>{starString(item.average_score)}</Text>
            </>
          ) : (
            <Text style={styles.scoreNum}>—</Text>
          )}
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
      {/* Reported 2026-09-21: the title rendered UNDER the status bar, with
          the clock drawn through the word and the first letter against the
          screen edge. This screen was the only one in (app)/ laying its
          header out in a bare View -- every sibling (jobs, history, profile,
          shifts, calendar, attendance, notifications, index) wraps in
          SafeAreaView with the same `safeArea` style. `paddingTop: 4` cannot
          stand in for the inset: it is a fixed number, and the notch it has
          to clear is not. */}
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader
          title={t('nav.leaderboard')}
          subtitle={t('leaderboard.topPerformers')}
          action={<NotificationBell />}
        />
      </SafeAreaView>
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
