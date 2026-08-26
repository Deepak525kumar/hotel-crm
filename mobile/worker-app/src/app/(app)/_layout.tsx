import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { PushRegistration } from '@/components/PushRegistration';

/**
 * Three tabs: Home, Schedule, Profile.
 *
 * There were six (Dashboard, Jobs, My Shifts, Calendar, Alerts, Profile), two
 * of which -- "My Shifts" and "Calendar" -- showed the same assignments behind
 * near-identical calendar icons, so the bar could not be scanned at a glance.
 * The routes still exist and are still reachable; they are simply no longer
 * all competing for a slot in the tab bar:
 *
 *   - `marketplace` (Jobs) is a section on Home, and a full screen from there.
 *   - `calendar` is a view mode inside Schedule.
 *   - `notifications` is a header bell with an unread badge on Home.
 *
 * `href: null` keeps a route navigable while hiding its tab, which is why the
 * screens below are declared rather than deleted.
 *
 * <PushRegistration /> sits inside the consent gate (applied at the root
 * layout) deliberately. It used to be two useEffects on this component, which
 * React runs on mount whatever the component renders -- so with the gate live
 * they fired against a gated /notifications route, took a swallowed 403, and
 * never retried that session.
 */
export default function AppLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <>
      <PushRegistration />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.backgroundElement,
            borderTopColor: theme.border,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textSecondary,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('nav.home', 'Home'),
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
          name="shifts"
          options={{
            title: t('nav.schedule', 'Schedule'),
            tabBarIcon: ({ color, size }) => (
              <SymbolView
                name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
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

        {/* Reachable by navigation, not by tab. See the comment above. */}
        <Tabs.Screen name="marketplace" options={{ href: null }} />
        <Tabs.Screen name="calendar" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
      </Tabs>
    </>
  );
}
