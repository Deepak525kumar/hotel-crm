import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { api } from '@/lib/api';
import type { Notification } from '@/types/api';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await api.notifications.list();
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      // show empty state on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleMarkRead = async (id: string) => {
    try {
      await api.notifications.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch {
      // ignore
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
    headerSub: { fontSize: 13, color: theme.textSecondary },
    card: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 12,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 8,
      borderLeftWidth: 3,
    },
    cardRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6', marginTop: 5 },
    cardContent: { flex: 1 },
    title: { fontSize: 14, fontWeight: '700', color: theme.text },
    message: { fontSize: 13, color: theme.textSecondary, marginTop: 3 },
    time: { fontSize: 11, color: theme.textSecondary, marginTop: 6 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyText: { fontSize: 16, color: theme.textSecondary, textAlign: 'center' },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[
        styles.card,
        { borderLeftColor: item.is_read ? theme.backgroundElement : '#3b82f6' },
      ]}
      onPress={() => { if (!item.is_read) handleMarkRead(item.id); }}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        {!item.is_read && <View style={styles.dot} />}
        <View style={styles.cardContent}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.message}>{item.message}</Text>
          <Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

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
        <Text style={styles.headerSub}>{t("notifications.tapToMarkRead")}</Text>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={notifications.length === 0 ? { flex: 1 } : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor={theme.text}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t("notifications.noneYet")}</Text>
          </View>
        }
      />
    </View>
  );
}
