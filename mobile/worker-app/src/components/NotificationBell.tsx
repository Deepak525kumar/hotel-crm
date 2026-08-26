import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useNotificationStore } from '@/stores/notification-store';

/** Bell with an unread badge, for a screen header. */
export function NotificationBell() {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const unread = useNotificationStore((s) => s.unread);
  const subscribe = useNotificationStore((s) => s.subscribe);

  // Ref-counted in the store: several bells are mounted at once (Expo Router
  // keeps visited tabs alive), but only one timer runs.
  useEffect(() => subscribe(), [subscribe]);

  return (
    <Pressable
      onPress={() => router.push('/(app)/notifications')}
      accessibilityRole="button"
      accessibilityLabel={t('nav.alerts')}
      hitSlop={8}
    >
      <SymbolView name={{ ios: 'bell', android: 'notifications', web: 'notifications' }} tintColor={theme.text} size={24} />
      {unread > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.danger }]}>
          <ThemedText style={[styles.count, { color: theme.onPrimary }]}>
            {unread > 9 ? '9+' : unread}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontSize: 10, fontWeight: '700' },
});
