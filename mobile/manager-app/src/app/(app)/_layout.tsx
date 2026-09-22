import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

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
 * Today is the shell's own screen; Rota, Team, Attendance and More follow in
 * PR-4, PR-9, PR-7 and PR-13. A tab is declared here only once the screen
 * behind it does something -- a tab that opens an empty page is worse than no
 * tab, because it reads as a broken app rather than an unfinished one.
 *
 * <PushRegistration /> sits here, inside the consent gate applied at the root
 * layout. In worker-app it was two useEffects on this component, which React
 * runs on mount whatever the component renders -- so with the gate live they
 * fired against a gated /notifications route, took a swallowed 403, and never
 * retried for the rest of the session.
 */
export default function AppLayout() {
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
            title: 'Today',
            tabBarIcon: ({ color }) => (
              <SymbolView name="square.grid.2x2" tintColor={color} size={24} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
