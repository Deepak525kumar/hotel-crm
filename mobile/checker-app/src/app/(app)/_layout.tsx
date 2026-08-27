import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { PushRegistration } from '@/components/PushRegistration';

/**
 * Four tabs: Home, Schedule, Attendance, Profile — the same bar the worker app
 * has, in the same order.
 *
 * It used to be Queue, Leaderboard, Sick/Vacation, Profile, which shared no
 * shape with the worker app and opened onto an attendance queue rather than a
 * home screen. A checker works a shift exactly as a worker does; the two apps
 * differing in their primary navigation made the checker app read as a
 * different product rather than the same one in a different role.
 *
 * `headerShown` is false, as it is in worker-app. It was true here, so
 * expo-router drew its own header bar carrying the route title ON TOP of each
 * screen's own <ScreenHeader> — every screen showed its name twice.
 *
 * Moved off the bar, still reachable:
 *
 *   - `leaderboard` and `absences` are rows on Profile. The old Queue
 *     screen (attendance verification) was dropped entirely -- checkers do
 *     not verify attendance.
 *   - `notifications` is the header bell, as in worker-app.
 *
 * `href: null` keeps a route navigable while hiding its tab, which is why they
 * are declared rather than deleted.
 *
 * <PushRegistration /> sits inside the consent gate (applied at the root
 * layout) deliberately — see worker-app's copy of this note for the 403 it
 * otherwise takes on mount.
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
          name="attendance"
          options={{
            title: t('nav.attendance'),
            tabBarIcon: ({ color, size }) => (
              <SymbolView
                name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
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
        <Tabs.Screen name="leaderboard" options={{ href: null }} />
        <Tabs.Screen name="absences" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
      </Tabs>
    </>
  );
}
