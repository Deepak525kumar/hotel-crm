import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTheme } from '@/hooks/use-theme';
import { registerForPushNotificationsAsync } from '@/lib/push-notifications';

export default function AppLayout() {
  const theme = useTheme();

  // Register this device for push once per app launch (Epic 7 PR 7.7).
  // Placed in the (app) layout rather than the root layout because this tree
  // only renders for a signed-in user (app/index.tsx redirects otherwise), and
  // the backend endpoint is authenticated. Running on every launch is
  // intentional: device tokens rotate, and the backend upsert is keyed by
  // token, so re-registration is idempotent and reassigns ownership if a
  // different user has since signed in on this device.
  useEffect(() => {
    void registerForPushNotificationsAsync();
  }, []);

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
          title: 'Queue',
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
          title: 'Leaderboard',
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
        name="notifications"
        options={{
          title: 'Alerts',
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
          title: 'Profile',
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
