import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { PushRegistration } from '@/components/PushRegistration';

/**
 * Five tabs: Home, Schedule, Attendance, History, Profile. The first three and
 * the last are the same bar the worker app has, in the same order.
 *
 * `history` is the one tab this app has that worker-app does not, and it is
 * role-specific rather than a copy: it lists the shifts THIS checker scored.
 * Before it, the app had no route back to a past inspection at all — both
 * evidence screens are keyed by a record id and nothing handed one out after
 * the fact, so a checker could not review their own scores or photos, and
 * "Assign rework" (CRR §14) was reachable only in the seconds after
 * submitting a verification or by tapping a REWORK_COMPLETED push.
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
 *   - `leaderboard` is a row on Profile.
 *   - `calendar` is a view mode inside Schedule, exactly as in worker-app --
 *     see its own header comment. It replaces the standalone Sick/Vacation
 *     screen this app used to have: worker-app has never had two separate
 *     absence-marking surfaces, and keeping this app's old one alongside a
 *     ported calendar.tsx would have meant two screens independently
 *     calling markAbsence/deleteAbsence against the same record, with no
 *     shared state between them.
 *   - The old Queue screen (attendance verification) was dropped entirely --
 *     checkers do not verify attendance.
 *   - `jobs` (worker-app calls its equivalent "marketplace") is a section on
 *     Home, and a full screen from there, exactly as in worker-app -- see its
 *     own header comment. Every row it shows is CHECKER-targeted, enforced
 *     server-side (job-requests/service.ts), not by anything in this app.
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
          name="history"
          options={{
            title: t('nav.history'),
            tabBarIcon: ({ color, size }) => (
              <SymbolView
                name={{ ios: 'checklist', android: 'fact_check', web: 'fact_check' }}
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
        <Tabs.Screen name="calendar" options={{ href: null }} />
        <Tabs.Screen name="jobs" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
      </Tabs>
    </>
  );
}
