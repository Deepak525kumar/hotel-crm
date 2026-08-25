import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { PushRegistration } from '@/components/PushRegistration';

export default function AppLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <>
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
    </>
  );
}
