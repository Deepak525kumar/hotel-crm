import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';

import { useAuthStore, useTheme } from '@hotel-crm/mobile-shared';
import { admit } from '@/lib/role-admission';

export default function Index() {
  const { user, isInitialized } = useAuthStore();
  const theme = useTheme();

  if (!isInitialized) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/(auth)/login" />;

  // A worker or checker who signs in here is sent somewhere that explains
  // itself, rather than to a dashboard whose every request 403s.
  const admission = admit(user);
  if (admission.kind !== 'admitted') return <Redirect href="/wrong-app" />;

  return <Redirect href="/(app)" />;
}
