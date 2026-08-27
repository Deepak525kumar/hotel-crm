import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Badge, Card, EmptyState, ScreenHeader } from '@/components/ui';
import { assignmentStatusTone } from '@/lib/assignment-status-tone';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { InspectableWorker } from '@/types/api';

/**
 * Step one of Start checking: pick the worker.
 *
 * The list is whatever `GET /quality/inspectable-workers` returns — workers
 * with a shift today at a hotel this checker is working (ADR-072 §2.5). The
 * client sends no hotel and does no filtering of its own: scope is the
 * server's to decide, and a client-side filter over a wider list would be a
 * disclosure, not a gate.
 *
 * Selecting a worker goes to their assignment's inspection screen, which is
 * where photos, the checklist and the score are captured.
 */
export default function SelectWorkerScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const { data, isLoading, isValidating, mutate, error } = useSWR(
    '/quality/inspectable-workers',
    () => api.quality.inspectableWorkers()
  );

  const workers = data?.workers ?? [];

  const renderItem = ({ item }: { item: InspectableWorker }) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/rating/${item.assignment_id}`)}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <ThemedText type="smallBold">
            {item.worker_name ?? t('quality.workerUnavailable')}
          </ThemedText>
          <Badge tone={assignmentStatusTone(item.status)} label={item.status.replace('_', ' ')} />
        </View>
        {item.hotel_name ? (
          <ThemedText type="small" themeColor="textSecondary">
            {item.hotel_name}
          </ThemedText>
        ) : null}
      </Card>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader
          title={t('quality.selectWorkerTitle')}
          subtitle={t('quality.selectWorkerSubtitle')}
        />
        {isLoading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <FlatList
            data={workers}
            keyExtractor={(item) => item.assignment_id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={isValidating} onRefresh={() => void mutate()} />
            }
            ListEmptyComponent={
              <EmptyState
                title={
                  error ? t('common.loadFailed') : t('quality.noInspectableWorkers')
                }
                body={error ? undefined : t('quality.noInspectableWorkersBody')}
              />
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  list: { padding: Spacing.four, gap: Spacing.two },
  card: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  loader: { marginTop: Spacing.six },
});
