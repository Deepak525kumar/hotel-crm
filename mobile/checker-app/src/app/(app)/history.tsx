import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { useTheme } from '@/hooks/use-theme';
import { translateApiError } from '@/lib/api-error-i18n';
import type { QualityVerification } from '@/types/api';

/**
 * Past inspections.
 *
 * Before this screen an inspection was unreachable once it left the pending
 * attendance queue: the checker app had no history surface, so the only way
 * back to a recorded inspection — and its photo evidence — was tapping a push
 * notification while it was still in the tray. A checker could not revisit
 * what they had recorded, which also made the evidence effectively one-shot.
 *
 * Rows open the evidence screen, which is also where rework is assigned, so
 * an inspection that needs rework can be actioned from here rather than only
 * in the moments right after submitting it.
 */
export default function HistoryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<QualityVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) setLoading(true);
      setError(null);
      try {
        const data = await api.quality.listVerifications();
        setItems(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(translateApiError(e, t, 'common.loadFailed'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    card: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 12,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 8,
      gap: 6,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    score: { fontSize: 20, fontWeight: '700', color: theme.text },
    sub: { fontSize: 12, color: theme.textSecondary },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
    pill: {
      alignSelf: 'flex-start',
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: '#f59e0b22',
    },
    pillText: { color: '#b45309', fontSize: 11, fontWeight: '600' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyText: { fontSize: 15, color: theme.textSecondary, textAlign: 'center' },
    error: { color: '#E53E3E', textAlign: 'center', padding: 16, fontSize: 14 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });

  const statusColor = (s: string) =>
    s === 'PASSED' ? '#22c55e' : s === 'NEEDS_REWORK' ? '#f59e0b' : '#ef4444';

  if (loading) {
    return (
      <View style={[styles.container, styles.loading]}>
        <ActivityIndicator size="large" color={theme.text} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={items.length === 0 ? { flex: 1 } : { paddingTop: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
            tintColor={theme.text}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => router.push(`/verification/${item.id}`)}
          >
            <View style={styles.row}>
              <Text style={styles.score}>{item.score}</Text>
              <View style={[styles.badge, { backgroundColor: statusColor(item.status) }]}>
                <Text style={styles.badgeText}>{item.status}</Text>
              </View>
            </View>
            <Text style={styles.sub}>{new Date(item.created_at).toLocaleString()}</Text>
            {item.rework_required ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>
                  {item.rework_completed_at
                    ? t('quality.reworkCompleted')
                    : t('quality.reworkPending')}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('quality.noInspections')}</Text>
          </View>
        }
      />
    </View>
  );
}
