import { useEffect } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTheme } from '@/hooks/use-theme';
import { registerForPushNotificationsAsync, subscribeToPushNotifications } from '@/lib/push-notifications';
import { useTranslation } from 'react-i18next';

export default function AppLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  // Register this device for push once per app launch (Epic 7 PR 7.7).
  // Placed in the (app) layout rather than the root layout because this tree
  // only renders for a signed-in user (app/index.tsx redirects otherwise), and
  // the backend endpoint is authenticated. Running on every launch is
  // intentional: device tokens rotate, and the backend upsert is keyed by
  // token, so re-registration is idempotent and reassigns ownership if a
  // different user has since signed in on this device.
  //
  // This effect does NOT re-fire on tab navigation: this component is the
  // Tabs navigator itself, which React Navigation mounts once per (app)-group
  // entry and keeps alive across tab switches (no `key` prop forces a
  // remount, and this app does not use StrictMode, so there's no dev-only
  // double-invoke either). The one real remount path is logout -> login,
  // which is the intended re-registration case above, not a bug.
  useEffect(() => {
    void registerForPushNotificationsAsync();
  }, []);

  // Foreground banner + tap-to-Alerts-tab routing for incoming push. Same
  // once-per-(app)-mount lifecycle reasoning as the registration effect
  // above; the listener is removed on unmount rather than left dangling.
  useEffect(() => {
    return subscribeToPushNotifications(router);
  }, [router]);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarStyle: { backgroundColor: theme.background },
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { color: theme.text },
        headerShadowVisible: false,
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.queue'),
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'list.bullet.clipboard', android: 'assignment', web: 'assignment' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: t('nav.leaderboard'),
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'trophy', android: 'emoji_events', web: 'emoji_events' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="absences"
        options={{
          title: t('nav.sickVacation'),
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'calendar.badge.exclamationmark', android: 'event_busy', web: 'event_busy' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t('nav.alerts'),
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'person.circle', android: 'account_circle', web: 'account_circle' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
