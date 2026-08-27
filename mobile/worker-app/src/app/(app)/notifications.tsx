import { StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { Notification } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/use-theme';

function NotifCard({ item, onPress }: { item: Notification; onPress: () => void }) {
  const theme = useTheme();
  const unread = !item.read_at;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
      <ThemedView type={unread ? 'backgroundSelected' : 'backgroundElement'} style={styles.card}>
        <View style={styles.cardRow}>
          <ThemedText type="smallBold" style={styles.flex}>{item.title}</ThemedText>
          {unread && <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
        </View>
        <ThemedText type="small" themeColor="textSecondary">{item.message}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
          {new Date(item.created_at).toLocaleString()}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.notifications.list();
      setItems(Array.isArray(res) ? res : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const handlePress = async (item: Notification) => {
    if (!item.read_at) {
      await api.notifications.markRead(item.id).catch(() => {});
      setItems((prev) =>
        prev.map((n) => n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)
      );
    }

    if (item.type === 'JOB_REQUEST_BROADCAST' && item.data?.work_request_id) {
      router.push(`/offer/${item.data.work_request_id}`);
    } else if (item.type === 'ASSIGNMENT_CONFIRMED' && item.data?.assignment_id) {
      router.push(`/shift/${item.data.assignment_id}`);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.header}>{t('notifications.title')}</ThemedText>
        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <NotifCard item={item} onPress={() => handlePress(item)} />
            )}
            ListEmptyComponent={
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="small" themeColor="textSecondary">{t('notifications.none')}</ThemedText>
              </ThemedView>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
  header: { marginBottom: Spacing.three },
  loader: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  // Accent token, not a hex: the hardcoded blue ignored the colour scheme
  // and no longer matched the app's accent at all.
  dot: { width: 8, height: 8, borderRadius: 4 },
  time: { fontSize: 11 },
  empty: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center', marginTop: Spacing.four },
});
