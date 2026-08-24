import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { useTheme } from '@/hooks/use-theme';
import { translateApiError } from '@/lib/api-error-i18n';
import type { Assignment } from '@/types/api';

/**
 * The checker's own assignments.
 *
 * Not cosmetic: a checker may only verify attendance or record an inspection
 * at a hotel where they hold an ACTIVE assignment that day
 * (`quality/service.ts` enforces this on both paths). Without this screen the
 * rule was invisible — a checker refused with "Checker must have an active
 * assignment at the same hotel on the same day" had no way to see where they
 * were actually rostered, or that they were rostered at all.
 *
 * Deliberately read-only. A checker does not accept or decline work here; the
 * worker app's own shifts screen is a different flow with different rules.
 */
export default function ShiftsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [items, setItems] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) setLoading(true);
      setError(null);
      try {
        const res = await api.assignments.mine();
        setItems(res.data ?? []);
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
      gap: 4,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    day: { fontSize: 15, fontWeight: '600', color: theme.text },
    sub: { fontSize: 13, color: theme.textSecondary },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    badgeText: { fontSize: 12, fontWeight: '600', color: '#fff' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyText: { fontSize: 15, color: theme.textSecondary, textAlign: 'center' },
    error: { color: '#E53E3E', textAlign: 'center', padding: 16, fontSize: 14 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });

  const statusColor = (s: string) =>
    s === 'COMPLETED' ? '#22c55e' : s === 'CANCELLED' ? '#ef4444' : '#3b82f6';

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
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.day}>
                {item.confirmed_at ? new Date(item.confirmed_at).toLocaleDateString() : '—'}
              </Text>
              <View style={[styles.badge, { backgroundColor: statusColor(item.status) }]}>
                <Text style={styles.badgeText}>{item.status}</Text>
              </View>
            </View>
            {/* Hotel id rather than a name: the assignment payload carries no
                hotel name, and fetching one per row would be an N+1 for a
                screen that exists to answer "am I rostered, and where". */}
            <Text style={styles.sub}>
              {t('shifts.hotel')}: ···{item.hotel_id.slice(-6)}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('shifts.noneAssigned')}</Text>
          </View>
        }
      />
    </View>
  );
}
