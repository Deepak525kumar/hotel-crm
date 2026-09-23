import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import { POLL_INTERVAL_MS, ThemedText, api, useTheme } from '@hotel-crm/mobile-shared';

/**
 * The unread bell.
 *
 * The app had no notification affordance anywhere: notifications arrived,
 * the list existed, and nothing on any screen said so — reported by the
 * project owner as "I don't see a notification icon in this app".
 *
 * Polls on the app's shared 60s interval rather than a tighter one of its
 * own. Every round trip here is on a hotel's mobile data, and a manager does
 * not need sub-minute latency on a badge.
 *
 * The count is capped at 9+: a two-digit badge on a 24pt glyph is unreadable,
 * and past a point the exact number stops changing what anyone does.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const theme = useTheme();

  const { data } = useSWR('notifications/unread', () => api.notifications.list(), {
    refreshInterval: POLL_INTERVAL_MS,
    revalidateOnFocus: true,
  });

  const unread = (data ?? []).filter((n) => !n.read_at).length;

  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      // The count is in the label, so a screen reader hears "Notifications, 3
      // unread" rather than just "Notifications".
      accessibilityLabel={
        unread > 0 ? `${t('nav.notifications')}, ${unread}` : t('nav.notifications')
      }
      hitSlop={8}
      style={styles.wrap}
    >
      <ThemedText style={styles.glyph}>◔</ThemedText>
      {unread > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.danger }]}>
          <ThemedText type="small" style={[styles.badgeText, { color: theme.onPrimary }]}>
            {unread > 9 ? '9+' : unread}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 44pt: the platform minimum for a tap target, even though the glyph is
  // smaller. hitSlop widens it further for a thumb.
  wrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 22 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, lineHeight: 14 },
});
