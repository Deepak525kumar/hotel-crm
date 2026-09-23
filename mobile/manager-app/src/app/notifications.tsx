import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  Button,
  DataRow,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SkeletonList,
  Spacing,
  ThemedView,
  api,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

/**
 * Notifications.
 *
 * MARK-ALL IS A FAN-OUT, NOT ONE CALL. There is no bulk endpoint -- the web
 * does the same thing. That matters because a fan-out can PARTIALLY succeed:
 * this reports how many were actually marked rather than optimistically
 * clearing the badge, which would hide unread work behind a clean screen.
 */
export default function Notifications() {
  const { t } = useTranslation();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, error, isLoading, mutate } = useSWR('notifications', () =>
    api.notifications.list()
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  const rows = data ?? [];
  const unread = rows.filter((n) => !n.read_at);

  const markAll = useCallback(async () => {
    if (busy || unread.length === 0) return;
    setBusy(true);
    try {
      // allSettled, not all: one failure must not abandon the rest, and the
      // count below must reflect what actually happened.
      const results = await Promise.allSettled(
        unread.map((n) => api.notifications.markRead(n.id))
      );
      await mutate();
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast.show(`${results.length - failed}/${results.length}`, 'danger');
      } else {
        toast.show(t('notifications.allCaughtUp'), 'success');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, unread, mutate, toast, t]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <BackLink />
          <ScreenHeader title={t('nav.notifications')} />

          {unread.length > 0 ? (
            <Button
              label={t('notifications.markAllRead')}
              variant="ghost"
              loading={busy}
              onPress={() => void markAll()}
            />
          ) : null}

          {isLoading ? (
            <SkeletonList rows={6} />
          ) : error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('notifications.none')} />
          ) : (
            rows.map((n) => (
              <DataRow
                key={n.id}
                title={n.title}
                subtitle={n.message}
                trailing={
                  n.read_at ? null : <Badge label={t('status.unread')} tone="primary" />
                }
                // Opens the notification (2026-09-23). Tapping a row used to
                // mark it read and nothing else, so an alert about a no-show
                // told you it had been read and left you where you were. The
                // detail screen marks it read on open, so the row no longer
                // needs to.
                onPress={() => router.push(`/notification/${n.id}`)}
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
