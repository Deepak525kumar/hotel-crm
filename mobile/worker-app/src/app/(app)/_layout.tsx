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
          headerShown: false,
          tabBarStyle: { backgroundColor: theme.background },
          tabBarActiveTintColor: theme.text,
          tabBarInactiveTintColor: theme.textSecondary,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('nav.dashboard'),
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
            title: t('nav.jobs'),
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
            title: t('nav.myShifts'),
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
            title: t('nav.sickVacation'),
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
            title: t('nav.alerts'),
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
