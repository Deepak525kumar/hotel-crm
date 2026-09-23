import { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { formatDateTime } from '@/lib/assignment-format';
import { resolvePushTapRoute } from '@/lib/push-routes';

/**
 * One notification — S-30's detail half.
 *
 * The list could mark a row read and nothing else: tapping a notification
 * about a no-show told you it had been read and left you exactly where you
 * were. This screen shows the full message and, where the payload names
 * something, offers a way to go to it.
 *
 * READ FROM THE LIST, NOT FROM AN ENDPOINT. There is no
 * `GET /notifications/:id` — the module exposes the list, a mark-read and a
 * mark-all-read, and nothing else. Rather than invent a route for one screen,
 * this finds the row in the same list the previous screen already loaded;
 * SWR's cache means the common case costs no request at all. If the id is not
 * in the list (a deep link into a session that never loaded it, or a
 * notification older than the list's window) the fetch still populates it.
 *
 * `resolvePushTapRoute` is deliberately the SAME resolver the push handler
 * uses. Two mappings would drift, and the failure would be silent: tapping
 * the push would open the shift while tapping the row in the app opened
 * something else, or nothing.
 */
export default function NotificationDetail() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, error, isLoading, mutate } = useSWR('notifications', () =>
    api.notifications.list()
  );

  const notification = (data ?? []).find((n) => n.id === String(id));

  /**
   * Marking read is fire-and-forget on open, and deliberately not awaited
   * before rendering: a manager opening an alert wants to read it, not to
   * wait for a write. A failure here leaves the row unread, which is
   * recoverable and honest — the alternative, a blocking spinner over text
   * that is already on the device, is not.
   */
  const markRead = useCallback(() => {
    if (!notification || notification.read_at) return;
    void api.notifications
      .markRead(notification.id)
      .then(() => mutate())
      .catch(() => {
        // Swallowed on purpose: see above. The list still shows it unread.
      });
  }, [notification, mutate]);

  const target = notification
    ? resolvePushTapRoute({ type: notification.type, ...(notification.data ?? {}) })
    : null;

  return (
    <ThemedView style={styles.root} onLayout={markRead}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('nav.notifications')} />

          {isLoading ? (
            <SkeletonList rows={3} />
          ) : error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : !notification ? (
            <EmptyState title={t('notifications.noneYet')} />
          ) : (
            <>
              <Card>
                <ThemedText type="h2">{notification.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDateTime(notification.created_at)}
                </ThemedText>
                {!notification.read_at ? (
                  <Badge label={t('status.unread')} tone="primary" />
                ) : null}
                <ThemedText>{notification.message}</ThemedText>
              </Card>

              {/*
                Only when the payload actually names a target. The resolver
                falls back to '/notifications' for a type it does not map, and
                a button that returns you to the list you came from is worse
                than no button.
              */}
              {target && target !== '/notifications' ? (
                <Button
                  label={t('documents.view')}
                  onPress={() => router.push(target as Parameters<typeof router.push>[0])}
                />
              ) : null}
            </>
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
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
