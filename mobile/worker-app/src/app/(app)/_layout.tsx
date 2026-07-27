import { useEffect } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTheme } from '@/hooks/use-theme';
import { registerForPushNotificationsAsync, subscribeToPushNotifications } from '@/lib/push-notifications';

export default function AppLayout() {
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
        headerShown: false,
        tabBarStyle: { backgroundColor: theme.background },
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'house.fill', android: 'home', web: 'home' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="marketplace"
        options={{
          title: 'Jobs',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'briefcase.fill', android: 'work', web: 'work' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="shifts"
        options={{
          title: 'My Shifts',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'calendar', android: 'calendar_today', web: 'calendar_today' }}
              tintColor={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="absences"
        options={{
          title: 'Sick/Vacation',
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'cross.case.fill', android: 'medical_services', web: 'medical_services' }}
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
              name={{ ios: 'bell.fill', android: 'notifications', web: 'notifications' }}
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
