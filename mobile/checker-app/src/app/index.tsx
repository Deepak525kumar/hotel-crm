import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/hooks/use-theme';

export default function Index() {
  const { user, isInitialized } = useAuthStore();
  const theme = useTheme();

  if (!isInitialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  if (user) {
    return <Redirect href="/(app)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
