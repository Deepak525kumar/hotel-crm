import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BackLink } from '@/components/BackLink';
import { Card, EmptyState, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNotificationStore } from '@/stores/notification-store';
import type { Notification } from '@/types/api';

/**
 * Alerts.
 *
 * Rebuilt on the shared UI primitives to match worker-app's list. Reached from
 * the bell in every screen header rather than a bottom tab -- the tab bar is
 * for what a checker touches while working a queue.
 */
function NotifCard({ item, onPress }: { item: Notification; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
      <Card>
        <View style={styles.row}>
          {/* Unread marker takes the accent token. Both apps previously
              hardcoded a blue hex here, which ignored the colour scheme and no
              longer matched the accent at all. */}
          {!item.is_read ? (
            <View style={[styles.dot, { backgroundColor: theme.primary }]} />
          ) : (
            <View style={styles.dotSpacer} />
          )}
          <View style={styles.body}>
            <ThemedText type="smallBold">{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.message}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(item.created_at).toLocaleString()}
            </ThemedText>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refreshUnread = useNotificationStore((s) => s.refresh);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await api.notifications.list();
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      // Leaves the previous list in place; the empty state covers a first load.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePress = async (item: Notification) => {
    if (item.is_read) return;
    try {
      await api.notifications.markAsRead(item.id);
      setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
      // Keeps the header badge honest: without this it keeps counting a
      // notification the checker is looking at.
      void refreshUnread();
    } catch {
      // The row stays unread and can be tapped again.
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />
        <ScreenHeader title={t('nav.alerts')} />

        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void load(true);
                }}
              />
            }
            renderItem={({ item }) => <NotifCard item={item} onPress={() => void handlePress(item)} />}
            ListEmptyComponent={<EmptyState title={t('notifications.empty')} />}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  loader: { marginTop: Spacing.five },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  row: { flexDirection: 'row', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  dotSpacer: { width: 8 },
  body: { flex: 1, gap: 2 },
});
