import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { useTranslation } from 'react-i18next';

import { useTheme } from '@hotel-crm/mobile-shared';
import { PushRegistration } from '@/components/PushRegistration';

/**
 * The tab bar.
 *
 * The web sidebar has eighteen entries. Eighteen does not become eighteen
 * tabs: the bar is for what a supervisor touches during a shift, and
 * everything else is reachable from `More`. worker-app went from six tabs to
 * three for exactly this reason -- two of its tabs showed the same
 * assignments behind near-identical calendar icons, and the bar stopped being
 * scannable at a glance.
 *
 * Tabs land with the PRs that build their screens (MANAGER_APP_PLAN.md §7).
 * Five tabs: Today, Rota, Team, Attendance, More. Everything else on the
 * web's eighteen-entry sidebar is reachable from More rather than competing
 * for a slot in a bar that stops being scannable past five. A tab is declared here only once the screen behind it does
 * something -- a tab that opens an empty page is worse than no tab, because
 * it reads as a broken app rather than an unfinished one.
 *
 * <PushRegistration /> sits here, inside the consent gate applied at the root
 * layout. In worker-app it was two useEffects on this component, which React
 * runs on mount whatever the component renders -- so with the gate live they
 * fired against a gated /notifications route, took a swallowed 403, and never
 * retried for the rest of the session.
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
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('nav.home'),
            tabBarIcon: ({ color }) => (
              <SymbolView name="square.grid.2x2" tintColor={color} size={24} />
            ),
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: t('nav.calendar'),
            tabBarIcon: ({ color }) => (
              <SymbolView name="calendar" tintColor={color} size={24} />
            ),
          }}
        />
        <Tabs.Screen
          name="team"
          options={{
            title: t('nav.users'),
            tabBarIcon: ({ color }) => (
              <SymbolView name="person.2" tintColor={color} size={24} />
            ),
          }}
        />
        {/* ATTENDANCE IS HIDDEN, NOT DELETED (2026-09-23, project owner).
            `href: null` keeps the route navigable while removing its tab —
            the WORKER_NO_SHOW push deep-links to `/attendance/:id`, and
            deleting the screens would create exactly the dead link this app
            has already shipped three times. Hidden for all three roles, so
            nothing here branches on who is looking. */}
        <Tabs.Screen name="attendance" options={{ href: null }} />
        <Tabs.Screen
          name="more"
          options={{
            title: t('nav.more'),
            tabBarIcon: ({ color }) => (
              <SymbolView name="ellipsis.circle" tintColor={color} size={24} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
