import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { ConsentGate } from '@/components/consent/ConsentGate';
import { PushRegistration } from '@/components/PushRegistration';

export default function AppLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  // RULE-CONSENT-01: the daily notice must be accepted before the worker can
  // use the system. Wrapping the (app) tree rather than the root layout
  // because this tree only renders for a signed-in user and the consent
  // endpoints are authenticated.
  //
  // <PushRegistration /> sits INSIDE the gate deliberately. It used to be two
  // useEffects on this component, which React runs on mount whatever the
  // component renders -- so with the gate live they fired against a gated
  // /notifications route, took a swallowed 403, and never retried that
  // session. As a child of the gate, mount implies consent.
  return (
    <ConsentGate>
      <PushRegistration />
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
    </ConsentGate>
  );
}
