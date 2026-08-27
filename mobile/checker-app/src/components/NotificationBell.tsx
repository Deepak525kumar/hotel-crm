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
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.7 : 1 }]}
    >
      <SymbolView
        name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
        tintColor={theme.text}
        size={24}
      />
      {unread > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.background }]}>
          <ThemedText style={[styles.count, { color: theme.onPrimary }]} numberOfLines={1}>
            {unread > 9 ? '9+' : unread}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The badge used to be pinned at top:-4/right:-6 on a Pressable that sized
  // itself to the 24px icon, so it sat OUTSIDE its parent's bounds -- Android
  // clips that, and on iOS it collided with whatever sat beside it. The button
  // now reserves the room the badge needs and the badge stays inside it.
  button: { width: 34, height: 30, alignItems: 'flex-start', justifyContent: 'flex-end' },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    // Separates the badge from the bell it overlaps, in either theme.
    borderWidth: 2,
  },
  // lineHeight matched to the circle and font padding off: without both, the
  // digit sits low and looks off-centre inside the dot.
  count: { fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center', includeFontPadding: false },
});
